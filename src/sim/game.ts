import { CREEPS, SENDS, SENDS_BY_ID } from './data/creeps';
import type { CreepDef } from './data/creeps';
import { buildable, EXIT_Y, LANE_H, LANE_W, SPAWN_X, SPAWN_Y } from './data/map';
import {
  DT,
  HOUSES,
  INCOME_PERIOD,
  MAX_LANES,
  MUSTER_TIME,
  PLUNDER_PER_LIFE,
  RAID_FIRST,
  RAID_PERIOD,
  SEND_SPACING,
  START_GOLD,
  START_INCOME,
  START_LIVES,
  SUDDEN_DEATH,
  SUDDEN_DEATH_PERIOD,
  TICK_RATE,
  TRANSIT_TIME,
  VETERANCY_PER_MIN,
} from './data/rules';
import { RAISE_KINDS, SELL_REFUND, TOWERS, towerLevel } from './data/towers';
import { cellIndex, nextCell, pathLengthWith, refreshLane, UNREACHABLE } from './pathing';
import { nextFloat, seedRng } from './rng';
import { botThink, createBrain } from './bot';
import type {
  Command,
  CommandResult,
  Creep,
  CreepKind,
  GameEvent,
  GameState,
  Lane,
  Player,
  Projectile,
  SendId,
  Tower,
  TowerKind,
} from './types';

export const SAVE_VERSION = 1;
const secs = (t: number) => Math.round(t * TICK_RATE);

export interface GameOptions {
  /** Player ids controlled by humans; the rest are bots. */
  humans?: number[];
  players?: number;
}

export function createGame(seed: string, opts: GameOptions = {}): GameState {
  const count = opts.players ?? 8;
  const humans = new Set(opts.humans ?? [0]);
  const rng = seedRng(seed);
  const players: Player[] = [];
  const lanes: Lane[] = [];
  for (let i = 0; i < count; i++) {
    const house = HOUSES[i];
    const stock = {} as Record<SendId, number>;
    const stockTimer = {} as Record<SendId, number>;
    for (const sd of SENDS) {
      stock[sd.id] = sd.stock;
      stockTimer[sd.id] = 0;
    }
    players.push({
      id: i,
      name: house.name,
      colour: house.colour,
      bot: humans.has(i) ? null : createBrain(rng),
      alive: true,
      lives: START_LIVES,
      gold: START_GOLD,
      income: START_INCOME,
      stock,
      stockTimer,
      eliminatedAt: null,
      place: null,
      stats: { sent: 0, goldSent: 0, goldTowers: 0, kills: 0, leaked: 0, plundered: 0, livesTaken: 0, towersLost: 0, incomeHistory: [START_INCOME], livesHistory: [START_LIVES] },
    });
    const lane: Lane = { grid: new Array(LANE_W * LANE_H).fill(0), open: [], breach: [], blocked: false, pathLength: 0 };
    refreshLane(lane);
    lanes.push(lane);
  }
  return {
    version: SAVE_VERSION,
    seed,
    rng,
    tick: 0,
    phase: 'muster',
    players,
    lanes,
    towers: [],
    creeps: [],
    projectiles: [],
    nextId: 1,
    nextIncome: secs(MUSTER_TIME + INCOME_PERIOD),
    nextRaid: secs(MUSTER_TIME + RAID_FIRST),
    raidNumber: 0,
    winner: null,
    fallen: [],
  };
}

/** Seconds since the gates opened (negative during the muster). */
export const battleTime = (s: GameState) => s.tick / TICK_RATE - MUSTER_TIME;

// ---------------------------------------------------------------------------
// Queries used by commands, the UI and bots

/** The next living player after `from`, cycling. Null when nobody else is alive. */
export function nextAlive(s: GameState, from: number): number | null {
  const n = s.players.length;
  for (let k = 1; k < n; k++) {
    const p = s.players[(from + k) % n];
    if (p.alive) return p.id;
  }
  return null;
}

