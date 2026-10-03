/**
 * Seeded 2D gradient noise for building scenery geometry on the CPU (the
 * shaders use TSL's own noise). Cosmetic only: never used by the sim.
 */

/** Tiny seeded PRNG, so the scenery is the same every load. */
export function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Noise2 = (x: number, y: number) => number;

/** Perlin-style gradient noise in roughly [-1, 1]. */
export function makeNoise(seed: number): Noise2 {
  const rand = mulberry(seed);
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = rand() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const dot = (ix: number, iy: number, dx: number, dy: number) => {
      const g = perm[perm[(X + ix) & 255] + ((Y + iy) & 255)];
      return gx[g] * dx + gy[g] * dy;
    };
    const u = fade(xf);
    const v = fade(yf);
    const a = dot(0, 0, xf, yf) + u * (dot(1, 0, xf - 1, yf) - dot(0, 0, xf, yf));
    const b = dot(0, 1, xf, yf - 1) + u * (dot(1, 1, xf - 1, yf - 1) - dot(0, 1, xf, yf - 1));
    return (a + v * (b - a)) * 1.4;
  };
}

/** Fractal sum of octaves, roughly [-1, 1]. */
export function fbm(n: Noise2, x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += n(x, y) * amp;
    norm += amp;
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.7;
    amp *= 0.5;
  }
  return sum / norm;
}

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
