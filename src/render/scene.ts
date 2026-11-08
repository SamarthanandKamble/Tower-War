import { ENEMIES, EnemyFlag, EnemyId } from '../data/enemies';
import { BASE_TILE, COLS, NORTH_ROUTE_WAVE, TILE, WORLD_HEIGHT, WORLD_WIDTH } from '../data/map';
import { TOWERS } from '../data/towers';
import { FxKind } from '../sim/fx';
import type { World } from '../sim/world';
import type { Atlas, } from './atlas';
import { additive, InstanceBatch, rgba, WHITE, type Sprite } from './batch';
import type { Camera } from './camera';

const MAX_PARTICLES = 6000;
const MAX_BEAMS = 512;
const MAX_NUMBERS = 256;
const MAX_NUMBERS_PER_FRAME = 8;
const CULL_PADDING = 48;
const BOB_STEPS = 64;
const HIT_FLASH_TICKS = 3;
const ARC_SEGMENTS = 4;
const TWO_PI = Math.PI * 2;

export interface Overlay {
  hoverCol: number;
  hoverRow: number;
  buildType: number;
  selected: number;
}

export interface SceneOptions {
  culling: boolean;
}

export type FxListener = (kind: FxKind, a: number, b: number) => void;

function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= TWO_PI;
  while (delta < -Math.PI) delta += TWO_PI;
  return a + delta * t;
}

/** Turns simulation state and visual events into one instance batch per frame. */
export class Scene {
  readonly batch = new InstanceBatch();
  readonly options: SceneOptions = { culling: true };
  drawnEnemies = 0;
  culledEnemies = 0;
  reduceMotion = false;
  onFx: FxListener | null = null;

  private shake = 0;
  private baseFlash = 0;
  private numbersThisFrame = 0;
  private readonly airScratch = new Int32Array(1 << 17);
  private readonly bob = new Float32Array(BOB_STEPS);

  private readonly normal: number[];
  private readonly slowed: number[];
  private readonly hiddenPhantom = rgba(1, 1, 1, 0.28);
  private readonly hitFlash = additive(1, 1, 1, 0.55);
  private readonly barBack = rgba(0.12, 0.05, 0.07, 0.9);
  private readonly barHigh = rgba(0.36, 0.9, 0.42);
  private readonly barMid = rgba(0.96, 0.8, 0.22);
  private readonly barLow = rgba(0.95, 0.3, 0.26);
  private readonly shellColors: number[];
  private readonly beamColors: number[];
  private readonly explosionColor = additive(1, 0.62, 0.25);
  private readonly frostColor = additive(0.5, 0.89, 1, 0.8);
  private readonly ghostOk = rgba(0.35, 0.9, 0.5, 0.22);
  private readonly ghostBad = rgba(0.95, 0.3, 0.3, 0.22);
  private readonly ringOk = rgba(0.45, 1, 0.6, 0.9);
  private readonly ringBad = rgba(1, 0.4, 0.4, 0.9);
  private readonly rangeFill = rgba(1, 1, 1, 0.08);
  private readonly rangeRing = rgba(1, 1, 1, 0.75);
  private readonly preview = rgba(1, 1, 1, 0.7);
  private readonly selectGlow = additive(1, 0.9, 0.5, 0.45);

  // Particles: oldest slot is overwritten when the pool is full.
  private readonly px = new Float32Array(MAX_PARTICLES);
  private readonly py = new Float32Array(MAX_PARTICLES);
  private readonly pvx = new Float32Array(MAX_PARTICLES);
  private readonly pvy = new Float32Array(MAX_PARTICLES);
  private readonly pLife = new Float32Array(MAX_PARTICLES);
  private readonly pMax = new Float32Array(MAX_PARTICLES);
  private readonly pSize = new Float32Array(MAX_PARTICLES);
  private readonly pGrow = new Float32Array(MAX_PARTICLES);
  private readonly pColor = new Uint32Array(MAX_PARTICLES);
  private readonly pSprite = new Uint8Array(MAX_PARTICLES);
  private pNext = 0;
  private readonly particleSprites: Sprite[];

  private readonly bX1 = new Float32Array(MAX_BEAMS);
  private readonly bY1 = new Float32Array(MAX_BEAMS);
  private readonly bX2 = new Float32Array(MAX_BEAMS);
  private readonly bY2 = new Float32Array(MAX_BEAMS);
  private readonly bLife = new Float32Array(MAX_BEAMS);
  private readonly bColor = new Uint32Array(MAX_BEAMS);
  private readonly bWidth = new Float32Array(MAX_BEAMS);
  private bNext = 0;

