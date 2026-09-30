import {
  applyCommand,
  buildable,
  cellIndex,
  checkBuild,
  computeField,
  createGame,
  CREEPS,
  DT,
  SAVE_VERSION,
  SENDS_BY_ID,
  step,
  tracePath,
} from '../sim';
import type { Command, GameEvent, GameState, PlaceCheck, SendId, TowerKind } from '../sim';
import type { NetGame } from '../net/client';

export type Selection = { kind: 'tower'; id: number } | { kind: 'tile'; lane: number; x: number; y: number } | null;

export interface Hover {
  lane: number;
  x: number;
  y: number;
  check: PlaceCheck | null;
  preview: number[] | null;
}

export type Speed = 1 | 2 | 4 | 10;

export interface FeedItem {
  id: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
  at: number;
}

const SAVE_KEY = 'siegeline.save.v1';

export class Controller {
  state: GameState;
  /** The local player's id (and lane). */
  me = 0;
  speed: Speed = 1;
  paused = false;
  selection: Selection = null;
  hover: Hover | null = null;
  /** Tower kind armed for quick building, or null. */
  armed: TowerKind | null = null;
  toast: { text: string; id: number } | null = null;
  feed: FeedItem[] = [];
  confirmNew = false;
  version = 0;
  runId = 0;
  /** Set when playing in a multiplayer room; the server then owns the clock. */
  net: NetGame | null = null;
  /**
   * Builds ordered in multiplayer that the server hasn't confirmed yet. They're
   * drawn as translucent ghosts so the ~150 ms round trip doesn't feel laggy.
   */
  ghosts: { lane: number; x: number; y: number; kind: TowerKind; at: number }[] = [];
  private netSnapshots = 0;
  /** Lane the camera should glide to (consumed by the scene). */
  focusRequest: number | null = null;
  private listeners = new Set<() => void>();
  private acc = 0;
  private events: GameEvent[] = [];
  private lastNotify = 0;
  private dirty = false;
  private lastSave = 0;
  private feedId = 0;

  constructor(state?: GameState) {
    this.state = state ?? createGame(randomSeed());
  }