export function towerAt(s: GameState, lane: number, x: number, y: number): Tower | undefined {
  const id = s.lanes[lane].grid[cellIndex(x, y)];
  return id ? s.towers.find((t) => t.id === id) : undefined;
}

export interface PlaceCheck {
  ok: boolean;
  reason?: string;
  /** True if this placement closes the road; allowed, but creeps will batter through. */
  blocks: boolean;
  pathLength: number;
}

/** Validates a build. `withPath` also computes the resulting road length (a Dijkstra; skip it in hot loops). */
export function checkBuild(s: GameState, player: number, x: number, y: number, kind: TowerKind, withPath = true): PlaceCheck {
  const p = s.players[player];
  const lane = s.lanes[player];
  const fail = (reason: string): PlaceCheck => ({ ok: false, reason, blocks: false, pathLength: lane.pathLength });
  if (!p?.alive || s.phase === 'over') return fail('You have fallen');
  if (!buildable(x, y)) return fail("Can't build here");
  if (lane.grid[cellIndex(x, y)] !== 0) return fail('Occupied');
  for (const c of s.creeps) {
    if (c.lane !== player || c.delay > 0 || CREEPS[c.kind].air) continue;
    if (Math.abs(c.x - (x + 0.5)) < 0.85 && Math.abs(c.y - (y + 0.5)) < 0.85) return fail('Troops in the way');
  }
  const len = withPath ? pathLengthWith(lane.grid, cellIndex(x, y)) : lane.pathLength;
  const cost = TOWERS[kind].levels[0].cost;
  if (p.gold < cost) return { ok: false, reason: `Need ${cost} gold`, blocks: len < 0, pathLength: len };
  return { ok: true, blocks: len < 0, pathLength: len };
}

/** Hp multiplier for troops sent now (veterancy). */
export const sendHpScale = (s: GameState) => 1 + VETERANCY_PER_MIN * Math.max(0, battleTime(s) / 60);

export function upgradeCost(t: Tower, kind?: TowerKind): number | null {
  if (t.kind === 'palisade') {
    if (!kind || !RAISE_KINDS.includes(kind)) return null;
    return TOWERS[kind].levels[0].cost - TOWERS.palisade.levels[0].cost;
  }
  const next = TOWERS[t.kind].levels[t.level + 1];
  return next ? next.cost : null;
}

export const sellValue = (t: Tower) => Math.floor(t.spent * SELL_REFUND);

export interface SendCheck {
  ok: boolean;
  reason?: string;
  target: number | null;
  /** Seconds until unlocked, if locked. */
  unlocksIn: number;
}

export function checkSend(s: GameState, player: number, id: SendId): SendCheck {
  const p = s.players[player];
  const sd = SENDS_BY_ID[id];
  const target = nextAlive(s, player);
  const unlocksIn = Math.max(0, sd.unlockAt - battleTime(s));
  const fail = (reason: string): SendCheck => ({ ok: false, reason, target, unlocksIn });
  if (!p?.alive || s.phase === 'over') return fail('You have fallen');
  if (s.phase === 'muster') return fail('The gates are still shut');
  if (unlocksIn > 0) return fail(`Unlocks in ${Math.ceil(unlocksIn)}s`);
  if (target === null) return fail('No one left to attack');
  if (p.stock[id] <= 0) return fail('Mustering more troops');
  if (p.gold < sd.cost) return fail(`Need ${sd.cost} gold`);
  return { ok: true, target, unlocksIn: 0 };
}

// ---------------------------------------------------------------------------
// Commands

export function applyCommand(s: GameState, cmd: Command): { result: CommandResult; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const result = exec(s, cmd, events);
  return { result, events };
}

