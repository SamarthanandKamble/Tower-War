import { BOSS_MIN_SLOW, ENEMIES, EnemyFlag, EnemyId, MIN_DAMAGE_FRACTION } from '../data/enemies';
import { BASE_TILE, COLS, GROUND_ROUTES, ROUTES, ROWS, TILE, WORLD_HEIGHT, WORLD_WIDTH } from '../data/map';
import { MAX_TOWER_LEVEL, SELL_REFUND, TargetPriority, TOWERS, TowerKind } from '../data/towers';
import { FIRST_PREP_SECONDS, PREP_SECONDS, TOTAL_WAVES, WAVES, type SpawnGroup, type WaveDef } from '../data/waves';
import { FxKind, FxQueue } from './fx';
import { UniformGrid } from './grid';
import { BakedPath } from './path';
import { Rng } from './rng';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export const MAX_ENEMIES = 1 << 17;
export const MAX_PROJECTILES = 1 << 16;
export const MAX_TOWERS = COLS * ROWS;

const GRID_CELL = 64;
const RETARGET_INTERVAL = 12;
const PROJECTILE_HIT_RADIUS = 6;
const CHAIN_JUMP_RANGE = 90;
const SLOW_DURATION_TICKS = 30;
const REVEAL_DURATION_TICKS = 45;
const STRESS_HP_FLOOR = 0.25;
const STRESS_PROJECTILE_SPEED = 420;
const NO_TARGET = -1;

export type Phase = 'prep' | 'active' | 'won' | 'lost';

export interface Difficulty {
  name: string;
  lives: number;
  money: number;
  hpMult: number;
  scoreMult: number;
}

export const DIFFICULTIES: Record<'normal' | 'hard', Difficulty> = {
  normal: { name: 'Normal', lives: 40, money: 280, hpMult: 1, scoreMult: 1 },
  hard: { name: 'Hard', lives: 20, money: 220, hpMult: 1.3, scoreMult: 1.6 },
};

export interface StressConfig {
  enemies: number;
  towers: number;
  projectiles: number;
}

/** Runtime switches that let the benchmark show what each technique buys. */
export interface SimOptions {
  spatialGrid: boolean;
}

export class World {
  readonly rng: Rng;
  readonly fx = new FxQueue();
  readonly paths: BakedPath[] = ROUTES.map((r) => new BakedPath(r));
  readonly options: SimOptions = { spatialGrid: true };
  readonly difficulty: Difficulty;

  tick = 0;
  phase: Phase = 'prep';
  money: number;
  lives: number;
  score = 0;
  kills = 0;
  leaks = 0;
  /** Number of the wave most recently started. 0 before the first wave. */
  waveNumber = 0;
  prepTicks = FIRST_PREP_SECONDS * TICK_RATE;
  stress: StressConfig | null = null;

  // Enemies, stored by stable slot. eDense lists live slots for iteration.
  readonly eX = new Float32Array(MAX_ENEMIES);
  readonly eY = new Float32Array(MAX_ENEMIES);
  readonly ePrevX = new Float32Array(MAX_ENEMIES);
  readonly ePrevY = new Float32Array(MAX_ENEMIES);
  readonly eDist = new Float32Array(MAX_ENEMIES);
  readonly eLane = new Float32Array(MAX_ENEMIES);
  readonly eHp = new Float32Array(MAX_ENEMIES);
  readonly eMaxHp = new Float32Array(MAX_ENEMIES);
  readonly eSlow = new Float32Array(MAX_ENEMIES);
  readonly eSlowUntil = new Int32Array(MAX_ENEMIES);
  readonly eRevealUntil = new Int32Array(MAX_ENEMIES);
  readonly eHitTick = new Int32Array(MAX_ENEMIES);
  readonly eType = new Uint8Array(MAX_ENEMIES);
  readonly ePath = new Uint8Array(MAX_ENEMIES);
  readonly eImmortal = new Uint8Array(MAX_ENEMIES);
  readonly eGen = new Uint16Array(MAX_ENEMIES);
  readonly eDenseIndex = new Int32Array(MAX_ENEMIES).fill(-1);
  readonly eDense = new Int32Array(MAX_ENEMIES);
  private readonly eFree = new Int32Array(MAX_ENEMIES);
  private eFreeCount = MAX_ENEMIES;
  enemyCount = 0;

