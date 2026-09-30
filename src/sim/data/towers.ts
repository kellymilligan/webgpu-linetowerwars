import type { AttackStyle, TowerKind } from '../types';

export interface TowerAttack {
  style: AttackStyle;
  damage: number;
  /** Seconds between shots. */
  period: number;
  range: number;
  ground: boolean;
  air: boolean;
  /** Splash radius in tiles (0 = single target). */
  splash: number;
  /** Ignores armour. */
  pierce: boolean;
  /** Projectile speed in tiles/s; 0 = instant hit. */
  speed: number;
  homing: boolean;
  /** Slow factor applied on hit (0.4 = 40% slower) and its duration in s. */
  slow: number;
  slowTime: number;
  /** Burning damage per second applied on hit, for slowTime seconds. */
  burn: number;
}

export interface TowerLevel {
  name: string;
  /** Gold to build (level 0) or to upgrade into this level. */
  cost: number;
  hp: number;
  attack: TowerAttack | null;
  /** Banner aura: attack-speed bonus to towers within auraRange. */
  aura: number;
  auraRange: number;
}

export interface TowerDef {
  kind: TowerKind;
  role: string;
  levels: TowerLevel[];
}

const atk = (a: Partial<TowerAttack> & Pick<TowerAttack, 'style' | 'damage' | 'period' | 'range'>): TowerAttack => ({
  ground: true,
  air: false,
  splash: 0,
  pierce: false,
  speed: 0,
  homing: true,
  slow: 0,
  slowTime: 0,
  burn: 0,
  ...a,
});

const lvl = (name: string, cost: number, hp: number, attack: TowerAttack | null, aura = 0, auraRange = 0): TowerLevel => ({
  name,
  cost,
  hp,
  attack,
  aura,
  auraRange,
});

export const TOWERS: Record<TowerKind, TowerDef> = {
  palisade: {
    kind: 'palisade',
    role: 'Cheap wall for shaping the road. Raise it into any tower later.',
    levels: [lvl('Palisade', 5, 160, null)],
  },
  archer: {
    kind: 'archer',
    role: 'Steady single-target fire. Hits air.',
    levels: [
      lvl('Archer Post', 20, 260, atk({ style: 'arrow', damage: 15, period: 0.9, range: 4.0, air: true, speed: 16 })),
      lvl('Archer Tower', 35, 420, atk({ style: 'arrow', damage: 34, period: 0.8, range: 3.9, air: true, speed: 17 })),
      lvl('Longbow Tower', 70, 640, atk({ style: 'arrow', damage: 75, period: 0.7, range: 4.3, air: true, speed: 18 })),
    ],
  },
  mangonel: {
    kind: 'mangonel',
    role: 'Lobs stones that crush packs. Ground only.',
    levels: [
      lvl('Mangonel', 40, 320, atk({ style: 'stone', damage: 40, period: 2.6, range: 4.6, splash: 1.3, speed: 7, homing: false })),
      lvl('Heavy Mangonel', 60, 480, atk({ style: 'stone', damage: 85, period: 2.4, range: 5.0, splash: 1.45, speed: 7.5, homing: false })),
      lvl('Trebuchet', 110, 720, atk({ style: 'stone', damage: 190, period: 2.3, range: 5.6, splash: 1.6, speed: 8, homing: false })),
    ],
  },
  cauldron: {
    kind: 'cauldron',
    role: 'Pours burning pitch: slows and burns. Ground only, short reach.',
    levels: [
      lvl('Pitch Cauldron', 35, 300, atk({ style: 'pitch', damage: 6, period: 1.6, range: 2.4, splash: 1.0, speed: 6, homing: false, slow: 0.4, slowTime: 2, burn: 6 })),
      lvl('Tar Works', 55, 460, atk({ style: 'pitch', damage: 14, period: 1.5, range: 2.6, splash: 1.15, speed: 6, homing: false, slow: 0.5, slowTime: 2.4, burn: 14 })),
      lvl('Greek Fire', 100, 680, atk({ style: 'pitch', damage: 30, period: 1.4, range: 2.9, splash: 1.3, speed: 7, homing: false, slow: 0.55, slowTime: 2.8, burn: 32 })),
    ],
  },
  ballista: {
    kind: 'ballista',
    role: 'Long-range bolts that punch through armour. Hits air.',
    levels: [
      lvl('Scorpion', 50, 300, atk({ style: 'bolt', damage: 85, period: 2.2, range: 5.4, air: true, pierce: true, speed: 26 })),
      lvl('Ballista', 75, 460, atk({ style: 'bolt', damage: 190, period: 2.0, range: 5.8, air: true, pierce: true, speed: 28 })),
      lvl('Siege Ballista', 130, 680, atk({ style: 'bolt', damage: 420, period: 1.9, range: 6.4, air: true, pierce: true, speed: 30 })),
    ],
  },
  banner: {
    kind: 'banner',
    role: 'Rallies nearby towers to shoot faster. No attack.',
    levels: [
      lvl('War Banner', 45, 280, null, 0.2, 2.6),
      lvl('Standard', 60, 420, null, 0.32, 2.9),
      lvl('Oriflamme', 100, 620, null, 0.45, 3.2),
    ],
  },
};

export const TOWER_KINDS: TowerKind[] = ['palisade', 'archer', 'mangonel', 'cauldron', 'ballista', 'banner'];
/** Towers a palisade can be raised into. */
export const RAISE_KINDS: TowerKind[] = ['archer', 'mangonel', 'cauldron', 'ballista', 'banner'];

/** Refund fraction when selling. */
export const SELL_REFUND = 0.6;

export function towerLevel(t: { kind: TowerKind; level: number }): TowerLevel {
  return TOWERS[t.kind].levels[t.level];
}