function exec(s: GameState, cmd: Command, ev: GameEvent[]): CommandResult {
  const p = s.players[cmd.player];
  if (!p || !p.alive || s.phase === 'over') return { ok: false, reason: 'You have fallen' };
  switch (cmd.type) {
    case 'build': {
      const chk = checkBuild(s, cmd.player, cmd.x, cmd.y, cmd.kind, false);
      if (!chk.ok) return { ok: false, reason: chk.reason! };
      const lv = TOWERS[cmd.kind].levels[0];
      const t: Tower = {
        id: s.nextId++,
        lane: cmd.player,
        x: cmd.x,
        y: cmd.y,
        kind: cmd.kind,
        level: 0,
        hp: lv.hp,
        maxHp: lv.hp,
        cooldown: 0,
        spent: lv.cost,
        kills: 0,
        damage: 0,
        haste: 0,
      };
      p.gold -= lv.cost;
      p.stats.goldTowers += lv.cost;
      s.towers.push(t);
      s.lanes[t.lane].grid[cellIndex(t.x, t.y)] = t.id;
      laneChanged(s, t.lane, ev);
      ev.push({ type: 'built', lane: t.lane, towerId: t.id, x: t.x, y: t.y, kind: t.kind });
      return { ok: true };
    }
    case 'upgrade': {
      const t = s.towers.find((t) => t.id === cmd.towerId);
      if (!t || t.lane !== cmd.player) return { ok: false, reason: 'Not your tower' };
      const cost = upgradeCost(t, cmd.kind);
      if (cost === null) return { ok: false, reason: t.kind === 'palisade' ? 'Choose a tower' : 'Fully upgraded' };
      if (p.gold < cost) return { ok: false, reason: `Need ${cost} gold` };
      p.gold -= cost;
      p.stats.goldTowers += cost;
      t.spent += cost;
      const ratio = t.hp / t.maxHp;
      if (t.kind === 'palisade') {
        t.kind = cmd.kind!;
        t.level = 0;
      } else t.level++;
      t.maxHp = towerLevel(t).hp;
      t.hp = Math.max(1, Math.round(t.maxHp * ratio));
      recomputeHaste(s, t.lane);
      ev.push({ type: 'upgraded', lane: t.lane, towerId: t.id, x: t.x, y: t.y });
      return { ok: true };
    }
    case 'sell': {
      const t = s.towers.find((t) => t.id === cmd.towerId);
      if (!t || t.lane !== cmd.player) return { ok: false, reason: 'Not your tower' };
      p.gold += sellValue(t);
      removeTower(s, t);
      laneChanged(s, t.lane, ev);
      ev.push({ type: 'sold', lane: t.lane, x: t.x, y: t.y });
      return { ok: true };
    }
    case 'send': {
      const chk = checkSend(s, cmd.player, cmd.send);
      if (!chk.ok) return { ok: false, reason: chk.reason! };
      const sd = SENDS_BY_ID[cmd.send];
      p.gold -= sd.cost;
      p.income += sd.income;
      p.stock[cmd.send]--;
      p.stats.sent++;
      p.stats.goldSent += sd.cost;
      // Space the group out behind anything this player already has queued at that gate.
      let queued = 0;
      for (const c of s.creeps) if (c.owner === p.id && c.lane === chk.target && c.delay > 0) queued = Math.max(queued, c.delay);
      const hpScale = sendHpScale(s);
      let k = 0;
      for (const u of sd.units) {
        for (let i = 0; i < u.count; i++) {
          spawnCreep(s, u.kind, p.id, chk.target!, queued + secs(SEND_SPACING) * (k + 1), hpScale);
          k++;
        }
      }
      ev.push({ type: 'sent', player: p.id, target: chk.target!, send: cmd.send });
      return { ok: true };
    }
  }
}