  // Projectiles.
  readonly pX = new Float32Array(MAX_PROJECTILES);
  readonly pY = new Float32Array(MAX_PROJECTILES);
  readonly pPrevX = new Float32Array(MAX_PROJECTILES);
  readonly pPrevY = new Float32Array(MAX_PROJECTILES);
  private readonly pTargetX = new Float32Array(MAX_PROJECTILES);
  private readonly pTargetY = new Float32Array(MAX_PROJECTILES);
  private readonly pDamage = new Float32Array(MAX_PROJECTILES);
  private readonly pSplash = new Float32Array(MAX_PROJECTILES);
  private readonly pSpeed = new Float32Array(MAX_PROJECTILES);
  private readonly pTarget = new Int32Array(MAX_PROJECTILES);
  private readonly pTargetGen = new Uint16Array(MAX_PROJECTILES);
  private readonly pSource = new Int32Array(MAX_PROJECTILES);
  readonly pKind = new Uint8Array(MAX_PROJECTILES);
  private readonly pIgnoreArmor = new Uint8Array(MAX_PROJECTILES);
  projectileCount = 0;

  // Towers, stored by stable slot so the UI can hold on to a selection.
  readonly tX = new Float32Array(MAX_TOWERS);
  readonly tY = new Float32Array(MAX_TOWERS);
  readonly tAngle = new Float32Array(MAX_TOWERS);
  readonly tPrevAngle = new Float32Array(MAX_TOWERS);
  readonly tRange = new Float32Array(MAX_TOWERS);
  private readonly tCooldown = new Float32Array(MAX_TOWERS);
  private readonly tTarget = new Int32Array(MAX_TOWERS).fill(NO_TARGET);
  private readonly tTargetGen = new Uint16Array(MAX_TOWERS);
  readonly tType = new Uint8Array(MAX_TOWERS);
  readonly tLevel = new Uint8Array(MAX_TOWERS);
  readonly tPriority = new Uint8Array(MAX_TOWERS);
  readonly tSpent = new Float32Array(MAX_TOWERS);
  readonly tCol = new Int16Array(MAX_TOWERS);
  readonly tRow = new Int16Array(MAX_TOWERS);
  readonly tKills = new Int32Array(MAX_TOWERS);
  readonly tFireTick = new Int32Array(MAX_TOWERS);
  readonly tGen = new Uint16Array(MAX_TOWERS);
  readonly tDense = new Int32Array(MAX_TOWERS);
  readonly tDenseIndex = new Int32Array(MAX_TOWERS).fill(-1);
  private readonly tFree = new Int32Array(MAX_TOWERS);
  private tFreeCount = MAX_TOWERS;
  towerCount = 0;

  /** 0 = open ground, 1 = route or base. */
  readonly blocked = new Uint8Array(COLS * ROWS);
  /** Tower slot + 1, or 0 when the tile is empty. */
  readonly occupied = new Int32Array(COLS * ROWS);

  readonly grid = new UniformGrid(WORLD_WIDTH, WORLD_HEIGHT, GRID_CELL, MAX_ENEMIES);
  private readonly scratch = new Int32Array(MAX_ENEMIES);
  private readonly chainHits = new Int32Array(32);

  private wave: WaveDef | null = null;
  private waveStartTick = 0;
  private readonly groupRemaining = new Int32Array(16);
  private readonly groupSpawned = new Int32Array(16);

  constructor(seed = 1, difficulty: Difficulty = DIFFICULTIES.normal) {
    this.rng = new Rng(seed);
    this.difficulty = difficulty;
    this.money = difficulty.money;
    this.lives = difficulty.lives;
    for (let i = 0; i < MAX_ENEMIES; i++) this.eFree[i] = MAX_ENEMIES - 1 - i;
    for (let i = 0; i < MAX_TOWERS; i++) this.tFree[i] = MAX_TOWERS - 1 - i;
    this.markBlockedTiles();
  }

  private markBlockedTiles(): void {
    const mark = (c: number, r: number) => {
      if (c >= 0 && r >= 0 && c < COLS && r < ROWS) this.blocked[r * COLS + c] = 1;
    };
    for (const id of GROUND_ROUTES) {
      const route = ROUTES[id];
      for (let i = 0; i < route.length - 1; i++) {
        let [c, r] = route[i];
        const [ec, er] = route[i + 1];
        for (;;) {
          mark(c, r);
          if (c === ec && r === er) break;
          c += Math.sign(ec - c);
          r += Math.sign(er - r);
        }
      }
    }
    const [bc, br] = BASE_TILE;
    for (let r = br - 1; r <= br + 1; r++) for (let c = bc - 1; c <= bc + 1; c++) mark(c, r);
  }

  // ---- Simulation -----------------------------------------------------------