  private readonly nX = new Float32Array(MAX_NUMBERS);
  private readonly nY = new Float32Array(MAX_NUMBERS);
  private readonly nValue = new Int32Array(MAX_NUMBERS);
  private readonly nLife = new Float32Array(MAX_NUMBERS);
  private nNext = 0;

  constructor(private readonly atlas: Atlas) {
    this.normal = ENEMIES.map(() => WHITE);
    this.slowed = ENEMIES.map(() => rgba(0.6, 0.82, 1));
    this.shellColors = TOWERS.map(() => WHITE);
    this.beamColors = TOWERS.map((t) => additive(t.color[0], t.color[1], t.color[2], 1.1));
    this.particleSprites = [atlas.soft, atlas.spark, atlas.ring];
    for (let i = 0; i < BOB_STEPS; i++) this.bob[i] = 1 + Math.sin((i / BOB_STEPS) * TWO_PI) * 0.06;
  }

  reset(): void {
    this.pLife.fill(0);
    this.bLife.fill(0);
    this.nLife.fill(0);
    this.shake = 0;
    this.baseFlash = 0;
  }

  private spawnParticle(x: number, y: number, vx: number, vy: number, life: number, size: number, grow: number, color: number, sprite: number): void {
    const i = this.pNext;
    this.pNext = (i + 1) % MAX_PARTICLES;
    this.px[i] = x;
    this.py[i] = y;
    this.pvx[i] = vx;
    this.pvy[i] = vy;
    this.pLife[i] = this.pMax[i] = life;
    this.pSize[i] = size;
    this.pGrow[i] = grow;
    this.pColor[i] = color;
    this.pSprite[i] = sprite;
  }

  private burst(x: number, y: number, count: number, speed: number, life: number, size: number, color: number): void {
    for (let n = 0; n < count; n++) {
      const a = Math.random() * TWO_PI;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.spawnParticle(x, y, Math.cos(a) * v, Math.sin(a) * v, life * (0.6 + Math.random() * 0.4), size, 0, color, 1);
    }
  }

  private addBeam(x1: number, y1: number, x2: number, y2: number, life: number, width: number, color: number): void {
    const i = this.bNext;
    this.bNext = (i + 1) % MAX_BEAMS;
    this.bX1[i] = x1;
    this.bY1[i] = y1;
    this.bX2[i] = x2;
    this.bY2[i] = y2;
    this.bLife[i] = life;
    this.bWidth[i] = width;
    this.bColor[i] = color;
  }

  private addNumber(x: number, y: number, value: number): void {
    if (this.numbersThisFrame >= MAX_NUMBERS_PER_FRAME) return;
    this.numbersThisFrame++;
    const i = this.nNext;
    this.nNext = (i + 1) % MAX_NUMBERS;
    this.nX[i] = x + (Math.random() - 0.5) * 12;
    this.nY[i] = y - 10;
    this.nValue[i] = value;
    this.nLife[i] = 0.7;
  }