function spawnCreep(s: GameState, kind: CreepKind, owner: number, lane: number, delay: number, hpScale: number): Creep {
  const d = CREEPS[kind];
  // A small deterministic sideways jitter keeps packs from stacking into one blob.
  const jitter = (nextFloat(s.rng) - 0.5) * 0.6;
  const hp = Math.round(d.hp * hpScale);
  const c: Creep = {
    id: s.nextId++,
    kind,
    owner,
    lane,
    x: SPAWN_X + jitter,
    y: SPAWN_Y,
    px: SPAWN_X + jitter,
    py: SPAWN_Y,
    hp,
    maxHp: hp,
    slowTicks: 0,
    slowFactor: 0,
    burnTicks: 0,
    burnDps: 0,
    delay,
    breaches: 0,
    attackCd: 0,
    battering: 0,
    heading: 0,
  };
  s.creeps.push(c);
  return c;
}

function removeTower(s: GameState, t: Tower) {
  s.towers.splice(s.towers.indexOf(t), 1);
  s.lanes[t.lane].grid[cellIndex(t.x, t.y)] = 0;
  for (const c of s.creeps) if (c.battering === t.id) c.battering = 0;
}

function laneChanged(s: GameState, lane: number, ev: GameEvent[]) {
  const L = s.lanes[lane];
  const was = L.blocked;
  refreshLane(L);
  if (L.blocked !== was) ev.push({ type: 'blocked', lane, blocked: L.blocked });
  recomputeHaste(s, lane);
}

function recomputeHaste(s: GameState, lane: number) {
  const inLane = s.towers.filter((t) => t.lane === lane);
  const banners = inLane.filter((t) => towerLevel(t).aura > 0);
  for (const t of inLane) {
    let best = 0;
    for (const b of banners) {
      if (b === t) continue;
      const lv = towerLevel(b);
      const dx = b.x - t.x;
      const dy = b.y - t.y;
      if (dx * dx + dy * dy <= lv.auraRange * lv.auraRange) best = Math.max(best, lv.aura);
    }
    t.haste = best;
  }
}

// ---------------------------------------------------------------------------
// Simulation

export function step(s: GameState): GameEvent[] {
  const ev: GameEvent[] = [];
  if (s.phase === 'over') return ev;
  s.tick++;

  if (s.phase === 'muster' && s.tick >= secs(MUSTER_TIME)) {
    s.phase = 'battle';
    ev.push({ type: 'gatesOpen' });
  }

  if (s.tick >= s.nextIncome) {
    s.nextIncome += secs(INCOME_PERIOD);
    for (const p of s.players) {
      if (!p.alive) continue;
      p.gold += p.income;
      p.stats.incomeHistory.push(p.income);
      p.stats.livesHistory.push(p.lives);
    }
    ev.push({ type: 'income', tick: s.tick });
  }

  for (const p of s.players) {
    if (!p.alive) continue;
    for (const sd of SENDS) {
      if (p.stock[sd.id] >= sd.stock) continue;
      if (++p.stockTimer[sd.id] >= secs(sd.restock)) {
        p.stockTimer[sd.id] = 0;
        p.stock[sd.id]++;
      }
    }
  }

  if (s.phase === 'battle' && s.tick >= s.nextRaid) spawnRaid(s, ev);

  for (const p of s.players) {
    if (p.alive && p.bot && s.tick >= p.bot.nextThink) {
      botThink(s, p, ev);
      p.bot.nextThink = s.tick + secs(0.8 + nextFloat(s.rng) * 0.6);
    }
  }

  moveCreeps(s, ev);
  towersAct(s, ev);
  moveProjectiles(s, ev);
  reap(s, ev);
  return ev;
}

