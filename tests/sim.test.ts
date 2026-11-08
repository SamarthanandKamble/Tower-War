import { describe, expect, it } from 'vitest';
import { TOTAL_WAVES, WAVES } from '../src/data/waves';
import { TOWERS } from '../src/data/towers';
import { Bot, BOT_PROFILES } from '../src/sim/bot';
import { UniformGrid } from '../src/sim/grid';
import { FixedStepper } from '../src/sim/loop';
import { DIFFICULTIES, DT, World } from '../src/sim/world';

function buildOpening(world: World) {
  world.placeTower(0, 5, 5);
  world.placeTower(1, 10, 10);
  world.placeTower(0, 9, 8);
}

/** Runs a fixed amount of game time under one display's frame-time pattern. */
function playAt(frameMs: (frame: number) => number, ticks: number): World {
  const world = new World(42);
  buildOpening(world);
  world.startNextWave();
  const stepper = new FixedStepper();
  let frame = 0;
  while (world.tick < ticks) {
    const remaining = (ticks - world.tick) * DT;
    // Land on the exact tick so every run compares the same simulation moment.
    stepper.advance(Math.min(frameMs(frame++) / 1000, remaining + DT / 2), () => world.step());
  }
  return world;
}

describe('UniformGrid', () => {
  it('finds exactly the points a brute-force search finds', () => {
    const count = 2000;
    const world = new World(7);
    world.setStress({ enemies: count, towers: 0, projectiles: 0 });
    world.grid.rebuild(world.eDense, world.enemyCount, world.eX, world.eY);
    const out = new Int32Array(count);
    for (const [x, y, r] of [[400, 300, 150], [10, 10, 80], [1800, 1000, 300], [960, 560, 40]]) {
      world.options.spatialGrid = true;
      const fromGrid = Array.from(out.subarray(0, world.queryRadius(x, y, r, out))).sort((a, b) => a - b);
      world.options.spatialGrid = false;
      const fromBrute = Array.from(out.subarray(0, world.queryRadius(x, y, r, out))).sort((a, b) => a - b);
      expect(fromGrid).toEqual(fromBrute);
    }
  });

  it('places every id in the cell range matching its position', () => {
    const grid = new UniformGrid(100, 100, 10, 8);
    const xs = new Float32Array([5, 15, 15, 95, -20, 500, 5, 55]);
    const ys = new Float32Array([5, 5, 5, 95, 5, 500, 5, 55]);
    const ids = new Int32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    grid.rebuild(ids, 8, xs, ys);
    const cell = (x: number, y: number) => {
      const c = y * grid.cols + x;
      return Array.from(grid.items.subarray(grid.cellStart[c], grid.cellStart[c + 1])).sort();
    };
    expect(cell(0, 0)).toEqual([0, 4, 6]);
    expect(cell(1, 0)).toEqual([1, 2]);
    expect(cell(5, 5)).toEqual([7]);
    expect(cell(9, 9)).toEqual([3, 5]);
    expect(grid.cellStart[grid.cols * grid.rows]).toBe(8);
  });
});

describe('determinism across refresh rates', () => {
  const TICKS = 1800;
  const reference = playAt(() => 1000 / 60, TICKS).stateHash();
  const displays: [string, (f: number) => number][] = [
    ['30 Hz', () => 1000 / 30],
    ['75 Hz', () => 1000 / 75],
    ['120 Hz', () => 1000 / 120],
    ['144 Hz', () => 1000 / 144],
    ['240 Hz', () => 1000 / 240],
    ['jittery', (f) => [7, 33, 16, 21, 4, 40, 11][f % 7]],
  ];
  for (const [name, pattern] of displays) {
    it(`matches the 60 Hz run at ${name}`, () => {
      expect(playAt(pattern, TICKS).stateHash()).toBe(reference);
    });
  }

  it('produces a different game from a different seed', () => {
    const a = new World(1);
    const b = new World(2);
    for (const w of [a, b]) {
      w.startNextWave();
      for (let i = 0; i < 300; i++) w.step();
    }
    expect(a.stateHash()).not.toBe(b.stateHash());
  });
});

describe('game rules', () => {
  it('defines 50 waves that keep getting harder', () => {
    expect(TOTAL_WAVES).toBeGreaterThanOrEqual(50);
    expect(WAVES).toHaveLength(TOTAL_WAVES);
    const threat = WAVES.map((w) => w.hpScale * w.groups.reduce((sum, g) => sum + g.count, 0));
    for (const start of [0, 10, 20, 30, 40]) expect(threat[start + 9]).toBeGreaterThan(threat[start]);
  });

  it('charges for placement, upgrade, and refunds on sale', () => {
    const world = new World(1);
    const start = world.money;
    const cost = TOWERS[0].levels[0].cost;
    const t = world.placeTower(0, 5, 5);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(world.money).toBe(start - cost);
    expect(world.placeTower(0, 5, 5)).toBe(-1);
    expect(world.upgradeTower(t)).toBe(true);
    const spent = cost + TOWERS[0].levels[1].cost;
    expect(world.money).toBe(start - spent);
    expect(world.sellTower(t)).toBe(true);
    expect(world.money).toBe(start - spent + Math.floor(spent * 0.7));
    expect(world.canBuild(5, 5)).toBe(true);
  });

  it('refuses to build on the route or without funds', () => {
    const world = new World(1);
    expect(world.placeTower(0, 8, 10)).toBe(-1);
    world.money = 0;
    expect(world.placeTower(0, 5, 5)).toBe(-1);
  });

  it('kills enemies, pays bounties, and scores', () => {
    const world = new World(1);
    buildOpening(world);
    world.startNextWave();
    const start = world.money;
    for (let i = 0; i < 2400 && world.kills === 0; i++) world.step();
    expect(world.kills).toBeGreaterThan(0);
    expect(world.money).toBeGreaterThan(start);
    expect(world.score).toBeGreaterThan(0);
  });

  it('ends in defeat when undefended', () => {
    const world = new World(1, DIFFICULTIES.hard);
    for (let i = 0; i < 400000 && world.phase !== 'lost'; i++) {
      if (world.phase === 'prep') world.startNextWave();
      world.step();
    }
    expect(world.phase).toBe('lost');
    expect(world.lives).toBe(0);
  });

  it('holds exact counts in the stress scenario', () => {
    const world = new World(3);
    world.setStress({ enemies: 5000, towers: 100, projectiles: 1000 });
    for (let i = 0; i < 300; i++) {
      world.step();
      expect(world.enemyCount).toBe(5000);
      expect(world.towerCount).toBe(100);
      expect(world.projectileCount).toBe(1000);
    }
  });
});

describe('balance', () => {
  function playOut(profile: keyof typeof BOT_PROFILES, seed: number): World {
    const world = new World(seed);
    const bot = new Bot(BOT_PROFILES[profile]);
    for (let i = 0; i < 2_000_000 && world.phase !== 'won' && world.phase !== 'lost'; i++) {
      bot.act(world);
      world.step();
      world.fx.clear();
    }
    return world;
  }

  it('lets good play win all 50 waves', { timeout: 60_000 }, () => {
    const world = playOut('strong', 1);
    expect(world.phase).toBe('won');
    expect(world.waveNumber).toBe(TOTAL_WAVES);
  });

  it('defeats weak play well before the end', { timeout: 60_000 }, () => {
    const world = playOut('weak', 1);
    expect(world.phase).toBe('lost');
    expect(world.waveNumber).toBeLessThan(25);
  });
});
