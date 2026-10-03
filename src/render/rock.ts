import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  abs,
  bumpMap,
  float,
  floor,
  fract,
  instanceIndex,
  mix,
  mx_noise_float,
  normalWorld,
  positionGeometry,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { MATS } from './parts';

/**
 * Materials for the stone world: raw rock for the range and the canyon walls,
 * a slope-blended terrain (rock on the steeps, dead turf and frost on the
 * flats), dressed stone for the citadel gates, and the firelight pieces
 * (glowing doorways, light pools on the ground, embers).
 */

/** How strongly firelight glows (raised at night by the scene). */
export const fireLevel = uniform(1);

const n01 = (n: Node<'float'>) => n.mul(0.5).add(0.5);

/** Dark, cold stone: big tonal masses, strata, cracks and grit, all in world space so it never stretches. */
function rockColour(): Node<'vec3'> {
  const p = positionWorld;
  const big = n01(mx_noise_float(p.mul(0.06)));
  const mid = n01(mx_noise_float(p.mul(0.32)));
  const fine = n01(mx_noise_float(p.mul(2.1)));
  // Strata: warped horizontal bands, sharpened.
  const strata = smoothstep(0.25, 0.75, n01(sin(p.y.mul(1.9).add(big.mul(7)).add(mid.mul(1.5)))));
  // Wet streaks: noise stretched vertically, where water has run down the face for centuries.
  const streak = n01(mx_noise_float(p.mul(vec3(0.9, 0.07, 0.9))));
  let c = mix(vec3(0.04, 0.043, 0.05), vec3(0.2, 0.205, 0.215), big.mul(0.45).add(mid.mul(0.3)).add(fine.mul(0.25)));
  c = c.mul(mix(float(0.65), float(1.18), strata)).mul(mix(float(0.55), float(1.1), streak));
  // Cracks: thin dark lines where a noise field crosses zero.
  const crack = float(1).sub(smoothstep(0.0, 0.035, abs(mx_noise_float(p.mul(0.55).add(vec3(3, 7, 1))))));
  c = mix(c, c.mul(0.3), crack.mul(0.85));
  // A faint cold-green tinge of lichen in the hollows.
  c = mix(c, vec3(0.1, 0.115, 0.095), smoothstep(0.62, 0.8, mid).mul(0.25));
  return c;
}

/** Frost and old snow settle on anything facing up. */
function frosted(c: Node<'vec3'>, amount: Node<'float'>): Node<'vec3'> {
  const p = positionWorld;
  const up = smoothstep(0.55, 0.92, normalWorld.y);
  const patch = smoothstep(0.78, 0.98, n01(mx_noise_float(p.mul(0.35))).mul(0.8).add(n01(mx_noise_float(p.mul(2.7))).mul(0.3)));
  return mix(c, vec3(0.24, 0.255, 0.28), up.mul(patch).mul(amount));
}

/** Relief for the lighting: crags at several scales plus the strata, as a bump height. */
function rockRelief(): Node<'float'> {
  const p = positionWorld;
  const crag = mx_noise_float(p.mul(0.45)).mul(0.6).add(mx_noise_float(p.mul(1.6)).mul(0.3)).add(mx_noise_float(p.mul(5.0)).mul(0.1));
  const strata = smoothstep(0.3, 0.7, n01(sin(p.y.mul(1.9).add(mx_noise_float(p.mul(0.06)).mul(3.5)))));
  return crag.add(strata.mul(0.5));
}

function makeRock() {
  const m = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  m.colorNode = frosted(rockColour(), float(0.8));
  m.normalNode = bumpMap(rockRelief(), float(1.4));
  return m;
}