/** Neutral raid composition for raid n (1-based). Escalates slowly, then hard in sudden death. */
export function raidPlan(n: number, sudden: number): { kind: CreepKind; count: number; hpScale: number }[] {
  // Integer powers by repeated multiply: the sim avoids Math.pow for cross-browser determinism.
  let hpScale = 1 + 0.16 * (n - 1);
  for (let i = 0; i < sudden; i++) hpScale *= 1.6;
  const plan: { kind: CreepKind; count: number; hpScale: number }[] = [];
  // Headcounts level off; later raids get tougher instead of bigger (cheaper to simulate and read).
  const more = (base: number, per: number, cap: number) => Math.min(cap, base + Math.floor(n / per));
  if (n % 5 === 0) plan.push({ kind: 'crow', count: more(4, 5, 10), hpScale });
  else if (n % 2 === 1) plan.push({ kind: 'levy', count: more(5, 2, 12), hpScale });
  else plan.push({ kind: 'footman', count: more(2, 3, 8), hpScale });
  if (n >= 6 && n % 3 === 0) plan.push({ kind: 'outrider', count: more(1, 6, 5), hpScale });
  if (n >= 10 && n % 4 === 2) plan.push({ kind: 'shieldbearer', count: more(0, 5, 5), hpScale });
  return plan;
}

function spawnRaid(s: GameState, ev: GameEvent[]) {
  s.raidNumber++;
  const bt = battleTime(s);
  const sudden = bt >= SUDDEN_DEATH ? Math.floor((bt - SUDDEN_DEATH) / 60) + 1 : 0;
  s.nextRaid += secs(sudden > 0 ? SUDDEN_DEATH_PERIOD : RAID_PERIOD);
  const plan = raidPlan(s.raidNumber, sudden);
  for (const p of s.players) {
    if (!p.alive) continue;
    let k = 0;
    for (const g of plan) for (let i = 0; i < g.count; i++) spawnCreep(s, g.kind, -1, p.id, secs(SEND_SPACING) * ++k, g.hpScale);
  }
  ev.push({ type: 'raid', number: s.raidNumber });
}

function speedOf(c: Creep, d: CreepDef, s: GameState): number {
  let v = d.speed;
  if (c.slowTicks > 0) v *= 1 - c.slowFactor;
  // Warlords rally nearby troops.
  if (d.kind !== 'warlord') {
    for (const o of s.creeps) {
      if (o.kind === 'warlord' && o.lane === c.lane && o.delay <= 0) {
        const dx = o.x - c.x;
        const dy = o.y - c.y;
        if (dx * dx + dy * dy < 6.25) {
          v *= 1.25;
          break;
        }
      }
    }
  }
  return v;
}

function moveCreeps(s: GameState, ev: GameEvent[]) {
  const hasWarlord = s.creeps.some((c) => c.kind === 'warlord');
  for (const c of s.creeps) {
    c.px = c.x;
    c.py = c.y;
    if (c.delay > 0) {
      c.delay--;
      continue;
    }
    const d = CREEPS[c.kind];
    if (c.slowTicks > 0) c.slowTicks--;
    if (c.burnTicks > 0) {
      c.burnTicks--;
      c.hp -= c.burnDps * DT;
    }
    if (d.healRate > 0) heal(s, c, d, ev);
    const v = (hasWarlord ? speedOf(c, d, s) : c.slowTicks > 0 ? d.speed * (1 - c.slowFactor) : d.speed) * DT;

    if (d.air) {
      // Flyers ignore the maze: straight down the middle of the lane.
      const dx = SPAWN_X - c.x;
      c.x += Math.sign(dx) * Math.min(Math.abs(dx), v * 0.3);
      c.y += v;
      c.heading = 0;
      continue;
    }

    const L = s.lanes[c.lane];
    const cx = clampCell(Math.floor(c.x), LANE_W);
    const cy = clampCell(Math.floor(c.y), LANE_H);
    if (cy >= LANE_H - 1) {
      // In the keep row: march out.
      c.y += v;
      c.x += (cx + 0.5 - c.x) * 0.1;
      c.battering = 0;
      continue;
    }
    const useOpen = L.open[cellIndex(cx, cy)] !== UNREACHABLE;
    const next = nextCell(L.grid, useOpen ? L.open : L.breach, cx, cy);
    if (next < 0) {
      c.y += v;
      continue;
    }
    const towerId = L.grid[next];
    if (towerId !== 0) {
      // The road is shut: batter the tower in the way.
      c.battering = towerId;
      const t = s.towers.find((t) => t.id === towerId)!;
      // Close in on the wall's face before swinging.
      const fx = (next % LANE_W) + 0.5;
      const fy = ((next / LANE_W) | 0) + 0.5;
      const dx = fx - c.x;
      const dy = fy - c.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      c.heading = headingOf(dx, dy, c.heading);
      if (dist > 0.75) {
        const k = Math.min(v, dist - 0.75) / dist;
        c.x += dx * k;
        c.y += dy * k;
      }
      if (--c.attackCd <= 0) {
        c.attackCd = TICK_RATE;
        t.hp -= d.siege;
        ev.push({ type: 'batter', lane: c.lane, towerId: t.id, x: t.x, y: t.y, cx: c.x, cy: c.y });
        if (t.hp <= 0) destroyTower(s, t, c.kind, ev);
      }
      continue;
    }
    c.battering = 0;
    const tx = (next % LANE_W) + 0.5;
    const ty = ((next / LANE_W) | 0) + 0.5;
    const dx = tx - c.x;
    const dy = ty - c.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1e-6) {
      const k = Math.min(v, dist) / dist;
      c.x += dx * k;
      c.y += dy * k;
      c.heading = headingOf(dx, dy, c.heading);
    }
  }
}

