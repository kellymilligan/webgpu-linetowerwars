/**
 * The room server's brain, independent of any hosting platform. The
 * Cloudflare Durable Object (server/index.ts) and the in-memory test harness
 * both drive it through the same small interface.
 */
import { applyCommand, createGame, HOUSES, stateHash, step, TICK_RATE } from '../sim';
import type { Command, GameState } from '../sim';
import { HASH_EVERY, MAX_SEATS, PROTOCOL_VERSION } from './protocol';
import type { ClientMsg, RoomPhase, ServerMsg, SeatView } from './protocol';

export interface RoomIO {
  send(conn: string, msg: ServerMsg): void;
  broadcast(msg: ServerMsg): void;
  /** Ask the host to call pump() every TURN_MS (true) or stop (false). */
  clock(running: boolean): void;
  now(): number;
  /** Fresh seed for a new war. */
  seed(): string;
}

interface Member {
  token: string;
  name: string;
  colour: string;
  conn: string | null;
  seat: number;
}

/** Cap on catch-up after a stall (e.g. the host was suspended), in ticks. */
const MAX_CATCH_UP = TICK_RATE * 5;

export class RoomCore {
  phase: RoomPhase = 'lobby';
  game: GameState | null = null;
  paused = false;
  /** Fill empty seats with bots; if off, the realm has one lane per human. */
  fillBots = true;
  private members: Member[] = [];
  private byConn = new Map<string, Member>();
  private queue: { seat: number; cmd: Command }[] = [];
  private clockBase = 0;
  private tickBase = 0;
  private hashes = new Map<number, number>();

  constructor(private io: RoomIO) {}

  get connected() {
    return this.members.filter((m) => m.conn).length;
  }

  onConnect(_conn: string) {
    // Nothing until the client says hello with its token.
  }

  onClose(conn: string) {
    const m = this.byConn.get(conn);
    this.byConn.delete(conn);
    if (!m) return;
    m.conn = null;
    // In the lobby a leaver frees their seat; in a war the seat is held for a reconnect.
    if (this.phase === 'lobby') this.reseat(this.members.filter((x) => x !== m));
    if (this.connected === 0) this.io.clock(false);
    this.broadcastRoom();
  }

  onMessage(conn: string, raw: string) {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    if (msg.t === 'hello') return this.hello(conn, msg);
    const m = this.byConn.get(conn);
    if (!m) return;
    const isHost = this.hostOf() === m;
    switch (msg.t) {
      case 'profile':
        if (this.phase !== 'lobby') return;
        m.name = cleanName(msg.name);
        m.colour = this.freeColour(msg.colour, m);
        this.broadcastRoom();
        break;
      case 'start':
        if (!isHost || this.phase === 'playing') return;
        if (!this.fillBots && this.members.length < 2) {
          this.io.send(conn, { t: 'reject', reason: 'Without bots you need at least two players.' });
          return;
        }
        this.start();
        break;
      case 'settings':
        if (isHost && this.phase === 'lobby') {
          this.fillBots = !!msg.fillBots;
          this.broadcastRoom();
        }
        break;
      case 'toLobby':
        if (isHost && this.phase === 'over') {
          this.phase = 'lobby';
          this.game = null;
          this.reseat(this.members.filter((x) => x.conn));
          this.broadcastRoom();
        }
        break;
      case 'pause':
        if (isHost && this.phase === 'playing' && msg.paused !== this.paused) {
          this.paused = msg.paused;
          if (!this.paused) this.rebase();
          this.broadcastRoom();
        }
        break;
      case 'cmd':
        if (this.phase !== 'playing') return;
        if (this.paused) this.io.send(conn, { t: 'reject', reason: 'The war is paused.' });
        else this.queue.push({ seat: m.seat, cmd: msg.cmd });
        break;
      case 'hash': {
        const mine = this.hashes.get(msg.tick);
        if (mine !== undefined && mine !== msg.hash && this.game) {
          this.io.send(conn, { t: 'desync', tick: msg.tick });
          this.io.send(conn, { t: 'snapshot', state: this.game });
        }
        break;
      }
    }
  }

