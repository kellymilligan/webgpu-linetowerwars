import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three/webgpu';
import type { BufferGeometry, Material } from 'three/webgpu';
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

export type GeoKey = keyof typeof GEO;
export type MatKey = 'matte' | 'metal' | 'glow';

export const MATS: Record<MatKey, Material> = {
  matte: new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 }),
  metal: new MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.6 }),
  glow: new MeshBasicMaterial({ color: new Color('#ffffff').multiplyScalar(2.2) }),
};

export const PALETTE = {
  stone: '#8b867c',
  stoneDark: '#5d5952',
  wood: '#6e4b2f',
  woodDark: '#45301f',
  iron: '#4a4d52',
  steel: '#9aa0a6',
  fire: '#ff7a2a',
  gold: '#c9a227',
  skin: '#c89a78',
  cloth: '#5a4a3a',
  horse: '#5b3d28',
  black: '#1c1b1d',
  bandit: '#2f2b28',
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

  get(g: GeoKey, m: MatKey = 'matte', shadows = true): Batch {
    const key = `${g}:${m}`;
    let b = this.batches.get(key);
    if (!b) {
      b = new Batch(GEO[g], MATS[m], 128, shadows && m !== 'glow');
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
