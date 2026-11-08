export const enum TowerId {
  Gatling,
  Cannon,
  Frost,
  Tesla,
  Railgun,
}

export const enum TowerKind {
  /** Fires a homing projectile. */
  Projectile,
  /** Pulses an area around itself. */
  Aura,
  /** Instantly hits a target and jumps to neighbors. */
  Chain,
  /** Instantly hits one target. */
  Hitscan,
}

export interface TowerLevel {
  /** Build cost at level 1, upgrade cost afterwards. */
  cost: number;
  damage: number;
  range: number;
  /** Seconds between attacks. */
  cooldown: number;
  splash: number;
  /** Speed multiplier applied to enemies. */
  slow: number;
  chains: number;
}

export interface TowerDef {
  name: string;
  blurb: string;
  hotkey: string;
  kind: TowerKind;
  hitsAir: boolean;
  ignoresArmor: boolean;
  detectsStealth: boolean;
  projectileSpeed: number;
  color: [number, number, number];
  levels: TowerLevel[];
}

const level = (cost: number, damage: number, range: number, cooldown: number, extra: Partial<TowerLevel> = {}): TowerLevel => ({
  cost, damage, range, cooldown, splash: 0, slow: 1, chains: 0, ...extra,
});

export const TOWERS: TowerDef[] = [
  {
    name: 'Gatling', blurb: 'Rapid fire against single targets. Weak into armor.', hotkey: '1',
    kind: TowerKind.Projectile, hitsAir: true, ignoresArmor: false, detectsStealth: false, projectileSpeed: 520, color: [0.44, 0.66, 0.86],
    levels: [level(60, 6, 130, 0.16), level(90, 11, 145, 0.13), level(200, 20, 160, 0.1)],
  },
  {
    name: 'Cannon', blurb: 'Explosive area damage. Ground targets only.', hotkey: '2',
    kind: TowerKind.Projectile, hitsAir: false, ignoresArmor: false, detectsStealth: false, projectileSpeed: 340, color: [0.75, 0.5, 0.26],
    levels: [level(110, 26, 140, 1.1, { splash: 56 }), level(150, 55, 150, 1.0, { splash: 66 }), level(320, 120, 165, 0.9, { splash: 78 })],
  },
  {
    name: 'Frost', blurb: 'Slows everything nearby, including air.', hotkey: '3',
    kind: TowerKind.Aura, hitsAir: true, ignoresArmor: true, detectsStealth: false, projectileSpeed: 0, color: [0.5, 0.89, 1],
    levels: [level(85, 2, 110, 0.3, { slow: 0.65 }), level(110, 6, 125, 0.3, { slow: 0.5 }), level(240, 16, 145, 0.3, { slow: 0.38 })],
  },
  {
    name: 'Tesla', blurb: 'Lightning chains through packs and ignores armor.', hotkey: '4',
    kind: TowerKind.Chain, hitsAir: true, ignoresArmor: true, detectsStealth: false, projectileSpeed: 0, color: [0.76, 0.62, 1],
    levels: [level(140, 16, 120, 0.7, { chains: 3 }), level(190, 32, 135, 0.6, { chains: 5 }), level(380, 70, 150, 0.5, { chains: 8 })],
  },
  {
    name: 'Railgun', blurb: 'Huge range and damage. Reveals Phantoms.', hotkey: '5',
    kind: TowerKind.Hitscan, hitsAir: true, ignoresArmor: true, detectsStealth: true, projectileSpeed: 0, color: [0.61, 0.8, 0.4],
    levels: [level(200, 110, 300, 1.6), level(260, 260, 340, 1.4), level(520, 650, 400, 1.2)],
  },
];

export const SELL_REFUND = 0.7;
export const MAX_TOWER_LEVEL = TOWERS[0].levels.length;

export const enum TargetPriority {
  First,
  Last,
  Strongest,
  Closest,
}
export const PRIORITY_NAMES = ['First', 'Last', 'Strongest', 'Closest'];