  step(): void {
    if (this.phase === 'won' || this.phase === 'lost') return;
    if (!this.stress) this.updateWave();
    this.moveEnemies();
    this.grid.rebuild(this.eDense, this.enemyCount, this.eX, this.eY);
    this.updateTowers();
    this.updateProjectiles();
    if (this.stress) this.maintainStress(this.stress);
    this.tick++;
  }

  private updateWave(): void {
    if (this.phase === 'prep') {
      if (--this.prepTicks <= 0) this.startNextWave();
      return;
    }
    const wave = this.wave;
    if (!wave) return;
    const elapsed = this.tick - this.waveStartTick;
    let pending = false;
    for (let g = 0; g < wave.groups.length; g++) {
      if (this.groupRemaining[g] === 0) continue;
      pending = true;
      const group = wave.groups[g];
      if (elapsed < group.delay || (elapsed - group.delay) % group.gap !== 0) continue;
      const route = group.paths[this.groupSpawned[g] % group.paths.length];
      this.spawnEnemy(group.type, route, wave.hpScale * this.difficulty.hpMult);
      this.groupSpawned[g]++;
      this.groupRemaining[g]--;
    }
    if (!pending && this.enemyCount === 0) this.finishWave();
  }

  /** Calling a wave before its timer runs out pays a bonus for the time saved. */
  startNextWave(): boolean {
    if (this.phase !== 'prep' || this.stress || this.waveNumber >= TOTAL_WAVES) return false;
    const bonus = Math.floor(this.prepTicks / TICK_RATE);
    if (bonus > 0 && this.waveNumber > 0) {
      this.money += bonus;
      this.score += bonus * 5;
    }
    this.waveNumber++;
    const wave = WAVES[this.waveNumber - 1];
    this.wave = wave;
    this.waveStartTick = this.tick;
    wave.groups.forEach((group: SpawnGroup, i: number) => {
      this.groupRemaining[i] = group.count;
      this.groupSpawned[i] = 0;
    });
    this.phase = 'active';
    return true;
  }

  private finishWave(): void {
    const n = this.waveNumber;
    this.money += 30 + n * 5;
    this.score += Math.round(n * 100 * this.difficulty.scoreMult);
    this.fx.push(FxKind.WaveClear, 0, 0, n);
    if (n >= TOTAL_WAVES) {
      this.score += Math.round(this.lives * 500 * this.difficulty.scoreMult);
      this.phase = 'won';
      return;
    }
    this.phase = 'prep';
    this.prepTicks = PREP_SECONDS * TICK_RATE;
  }

  get nextWave(): WaveDef | null {
    return this.waveNumber < TOTAL_WAVES ? WAVES[this.waveNumber] : null;
  }

  spawnEnemy(type: EnemyId, route: number, hpScale: number): number {
    if (this.eFreeCount === 0) return -1;
    const slot = this.eFree[--this.eFreeCount];
    const def = ENEMIES[type];
    const path = this.paths[route];
    const air = (def.flags & EnemyFlag.Air) !== 0;
    const spread = (def.flags & EnemyFlag.Boss) !== 0 ? 0 : air ? 34 : 15;
    this.eDist[slot] = 0;
    this.eLane[slot] = this.rng.range(-spread, spread);
    this.eHp[slot] = this.eMaxHp[slot] = def.hp * hpScale;
    this.eSlow[slot] = 1;
    this.eSlowUntil[slot] = 0;
    this.eRevealUntil[slot] = 0;
    this.eHitTick[slot] = -1000;
    this.eType[slot] = type;
    this.ePath[slot] = route;
    this.eImmortal[slot] = 0;
    this.placeOnPath(slot, path);
    this.ePrevX[slot] = this.eX[slot];
    this.ePrevY[slot] = this.eY[slot];
    this.eDenseIndex[slot] = this.enemyCount;
    this.eDense[this.enemyCount++] = slot;
    return slot;
  }

  private placeOnPath(slot: number, path: BakedPath): void {
    const position = this.eDist[slot] * path.invSpacing;
    let index = position | 0;
    if (index > path.lastIndex) index = path.lastIndex;
    const f = position - index;
    const lane = this.eLane[slot];
    this.eX[slot] = path.xs[index] + (path.xs[index + 1] - path.xs[index]) * f + path.nx[index] * lane;
    this.eY[slot] = path.ys[index] + (path.ys[index + 1] - path.ys[index]) * f + path.ny[index] * lane;
  }