  static fromSave(): Controller | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as GameState;
      if (s.version !== SAVE_VERSION || s.phase === 'over') return null;
      return new Controller(s);
    } catch {
      return null;
    }
  }

  newGame(seed = randomSeed()) {
    if (this.net) {
      // "New" in a room means leaving it for a solo war.
      location.search = '';
      return;
    }
    this.state = createGame(seed);
    this.runId++;
    this.selection = null;
    this.hover = null;
    this.armed = null;
    this.acc = 0;
    this.paused = false;
    this.confirmNew = false;
    this.events = [];
    this.feed = [];
    this.focusRequest = this.me;
    this.save();
    this.notify(true);
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(force = false) {
    const now = performance.now();
    if (!force && now - this.lastNotify < 120) {
      this.dirty = true;
      return;
    }
    this.lastNotify = now;
    this.dirty = false;
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** Hooks this controller to a room; the net session drives state from then on. */
  attachNet(net: NetGame) {
    this.net = net;
    this.speed = 1;
    net.onNotice = (t) => {
      // A rejection (e.g. not enough gold) most likely voids our pending builds.
      this.ghosts = [];
      this.showToast(t);
    };
    net.onChange = () => {
      this.me = net.seat;
      if (net.state && net.snapshots !== this.netSnapshots) {
        const first = this.netSnapshots === 0 || this.state !== net.state;
        this.netSnapshots = net.snapshots;
        this.state = net.state;
        this.runId++;
        this.selection = null;
        this.hover = null;
        this.events = [];
        this.ghosts = [];
        if (first) this.focusRequest = this.me;
      }
      this.notify(true);
    };
  }

  dispatch(cmd: Command): boolean {
    if (this.net) {
      // Intent only: the server validates it and it lands with the next turn.
      if (!this.net.state || this.net.phase !== 'playing') return false;
      this.net.submit(cmd);
      if (cmd.type === 'build') this.ghosts.push({ lane: this.me, x: cmd.x, y: cmd.y, kind: cmd.kind, at: performance.now() });
      if (cmd.type === 'sell') this.selection = null;
      this.notify(true);
      return true;
    }
    const { result, events } = applyCommand(this.state, cmd);
    if (!result.ok) {
      this.showToast(result.reason);
      return false;
    }
    this.events.push(...events);
    this.narrate(events);
    if (cmd.type === 'sell') this.selection = null;
    if (cmd.type === 'build' || cmd.type === 'sell' || cmd.type === 'upgrade') {
      this.hover = this.hover ? this.computeHover(this.hover.lane, this.hover.x, this.hover.y) : null;
    }
    this.save(true);
    this.notify(true);
    return true;
  }

  build(x: number, y: number, kind: TowerKind) {
    return this.dispatch({ type: 'build', player: this.me, x, y, kind });
  }

  send(id: SendId) {
    return this.dispatch({ type: 'send', player: this.me, send: id });
  }

  upgrade(towerId: number, kind?: TowerKind) {
    return this.dispatch({ type: 'upgrade', player: this.me, towerId, kind });
  }

  sell(towerId: number) {
    return this.dispatch({ type: 'sell', player: this.me, towerId });
  }

  arm(kind: TowerKind | null) {
    this.armed = this.armed === kind ? null : kind;
    if (this.armed) this.selection = null;
    this.hover = this.hover ? this.computeHover(this.hover.lane, this.hover.x, this.hover.y) : null;
    this.notify(true);
  }

  showToast(text: string) {
    this.toast = { text, id: (this.toast?.id ?? 0) + 1 };
    this.notify(true);
  }

  setSpeed(speed: Speed) {
    if (this.net) return;
    this.speed = speed;
    this.paused = false;
    this.notify(true);
  }

  togglePause() {
    if (this.net) {
      if (this.net.host) this.net.setPaused(!this.net.paused);
      return;
    }
    this.paused = !this.paused;
    this.notify(true);
  }

  select(sel: Selection) {
    this.selection = sel;
    this.notify(true);
  }

  focusLane(lane: number) {
    this.focusRequest = lane;
    this.notify(true);
  }

  /** Runs fixed sim ticks for real elapsed time; returns interpolation alpha. */
  tick(dtReal: number): number {
    if (this.net) return this.tickNet(dtReal);
    const s = this.state;
    if (s.phase === 'over' || this.paused) {
      this.acc = 0;
      if (this.dirty) this.notify();
      return 1;
    }
    this.acc += Math.min(dtReal, 0.25) * this.speed;
    let stepped = false;
    let guard = 0;
    while (this.acc >= DT && !isOver(s) && guard++ < 40) {
      this.acc -= DT;
      const ev = step(s);
      if (ev.length) {
        this.events.push(...ev);
        this.narrate(ev);
      }
      stepped = true;
    }
    if (guard >= 40) this.acc = 0;
    if (stepped) {
      if (this.hover && s.tick % 15 === 0) this.hover = this.computeHover(this.hover.lane, this.hover.x, this.hover.y);
      this.save();
      this.notify(isOver(s));
    }
    return this.acc / DT;
  }

  private tickNet(dtReal: number): number {
    const net = this.net!;
    if (!net.state) {
      if (this.dirty) this.notify();
      return 1;
    }
    const { events, alpha } = net.advance(dtReal);
    if (this.ghosts.length) {
      // Confirmed builds replace their ghosts; anything unconfirmed after 2 s is dropped.
      const now = performance.now();
      const built = new Set(events.flatMap((e) => (e.type === 'built' && e.lane === this.me ? [`${e.x},${e.y}`] : [])));
      const before = this.ghosts.length;
      this.ghosts = this.ghosts.filter((g) => !built.has(`${g.x},${g.y}`) && now - g.at < 2000);
      if (this.ghosts.length !== before) this.notify(true);
    }
    if (events.length) {
      this.events.push(...events);
      this.narrate(events);
      if (events.some((e) => e.type === 'built' || e.type === 'sold' || e.type === 'towerDestroyed' || e.type === 'upgraded')) {
        this.hover = this.hover ? this.computeHover(this.hover.lane, this.hover.x, this.hover.y) : null;
      }
      this.notify(events.some((e) => e.type === 'gameOver'));
    } else if (this.dirty) this.notify();
    return alpha;
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  setHover(tile: { lane: number; x: number; y: number } | null) {
    if (!tile) {
      if (this.hover) {
        this.hover = null;
        this.notify(true);
      }
      return;
    }
    if (this.hover && this.hover.lane === tile.lane && this.hover.x === tile.x && this.hover.y === tile.y) return;
    this.hover = this.computeHover(tile.lane, tile.x, tile.y);
    this.notify(true);
  }

  private computeHover(lane: number, x: number, y: number): Hover {
    const s = this.state;
    const L = s.lanes[lane];
    if (lane !== this.me || !buildable(x, y) || L.grid[cellIndex(x, y)] !== 0 || this.ghosts.some((g) => g.x === x && g.y === y)) {
      return { lane, x, y, check: null, preview: null };
    }
    const check = checkBuild(s, this.me, x, y, this.armed ?? 'palisade');
    let preview: number[] | null = null;
    if (check.pathLength >= 0 && (check.ok || check.reason?.startsWith('Need'))) {
      const grid = L.grid.slice();
      grid[cellIndex(x, y)] = -1;
      preview = tracePath(grid, computeField(grid, false));
    }
    return { lane, x, y, check, preview };
  }

  clickTile(lane: number, x: number, y: number) {
    const s = this.state;
    const id = s.lanes[lane].grid[cellIndex(x, y)];
    if (id) {
      this.selection = { kind: 'tower', id };
      this.armed = null;
    } else if (lane === this.me && buildable(x, y)) {
      // Already ordered here and waiting on the server.
      if (this.ghosts.some((g) => g.x === x && g.y === y)) return;
      if (this.armed) {
        this.build(x, y, this.armed);
        return;
      }
      this.selection = { kind: 'tile', lane, x, y };
    } else this.selection = null;
    this.notify(true);
  }

  /** Right-click / Escape: disarm, then deselect. */
  cancel() {
    if (this.confirmNew) this.confirmNew = false;
    else if (this.armed) this.armed = null;
    else this.selection = null;
    this.notify(true);
  }

  private say(text: string, tone: FeedItem['tone']) {
    this.feed = [...this.feed.slice(-5), { id: ++this.feedId, text, tone, at: performance.now() }];
  }

  /** Turns sim events into short feed lines about what matters to the player. */
  private narrate(events: GameEvent[]) {
    const s = this.state;
    const name = (id: number) => (id === this.me ? 'You' : `House ${s.players[id].name}`);
    const leakAgg = new Map<string, { lives: number; plunder: number; text: (n: number, lives: number, g: number) => string; tone: FeedItem['tone'] }>();
    for (const e of events) {
      switch (e.type) {
        case 'gatesOpen':
          this.say('The gates open. Sends are unlocked.', 'info');
          break;
        case 'raid':
          if (e.number % 5 === 0) this.say(`Raid ${e.number}: brigands strike every holding.`, 'info');
          break;
        case 'sent':
          if (e.target === this.me && (SENDS_BY_ID[e.send].cost >= 120)) this.say(`${name(e.player)} sends ${SENDS_BY_ID[e.send].name} at you!`, 'bad');
          break;
        case 'leak': {
          if (e.victim === this.me) {
            const k = `in:${e.kind}`;
            const a = leakAgg.get(k) ?? { lives: 0, plunder: 0, tone: 'bad' as const, text: (n: number, l: number) => `${n > 1 ? `${n} ${CREEPS[e.kind].name}s` : CREEPS[e.kind].name} broke through: −${l} ${l === 1 ? 'life' : 'lives'}` };
            a.lives += e.lives;
            leakAgg.set(k, a);
          } else if (e.owner === this.me) {
            const k = `out:${e.victim}`;
            const a = leakAgg.get(k) ?? { lives: 0, plunder: 0, tone: 'good' as const, text: (_n: number, l: number, g: number) => `You plundered ${s.players[e.victim].name}: ${l} ${l === 1 ? 'life' : 'lives'}, +${g} gold` };
            a.lives += e.lives;
            a.plunder += e.plunder;
            leakAgg.set(k, a);
          }
          break;
        }
        case 'blocked':
          if (e.lane === this.me) this.say(e.blocked ? 'Your road is blocked. Foes will batter through your towers.' : 'Your road is open again.', e.blocked ? 'bad' : 'info');
          break;
        case 'towerDestroyed':
          if (e.lane === this.me) this.say(`A ${CREEPS[e.by].name} smashed your ${e.kind}.`, 'bad');
          break;
        case 'eliminated':
          this.say(e.player === this.me ? `Your keep has fallen. You place ${ordinal(e.place)}.` : `House ${s.players[e.player].name} has fallen (${ordinal(e.place)}).`, e.player === this.me ? 'bad' : 'info');
          if (e.player !== this.me && s.players[this.me].alive) {
            const t = s.players.find((p) => p.alive && p.id !== this.me && isNextOf(s, this.me, p.id));
            if (t) this.say(`Your sends now march on House ${t.name}.`, 'info');
          }
          break;
        case 'gameOver':
          this.say(e.winner === this.me ? 'Victory. The realm is yours.' : `House ${e.winner !== null ? s.players[e.winner].name : 'nobody'} holds the realm.`, e.winner === this.me ? 'good' : 'info');
          break;
      }
    }
    const count = new Map<string, number>();
    for (const e of events) if (e.type === 'leak') count.set(e.victim === this.me ? `in:${e.kind}` : `out:${e.victim}`, (count.get(e.victim === this.me ? `in:${e.kind}` : `out:${e.victim}`) ?? 0) + 1);
    for (const [k, a] of leakAgg) this.say(a.text(count.get(k) ?? 1, a.lives, a.plunder), a.tone);
  }

  save(force = false) {
    if (this.net) return;
    const now = performance.now();
    if (!force && now - this.lastSave < 4000) return;
    this.lastSave = now;
    try {
      const s = this.state;
      if (s.phase === 'over') localStorage.removeItem(SAVE_KEY);
      else localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    } catch {
      // Storage may be unavailable (private mode); saving is best-effort.
    }
  }
}

/** Reads the phase freshly (TS narrows it across step() calls otherwise). */
const isOver = (s: GameState) => s.phase === 'over';

function isNextOf(s: GameState, from: number, to: number) {
  const n = s.players.length;
  for (let k = 1; k < n; k++) {
    const p = s.players[(from + k) % n];
    if (p.alive) return p.id === to;
  }
  return false;
}

export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}
