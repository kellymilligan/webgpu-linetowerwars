import type { RngState } from './rng';

export type TowerKind = 'palisade' | 'archer' | 'mangonel' | 'cauldron' | 'ballista' | 'banner';
export type CreepKind = 'levy' | 'footman' | 'outrider' | 'crow' | 'shieldbearer' | 'friar' | 'knight' | 'ram' | 'warlord';
export type SendId = 'levies' | 'footmen' | 'outriders' | 'crows' | 'shieldwall' | 'friars' | 'knights' | 'ram' | 'warlord';
export type AttackStyle = 'arrow' | 'stone' | 'pitch' | 'bolt';

export interface BotBrain {
  /** 0 = pure builder, 1 = pure sender. */
  aggression: number;
  nextThink: number;
  /** Gold the bot is saving towards a bigger send. */
  saveFor: SendId | null;
  /** Lives at the last think, and a tick until which it stays on alert after a leak. */
  lastLives: number;
  alarm: number;
  /** Maze template: rows between walls, and which end the first gap is on. */
  spacing: number;
  flip: boolean;
}

export interface Player {
  id: number;
  name: string;
  colour: string;
  bot: BotBrain | null;
  alive: boolean;
  lives: number;
  gold: number;
  income: number;
  /** Remaining stock per send type; refills over time. */
  stock: Record<SendId, number>;
  stockTimer: Record<SendId, number>;
  eliminatedAt: number | null;
  place: number | null;
  stats: PlayerStats;
}

export interface PlayerStats {
  sent: number;
  goldSent: number;
  goldTowers: number;
  kills: number;
  leaked: number;
  plundered: number;
  livesTaken: number;
  towersLost: number;
  /** Income and lives sampled every income tick, for post-game graphs. */
  incomeHistory: number[];
  livesHistory: number[];
}

export interface Tower {
  id: number;
  lane: number;
  x: number;
  y: number;
  kind: TowerKind;
  level: number;
  hp: number;
  maxHp: number;
  cooldown: number;
  /** Total gold spent on this tower (for selling). */
  spent: number;
  kills: number;
  damage: number;
  /** Attack-speed bonus from banners, recomputed when towers change. */
  haste: number;
}

export interface Creep {
  id: number;
  kind: CreepKind;
  /** Player who sent it, or -1 for a neutral raid. */
  owner: number;
  lane: number;
  x: number;
  y: number;
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  /** Ticks remaining under a slow, and its factor. */
  slowTicks: number;
  slowFactor: number;
  burnTicks: number;
  burnDps: number;
  /** Ticks until it enters its lane (queued spawns and transit between lanes). */
  delay: number;
  /** Lanes it has already broken through. */
  breaches: number;
  /** Siege: ticks until the next blow against a tower. */
  attackCd: number;
  /** Id of the tower it's battering, if any. */
  battering: number;
  /** Walk-cycle phase, for rendering. */
  heading: number;
}

export interface Projectile {
  id: number;
  lane: number;
  style: AttackStyle;
  towerId: number;
  targetId: number;
  x: number;
  y: number;
  px: number;
  py: number;
  /** Aim point; updated while the target lives (homing), fixed for lobbed stones. */
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  speed: number;
  damage: number;
  splash: number;
  pierce: boolean;
  air: boolean;
  homing: boolean;
  slow: number;
  burn: number;
}

export interface Lane {
  /** Cell → tower id, or 0 when empty. */
  grid: number[];
  /** Distance to the keep with towers impassable (×10 per straight step). -1 = unreachable. */
  open: number[];
  /** Distance to the keep where towers can be smashed through at a cost. */
  breach: number[];
  /** True when the gate can't reach the keep without breaching. */
  blocked: boolean;
  /** Current open path length from the gate in tiles (for UI), or -1. */
  pathLength: number;
}

export type Phase = 'muster' | 'battle' | 'over';

export interface GameState {
  version: number;
  seed: string;
  rng: RngState;
  tick: number;
  phase: Phase;
  players: Player[];
  lanes: Lane[];
  towers: Tower[];
  creeps: Creep[];
  projectiles: Projectile[];
  nextId: number;
  nextIncome: number;
  nextRaid: number;
  raidNumber: number;
  winner: number | null;
  /** Players eliminated so far, in order. */
  fallen: number[];
}

export type Command =
  | { type: 'build'; player: number; x: number; y: number; kind: TowerKind }
  | { type: 'upgrade'; player: number; towerId: number; kind?: TowerKind }
  | { type: 'sell'; player: number; towerId: number }
  | { type: 'send'; player: number; send: SendId };

export type CommandResult = { ok: true } | { ok: false; reason: string };

export type GameEvent =
  | { type: 'fire'; lane: number; towerId: number; style: AttackStyle; x: number; y: number; tx: number; ty: number; air: boolean; instant: boolean }
  | { type: 'hit'; lane: number; x: number; y: number; style: AttackStyle; splash: number; air: boolean }
  | { type: 'death'; lane: number; x: number; y: number; kind: CreepKind; air: boolean; bounty: number; killer: number }
  | { type: 'leak'; lane: number; victim: number; owner: number; kind: CreepKind; lives: number; plunder: number; next: number | null }
  | { type: 'sent'; player: number; target: number; send: SendId }
  | { type: 'built'; lane: number; towerId: number; x: number; y: number; kind: TowerKind }
  | { type: 'upgraded'; lane: number; towerId: number; x: number; y: number }
  | { type: 'sold'; lane: number; x: number; y: number }
  | { type: 'batter'; lane: number; towerId: number; x: number; y: number; cx: number; cy: number }
  | { type: 'towerDestroyed'; lane: number; x: number; y: number; kind: TowerKind; by: CreepKind }
  | { type: 'heal'; lane: number; x: number; y: number; radius: number }
  | { type: 'income'; tick: number }
  | { type: 'raid'; number: number }
  | { type: 'gatesOpen' }
  | { type: 'blocked'; lane: number; blocked: boolean }
  | { type: 'eliminated'; player: number; place: number }
  | { type: 'gameOver'; winner: number | null };