  private hello(conn: string, msg: Extract<ClientMsg, { t: 'hello' }>) {
    if (msg.v !== PROTOCOL_VERSION) {
      this.io.send(conn, { t: 'error', reason: 'Your game is out of date. Refresh to update.' });
      return;
    }
    let m = this.members.find((x) => x.token === msg.token);
    if (!m) {
      if (this.phase !== 'lobby') {
        this.io.send(conn, { t: 'error', reason: 'This war has already begun.' });
        return;
      }
      if (this.members.length >= MAX_SEATS) {
        this.io.send(conn, { t: 'error', reason: 'This war council is full.' });
        return;
      }
      m = { token: msg.token, name: cleanName(msg.name), colour: '', conn: null, seat: this.members.length };
      m.colour = this.freeColour(msg.colour, m);
      this.members.push(m);
    }
    if (m.conn) this.byConn.delete(m.conn);
    m.conn = conn;
    this.byConn.set(conn, m);
    this.io.send(conn, { t: 'welcome', seat: m.seat, host: this.hostOf() === m });
    this.broadcastRoom();
    // Rejoining a war in progress: hand over the current state.
    if (this.game && this.phase !== 'lobby') this.io.send(conn, { t: 'snapshot', state: this.game });
    if (this.phase === 'playing') this.io.clock(true);
  }

  private start() {
    const seats = Array.from({ length: this.fillBots ? MAX_SEATS : this.members.length }, (_, i) => {
      const m = this.members.find((x) => x.seat === i);
      return m ? { name: m.name, colour: m.colour } : null;
    });
    this.game = createGame(this.io.seed(), { seats });
    this.phase = 'playing';
    this.paused = false;
    this.queue = [];
    this.hashes.clear();
    this.rebase();
    this.broadcastRoom();
    this.io.broadcast({ t: 'snapshot', state: this.game });
    this.io.clock(true);
  }

  private rebase() {
    this.clockBase = this.io.now();
    this.tickBase = this.game?.tick ?? 0;
  }

  /** Advance the authoritative sim to wall-clock time and broadcast the turn. */
  pump() {
    const s = this.game;
    if (!s || this.phase !== 'playing' || this.paused) return;
    let target = this.tickBase + Math.floor(((this.io.now() - this.clockBase) * TICK_RATE) / 1000);
    if (target - s.tick > MAX_CATCH_UP) {
      target = s.tick + MAX_CATCH_UP;
      this.clockBase = this.io.now();
      this.tickBase = target;
    }
    if (target <= s.tick) return;
    const at = s.tick;
    const cmds: Command[] = [];
    for (const { seat, cmd } of this.queue) {
      // The server stamps the seat; clients can only act for themselves.
      const c = { ...cmd, player: seat } as Command;
      const r = applyCommand(s, c);
      if (r.result.ok) cmds.push(c);
      else {
        const m = this.members.find((x) => x.seat === seat);
        if (m?.conn) this.io.send(m.conn, { t: 'reject', reason: r.result.reason });
      }
    }
    this.queue = [];
    while (s.tick < target && s.phase !== 'over') {
      step(s);
      if (s.tick % HASH_EVERY === 0) {
        this.hashes.set(s.tick, stateHash(s));
        this.hashes.delete(s.tick - HASH_EVERY * 20);
      }
    }
    this.io.broadcast({ t: 'turn', at, upTo: s.tick, cmds });
    if (s.phase === 'over') {
      this.phase = 'over';
      this.io.clock(false);
      this.broadcastRoom();
    }
  }

  private hostOf(): Member | undefined {
    return this.members.find((m) => m.conn) ?? this.members[0];
  }

  private reseat(list: Member[]) {
    this.members = list;
    list.forEach((m, i) => (m.seat = i));
  }

  private freeColour(want: string, me: Member): string {
    const used = new Set(this.members.filter((x) => x !== me).map((x) => x.colour));
    if (HOUSES.some((h) => h.colour === want) && !used.has(want)) return want;
    return HOUSES.find((h) => !used.has(h.colour))!.colour;
  }

  private broadcastRoom() {
    const host = this.hostOf();
    const members: SeatView[] = this.members.map((m) => ({ seat: m.seat, name: m.name, colour: m.colour, connected: !!m.conn, host: m === host }));
    this.io.broadcast({ t: 'room', phase: this.phase, members, paused: this.paused, fillBots: this.fillBots });
    // Tell everyone whether they're host (it can change when the host leaves).
    for (const m of this.members) if (m.conn) this.io.send(m.conn, { t: 'welcome', seat: m.seat, host: m === host });
  }
}

function cleanName(n: string) {
  const s = String(n ?? '').replace(/[^\p{L}\p{N} '_-]/gu, '').trim().slice(0, 16);
  return s || 'Nameless';
}
