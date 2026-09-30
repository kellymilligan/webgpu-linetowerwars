/**
 * Client half of server-clocked lockstep, free of DOM and sockets so it can be
 * tested in-memory. It runs the same deterministic sim as the server, but
 * never past the latest turn the server has announced (the "frontier").
 */
import { applyCommand, stateHash, step, TICK_RATE } from '../sim';
import type { Command, GameEvent, GameState } from '../sim';
import { HASH_EVERY, PROTOCOL_VERSION } from './protocol';
import type { ClientMsg, RoomPhase, SeatView, ServerMsg } from './protocol';

/** How far behind the frontier we aim to run, as a jitter buffer (ticks). */
const TARGET_LAG = 3;

export interface Profile {
  token: string;
  name: string;
  colour: string;
}

export class NetGame {
  state: GameState | null = null;
  seat = 0;
  host = false;
  phase: RoomPhase = 'lobby';
  members: SeatView[] = [];
  paused = false;
  connected = false;
  error: string | null = null;
  /** Latest tick the server has cleared us to simulate to. */
  frontier = 0;
  /** Bumped whenever a snapshot replaces the state. */
  snapshots = 0;
  desyncs = 0;
  private pending: { at: number; cmds: Command[] }[] = [];
  private acc = 0;
  /** Called with toasts from the server (e.g. rejected commands). */
  onNotice: (text: string) => void = () => {};
  onChange: () => void = () => {};

  constructor(
    private send: (m: ClientMsg) => void,
    public profile: Profile,
  ) {}

  /** Call when the socket (re)opens. */
  open() {
    this.connected = true;
    this.send({ t: 'hello', v: PROTOCOL_VERSION, token: this.profile.token, name: this.profile.name, colour: this.profile.colour });
    this.onChange();
  }

  closed() {
    this.connected = false;
    this.onChange();
  }

  setProfile(name: string, colour: string) {
    this.profile = { ...this.profile, name, colour };
    this.send({ t: 'profile', name, colour });
  }

  start() {
    this.send({ t: 'start' });
  }

  setPaused(paused: boolean) {
    this.send({ t: 'pause', paused });
  }

  toLobby() {
    this.send({ t: 'toLobby' });
  }

  /** Sends intent; it takes effect when the server echoes it back in a turn. */
  submit(cmd: Command) {
    this.send({ t: 'cmd', cmd });
  }

  receive(msg: ServerMsg) {
    switch (msg.t) {
      case 'welcome':
        this.seat = msg.seat;
        this.host = msg.host;
        break;
      case 'room':
        this.phase = msg.phase;
        this.members = msg.members;
        this.paused = msg.paused;
        if (msg.phase === 'lobby') this.state = null;
        break;
      case 'snapshot':
        this.state = msg.state;
        this.frontier = msg.state.tick;
        this.pending = [];
        this.acc = 0;
        this.snapshots++;
        break;
      case 'turn':
        if (msg.cmds.length) this.pending.push({ at: msg.at, cmds: msg.cmds });
        this.frontier = Math.max(this.frontier, msg.upTo);
        break;
      case 'reject':
        this.onNotice(msg.reason);
        break;
      case 'desync':
        this.desyncs++;
        this.onNotice('Resynchronising with the server…');
        break;
      case 'error':
        this.error = msg.reason;
        break;
    }
    this.onChange();
  }

  /**
   * Advances real time. Runs slightly faster when far behind the frontier and
   * slightly slower when close, so play stays smooth over network jitter.
   * Returns sim events and the render interpolation alpha.
   */
  advance(dtReal: number): { events: GameEvent[]; alpha: number } {
    const events: GameEvent[] = [];
    const s = this.state;
    // No early return when paused: the server simply stops issuing turns, so we
    // finish what we've been cleared for and come to rest on the same tick as everyone.
    if (!s) return { events, alpha: 1 };
    const lag = this.frontier - s.tick;
    // Ease back to TARGET_LAG; far behind (a slow machine, a hidden tab) we sprint to catch up.
    const rate = lag > TARGET_LAG * 2 ? Math.min(30, 1 + (lag - TARGET_LAG * 2) / 6) : lag < TARGET_LAG ? 0.85 : 1;
    this.acc += Math.min(dtReal, 1) * TICK_RATE * rate;
    while (this.acc >= 1 && s.tick < this.frontier) {
      this.applyDue(s, events);
      events.push(...step(s));
      this.acc -= 1;
      if (s.tick % HASH_EVERY === 0) this.send({ t: 'hash', tick: s.tick, hash: stateHash(s) });
    }
    // Don't bank time while stalled at the frontier, or we'd lurch forward later.
    if (s.tick >= this.frontier) this.acc = Math.min(this.acc, 1);
    return { events, alpha: Math.min(1, this.acc) };
  }

  private applyDue(s: GameState, events: GameEvent[]) {
    while (this.pending.length && this.pending[0].at <= s.tick) {
      const turn = this.pending.shift()!;
      if (turn.at < s.tick) {
        // Should never happen with an ordered transport; the server's next hash check will repair us.
        continue;
      }
      for (const c of turn.cmds) events.push(...applyCommand(s, c).events);
    }
  }
}