  /** Drains simulation events into visuals. Time is display time scaled by game speed. */
  update(world: World, dt: number): void {
    this.numbersThisFrame = 0;
    const { fx } = world;
    const d = fx.data;
    for (let o = fx.shift(); o >= 0; o = fx.shift()) {
      const kind = d[o] as FxKind;
      const x = d[o + 1];
      const y = d[o + 2];
      const a = d[o + 3];
      const b = d[o + 4];
      const c = d[o + 5];
      switch (kind) {
        case FxKind.Muzzle:
          this.spawnParticle(x + Math.cos(b) * 24, y + Math.sin(b) * 24, 0, 0, 0.07, 20, 0, this.beamColors[a], 0);
          break;
        case FxKind.Hit:
          this.burst(x, y, 2, 90, 0.18, 7, this.beamColors[a]);
          break;
        case FxKind.Explosion:
          this.spawnParticle(x, y, 0, 0, 0.26, a * 0.4, a * 7, this.explosionColor, 2);
          this.spawnParticle(x, y, 0, 0, 0.18, a * 1.5, 0, this.explosionColor, 0);
          this.burst(x, y, 5, 170, 0.3, 9, this.explosionColor);
          break;
        case FxKind.Kill: {
          const color = ENEMIES[a].color;
          const isBoss = a === EnemyId.Boss;
          this.burst(x, y, isBoss ? 40 : 5, isBoss ? 240 : 120, isBoss ? 0.8 : 0.32, isBoss ? 16 : 9, additive(color[0], color[1], color[2]));
          if (isBoss) this.addShake(16);
          break;
        }
        case FxKind.Damage:
          if (a >= 25) this.addNumber(x, y, Math.round(a));
          break;
        case FxKind.Beam:
          this.addBeam(x, y, a, b, 0.14, 6, this.beamColors[c]);
          break;
        case FxKind.Arc:
          this.addArc(x, y, a, b, this.beamColors[c]);
          break;
        case FxKind.Pulse:
          this.spawnParticle(x, y, 0, 0, 0.3, a * 0.4, a * 5, this.frostColor, 2);
          break;
        case FxKind.Leak:
          this.addShake(6);
          this.baseFlash = 1;
          break;
        default:
          break;
      }
      this.onFx?.(kind, a, c);
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      this.px[i] += this.pvx[i] * dt;
      this.py[i] += this.pvy[i] * dt;
      this.pSize[i] += this.pGrow[i] * dt;
    }
    for (let i = 0; i < MAX_BEAMS; i++) if (this.bLife[i] > 0) this.bLife[i] -= dt;
    for (let i = 0; i < MAX_NUMBERS; i++) {
      if (this.nLife[i] <= 0) continue;
      this.nLife[i] -= dt;
      this.nY[i] -= 34 * dt;
    }
    this.shake *= Math.pow(0.002, dt);
    this.baseFlash = Math.max(0, this.baseFlash - dt * 2.5);
  }

  private addShake(amount: number): void {
    if (!this.reduceMotion) this.shake = Math.min(14, this.shake + amount);
  }

  private addArc(x1: number, y1: number, x2: number, y2: number, color: number): void {
    const nx = -(y2 - y1);
    const ny = x2 - x1;
    let fromX = x1;
    let fromY = y1;
    for (let s = 1; s <= ARC_SEGMENTS; s++) {
      const t = s / ARC_SEGMENTS;
      const jitter = s === ARC_SEGMENTS ? 0 : (Math.random() - 0.5) * 0.22;
      const x = x1 + (x2 - x1) * t + nx * jitter;
      const y = y1 + (y2 - y1) * t + ny * jitter;
      this.addBeam(fromX, fromY, x, y, 0.1, 3, color);
      fromX = x;
      fromY = y;
    }
  }

  /** Screen shake offsets to apply to the camera for this frame only. */
  get shakeX(): number {
    return this.shake > 0.1 ? (Math.random() - 0.5) * this.shake : 0;
  }

  get shakeY(): number {
    return this.shake > 0.1 ? (Math.random() - 0.5) * this.shake : 0;
  }

  build(world: World, camera: Camera, alpha: number, overlay: Overlay): void {
    const { batch, atlas } = this;
    batch.clear();
    const left = camera.worldX(0) - CULL_PADDING;
    const top = camera.worldY(0) - CULL_PADDING;
    const right = camera.worldX(camera.width) + CULL_PADDING;
    const bottom = camera.worldY(camera.height) + CULL_PADDING;

    if (world.waveNumber + 1 < NORTH_ROUTE_WAVE && !world.stress) batch.push(24.5 * TILE, 0.7 * TILE, TILE * 1.3, TILE * 1.3, 1, 0, atlas.barricade, WHITE);

    const baseX = BASE_TILE[0] * TILE + TILE / 2;
    const baseY = BASE_TILE[1] * TILE + TILE / 2;
    batch.push(baseX, baseY, 120, 120, 1, 0, atlas.base, WHITE);
    if (this.baseFlash > 0) batch.push(baseX, baseY, 240, 240, 1, 0, atlas.soft, additive(1, 0.25, 0.2, this.baseFlash));

    this.buildRangeIndicators(world, overlay);
    this.buildTowers(world, alpha, overlay, left, top, right, bottom);
    this.buildEnemies(world, alpha, left, top, right, bottom);
    this.buildProjectiles(world, alpha, left, top, right, bottom);
    this.buildEffects(left, top, right, bottom);
    this.buildGhost(world, overlay);
  }

  private buildRangeIndicators(world: World, overlay: Overlay): void {
    const { batch, atlas } = this;
    const t = overlay.selected;
    if (t < 0 || world.tDenseIndex[t] < 0) return;
    const d = world.tRange[t] * 2;
    batch.push(world.tX[t], world.tY[t], d, d, 1, 0, atlas.disk, this.rangeFill);
    batch.push(world.tX[t], world.tY[t], d, d, 1, 0, atlas.ring, this.rangeRing);
  }

