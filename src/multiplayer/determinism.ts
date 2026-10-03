/**
 * A scripted war for the cross-engine determinism check:
 *   npx lobbyhop determinism src/multiplayer/determinism.ts --require-all
 * Bundled and run identically in Node, Chromium, Firefox and WebKit.
 */
import { recordHashes } from 'lobbyhop/testing';
import { nextInt } from 'lobbyhop/det';
import { SENDS, TOWER_KINDS } from '../sim';
import { game } from './game';
import type { NetCommand } from './game';

export function runScenario(seed: string, minutes: number): number[] {
  return recordHashes(game, {
    seed,
    // Two "humans" follow a seeded script; the other six seats are bot lords.
    seats: [0, 3],
    settings: { fillBots: true },
    ticks: minutes * 60 * game.tickRate,
    input: (t, rng) => {
      if (t % 20 !== 0) return [];
      return [0, 3].map((seat): [number, NetCommand] =>
        nextInt(rng, 3) > 0
          ? [seat, { type: 'build', x: nextInt(rng, 11), y: 2 + nextInt(rng, 30), kind: TOWER_KINDS[nextInt(rng, TOWER_KINDS.length)] }]
          : [seat, { type: 'send', send: SENDS[nextInt(rng, SENDS.length)].id }],
      );
    },
  });
}

(globalThis as unknown as { runScenario: typeof runScenario }).runScenario = runScenario;
