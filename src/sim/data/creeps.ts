import type { CreepKind, SendId } from '../types';

export interface CreepDef {
  kind: CreepKind;
  name: string;
  hp: number;
  /** Tiles per second. */
  speed: number;
  /** Fraction of non-piercing damage ignored. */
  armour: number;
  air: boolean;
  /** Gold to the defender for the kill. */
  bounty: number;
  /** Lives lost by the defender when it breaks through. */
  lives: number;
  /** Damage per second against towers in its way. */
  siege: number;
  /** Heals allies within healRadius by healRate hp/s. */
  healRate: number;
  healRadius: number;
  /** Takes this much less from slows (0..1). */
  slowResist: number;
  /** Rendering scale hint. */
  size: number;
}

const def = (kind: CreepKind, name: string, d: Partial<CreepDef> & Pick<CreepDef, 'hp' | 'speed'>): CreepDef => ({
  kind,
  name,
  armour: 0,
  air: false,
  bounty: 1,
  lives: 1,
  siege: 8,
  healRate: 0,
  healRadius: 0,
  slowResist: 0,
  size: 1,
  ...d,
});

export const CREEPS: Record<CreepKind, CreepDef> = {
  levy: def('levy', 'Levy', { hp: 45, speed: 1.5, bounty: 1, siege: 6, size: 0.8 }),
  footman: def('footman', 'Footman', { hp: 150, speed: 1.3, armour: 0.2, bounty: 2, siege: 12 }),
  outrider: def('outrider', 'Outrider', { hp: 120, speed: 2.6, bounty: 2, siege: 8, size: 1.1 }),
  crow: def('crow', 'Carrion Crow', { hp: 60, speed: 2.0, air: true, bounty: 1, siege: 0, size: 0.7 }),
  shieldbearer: def('shieldbearer', 'Shieldbearer', { hp: 280, speed: 1.0, armour: 0.5, bounty: 4, siege: 14, size: 1.1 }),
  friar: def('friar', 'Friar', { hp: 210, speed: 1.2, armour: 0.1, bounty: 4, siege: 6, healRate: 14, healRadius: 2.2 }),
  knight: def('knight', 'Knight', { hp: 560, speed: 2.1, armour: 0.3, bounty: 8, lives: 2, siege: 30, size: 1.35 }),
  ram: def('ram', 'Battering Ram', { hp: 1500, speed: 0.8, armour: 0.4, bounty: 12, lives: 3, siege: 140, slowResist: 0.6, size: 1.7 }),
  warlord: def('warlord', 'Warlord', { hp: 4200, speed: 1.1, armour: 0.3, bounty: 40, lives: 6, siege: 90, slowResist: 0.5, size: 2.0 }),
};

export interface SendDef {
  id: SendId;
  name: string;
  blurb: string;
  units: { kind: CreepKind; count: number }[];
  cost: number;
  /** Permanent income gained per send. */
  income: number;
  /** Seconds after the gates open before it's available. */
  unlockAt: number;
  /** Stock cap and seconds to restock one. */
  stock: number;
  restock: number;
}

// Roughly 20–28 gold per +1 income: sends pay back over ~4–6 minutes, so
// economies grow steadily instead of exploding.
export const SENDS: SendDef[] = [
  { id: 'levies', name: 'Levies', blurb: 'A mob of conscripted peasants.', units: [{ kind: 'levy', count: 5 }], cost: 20, income: 1, unlockAt: 0, stock: 10, restock: 3 },
  { id: 'footmen', name: 'Footmen', blurb: 'Armoured infantry.', units: [{ kind: 'footman', count: 3 }], cost: 36, income: 2, unlockAt: 0, stock: 8, restock: 4 },
  { id: 'outriders', name: 'Outriders', blurb: 'Fast light cavalry.', units: [{ kind: 'outrider', count: 3 }], cost: 40, income: 2, unlockAt: 60, stock: 8, restock: 5 },
  { id: 'crows', name: 'Carrion Crows', blurb: 'Flyers. Ignore the maze.', units: [{ kind: 'crow', count: 6 }], cost: 40, income: 2, unlockAt: 90, stock: 8, restock: 5 },
  { id: 'shieldwall', name: 'Shieldwall', blurb: 'Heavily armoured. Bring bolts.', units: [{ kind: 'shieldbearer', count: 3 }], cost: 66, income: 3, unlockAt: 150, stock: 6, restock: 6 },
  { id: 'friars', name: 'Friars', blurb: 'Heal everything near them.', units: [{ kind: 'friar', count: 2 }, { kind: 'footman', count: 3 }], cost: 80, income: 4, unlockAt: 210, stock: 6, restock: 7 },
  { id: 'knights', name: 'Knights', blurb: 'Fast, tough, cost 2 lives.', units: [{ kind: 'knight', count: 2 }], cost: 120, income: 5, unlockAt: 300, stock: 6, restock: 8 },
  { id: 'ram', name: 'Battering Ram', blurb: 'Smashes blockades. Costs 3 lives.', units: [{ kind: 'ram', count: 1 }], cost: 130, income: 5, unlockAt: 330, stock: 4, restock: 10 },
  { id: 'warlord', name: 'Warlord', blurb: 'A boss. Costs 6 lives.', units: [{ kind: 'warlord', count: 1 }], cost: 340, income: 12, unlockAt: 540, stock: 3, restock: 20 },
];

export const SENDS_BY_ID = Object.fromEntries(SENDS.map((s) => [s.id, s])) as Record<SendId, SendDef>;
