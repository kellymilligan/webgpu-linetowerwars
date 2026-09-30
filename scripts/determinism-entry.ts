/**
 * A scripted war used to check cross-engine determinism. Bundled and run
 * identically in Node and in each browser engine by scripts/determinism.mjs.
 */
import { applyCommand, createGame, SENDS, stateHash, step, TOWER_KINDS } from '../src/sim';
import type { GameState } from '../src/sim';
import { nextInt, seedRng } from '../src/sim/rng';

export function runScenario(seed: string, minutes: number): number[] {
  // Two "humans" follow a seeded script; the other six seats are bots.
  let s: GameState = createGame(seed, { humans: [0, 3] });
  const script = seedRng(`script:${seed}`);
  const hashes: number[] = [];
  const total = minutes * 60 * 30;
  for (let t = 0; t < total && s.phase !== 'over'; t++) {
    if (t % 20 === 0) {
      for (const p of [0, 3]) {
        if (nextInt(script, 3) > 0) {
          applyCommand(s, { type: 'build', player: p, x: nextInt(script, 11), y: 2 + nextInt(script, 30), kind: TOWER_KINDS[nextInt(script, TOWER_KINDS.length)] });
        } else {
          applyCommand(s, { type: 'send', player: p, send: SENDS[nextInt(script, SENDS.length)].id });
        }
      }
    }
    step(s);
    if (s.tick % 150 === 0) hashes.push(stateHash(s));
    // Halfway, pass the state through JSON as a reconnect would.
    if (t === total >> 1) s = JSON.parse(JSON.stringify(s)) as GameState;
  }
  hashes.push(s.tick, stateHash(s));
  return hashes;
}

(globalThis as unknown as { runScenario: typeof runScenario }).runScenario = runScenario;
