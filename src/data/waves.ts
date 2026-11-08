import { EnemyId } from './enemies';
import { NORTH_ROUTE_WAVE, PathId } from './map';

export const TOTAL_WAVES = 50;

export interface SpawnGroup {
  type: EnemyId;
  count: number;
  /** Ticks between spawns in this group. */
  gap: number;
  /** Ticks after wave start before the first spawn. */
  delay: number;
  /** Routes are used in rotation. */
  paths: PathId[];
}

export interface WaveDef {
  number: number;
  groups: SpawnGroup[];
  /** HP multiplier applied to regular enemies in the wave. */
  hpScale: number;
  /** Bosses scale more gently, since they are already long fights. */
  bossHpScale: number;
  isBoss: boolean;
}

export function waveHpScale(n: number): number {
  return Math.pow(1.092, n - 1) * (1 + (n - 1) * 0.02);
}

const BOSS_SCALE_EXPONENT = 0.72;

function buildWave(n: number): WaveDef {
  const groundPaths = n >= NORTH_ROUTE_WAVE ? [PathId.Main, PathId.North] : [PathId.Main];
  const airPaths = n >= NORTH_ROUTE_WAVE ? [PathId.AirSouth, PathId.AirNorth] : [PathId.AirSouth];
  const groups: SpawnGroup[] = [];
  let delay = 0;
  const add = (type: EnemyId, count: number, gap: number, paths: PathId[] = groundPaths) => {
    const whole = Math.round(count);
    if (whole <= 0) return;
    groups.push({ type, count: whole, gap, delay, paths });
    // Later groups overlap the tail of earlier ones so pressure builds.
    delay += Math.round(whole * gap * 0.55) + 30;
  };

  // A horde multiplier so late waves become genuine swarms.
  const horde = 1 + Math.pow(Math.max(0, n - 12) / 38, 2) * 11;

  add(EnemyId.Grunt, (6 + n * 1.6) * horde, Math.max(4, 34 - n));
  if (n >= 3 && n % 2 === 1) add(EnemyId.Runner, (3 + n) * horde, Math.max(3, 20 - Math.floor(n / 3)));
  if (n >= 5 && n % 3 !== 1) add(EnemyId.Brute, (1 + n / 3) * Math.sqrt(horde), Math.max(12, 60 - n));
  if (n >= 8 && n % 2 === 0) add(EnemyId.Swarm, (14 + n * 3) * horde, 3);
  if (n >= 12 && n % 3 === 0) add(EnemyId.Regenerator, (2 + n / 3) * Math.sqrt(horde), 40);
  if (n >= 14 && n % 2 === 0) add(EnemyId.Flyer, (3 + n / 2) * Math.sqrt(horde), 24, airPaths);
  if (n >= 18 && n % 4 === 2) add(EnemyId.Phantom, (2 + n / 4) * Math.sqrt(horde), 36);

  const isBoss = n % 10 === 0;
  if (isBoss) add(EnemyId.Boss, n / 10 + (n === TOTAL_WAVES ? 2 : 0), 150);

  return { number: n, groups, hpScale: waveHpScale(n), bossHpScale: Math.pow(waveHpScale(n), BOSS_SCALE_EXPONENT), isBoss };
}

export const WAVES: WaveDef[] = Array.from({ length: TOTAL_WAVES }, (_, i) => buildWave(i + 1));

/** Seconds of preparation before the next wave starts by itself. */
export const PREP_SECONDS = 20;
export const FIRST_PREP_SECONDS = 40;
