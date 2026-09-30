/**
 * Deterministic PRNG (sfc32). State is a plain tuple so it serialises with the
 * rest of the game state; every random decision in the sim goes through here.
 */
export type RngState = [number, number, number, number];

export function seedRng(seed: number | string): RngState {
  let h = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  const next = () => {
    // splitmix32
    h = (h + 0x9e3779b9) >>> 0;
    let z = h;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const state: RngState = [next(), next(), next(), next()];
  // Warm up to decorrelate the initial state.
  for (let i = 0; i < 12; i++) nextU32(state);
  return state;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Advances the state in place and returns a uint32. */
export function nextU32(s: RngState): number {
  const [a, b, c, d] = s;
  const t = (((a + b) >>> 0) + d) >>> 0;
  s[3] = (d + 1) >>> 0;
  s[0] = b ^ (b >>> 9);
  s[1] = (c + (c << 3)) >>> 0;
  s[2] = ((c << 21) | (c >>> 11)) >>> 0;
  s[2] = (s[2] + t) >>> 0;
  return t;
}

/** Float in [0, 1). */
export function nextFloat(s: RngState): number {
  return nextU32(s) / 4294967296;
}

/** Integer in [0, n). */
export function nextInt(s: RngState, n: number): number {
  return Math.floor(nextFloat(s) * n);
}

/** Picks an index by integer weights. */
export function pickWeighted(s: RngState, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = nextFloat(s) * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}
