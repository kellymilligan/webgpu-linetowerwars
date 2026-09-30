import { describe, expect, it } from 'vitest';
import { NetGame } from '../src/net/client';
import { TURN_MS } from '../src/net/protocol';
import type { ClientMsg, ServerMsg } from '../src/net/protocol';
import { RoomCore } from '../src/net/room';
import { stateHash, TOWER_KINDS, SENDS } from '../src/sim';
import { nextFloat, nextInt, seedRng } from '../src/sim/rng';

/**
 * A whole room in memory: a server, N clients, and a network that delivers
 * each message after a random 20–250 ms delay (ordered per connection, like
 * a WebSocket). Time is simulated in 10 ms steps.
 */
function harness(clients: number, seed = 'net') {
  const rng = seedRng(`harness:${seed}`);
  let now = 0;
  let clockOn = false;
  const inflight: { at: number; seq: number; deliver: () => void }[] = [];
  let seq = 0;
  const lastAt = new Map<string, number>();
  const post = (channel: string, deliver: () => void) => {
    // Ordered per channel: never earlier than the previous message on it.
    const at = Math.max(now + 20 + nextInt(rng, 230), lastAt.get(channel) ?? 0);
    lastAt.set(channel, at);
    inflight.push({ at, seq: seq++, deliver });
  };
  const nets: NetGame[] = [];
  const room = new RoomCore({
    send: (conn, msg) => post(`s>${conn}`, () => nets[Number(conn)].receive(clone(msg))),
    broadcast: (msg) => nets.forEach((_, i) => post(`s>${i}`, () => nets[i].receive(clone(msg)))),
    clock: (on) => (clockOn = on),
    now: () => now,
    seed: () => `war-${seed}`,
  });
  for (let i = 0; i < clients; i++) {
    const conn = String(i);
    const net = new NetGame((m: ClientMsg) => post(`c>${conn}`, () => room.onMessage(conn, JSON.stringify(m))), {
      token: `tok${i}`,
      name: `Player ${i}`,
      colour: '#b23a3a',
    });
    nets.push(net);
    room.onConnect(conn);
    net.open();
  }
  let nextPump = 0;
  const run = (ms: number, each?: (t: number) => void) => {
    const end = now + ms;
    while (now < end) {
      now += 10;
      inflight.sort((a, b) => a.at - b.at || a.seq - b.seq);
      while (inflight.length && inflight[0].at <= now) inflight.shift()!.deliver();
      if (clockOn && now >= nextPump) {
        room.pump();
        nextPump = now + TURN_MS;
      }
      for (const n of nets) n.advance(0.01);
      each?.(now);
    }
  };
  return { room, nets, run, rng };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('lockstep over a lossy-latency network', () => {
  it('lobby assigns seats, unique colours and a host', () => {
    const h = harness(3);
    h.run(600);
    const m = h.nets[0].members;
    expect(m.map((x) => x.seat)).toEqual([0, 1, 2]);
    expect(new Set(m.map((x) => x.colour)).size).toBe(3);
    // Join order depends on network timing; the first to arrive hosts and takes seat 0.
    expect(h.nets.filter((n) => n.host).length).toBe(1);
    expect(h.nets.find((n) => n.host)!.seat).toBe(0);
  });

  it('three players stay in sync with the server through a busy war', () => {
    const h = harness(3, 'busy');
    h.run(600);
    h.nets.find((n) => n.host)!.start();
    h.run(1000);
    expect(h.nets.every((n) => n.state && n.phase === 'playing')).toBe(true);
    // Everyone mashes buttons: builds anywhere, sends whatever.
    let acted = 0;
    h.run(150_000, (t) => {
      if (t % 250 !== 0) return;
      for (const n of h.nets) {
        if (!n.state) continue;
        if (nextFloat(h.rng) < 0.5) {
          n.submit({ type: 'build', player: n.seat, x: nextInt(h.rng, 11), y: 2 + nextInt(h.rng, 30), kind: TOWER_KINDS[nextInt(h.rng, TOWER_KINDS.length)] });
        } else {
          n.submit({ type: 'send', player: n.seat, send: SENDS[nextInt(h.rng, 4)].id });
        }
        acted++;
      }
    });
    const server = h.room.game!;
    // Let clients drain up to the frontier, then freeze the server and compare.
    const stopAt = server.tick;
    h.room.paused = true;
    h.run(3000);
    for (const n of h.nets) {
      expect(n.state!.tick).toBe(stopAt);
      expect(stateHash(n.state!)).toBe(stateHash(server));
      expect(n.desyncs).toBe(0);
    }
    expect(acted).toBeGreaterThan(1000);
    expect(server.towers.filter((t) => t.lane < 3).length).toBeGreaterThan(10);
  });

  it('without bots the realm has one lane per player, and stays in sync', () => {
    const h = harness(3, 'nobots');
    h.run(600);
    const host = h.nets.find((n) => n.host)!;
    host.setFillBots(false);
    h.run(600);
    expect(h.nets.every((n) => n.fillBots === false)).toBe(true);
    host.start();
    h.run(1000);
    const s = h.room.game!;
    expect(s.players.length).toBe(3);
    expect(s.lanes.length).toBe(3);
    expect(s.players.every((p) => p.bot === null)).toBe(true);
    h.run(60_000, (t) => {
      if (t % 500 !== 0) return;
      for (const n of h.nets) n.submit({ type: 'send', player: n.seat, send: 'levies' });
    });
    h.room.paused = true;
    h.run(3000);
    for (const n of h.nets) expect(stateHash(n.state!)).toBe(stateHash(h.room.game!));
    expect(h.room.game!.creeps.length + h.room.game!.players.reduce((a, p) => a + p.stats.kills, 0)).toBeGreaterThan(0);
  });

  it('a client cannot act for another seat', () => {
    const h = harness(2, 'spoof');
    h.run(600);
    h.nets.find((n) => n.host)!.start();
    h.run(1000);
    const guest = h.nets.find((n) => !n.host)!;
    guest.submit({ type: 'build', player: 0, x: 3, y: 10, kind: 'palisade' });
    h.run(1000);
    const t = h.room.game!.towers.find((t) => t.x === 3 && t.y === 10);
    expect(t?.lane).toBe(guest.seat);
  });

  it('a reconnecting player gets a snapshot and rejoins in sync', () => {
    const h = harness(2, 'rejoin');
    h.run(600);
    h.nets.find((n) => n.host)!.start();
    h.run(20_000);
    // Drop player 1, carry on, then reconnect them on a new connection id.
    h.room.onClose('1');
    h.run(10_000);
    const fresh = new NetGame((m) => h.room.onMessage('9', JSON.stringify(m)), h.nets[1].profile);
    const sends: ServerMsg[] = [];
    const io = h.room as unknown as { io: { send: (c: string, m: ServerMsg) => void } };
    const orig = io.io.send;
    io.io.send = (c, m) => (c === '9' ? sends.push(clone(m)) : orig(c, m));
    fresh.open();
    for (const m of sends) fresh.receive(m);
    expect(fresh.state).not.toBeNull();
    expect(fresh.seat).toBe(h.nets[1].seat);
    expect(stateHash(fresh.state!)).toBe(stateHash(h.room.game!));
  });
});