/** Facing as a quantised angle index 0..7 (rendering only needs a direction). */
function headingOf(dx: number, dy: number, prev: number): number {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return prev;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const diag = ax > ay * 0.4 && ay > ax * 0.4;
  if (diag) return dy > 0 ? (dx > 0 ? 1 : 7) : dx > 0 ? 3 : 5;
  if (ay >= ax) return dy > 0 ? 0 : 4;
  return dx > 0 ? 2 : 6;
}

const clampCell = (v: number, n: number) => (v < 0 ? 0 : v >= n ? n - 1 : v);

function heal(s: GameState, c: Creep, d: CreepDef, ev: GameEvent[]) {
  const r2 = d.healRadius * d.healRadius;
  const amt = d.healRate * DT;
  for (const o of s.creeps) {
    if (o.lane !== c.lane || o.delay > 0 || o.hp >= o.maxHp) continue;
    const dx = o.x - c.x;
    const dy = o.y - c.y;
    if (dx * dx + dy * dy <= r2) o.hp = Math.min(o.maxHp, o.hp + amt);
  }
  if ((s.tick + c.id) % TICK_RATE === 0) ev.push({ type: 'heal', lane: c.lane, x: c.x, y: c.y, radius: d.healRadius });
}

function destroyTower(s: GameState, t: Tower, by: CreepKind, ev: GameEvent[]) {
  removeTower(s, t);
  s.players[t.lane].stats.towersLost++;
  laneChanged(s, t.lane, ev);
  ev.push({ type: 'towerDestroyed', lane: t.lane, x: t.x, y: t.y, kind: t.kind, by });
}

/** Lower = closer to breaking through; used for "first" targeting. */
function remaining(s: GameState, c: Creep): number {
  if (CREEPS[c.kind].air) return (EXIT_Y - c.y) * 10;
  const L = s.lanes[c.lane];
  const i = cellIndex(clampCell(Math.floor(c.x), LANE_W), clampCell(Math.floor(c.y), LANE_H));
  const o = L.open[i];
  return o !== UNREACHABLE ? o : L.breach[i];
}

