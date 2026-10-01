import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MeshStandardNodeMaterial,
  SphereGeometry,
} from 'three/webgpu';
import type { BufferGeometry, Material } from 'three/webgpu';
import { float, instanceIndex, positionGeometry, positionLocal, sin, time, vec3 } from 'three/tsl';
import { Batch } from './batch';

/** Unit primitives with their base at y = 0 (spheres are centred). */
export const GEO = {
  box: new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cyl: new CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0),
  cyl6: new CylinderGeometry(0.5, 0.5, 1, 6).translate(0, 0.5, 0),
  cone: new ConeGeometry(0.5, 1, 8).translate(0, 0.5, 0),
  cone4: new ConeGeometry(0.5, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
  sphere: new SphereGeometry(0.5, 10, 8),
  rock: new IcosahedronGeometry(0.5, 0),
} satisfies Record<string, BufferGeometry>;

/** Built-in primitives, plus models loaded at runtime: `kk:<model>` (KayKit statics) and `kc:<char>:<frame>` (baked character frames). */
export type GeoKey = keyof typeof GEO | `kk:${string}` | `kc:${string}`;
export type MatKey = 'matte' | 'metal' | 'glow' | 'foliage' | 'cloth' | 'atlas' | 'atlasFoliage' | 'peak' | `char:${string}`;

const EXTRA_GEO = new Map<string, BufferGeometry>();
/** Registers a loaded geometry under a `kk:`/`kc:` key. */
export function registerGeometry(key: string, g: BufferGeometry) {
  EXTRA_GEO.set(key, g);
}
export const hasGeometry = (key: string) => key in GEO || EXTRA_GEO.has(key);
const geometryOf = (key: GeoKey): BufferGeometry => (GEO as Record<string, BufferGeometry>)[key] ?? EXTRA_GEO.get(key)!;

/*
 * Wind materials. With instancing, positionLocal already includes the instance
 * transform, so shapes are read from positionGeometry (the unit primitive) and
 * displacements are added in world-sized units.
 */

/** Leaves sway in the wind: displacement grows with height within each part, phase varies per instance. */
function foliage() {
  const m = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const phase = float(instanceIndex).mul(1.71);
  const h = positionGeometry.y.add(0.5).clamp(0, 1.5);
  const sway = sin(time.mul(1.4).add(phase)).mul(0.07).add(sin(time.mul(3.1).add(phase.mul(2.3))).mul(0.025)).mul(h);
  m.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(0.6)));
  return m;
}

/** Banners ripple: a travelling wave across the cloth, pinned at the pole side (local x = -0.5). */
function cloth() {
  const m = new MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0 });
  const phase = float(instanceIndex).mul(0.93);
  const along = positionGeometry.x.add(0.5).clamp(0, 1);
  const wave = sin(time.mul(4.2).add(along.mul(5)).add(phase)).mul(0.07).mul(along);
  m.positionNode = positionLocal.add(vec3(0, sin(time.mul(2.1).add(phase)).mul(0.03).mul(along), wave));
  return m;
}

export const MATS: Partial<Record<MatKey, Material>> & Record<'matte' | 'metal' | 'glow' | 'foliage' | 'cloth', Material> = {
  matte: new MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, metalness: 0 }),
  metal: new MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0.65 }),
  glow: new MeshBasicMaterial({ color: new Color('#ffffff').multiplyScalar(2.2) }),
  foliage: foliage(),
  cloth: cloth(),
};

/** Torches, fire and other glowing parts brighten at night. */
export function setGlow(level: number) {
  (MATS.glow as MeshBasicMaterial).color.setScalar(1.2 + level * 1.6);
}

export const PALETTE = {
  stone: '#9a978f',
  stoneDark: '#646260',
  wood: '#7a5434',
  woodDark: '#4a3424',
  iron: '#4a4d52',
  steel: '#9aa0a6',
  fire: '#ff7a2a',
  gold: '#c9a227',
  skin: '#c89a78',
  cloth: '#5a4a3a',
  horse: '#5b3d28',
  black: '#1c1b1d',
  bandit: '#2f2b28',
  thatch: '#c9a25a',
  white: '#ffffff',
  birch: '#d8d2c6',
  roofRed: '#a8432e',
};

export type Tint = keyof typeof PALETTE | 'house';

/** One primitive in a model: geometry, material, local transform and colour role. */
export interface Part {
  g: GeoKey;
  m?: MatKey;
  p: [number, number, number];
  s: [number, number, number];
  r?: [number, number, number];
  c: Tint;
  /** Animation tag interpreted by the owner (e.g. wings flap). */
  anim?: 'wingL' | 'wingR' | 'bob';
}

export const part = (g: GeoKey, c: Tint, p: Part['p'], s: Part['s'], r?: Part['r'], m?: MatKey, anim?: Part['anim']): Part => ({ g, c, p, s, r, m, anim });

/** A set of batches keyed by geometry+material, sharing one group. */
export class BatchSet {
  readonly group = new Group();
  private batches = new Map<string, Batch>();

  /** `override` draws every part with one material (e.g. translucent ghosts). */
  constructor(private override?: Material) {}

  get(g: GeoKey, m: MatKey = 'matte', shadows = true): Batch {
    const key = `${g}:${m}`;
    let b = this.batches.get(key);
    if (!b) {
      b = new Batch(geometryOf(g), this.override ?? MATS[m] ?? MATS.matte, 128, !this.override && shadows && m !== 'glow');
      this.batches.set(key, b);
      this.group.add(b.mesh);
    }
    return b;
  }

  begin() {
    for (const b of this.batches.values()) b.begin();
  }

  end() {
    for (const b of this.batches.values()) b.end();
  }
}

const tmp = new Color();

/**
 * Pushes a model at (x, y, z) with heading `yaw` and uniform `scale`.
 * `house` is the owner's colour; `shade` darkens everything (e.g. damage).
 */
export function pushModel(
  set: BatchSet,
  parts: readonly Part[],
  x: number,
  y: number,
  z: number,
  yaw: number,
  scale: number,
  house: Color,
  shade = 1,
  animT = 0,
) {
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  for (const pt of parts) {
    const [lx, ly, lz] = pt.p;
    let rx = pt.r?.[0] ?? 0;
    const ry = pt.r?.[1] ?? 0;
    let rz = pt.r?.[2] ?? 0;
    let oy = ly;
    if (pt.anim === 'wingL') rz += Math.sin(animT) * 0.7;
    else if (pt.anim === 'wingR') rz -= Math.sin(animT) * 0.7;
    else if (pt.anim === 'bob') {
      oy += Math.abs(Math.sin(animT)) * 0.04;
      rx += Math.sin(animT) * 0.06;
    }
    const wx = x + (lx * cs + lz * sn) * scale;
    const wz = z + (-lx * sn + lz * cs) * scale;
    if (pt.c === 'house') tmp.copy(house);
    else tmp.set(PALETTE[pt.c]);
    if (shade !== 1 && pt.m !== 'glow') tmp.multiplyScalar(shade);
    set.get(pt.g, pt.m).push(wx, y + oy * scale, wz, yaw + ry, pt.s[0] * scale, pt.s[1] * scale, pt.s[2] * scale, tmp, rx, rz);
  }
}
