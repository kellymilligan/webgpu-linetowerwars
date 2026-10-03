/**
 * Siegeline as a lobbyhop lockstep game. Shared by the browser, the room
 * server (Durable Object) and the tests. It wraps the existing sim; the
 * rules live in `src/sim`.
 */
import { defineLockstep, ok, reject } from 'lobbyhop';
import { applyCommand, createGame, HOUSES, step, TICK_RATE } from '../sim';
import type { Command, GameEvent, GameState } from '../sim';
import { createBrain } from '../sim/bot';

/** Most lanes a realm can have. */
export const MAX_SEATS = 8;

type WithoutPlayer<T> = T extends unknown ? Omit<T, 'player'> : never;

/**
 * What clients send. The server stamps the sender's seat, so commands carry
 * no `player`. `bot` comes only from server hooks: an idle seat goes to the
 * bot brain, and comes back when its lord returns.
 */
export type NetCommand = WithoutPlayer<Command> | { type: 'bot'; on: boolean };

export interface Settings {
  /** Fill empty seats with bot lords. Off: one lane per human (at least two). */
  fillBots: boolean;
}

export const game = defineLockstep<GameState, NetCommand, Settings, GameEvent>({
  name: 'siegeline',
  version: 1,
  tickRate: TICK_RATE,
  turnMs: 100,
  hashEvery: 150,
  seats: { min: 1, max: MAX_SEATS, palette: HOUSES.map((h) => h.colour) },
  settings: { defaults: { fillBots: true } },
  idleMs: 20_000,
  hooks: {
    idle: () => ({ type: 'bot', on: true }),
    return: () => ({ type: 'bot', on: false }),
  },
  create({ seed, seats, settings }) {
    // Without bots a lone lord still gets one bot rival, so the war has someone to fight.
    const count = settings.fillBots ? MAX_SEATS : Math.max(2, seats.length);
    return createGame(seed, {
      seats: Array.from({ length: count }, (_, i) => {
        const h = seats.find((x) => x.seat === i);
        return h ? { name: h.name, colour: h.colour } : null;
      }),
    });
  },
  apply(s, cmd, from) {
    if (cmd.type === 'bot') {
      if (!from.system) return reject('Not allowed.');
      const p = s.players[from.seat];
      if (!p) return reject('No such lord.');
      if (cmd.on && !p.bot) p.bot = createBrain(s.rng);
      if (!cmd.on) p.bot = null;
      return ok();
    }
    const { result, events } = applyCommand(s, { ...cmd, player: from.seat } as Command);
    return result.ok ? ok(events) : reject(result.reason);
  },
  step: (s) => step(s),
  isOver: (s) => s.phase === 'over',
});

export type SiegeGame = typeof game;