function towersAct(s: GameState, ev: GameEvent[]) {
  // Bucket live creeps per lane once per tick.
  const byLane: Creep[][] = s.lanes.map(() => []);
  for (const c of s.creeps) if (c.delay <= 0 && c.hp > 0) byLane[c.lane].push(c);
  for (const t of s.towers) {
    const a = towerLevel(t).attack;
    if (!a) continue;
    if (t.cooldown > 0) {
      t.cooldown -= 1 + t.haste;
      if (t.cooldown > 0) continue;
    }
    const list = byLane[t.lane];
    if (list.length === 0) continue;
    const ox = t.x + 0.5;
    const oy = t.y + 0.5;
    const r2 = a.range * a.range;
    let best: Creep | null = null;
    let bestRem = Infinity;
    for (const c of list) {
      const air = CREEPS[c.kind].air;
      if (air ? !a.air : !a.ground) continue;
      const dx = c.x - ox;
      const dy = c.y - oy;
      if (dx * dx + dy * dy > r2) continue;
      const rem = remaining(s, c);
      if (rem < bestRem || (rem === bestRem && best && c.id < best.id)) {
        bestRem = rem;
        best = c;
      }
    }
    if (!best) continue;
    t.cooldown += secs(a.period);
    const air = CREEPS[best.kind].air;
    s.projectiles.push({
      id: s.nextId++,
      lane: t.lane,
      style: a.style,
      towerId: t.id,
      targetId: best.id,
      x: ox,
      y: oy,
      px: ox,
      py: oy,
      sx: ox,
      sy: oy,
      tx: best.x,
      ty: best.y,
      speed: a.speed,
      damage: a.damage,
      splash: a.splash,
      pierce: a.pierce,
      air,
      homing: a.homing,
      slow: a.slow,
      burn: a.burn,
    });
    ev.push({ type: 'fire', lane: t.lane, towerId: t.id, style: a.style, x: ox, y: oy, tx: best.x, ty: best.y, air, instant: false });
  }
}

function moveProjectiles(s: GameState, ev: GameEvent[]) {
  if (s.projectiles.length === 0) return;
  const creeps = new Map<number, Creep>();
  for (const c of s.creeps) if (c.hp > 0 && c.delay <= 0) creeps.set(c.id, c);
  const towers = new Map<number, Tower>();
  for (const t of s.towers) towers.set(t.id, t);
  const keep = [];
  for (const p of s.projectiles) {
    p.px = p.x;
    p.py = p.y;
    if (p.homing) {
      const tgt = creeps.get(p.targetId);
      if (tgt && tgt.hp > 0 && tgt.lane === p.lane) {
        p.tx = tgt.x;
        p.ty = tgt.y;
      }
    }
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const v = p.speed * DT;
    if (dist <= v) {
      p.x = p.tx;
      p.y = p.ty;
      impact(s, p, ev, creeps, towers);
    } else {
      p.x += (dx / dist) * v;
      p.y += (dy / dist) * v;
      keep.push(p);
    }
  }
  s.projectiles = keep;
}

function impact(s: GameState, p: Projectile, ev: GameEvent[], creeps: Map<number, Creep>, towers: Map<number, Tower>) {
  const tower = towers.get(p.towerId);
  const tlv = tower ? towerLevel(tower) : null;
  const slowTime = tlv?.attack?.slowTime ?? 2;
  ev.push({ type: 'hit', lane: p.lane, x: p.x, y: p.y, style: p.style, splash: p.splash, air: p.air });
  const hitOne = (c: Creep, dmg: number) => {
    const d = CREEPS[c.kind];
    const dealt = dmg * (p.pierce ? 1 : 1 - d.armour);
    c.hp -= dealt;
    if (tower) tower.damage += dealt;
    if (p.slow > 0) {
      const f = p.slow * (1 - d.slowResist);
      if (f >= c.slowFactor || c.slowTicks <= 0) c.slowFactor = f;
      c.slowTicks = Math.max(c.slowTicks, secs(slowTime));
    }
    if (p.burn > 0) {
      c.burnDps = Math.max(c.burnTicks > 0 ? c.burnDps : 0, p.burn);
      c.burnTicks = secs(slowTime);
    }
    if (c.hp <= 0 && tower) tower.kills++;
  };
  if (p.splash > 0) {
    const r2 = p.splash * p.splash;
    for (const c of s.creeps) {
      if (c.lane !== p.lane || c.delay > 0 || c.hp <= 0 || CREEPS[c.kind].air) continue;
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      // Full damage at the centre, half at the rim.
      hitOne(c, p.damage * (1 - 0.5 * Math.sqrt(d2 / r2)));
    }
  } else {
    const c = creeps.get(p.targetId);
    if (c && c.hp > 0 && c.lane === p.lane) hitOne(c, p.damage);
  }
}

