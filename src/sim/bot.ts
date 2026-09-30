/**
 * Bot lords. They run inside the sim (driven by the sim's RNG) so games with
 * bots stay deterministic and lockstep-safe. They play a simple greedy
 * strategy: maze with palisades, raise them into towers, and split spare
 * gold between defence and sends by temperament. They play worse than a
 * decent human, on purpose; they're opponents to learn on and balance with.
 */
import { CREEPS, SENDS } from './data/creeps';
import { GATE_ROWS, KEEP_ROWS, LANE_H, LANE_W } from './data/map';
import { TICK_RATE } from './data/rules';
import { TOWERS, towerLevel } from './data/towers';
import { applyCommand as apply, battleTime, checkBuild, checkSend, nextAlive, upgradeCost } from './game';
import { cellIndex, pathLengthWith } from './pathing';
import { nextFloat, nextInt, pickWeighted } from './rng';
import type { RngState } from './rng';
import type { BotBrain, Command, GameEvent, GameState, Player, SendId, Tower, TowerKind } from './types';

export function createBrain(rng: RngState): BotBrain {
  return {
    aggression: 0.45 + nextFloat(rng) * 0.35,
    nextThink: 0,
    saveFor: null,
    lastLives: 0,
    alarm: 0,
    spacing: 3 + nextInt(rng, 2),
    flip: nextFloat(rng) < 0.5,
  };
}

let sink: GameEvent[] = [];
/** Applies a bot command, forwarding its events to the tick's event list. */
let recorder: Command[] | null = null;
function act(s: GameState, cmd: Command) {
  const r = apply(s, cmd);
  sink.push(...r.events);
  if (recorder && r.result.ok) recorder.push(cmd);
  return r;
}

/**
 * Lets a bot brain play a seat from outside the sim (e.g. a networked bot
 * client): thinks on a copy of the state and returns the commands it chose.
 */
export function decide(s: GameState, player: number, brain: BotBrain): Command[] {
  const copy = JSON.parse(JSON.stringify(s)) as GameState;
  copy.players[player].bot = brain;
  recorder = [];
  try {
    botThink(copy, copy.players[player], []);
    return recorder;
  } finally {
    recorder = null;
  }
}

const attackDps = (t: Tower) => {
  const a = towerLevel(t).attack;
  if (!a) return 0;
  return (a.damage / a.period) * (1 + t.haste) * (a.splash > 0 ? 1.8 : 1);
};

export function botThink(s: GameState, p: Player, ev: GameEvent[]) {
  sink = ev;
  const brain = p.bot!;
  if (brain.lastLives === 0) brain.lastLives = p.lives;
  if (p.lives < brain.lastLives) brain.alarm = s.tick + 20 * TICK_RATE;
  brain.lastLives = p.lives;

  const mine = s.towers.filter((t) => t.lane === p.id);
  let threat = 0;
  for (const c of s.creeps) if (c.lane === p.id) threat += Math.max(0, c.hp) * CREEPS[c.kind].lives;
  const dps = mine.reduce((sum, t) => sum + attackDps(t), 0);
  const pressured = s.tick < brain.alarm || threat > dps * 10;

  for (let action = 0; action < 4; action++) {
    if (s.phase === 'muster') {
      if (!build(s, p, mine)) return;
      continue;
    }
    // Temper aggression in the opening so the realm isn't decided in five minutes.
    const agg = Math.min(brain.aggression, 0.35 + Math.max(0, battleTime(s)) / 400);
    const ratio = agg / (1 - agg);
    const wantSend = !pressured && p.stats.goldSent < ratio * p.stats.goldTowers + 20;
    if (wantSend) {
      if (send(s, p)) continue;
      // Saving for something bigger: hold the gold. Otherwise spend on defence only if flush.
      if (brain.saveFor || p.gold < 90) return;
    }
    if (!build(s, p, mine)) {
      // Couldn't afford the build: save for it, unless gold is piling up.
      if (!wantSend && p.gold > 160 && send(s, p)) continue;
      return;
    }
  }
}

function send(s: GameState, p: Player): boolean {
  const brain = p.bot!;
  const target = nextAlive(s, p.id);
  if (target === null) return false;
  if (brain.saveFor) {
    const id = brain.saveFor;
    const c = checkSend(s, p.id, id);
    if (c.ok) {
      brain.saveFor = null;
      return act(s, { type: 'send', player: p.id, send: id }).result.ok;
    }
    if (c.reason?.startsWith('Need')) return false;
    brain.saveFor = null;
  }
  const targetAir = s.towers.filter((t) => t.lane === target && towerLevel(t).attack?.air).length;
  const options: SendId[] = [];
  const weights: number[] = [];
  for (const sd of SENDS) {
    const c = checkSend(s, p.id, sd.id);
    if (!c.ok) {
      // Occasionally commit to saving for a big send that's unlocked and in stock.
      if (c.reason?.startsWith('Need') && sd.cost > 110 && sd.cost < p.income * 10 && nextFloat(s.rng) < 0.04) brain.saveFor = sd.id;
      continue;
    }
    options.push(sd.id);
    let w = 1 + sd.cost / 20;
    if (sd.id === 'crows' && targetAir < 3) w *= 3;
    weights.push(w);
  }
  if (options.length === 0) return false;
  const id = options[pickWeighted(s.rng, weights)];
  return act(s, { type: 'send', player: p.id, send: id }).result.ok;
}

