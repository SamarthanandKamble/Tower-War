export const enum EnemyFlag {
  None = 0,
  Air = 1,
  Stealth = 2,
  Boss = 4,
}

export interface EnemyDef {
  name: string;
  blurb: string;
  hp: number;
  /** World units per second. */
  speed: number;
  /** Flat damage reduction, ignored by armor-piercing towers. */
  armor: number;
  bounty: number;
  /** Lives lost if this enemy reaches the base. */
  leak: number;
  radius: number;
  /** Fraction of max HP regained per second. */
  regen: number;
  flags: number;
  color: [number, number, number];
}

export const enum EnemyId {
  Grunt,
  Runner,
  Brute,
  Swarm,
  Regenerator,
  Flyer,
  Phantom,
  Boss,
}

export const ENEMIES: EnemyDef[] = [
  { name: 'Grunt', blurb: 'Balanced foot soldier.', hp: 34, speed: 46, armor: 0, bounty: 3, leak: 1, radius: 9, regen: 0, flags: EnemyFlag.None, color: [0.87, 0.33, 0.31] },
  { name: 'Runner', blurb: 'Fragile and very fast.', hp: 18, speed: 96, armor: 0, bounty: 3, leak: 1, radius: 7, regen: 0, flags: EnemyFlag.None, color: [0.96, 0.77, 0.1] },
  { name: 'Brute', blurb: 'Armored. Weak hits barely scratch it.', hp: 150, speed: 30, armor: 6, bounty: 9, leak: 2, radius: 13, regen: 0, flags: EnemyFlag.None, color: [0.56, 0.36, 0.82] },
  { name: 'Swarm', blurb: 'Tiny and endless. Answer with splash.', hp: 9, speed: 66, armor: 0, bounty: 1, leak: 1, radius: 5, regen: 0, flags: EnemyFlag.None, color: [0.36, 0.75, 0.87] },
  { name: 'Mender', blurb: 'Regenerates unless burst down.', hp: 90, speed: 40, armor: 1, bounty: 7, leak: 1, radius: 10, regen: 0.09, flags: EnemyFlag.None, color: [0.36, 0.85, 0.45] },
  { name: 'Wasp', blurb: 'Flies its own route. Cannons cannot hit it.', hp: 42, speed: 62, armor: 0, bounty: 5, leak: 1, radius: 9, regen: 0, flags: EnemyFlag.Air, color: [0.98, 0.55, 0.2] },
  { name: 'Phantom', blurb: 'Invisible until a Railgun reveals it.', hp: 70, speed: 54, armor: 2, bounty: 8, leak: 2, radius: 10, regen: 0, flags: EnemyFlag.Stealth, color: [0.75, 0.78, 0.95] },
  { name: 'Warlord', blurb: 'Boss. Huge, armored, resists slows.', hp: 2600, speed: 22, armor: 10, bounty: 120, leak: 10, radius: 22, regen: 0, flags: EnemyFlag.Boss, color: [1, 0.23, 0.42] },
];

/** Slow multipliers on bosses are floored to this value. */
export const BOSS_MIN_SLOW = 0.6;
/** Armor can never reduce a hit below this fraction of its damage. */
export const MIN_DAMAGE_FRACTION = 0.15;
