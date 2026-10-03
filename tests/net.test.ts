import { describe, expect, it } from 'vitest';
import { createHarness } from 'lobbyhop/testing';
import type { Harness } from 'lobbyhop/testing';
import { game } from '../src/multiplayer/game';
import type { NetCommand, SiegeGame } from '../src/multiplayer/game';
import { SENDS, TOWER_KINDS } from '../src/sim';
import type { GameState } from '../src/sim';
import { nextFloat, nextInt } from '../src/sim/rng';

/** The server's copy of the war (the harness exposes the engine untyped). */
const serverState = (h: Harness<SiegeGame>) => (h.room.engine as unknown as { state: GameState | null }).state!;

describe('Siegeline rooms over a lossy-latency network (lobbyhop harness)', () => {
  it('lobby assigns seats, unique house colours and a host', () => {
    const h = createHarness(game, { clients: 3, seed: 'lobby' });
    h.run(600);
    const m = h.clients[0].members;
    expect(m.map((x) => x.seat)).toEqual([0, 1, 2]);
    expect(new Set(m.map((x) => x.colour)).size).toBe(3);
    // Join order depends on network timing; the first to arrive hosts and takes seat 0.
    expect(h.clients.filter((c) => c.host).length).toBe(1);
    expect(h.host().seat).toBe(0);
  });

  it('three players stay in sync with the server through a busy war', () => {
    const h = createHarness(game, { clients: 3, seed: 'busy' });
    h.run(600);
    h.startGame();
    expect(h.clients.every((c) => c.state && c.phase === 'playing')).toBe(true);
    // Everyone mashes buttons: builds anywhere, sends whatever.
    let acted = 0;
    h.run(150_000, (t) => {
      if (t % 250 !== 0) return;
      for (const c of h.clients) {
        if (!c.state) continue;
        const cmd: NetCommand =
          nextFloat(h.rng) < 0.5
            ? { type: 'build', x: nextInt(h.rng, 11), y: 2 + nextInt(h.rng, 30), kind: TOWER_KINDS[nextInt(h.rng, TOWER_KINDS.length)] }
            : { type: 'send', send: SENDS[nextInt(h.rng, 4)].id };
        c.submit(cmd);
        acted++;
      }
    });
    h.freeze();
    h.assertInSync();
    for (const c of h.clients) expect(c.desyncs).toBe(0);
    expect(acted).toBeGreaterThan(1000);
    expect(serverState(h).towers.filter((t) => t.lane < 3).length).toBeGreaterThan(10);
  });

  it('without bots the realm has one lane per player, and stays in sync', () => {
    const h = createHarness(game, { clients: 3, seed: 'nobots' });
    h.run(600);
    h.host().setSettings({ fillBots: false });
    h.run(600);
    expect(h.clients.every((c) => c.settings.fillBots === false)).toBe(true);
    h.startGame();
    const s = serverState(h);
    expect(s.players.length).toBe(3);
    expect(s.lanes.length).toBe(3);
    expect(s.players.every((p) => p.bot === null)).toBe(true);
    h.run(60_000, (t) => {
      if (t % 500 !== 0) return;
      for (const c of h.clients) c.submit({ type: 'send', send: 'levies' });
    });
    h.freeze();
    h.assertInSync();
    const end = serverState(h);
    expect(end.creeps.length + end.players.reduce((a, p) => a + p.stats.kills, 0)).toBeGreaterThan(0);
  });

  it('a lone lord without bots still gets one rival', () => {
    const h = createHarness(game, { clients: 1, seed: 'alone' });
    h.run(600);
    h.host().setSettings({ fillBots: false });
    h.run(600);
    h.startGame();
    const s = serverState(h);
    expect(s.players.length).toBe(2);
    expect(s.players[0].bot).toBeNull();
    expect(s.players[1].bot).not.toBeNull();
  });

  it('a client cannot act for another seat', () => {
    const h = createHarness(game, { clients: 2, seed: 'spoof' });
    h.run(600);
    h.startGame();
    const guest = h.clients.find((c) => !c.host)!;
    // A forged `player` field is ignored: the server stamps the sender's seat.
    guest.submit({ type: 'build', player: 0, x: 3, y: 10, kind: 'palisade' } as NetCommand);
    // And clients can't issue the server's bot-takeover command.
    guest.submit({ type: 'bot', on: true });
    h.run(1000);
    const s = serverState(h);
    expect(s.towers.find((t) => t.x === 3 && t.y === 10)?.lane).toBe(guest.seat);
    expect(s.players[guest.seat!].bot).toBeNull();
  });

  it('a dropped lord is played by a bot, and gets their seat back on return', () => {
    const h = createHarness(game, { clients: 2, seed: 'idle' });
    h.run(600);
    h.startGame();
    h.run(5_000);
    const i = h.clients.findIndex((c) => !c.host);
    const seat = h.clients[i].seat!;
    h.disconnect(i);
    h.run(game.idleMs! + 2_000);
    expect(serverState(h).players[seat].bot).not.toBeNull();
    h.run(20_000);
    h.reconnect(i);
    h.run(3_000);
    expect(h.clients[i].seat).toBe(seat);
    expect(serverState(h).players[seat].bot).toBeNull();
    h.freeze();
    h.assertInSync();
  });

  it('a reconnecting player gets a snapshot and rejoins in sync', () => {
    const h = createHarness(game, { clients: 2, seed: 'rejoin' });
    h.run(600);
    h.startGame();
    h.run(20_000);
    const before = h.clients[1].snapshots;
    h.disconnect(1);
    h.run(10_000);
    h.reconnect(1);
    h.run(3_000);
    expect(h.clients[1].snapshots).toBeGreaterThan(before);
    h.freeze();
    h.assertInSync();
  });
});