function chooseKind(s: GameState, mine: Tower[]): TowerKind {
  const bt = battleTime(s);
  const airCapable = mine.filter((t) => towerLevel(t).attack?.air).length;
  if (bt > 45 && airCapable < 2 + bt / 150) return nextFloat(s.rng) < 0.7 ? 'archer' : 'ballista';
  const banners = mine.filter((t) => t.kind === 'banner').length;
  const kinds: TowerKind[] = ['archer', 'mangonel', 'cauldron', 'ballista', 'banner'];
  const w = [4, bt > 30 ? 2 : 0.5, 1.5, bt > 120 ? 1.8 : 0.4, mine.length >= 10 && banners < mine.length / 10 ? 1.2 : 0];
  return kinds[pickWeighted(s.rng, w)];
}

/** One defensive action. Returns false if nothing was affordable or useful. */
function build(s: GameState, p: Player, mine: Tower[]): boolean {
  const palisades = mine.filter((t) => t.kind === 'palisade');
  const attackers = mine.filter((t) => towerLevel(t).attack);
  let cached: { x: number; y: number } | null | undefined;
  const next = () => (cached === undefined ? (cached = nextMazeCell(s, p)) : cached);

  // Open with a couple of real towers and a palisade skeleton, then keep the maze growing ahead of the raises.
  if (attackers.length < 2 && palisades.length === 0) return p.gold >= TOWERS.archer.levels[0].cost && place(s, p, next(), 'archer');
  const pressured = s.tick < p.bot!.alarm;
  const skeleton = s.phase === 'muster' ? 30 : 8 + attackers.length / 3;
  if (!pressured && palisades.length < skeleton && p.gold >= TOWERS.palisade.levels[0].cost && (palisades.length < 4 || nextFloat(s.rng) < 0.6) && next()) {
    return place(s, p, next(), 'palisade');
  }
  if (palisades.length > 0) {
    const kind = chooseKind(s, mine);
    const t = palisades[nextInt(s.rng, palisades.length)];
    if (p.gold < upgradeCost(t, kind)!) return false;
    return act(s, { type: 'upgrade', player: p.id, towerId: t.id, kind }).result.ok;
  }
  const kind = chooseKind(s, mine);
  if (p.gold < TOWERS[kind].levels[0].cost) return false;
  if (next()) return place(s, p, next(), kind);
  // Maze is complete: upgrade the cheapest attacking tower.
  let best: Tower | null = null;
  let bestCost = Infinity;
  for (const t of attackers) {
    const c = upgradeCost(t);
    if (c !== null && c < bestCost) {
      bestCost = c;
      best = t;
    }
  }
  if (!best || p.gold < bestCost) return false;
  return act(s, { type: 'upgrade', player: p.id, towerId: best.id }).result.ok;
}

function place(s: GameState, p: Player, spot: { x: number; y: number } | null, kind: TowerKind): boolean {
  if (!spot) return false;
  return act(s, { type: 'build', player: p.id, x: spot.x, y: spot.y, kind }).result.ok;
}

/**
 * The classic serpentine: full-width walls every few rows, each leaving a
 * one-cell gap at alternating ends, so the road snakes back and forth.
 * Returns cells in build order (top wall first).
 */
export function mazeTemplate(spacing: number, flip: boolean): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  let k = 0;
  for (let y = GATE_ROWS + 3; y < LANE_H - KEEP_ROWS - 1; y += spacing, k++) {
    const gapRight = (k % 2 === 0) !== flip;
    // Build outward from the gap, where every creep has to pass.
    for (let i = LANE_W - 2; i >= 0; i--) cells.push({ x: gapRight ? i : LANE_W - 1 - i, y });
  }
  return cells;
}

function nextMazeCell(s: GameState, p: Player): { x: number; y: number } | null {
  const brain = p.bot!;
  const lane = s.lanes[p.id];
  for (const c of mazeTemplate(brain.spacing, brain.flip)) {
    if (lane.grid[cellIndex(c.x, c.y)] !== 0) continue;
    if (!checkBuild(s, p.id, c.x, c.y, 'palisade', false).ok) continue;
    // Never close the road on purpose.
    if (pathLengthWith(lane.grid, cellIndex(c.x, c.y)) < 0) continue;
    return c;
  }
  return null;
}