  private removeEnemy(slot: number): void {
    const denseIndex = this.eDenseIndex[slot];
    const lastSlot = this.eDense[--this.enemyCount];
    this.eDense[denseIndex] = lastSlot;
    this.eDenseIndex[lastSlot] = denseIndex;
    this.eDenseIndex[slot] = -1;
    // A new generation invalidates every handle still pointing at this slot.
    this.eGen[slot] = (this.eGen[slot] + 1) & 0xffff;
    this.eFree[this.eFreeCount++] = slot;
  }

  private moveEnemies(): void {
    const { eDense, eDist, eSlow, eSlowUntil, eX, eY, ePrevX, ePrevY, eLane, ePath, eType, eHp, eMaxHp, eImmortal, paths, tick } = this;
    // Backwards so swap-removal never skips an unvisited enemy.
    for (let d = this.enemyCount - 1; d >= 0; d--) {
      const slot = eDense[d];
      const def = ENEMIES[eType[slot]];
      const path = paths[ePath[slot]];
      if (def.regen > 0 && eHp[slot] < eMaxHp[slot]) {
        const healed = eHp[slot] + eMaxHp[slot] * def.regen * DT;
        eHp[slot] = healed > eMaxHp[slot] ? eMaxHp[slot] : healed;
      }
      const speed = eSlowUntil[slot] > tick ? def.speed * eSlow[slot] : def.speed;
      let dist = eDist[slot] + speed * DT;
      if (dist >= path.length) {
        if (eImmortal[slot] === 0) {
          this.leak(slot);
          continue;
        }
        dist = 0;
      }
      eDist[slot] = dist;
      ePrevX[slot] = eX[slot];
      ePrevY[slot] = eY[slot];
      const position = dist * path.invSpacing;
      const index = position | 0;
      const f = position - index;
      const lane = eLane[slot];
      eX[slot] = path.xs[index] + (path.xs[index + 1] - path.xs[index]) * f + path.nx[index] * lane;
      eY[slot] = path.ys[index] + (path.ys[index + 1] - path.ys[index]) * f + path.ny[index] * lane;
      if (dist === 0) {
        ePrevX[slot] = eX[slot];
        ePrevY[slot] = eY[slot];
      }
    }
  }

  private leak(slot: number): void {
    const def = ENEMIES[this.eType[slot]];
    this.lives -= def.leak;
    this.leaks++;
    this.fx.push(FxKind.Leak, this.eX[slot], this.eY[slot], def.leak);
    this.removeEnemy(slot);
    if (this.lives <= 0) {
      this.lives = 0;
      this.phase = 'lost';
    }
  }

