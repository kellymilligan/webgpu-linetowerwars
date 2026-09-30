import type { GameState } from './types';

/**
 * Fingerprint of the whole game state (FNV-1a over its JSON). Lockstep peers
 * compare these at fixed ticks to catch desyncs the moment they happen.
 */
export function stateHash(s: GameState): number {
  const str = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