  private buildTowers(world: World, alpha: number, overlay: Overlay, left: number, top: number, right: number, bottom: number): void {
    const { batch, atlas } = this;
    for (let d = 0; d < world.towerCount; d++) {
      const t = world.tDense[d];
      const x = world.tX[t];
      const y = world.tY[t];
      if (this.options.culling && (x < left || x > right || y < top || y > bottom)) continue;
      const type = world.tType[t];
      if (t === overlay.selected) batch.push(x, y, 76, 76, 1, 0, atlas.soft, this.selectGlow);
      batch.push(x, y, 38, 38, 1, 0, atlas.towerPlates[type], WHITE);
      const angle = lerpAngle(world.tPrevAngle[t], world.tAngle[t], alpha);
      // Brief recoil along the barrel after firing.
      const sinceFire = world.tick - world.tFireTick[t];
      const recoil = sinceFire < 6 ? (6 - sinceFire) * 0.7 : 0;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      batch.push(x - cos * recoil, y - sin * recoil, 42, 42, cos, sin, atlas.turrets[type][world.tLevel[t] - 1], WHITE);
    }
  }

  private buildEnemies(world: World, alpha: number, left: number, top: number, right: number, bottom: number): void {
    const { grid, enemyCount, eDense, eDenseIndex } = world;
    let airCount = 0;
    let drawn = 0;
    const air = this.airScratch;

    const visit = (slot: number): void => {
      if ((ENEMIES[world.eType[slot]].flags & EnemyFlag.Air) !== 0) air[airCount++] = slot;
      else if (this.drawEnemy(world, slot, alpha, left, top, right, bottom)) drawn++;
    };

    if (this.options.culling) {
      // Only cells that touch the camera are visited, so off-screen enemies cost nothing.
      const { cols, cellStart, items } = grid;
      const minCol = grid.clampCol(left);
      const maxCol = grid.clampCol(right);
      const minRow = grid.clampRow(top);
      const maxRow = grid.clampRow(bottom);
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const cell = row * cols + col;
          const end = cellStart[cell + 1];
          for (let i = cellStart[cell]; i < end; i++) {
            const slot = items[i];
            if (eDenseIndex[slot] >= 0) visit(slot);
          }
        }
      }
    } else {
      for (let d = 0; d < enemyCount; d++) visit(eDense[d]);
    }
    for (let i = 0; i < airCount; i++) if (this.drawEnemy(world, air[i], alpha, left, top, right, bottom)) drawn++;
    this.drawnEnemies = drawn;
    this.culledEnemies = enemyCount - drawn;
  }

  private drawEnemy(world: World, slot: number, alpha: number, left: number, top: number, right: number, bottom: number): boolean {
    const px = world.ePrevX[slot];
    const py = world.ePrevY[slot];
    const dirX = world.eX[slot] - px;
    const dirY = world.eY[slot] - py;
    const x = px + dirX * alpha;
    const y = py + dirY * alpha;
    if (this.options.culling && (x < left || x > right || y < top || y > bottom)) return false;

    const { batch, atlas } = this;
    const type = world.eType[slot];
    const def = ENEMIES[type];
    const size = def.radius * 2.5 * this.bob[(world.tick + slot * 7) & (BOB_STEPS - 1)];
    let color = world.eSlowUntil[slot] > world.tick ? this.slowed[type] : this.normal[type];
    if ((def.flags & EnemyFlag.Stealth) !== 0 && world.eRevealUntil[slot] <= world.tick) color = this.hiddenPhantom;
    batch.push(x, y, size, size, dirX, dirY, atlas.enemies[type], color);
    if (world.tick - world.eHitTick[slot] < HIT_FLASH_TICKS) batch.push(x, y, size, size, 1, 0, atlas.soft, this.hitFlash);

    const hp = world.eHp[slot];
    const max = world.eMaxHp[slot];
    if (hp < max) {
      const fraction = hp / max;
      const width = def.radius * 2;
      const barY = y - def.radius - 6;
      batch.push(x, barY, width + 2, 4, 1, 0, atlas.solid, this.barBack);
      batch.push(x - (width * (1 - fraction)) / 2, barY, width * fraction, 2.5, 1, 0, atlas.solid, fraction > 0.6 ? this.barHigh : fraction > 0.3 ? this.barMid : this.barLow);
    }
    return true;
  }

  private buildProjectiles(world: World, alpha: number, left: number, top: number, right: number, bottom: number): void {
    const { batch, atlas } = this;
    for (let p = 0; p < world.projectileCount; p++) {
      const prevX = world.pPrevX[p];
      const prevY = world.pPrevY[p];
      const dx = world.pX[p] - prevX;
      const dy = world.pY[p] - prevY;
      const x = prevX + dx * alpha;
      const y = prevY + dy * alpha;
      if (this.options.culling && (x < left || x > right || y < top || y > bottom)) continue;
      const kind = world.pKind[p];
      batch.push(x, y, 13, 13, dx, dy, atlas.shells[kind], this.shellColors[kind]);
    }
  }

  private buildEffects(left: number, top: number, right: number, bottom: number): void {
    const { batch, atlas } = this;
    const culling = this.options.culling;

    for (let i = 0; i < MAX_BEAMS; i++) {
      const life = this.bLife[i];
      if (life <= 0) continue;
      const dx = this.bX2[i] - this.bX1[i];
      const dy = this.bY2[i] - this.bY1[i];
      batch.push(this.bX1[i] + dx / 2, this.bY1[i] + dy / 2, Math.sqrt(dx * dx + dy * dy), this.bWidth[i] * Math.min(1, life * 12), dx, dy, atlas.solid, this.bColor[i]);
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const life = this.pLife[i];
      if (life <= 0) continue;
      const x = this.px[i];
      const y = this.py[i];
      if (culling && (x < left || x > right || y < top || y > bottom)) continue;
      const fade = life / this.pMax[i];
      const size = this.pSize[i];
      const c = this.pColor[i];
      // Additive colors dim by scaling channels, which keeps blending in one draw call.
      const r = (c & 255) * fade;
      const g = ((c >>> 8) & 255) * fade;
      const b = ((c >>> 16) & 255) * fade;
      const color = ((b << 16) | (g << 8) | r) >>> 0;
      const sprite = this.particleSprites[this.pSprite[i]];
      batch.push(x, y, size * 2, this.pSprite[i] === 1 ? size * 0.7 : size * 2, this.pvx[i], this.pvy[i], sprite, color);
    }

    for (let i = 0; i < MAX_NUMBERS; i++) {
      const life = this.nLife[i];
      if (life <= 0) continue;
      this.drawNumber(this.nX[i], this.nY[i], this.nValue[i], Math.min(1, life * 3));
    }
  }

  private drawNumber(x: number, y: number, value: number, opacity: number): void {
    const { batch, atlas } = this;
    const height = 15;
    const width = height * atlas.digitAspect * 0.8;
    let digits = 1;
    for (let v = value; v >= 10; v = Math.floor(v / 10)) digits++;
    const color = rgba(1, 0.95, 0.75, opacity);
    let cursor = x + ((digits - 1) * width) / 2;
    let v = value;
    for (let n = 0; n < digits; n++) {
      batch.push(cursor, y, height * atlas.digitAspect, height, 1, 0, atlas.digits[v % 10], color);
      v = Math.floor(v / 10);
      cursor -= width;
    }
  }

  private buildGhost(world: World, overlay: Overlay): void {
    if (overlay.buildType < 0 || overlay.hoverCol < 0) return;
    const { batch, atlas } = this;
    const type = overlay.buildType;
    const def = TOWERS[type];
    const x = overlay.hoverCol * TILE + TILE / 2;
    const y = overlay.hoverRow * TILE + TILE / 2;
    const ok = world.canBuild(overlay.hoverCol, overlay.hoverRow) && world.money >= def.levels[0].cost;
    const d = def.levels[0].range * 2;
    batch.push(x, y, d, d, 1, 0, atlas.disk, ok ? this.ghostOk : this.ghostBad);
    batch.push(x, y, d, d, 1, 0, atlas.ring, ok ? this.ringOk : this.ringBad);
    batch.push(x, y, 38, 38, 1, 0, atlas.towerPlates[type], this.preview);
    batch.push(x, y, 42, 42, 0, -1, atlas.turrets[type][0], this.preview);
  }

  /** World bounds check for tile hover, exposed so input code shares one rule. */
  static tileAt(worldX: number, worldY: number): { col: number; row: number } {
    if (worldX < 0 || worldY < 0 || worldX >= WORLD_WIDTH || worldY >= WORLD_HEIGHT) return { col: -1, row: -1 };
    return { col: Math.min(COLS - 1, Math.floor(worldX / TILE)), row: Math.floor(worldY / TILE) };
  }
}