  /** Fills `out` with live enemies inside the circle and returns how many. */
  queryRadius(x: number, y: number, radius: number, out: Int32Array): number {
    const { eX, eY, eDenseIndex } = this;
    const r2 = radius * radius;
    let found = 0;
    if (!this.options.spatialGrid) {
      for (let d = 0; d < this.enemyCount; d++) {
        const slot = this.eDense[d];
        const dx = eX[slot] - x;
        const dy = eY[slot] - y;
        if (dx * dx + dy * dy <= r2) out[found++] = slot;
      }
      return found;
    }
    const { grid } = this;
    const { cols, cellStart, items } = grid;
    const minCol = grid.clampCol(x - radius);
    const maxCol = grid.clampCol(x + radius);
    const minRow = grid.clampRow(y - radius);
    const maxRow = grid.clampRow(y + radius);
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const cell = row * cols + col;
        const end = cellStart[cell + 1];
        for (let i = cellStart[cell]; i < end; i++) {
          const slot = items[i];
          // The grid is built once per tick, so it can hold enemies killed since.
          if (eDenseIndex[slot] < 0) continue;
          const dx = eX[slot] - x;
          const dy = eY[slot] - y;
          if (dx * dx + dy * dy <= r2) out[found++] = slot;
        }
      }
    }
    return found;
  }

  private isTargetable(slot: number, hitsAir: boolean, detects: boolean): boolean {
    const flags = ENEMIES[this.eType[slot]].flags;
    if (!hitsAir && (flags & EnemyFlag.Air) !== 0) return false;
    if ((flags & EnemyFlag.Stealth) !== 0 && !detects && this.eRevealUntil[slot] <= this.tick) return false;
    return true;
  }

  private acquireTarget(t: number): number {
    const def = TOWERS[this.tType[t]];
    const x = this.tX[t];
    const y = this.tY[t];
    const found = this.queryRadius(x, y, this.tRange[t], this.scratch);
    const priority = this.tPriority[t];
    let best = NO_TARGET;
    let bestScore = -Infinity;
    for (let i = 0; i < found; i++) {
      const slot = this.scratch[i];
      if (!this.isTargetable(slot, def.hitsAir, def.detectsStealth)) continue;
      let score: number;
      if (priority === TargetPriority.First) {
        score = this.eDist[slot] - this.paths[this.ePath[slot]].length;
      } else if (priority === TargetPriority.Last) {
        score = this.paths[this.ePath[slot]].length - this.eDist[slot];
      } else if (priority === TargetPriority.Strongest) {
        score = this.eHp[slot];
      } else {
        const dx = this.eX[slot] - x;
        const dy = this.eY[slot] - y;
        score = -(dx * dx + dy * dy);
      }
      if (score > bestScore) {
        bestScore = score;
        best = slot;
      }
    }
    return best;
  }

  private hasValidTarget(t: number, hitsAir: boolean, detects: boolean): boolean {
    const slot = this.tTarget[t];
    if (slot === NO_TARGET || this.eGen[slot] !== this.tTargetGen[t] || this.eDenseIndex[slot] < 0) return false;
    if (!this.isTargetable(slot, hitsAir, detects)) return false;
    const dx = this.eX[slot] - this.tX[t];
    const dy = this.eY[slot] - this.tY[t];
    return dx * dx + dy * dy <= this.tRange[t] * this.tRange[t];
  }

  private updateTowers(): void {
    for (let d = 0; d < this.towerCount; d++) {
      const t = this.tDense[d];
      const def = TOWERS[this.tType[t]];
      this.tPrevAngle[t] = this.tAngle[t];
      this.tCooldown[t] -= 1;

      if (def.detectsStealth && (this.tick + t) % RETARGET_INTERVAL === 0) this.revealStealth(t);

      if (def.kind === TowerKind.Aura) {
        if (this.tCooldown[t] <= 0) this.pulseAura(t);
        continue;
      }

      // Towers stay on a target and re-evaluate on a staggered schedule, so the
      // cost of a search is spread over ticks instead of paid by all at once.
      const stale = (this.tick + t) % RETARGET_INTERVAL === 0;
      if (stale || !this.hasValidTarget(t, def.hitsAir, def.detectsStealth)) {
        const slot = this.acquireTarget(t);
        this.tTarget[t] = slot;
        if (slot !== NO_TARGET) this.tTargetGen[t] = this.eGen[slot];
      }
      const target = this.tTarget[t];
      if (target === NO_TARGET) continue;
      this.tAngle[t] = Math.atan2(this.eY[target] - this.tY[t], this.eX[target] - this.tX[t]);
      if (this.tCooldown[t] > 0) continue;

      const stats = def.levels[this.tLevel[t] - 1];
      if (def.kind === TowerKind.Projectile) {
        if (this.stress && this.projectileCount >= this.stress.projectiles) continue;
        this.spawnProjectile(this.tX[t], this.tY[t], target, stats.damage, stats.splash, def.projectileSpeed, this.tType[t], def.ignoresArmor, t);
        this.fx.push(FxKind.Muzzle, this.tX[t], this.tY[t], this.tType[t], this.tAngle[t]);
      } else if (def.kind === TowerKind.Hitscan) {
        this.fx.push(FxKind.Beam, this.tX[t], this.tY[t], this.eX[target], this.eY[target], this.tType[t]);
        this.applyDamage(target, stats.damage, def.ignoresArmor, t);
      } else {
        this.fireChain(t, target, stats.damage, stats.chains, def.ignoresArmor);
      }
      this.tCooldown[t] = stats.cooldown * TICK_RATE;
      this.tFireTick[t] = this.tick;
    }
  }

  private revealStealth(t: number): void {
    const found = this.queryRadius(this.tX[t], this.tY[t], this.tRange[t], this.scratch);
    for (let i = 0; i < found; i++) {
      const slot = this.scratch[i];
      if ((ENEMIES[this.eType[slot]].flags & EnemyFlag.Stealth) !== 0) this.eRevealUntil[slot] = this.tick + REVEAL_DURATION_TICKS;
    }
  }

  private pulseAura(t: number): void {
    const stats = TOWERS[this.tType[t]].levels[this.tLevel[t] - 1];
    const found = this.queryRadius(this.tX[t], this.tY[t], stats.range, this.scratch);
    for (let i = found - 1; i >= 0; i--) {
      const slot = this.scratch[i];
      const isBoss = (ENEMIES[this.eType[slot]].flags & EnemyFlag.Boss) !== 0;
      const slow = isBoss && stats.slow < BOSS_MIN_SLOW ? BOSS_MIN_SLOW : stats.slow;
      if (this.eSlowUntil[slot] <= this.tick || slow < this.eSlow[slot]) this.eSlow[slot] = slow;
      this.eSlowUntil[slot] = this.tick + SLOW_DURATION_TICKS;
      this.applyDamage(slot, stats.damage, true, t);
    }
    this.tCooldown[t] = stats.cooldown * TICK_RATE;
    if (found > 0) {
      this.tFireTick[t] = this.tick;
      this.fx.push(FxKind.Pulse, this.tX[t], this.tY[t], stats.range);
    }
  }

  private fireChain(t: number, first: number, damage: number, chains: number, ignoreArmor: boolean): void {
    const hits = this.chainHits;
    const limit = Math.min(chains, hits.length);
    let hitCount = 0;
    let current = first;
    let fromX = this.tX[t];
    let fromY = this.tY[t];
    while (current !== NO_TARGET && hitCount < limit) {
      hits[hitCount++] = current;
      const x = this.eX[current];
      const y = this.eY[current];
      this.fx.push(FxKind.Arc, fromX, fromY, x, y, this.tType[t]);
      fromX = x;
      fromY = y;
      const found = this.queryRadius(x, y, CHAIN_JUMP_RANGE, this.scratch);
      let next = NO_TARGET;
      let nearest = Infinity;
      for (let i = 0; i < found; i++) {
        const slot = this.scratch[i];
        if (!this.isTargetable(slot, true, false)) continue;
        let seen = false;
        for (let h = 0; h < hitCount; h++) {
          if (hits[h] === slot) {
            seen = true;
            break;
          }
        }
        if (seen) continue;
        const dx = this.eX[slot] - x;
        const dy = this.eY[slot] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearest) {
          nearest = d2;
          next = slot;
        }
      }
      current = next;
    }
    // Damage last, so kills mid-chain cannot invalidate the jump search.
    for (let h = 0; h < hitCount; h++) this.applyDamage(hits[h], damage, ignoreArmor, t);
  }

  private spawnProjectile(x: number, y: number, target: number, damage: number, splash: number, speed: number, kind: number, ignoreArmor: boolean, source: number): void {
    if (this.projectileCount >= MAX_PROJECTILES) return;
    const p = this.projectileCount++;
    this.pX[p] = this.pPrevX[p] = x;
    this.pY[p] = this.pPrevY[p] = y;
    this.pTarget[p] = target;
    this.pTargetGen[p] = this.eGen[target];
    this.pTargetX[p] = this.eX[target];
    this.pTargetY[p] = this.eY[target];
    this.pDamage[p] = damage;
    this.pSplash[p] = splash;
    this.pSpeed[p] = speed;
    this.pKind[p] = kind;
    this.pIgnoreArmor[p] = ignoreArmor ? 1 : 0;
    this.pSource[p] = source;
  }

  private removeProjectile(p: number): void {
    const last = --this.projectileCount;
    if (p === last) return;
    this.pX[p] = this.pX[last];
    this.pY[p] = this.pY[last];
    this.pPrevX[p] = this.pPrevX[last];
    this.pPrevY[p] = this.pPrevY[last];
    this.pTarget[p] = this.pTarget[last];
    this.pTargetGen[p] = this.pTargetGen[last];
    this.pTargetX[p] = this.pTargetX[last];
    this.pTargetY[p] = this.pTargetY[last];
    this.pDamage[p] = this.pDamage[last];
    this.pSplash[p] = this.pSplash[last];
    this.pSpeed[p] = this.pSpeed[last];
    this.pKind[p] = this.pKind[last];
    this.pIgnoreArmor[p] = this.pIgnoreArmor[last];
    this.pSource[p] = this.pSource[last];
  }

  private updateProjectiles(): void {
    const { pX, pY, pPrevX, pPrevY, pTarget, pTargetGen, pTargetX, pTargetY, pSpeed, eGen, eDenseIndex, eX, eY } = this;
    for (let p = this.projectileCount - 1; p >= 0; p--) {
      const target = pTarget[p];
      const alive = eGen[target] === pTargetGen[p] && eDenseIndex[target] >= 0;
      if (alive) {
        pTargetX[p] = eX[target];
        pTargetY[p] = eY[target];
      }
      const dx = pTargetX[p] - pX[p];
      const dy = pTargetY[p] - pY[p];
      const stepLength = pSpeed[p] * DT;
      const reach = stepLength + PROJECTILE_HIT_RADIUS;
      const d2 = dx * dx + dy * dy;
      pPrevX[p] = pX[p];
      pPrevY[p] = pY[p];
      if (d2 <= reach * reach) {
        this.impact(p, alive);
        this.removeProjectile(p);
        continue;
      }
      const scale = stepLength / Math.sqrt(d2);
      pX[p] += dx * scale;
      pY[p] += dy * scale;
    }
  }

  private impact(p: number, targetAlive: boolean): void {
    const x = this.pTargetX[p];
    const y = this.pTargetY[p];
    const splash = this.pSplash[p];
    const ignoreArmor = this.pIgnoreArmor[p] === 1;
    const source = this.pSource[p];
    if (splash > 0) {
      const found = this.queryRadius(x, y, splash, this.scratch);
      const def = TOWERS[this.pKind[p]];
      for (let i = found - 1; i >= 0; i--) {
        const slot = this.scratch[i];
        if (def.hitsAir || (ENEMIES[this.eType[slot]].flags & EnemyFlag.Air) === 0) this.applyDamage(slot, this.pDamage[p], ignoreArmor, source);
      }
      this.fx.push(FxKind.Explosion, x, y, splash);
    } else if (targetAlive) {
      this.applyDamage(this.pTarget[p], this.pDamage[p], ignoreArmor, source);
      this.fx.push(FxKind.Hit, x, y, this.pKind[p]);
    }
  }

  private applyDamage(slot: number, amount: number, ignoreArmor: boolean, source: number): void {
    if (this.eDenseIndex[slot] < 0) return;
    const def = ENEMIES[this.eType[slot]];
    let dealt = amount;
    if (!ignoreArmor) {
      const reduced = amount - def.armor;
      const floor = amount * MIN_DAMAGE_FRACTION;
      dealt = reduced > floor ? reduced : floor;
    }
    this.eHitTick[slot] = this.tick;
    const hp = this.eHp[slot] - dealt;
    if (this.eImmortal[slot] === 1) {
      const floor = this.eMaxHp[slot] * STRESS_HP_FLOOR;
      this.eHp[slot] = hp < floor ? this.eMaxHp[slot] : hp;
      return;
    }
    this.fx.push(FxKind.Damage, this.eX[slot], this.eY[slot], dealt);
    if (hp > 0) {
      this.eHp[slot] = hp;
      return;
    }
    this.money += def.bounty;
    this.score += Math.round(def.bounty * 10 * this.difficulty.scoreMult);
    this.kills++;
    if (source >= 0 && this.tDenseIndex[source] >= 0) this.tKills[source]++;
    this.fx.push(FxKind.Kill, this.eX[slot], this.eY[slot], this.eType[slot], def.bounty);
    this.removeEnemy(slot);
  }

  // ---- Player commands ------------------------------------------------------

  canBuild(col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return false;
    const tile = row * COLS + col;
    return this.blocked[tile] === 0 && this.occupied[tile] === 0;
  }

  placeTower(type: number, col: number, row: number): number {
    const cost = TOWERS[type].levels[0].cost;
    if (this.phase === 'won' || this.phase === 'lost') return -1;
    if (!this.canBuild(col, row) || this.money < cost || this.tFreeCount === 0) return -1;
    this.money -= cost;
    return this.createTower(type, col, row, cost);
  }

  private createTower(type: number, col: number, row: number, spent: number): number {
    const t = this.tFree[--this.tFreeCount];
    this.tType[t] = type;
    this.tCol[t] = col;
    this.tRow[t] = row;
    this.tX[t] = col * TILE + TILE / 2;
    this.tY[t] = row * TILE + TILE / 2;
    this.tLevel[t] = 1;
    this.tPriority[t] = TargetPriority.First;
    this.tSpent[t] = spent;
    this.tKills[t] = 0;
    this.tFireTick[t] = -1000;
    this.tCooldown[t] = 0;
    this.tTarget[t] = NO_TARGET;
    this.tAngle[t] = this.tPrevAngle[t] = -Math.PI / 2;
    this.tRange[t] = TOWERS[type].levels[0].range;
    this.occupied[row * COLS + col] = t + 1;
    this.tDenseIndex[t] = this.towerCount;
    this.tDense[this.towerCount++] = t;
    return t;
  }

  upgradeCost(t: number): number | null {
    const level = this.tLevel[t];
    return level >= MAX_TOWER_LEVEL ? null : TOWERS[this.tType[t]].levels[level].cost;
  }

  upgradeTower(t: number): boolean {
    if (this.tDenseIndex[t] < 0) return false;
    const cost = this.upgradeCost(t);
    if (cost === null || this.money < cost) return false;
    this.money -= cost;
    this.tSpent[t] += cost;
    this.tLevel[t]++;
    this.tRange[t] = TOWERS[this.tType[t]].levels[this.tLevel[t] - 1].range;
    return true;
  }

  sellValue(t: number): number {
    return Math.floor(this.tSpent[t] * SELL_REFUND);
  }

  sellTower(t: number): boolean {
    if (this.tDenseIndex[t] < 0) return false;
    this.money += this.sellValue(t);
    this.removeTower(t);
    return true;
  }

  private removeTower(t: number): void {
    this.occupied[this.tRow[t] * COLS + this.tCol[t]] = 0;
    const index = this.tDenseIndex[t];
    const last = this.tDense[--this.towerCount];
    this.tDense[index] = last;
    this.tDenseIndex[last] = index;
    this.tDenseIndex[t] = -1;
    this.tGen[t] = (this.tGen[t] + 1) & 0xffff;
    this.tFree[this.tFreeCount++] = t;
  }

  setPriority(t: number, priority: TargetPriority): void {
    if (this.tDenseIndex[t] >= 0) this.tPriority[t] = priority;
  }

  // ---- Stress scenario ------------------------------------------------------

  /** Holds exact entity counts. Enemies are immortal and loop along the routes. */
  setStress(config: StressConfig | null): void {
    this.stress = config;
    while (this.enemyCount > 0) this.removeEnemy(this.eDense[0]);
    this.projectileCount = 0;
    while (this.towerCount > 0) this.removeTower(this.tDense[0]);
    if (config) {
      this.phase = 'active';
      this.maintainStress(config);
    }
  }

  private maintainStress(config: StressConfig): void {
    const { rng } = this;
    const types = EnemyId.Boss;
    const target = Math.min(config.enemies, MAX_ENEMIES);
    while (this.enemyCount < target) {
      const type = rng.int(types);
      const air = (ENEMIES[type].flags & EnemyFlag.Air) !== 0;
      const route = air ? 2 + rng.int(2) : rng.int(2);
      const slot = this.spawnEnemy(type, route, 1);
      this.eImmortal[slot] = 1;
      this.eDist[slot] = rng.next() * (this.paths[route].length - 1);
      this.placeOnPath(slot, this.paths[route]);
      this.ePrevX[slot] = this.eX[slot];
      this.ePrevY[slot] = this.eY[slot];
    }
    while (this.enemyCount > target) this.removeEnemy(this.eDense[this.enemyCount - 1]);

    if (this.towerCount !== config.towers) this.placeStressTowers(config.towers);

    const projectiles = Math.min(config.projectiles, MAX_PROJECTILES);
    if (this.projectileCount > projectiles) this.projectileCount = projectiles;
    if (this.enemyCount > 0 && this.towerCount > 0) {
      while (this.projectileCount < projectiles) {
        const t = this.tDense[rng.int(this.towerCount)];
        const e = this.eDense[rng.int(this.enemyCount)];
        this.spawnProjectile(this.tX[t], this.tY[t], e, 1, 0, STRESS_PROJECTILE_SPEED, this.tType[t], false, t);
      }
    }
  }

  private placeStressTowers(count: number): void {
    while (this.towerCount > 0) this.removeTower(this.tDense[0]);
    const free: number[] = [];
    for (let i = 0; i < COLS * ROWS; i++) if (this.blocked[i] === 0) free.push(i);
    const total = Math.min(count, free.length);
    for (let i = 0; i < total; i++) {
      const tile = free[Math.floor((i * free.length) / total)];
      this.createTower(i % TOWERS.length, tile % COLS, Math.floor(tile / COLS), 0);
    }
  }

  // ---- Testing --------------------------------------------------------------

  /** FNV-1a over simulation state, used to compare runs for determinism. */
  stateHash(): number {
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      h ^= v | 0;
      h = Math.imul(h, 0x01000193);
    };
    mix(this.tick);
    mix(this.money);
    mix(this.lives);
    mix(this.score);
    mix(this.kills);
    mix(this.enemyCount);
    mix(this.projectileCount);
    const bits = new Float32Array(1);
    const asInt = new Int32Array(bits.buffer);
    for (let d = 0; d < this.enemyCount; d++) {
      const slot = this.eDense[d];
      for (const value of [this.eX[slot], this.eY[slot], this.eHp[slot]]) {
        bits[0] = value;
        mix(asInt[0]);
      }
    }
    return h >>> 0;
  }
}