/** Removes the dead, handles break-throughs and eliminations. */
function reap(s: GameState, ev: GameEvent[]) {
  const keep: Creep[] = [];
  for (const c of s.creeps) {
    const d = CREEPS[c.kind];
    if (c.hp <= 0) {
      const lord = s.players[c.lane];
      lord.gold += d.bounty;
      lord.stats.kills++;
      ev.push({ type: 'death', lane: c.lane, x: c.x, y: c.y, kind: c.kind, air: d.air, bounty: d.bounty, killer: c.lane });
      continue;
    }
    if (c.delay <= 0 && c.y >= EXIT_Y) {
      if (breakThrough(s, c, d, ev)) keep.push(c);
      continue;
    }
    keep.push(c);
  }
  s.creeps = keep;

  for (const p of s.players) if (p.alive && p.lives <= 0) eliminate(s, p, ev);
}

/** A creep escaped a lane. Returns true if it marches on into the next one. */
function breakThrough(s: GameState, c: Creep, d: CreepDef, ev: GameEvent[]): boolean {
  const victim = s.players[c.lane];
  let plunder = 0;
  if (victim.alive) {
    const lives = Math.max(0, Math.min(d.lives, victim.lives));
    victim.lives -= d.lives;
    victim.stats.leaked++;
    if (c.owner >= 0) {
      const owner = s.players[c.owner];
      if (owner.alive) {
        plunder = lives * PLUNDER_PER_LIFE;
        owner.gold += plunder;
        owner.stats.plundered += plunder;
        owner.stats.livesTaken += lives;
      }
    }
  }
  const next = c.owner < 0 || c.breaches + 1 >= MAX_LANES ? null : nextAlive(s, c.lane);
  const onward = next !== null && next !== c.owner;
  ev.push({ type: 'leak', lane: c.lane, victim: victim.id, owner: c.owner, kind: c.kind, lives: d.lives, plunder, next: onward ? next : null });
  if (!onward) return false;
  sendOnward(c, next!);
  return true;
}

function sendOnward(c: Creep, lane: number) {
  c.lane = lane;
  c.x = c.px = SPAWN_X + (c.x - Math.floor(c.x) - 0.5) * 0.6;
  c.y = c.py = SPAWN_Y;
  c.delay = Math.round(TRANSIT_TIME * TICK_RATE);
  c.breaches++;
  c.battering = 0;
}

function eliminate(s: GameState, p: Player, ev: GameEvent[]) {
  const aliveBefore = s.players.filter((q) => q.alive).length;
  p.alive = false;
  p.lives = 0;
  p.place = aliveBefore;
  p.eliminatedAt = s.tick;
  s.fallen.push(p.id);
  ev.push({ type: 'eliminated', player: p.id, place: aliveBefore });
  // The lane falls: its towers are razed and anything inside marches on.
  for (const t of s.towers.filter((t) => t.lane === p.id)) removeTower(s, t);
  refreshLane(s.lanes[p.id]);
  s.projectiles = s.projectiles.filter((q) => q.lane !== p.id);
  const next = nextAlive(s, p.id);
  s.creeps = s.creeps.filter((c) => {
    if (c.lane !== p.id) return true;
    if (c.owner < 0 || next === null || next === c.owner) return false;
    sendOnward(c, next);
    return true;
  });
  const alive = s.players.filter((q) => q.alive);
  if (alive.length <= 1) {
    s.phase = 'over';
    s.winner = alive[0]?.id ?? null;
    if (alive[0]) alive[0].place = 1;
    ev.push({ type: 'gameOver', winner: s.winner });
  }
}