/** Rock on the steeps, dead heath and frost on the flats. */
function makeTerrain() {
  const m = new MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0 });
  const p = positionWorld;
  // Dead heath: straw-grey grass, peat-dark hollows, the odd rusty patch of bracken.
  const turfN = n01(mx_noise_float(p.mul(0.5))).mul(0.6).add(n01(mx_noise_float(p.mul(3.1))).mul(0.4));
  let turf = mix(vec3(0.06, 0.052, 0.045), vec3(0.22, 0.2, 0.16), turfN);
  turf = mix(turf, vec3(0.2, 0.12, 0.07), smoothstep(0.65, 0.85, n01(mx_noise_float(p.mul(0.18).add(vec3(9, 0, 4))))).mul(0.5));
  const flat = smoothstep(0.62, 0.86, normalWorld.y);
  // Fake occlusion: steep faces darken toward their feet, so the canyons read as deep.
  const foot = mix(float(0.42), float(1), smoothstep(0.0, 3.0, p.y));
  const shade = mix(foot, float(1), flat);
  m.colorNode = frosted(mix(rockColour(), turf, flat), float(0.5)).mul(shade);
  m.normalNode = bumpMap(rockRelief().mul(float(1).sub(flat.mul(0.7))), float(1.2));
  return m;
}

/** Dressed stone: the same rock, cut into courses of blocks with dark joints. */
function makeCutStone() {
  const m = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const p = positionWorld;
  const row = floor(p.y.mul(1.4));
  const along = p.x.add(p.z).mul(0.7).add(row.mul(0.5));
  const jy = fract(p.y.mul(1.4));
  const jx = fract(along);
  const joint = float(1).sub(smoothstep(0.0, 0.05, jy.min(float(1).sub(jy)).min(jx.min(float(1).sub(jx)))));
  const block = n01(mx_noise_float(vec2(floor(along), row).mul(0.9)));
  let c = rockColour().mul(1.25).mul(mix(float(0.8), float(1.15), block));
  c = mix(c, vec3(0.02, 0.02, 0.022), joint.mul(0.8));
  m.colorNode = frosted(c, float(0.5));
  return m;
}

/** A citadel doorway: firelight spilling out of the deep, brightest at the threshold. */
function makePortal() {
  const m = new MeshBasicNodeMaterial({ side: DoubleSide });
  const u = uv();
  const flick = n01(mx_noise_float(vec2(time.mul(2.3), float(instanceIndex).mul(7.1)))).mul(0.35).add(0.75);
  const depth = smoothstep(1.0, 0.0, u.y);
  const haze = n01(mx_noise_float(vec2(u.x.mul(3), u.y.mul(2).sub(time.mul(0.4))))).mul(0.3).add(0.7);
  const warm = mix(vec3(0.03, 0.008, 0.003), vec3(0.85, 0.3, 0.07), depth.mul(depth).mul(depth)).mul(haze);
  m.colorNode = warm.mul(flick).mul(fireLevel).mul(0.8);
  return m;
}

/** A pool of firelight on the ground: an additive radial falloff (tinted and scaled per instance). */
function makePool() {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const d = uv().sub(0.5).length().mul(2).clamp(0, 1);
  const fall = float(1).sub(d);
  m.colorNode = vec3(fall.mul(fall).mul(fall)).mul(fireLevel).mul(0.55);
  return m;
}

/** Flames and embers: unlit, additive, bloom does the rest. */
function makeEmber() {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  m.colorNode = vec3(1.0, 0.55, 0.2).mul(fireLevel).mul(1.4);
  return m;
}

/**
 * Brush: wiry dead grass, heather and bracken that bend in a cold wind. The
 * shape comes from positionGeometry (instancing folds the transform into
 * positionLocal); roots darken into the ground for depth.
 */
function makeBrush() {
  const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0, side: DoubleSide });
  const h = positionGeometry.y.clamp(0, 1.2);
  const phase = float(instanceIndex).mul(1.71);
  const gust = n01(sin(time.mul(0.55).add(phase.mul(0.07)))).mul(n01(sin(time.mul(1.3).add(phase.mul(0.13)))));
  const sway = sin(time.mul(2.4).add(phase)).mul(0.05).add(gust.mul(0.16)).mul(h).mul(h).mul(1.6);
  m.positionNode = positionLocal.add(vec3(sway, sway.mul(-0.25), sway.mul(0.35)));
  m.colorNode = vec3(mix(float(0.3), float(1.5), smoothstep(0.0, 0.5, h)));
  return m;
}

MATS.rock = makeRock();
MATS.terrain = makeTerrain();
MATS.cutStone = makeCutStone();
MATS.portal = makePortal();
MATS.pool = makePool();
MATS.ember = makeEmber();
MATS.brush = makeBrush();
