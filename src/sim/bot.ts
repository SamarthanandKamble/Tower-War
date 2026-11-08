import { COLS, ROWS, TILE, NORTH_ROUTE_WAVE, PathId } from '../data/map';
import { TowerId } from '../data/towers';
import type { BakedPath } from './path';
import type { World } from './world';

export interface BotProfile {
  name: string;
  maxTowers: number;
  maxLevel: number;
  /** Tower types built in order, repeating. */
  buildOrder: TowerId[];
}

const { Gatling, Cannon, Frost, Tesla, Railgun } = {
  Gatling: TowerId.Gatling,
  Cannon: TowerId.Cannon,
  Frost: TowerId.Frost,
  Tesla: TowerId.Tesla,
  Railgun: TowerId.Railgun,
};

export const BOT_PROFILES: Record<'strong' | 'average' | 'weak', BotProfile> = {
  strong: {
    name: 'strong', maxTowers: 140, maxLevel: 3,
    buildOrder: [Gatling, Gatling, Cannon, Gatling, Frost, Cannon, Tesla, Railgun, Cannon, Tesla, Frost, Railgun],
  },
  average: {
    name: 'average', maxTowers: 40, maxLevel: 2,
    buildOrder: [Gatling, Cannon, Gatling, Frost, Tesla, Railgun, Cannon, Gatling],
  },
  weak: { name: 'weak', maxTowers: 8, maxLevel: 1, buildOrder: [Gatling] },
};

const ACT_INTERVAL_TICKS = 10;
const COVERAGE_RADIUS = 130;

/** Plays through the public command API only, so it cannot do what a player can't. */
export class Bot {
  private buildIndex = 0;
  private tiles: number[] = [];
  private tilesIncludeNorth = false;

  constructor(private readonly profile: BotProfile) {}

  private rankTiles(world: World, includeNorth: boolean): void {
    this.tilesIncludeNorth = includeNorth;
    const routes: BakedPath[] = [world.paths[PathId.Main]];
    if (includeNorth) routes.push(world.paths[PathId.North]);
    const score = new Float64Array(COLS * ROWS);
    const r2 = COVERAGE_RADIUS * COVERAGE_RADIUS;
    for (let tile = 0; tile < score.length; tile++) {
      if (world.blocked[tile]) continue;
      const x = ((tile % COLS) + 0.5) * TILE;
      const y = (Math.floor(tile / COLS) + 0.5) * TILE;
      for (const path of routes) {
        for (let i = 0; i <= path.lastIndex; i += 2) {
          const dx = path.xs[i] - x;
          const dy = path.ys[i] - y;
          if (dx * dx + dy * dy <= r2) score[tile]++;
        }
      }
    }
    this.tiles = Array.from(score.keys()).filter((t) => score[t] > 0).sort((a, b) => score[b] - score[a]);
  }

  act(world: World): void {
    if (world.tick % ACT_INTERVAL_TICKS !== 0) return;
    if (world.phase === 'prep') world.startNextWave();

    const includeNorth = world.waveNumber + 1 >= NORTH_ROUTE_WAVE - 1;
    if (this.tiles.length === 0 || includeNorth !== this.tilesIncludeNorth) this.rankTiles(world, includeNorth);

    while (this.spend(world)) {
      // Keep spending until the next purchase is unaffordable.
    }
  }

  private spend(world: World): boolean {
    const wanted = Math.min(this.profile.maxTowers, 6 + world.waveNumber * 1.5);
    if (world.towerCount < wanted) return this.build(world);
    return this.upgrade(world) || (world.towerCount < this.profile.maxTowers && this.build(world));
  }

  private build(world: World): boolean {
    const order = this.profile.buildOrder;
    const type = order[this.buildIndex % order.length];
    for (const tile of this.tiles) {
      const col = tile % COLS;
      const row = Math.floor(tile / COLS);
      if (!world.canBuild(col, row)) continue;
      if (world.placeTower(type, col, row) < 0) return false;
      this.buildIndex++;
      return true;
    }
    return false;
  }

  private upgrade(world: World): boolean {
    let best = -1;
    let bestCost = Infinity;
    for (let d = 0; d < world.towerCount; d++) {
      const t = world.tDense[d];
      if (world.tLevel[t] >= this.profile.maxLevel) continue;
      const cost = world.upgradeCost(t);
      if (cost !== null && cost < bestCost) {
        bestCost = cost;
        best = t;
      }
    }
    return best >= 0 && world.upgradeTower(best);
  }
}
