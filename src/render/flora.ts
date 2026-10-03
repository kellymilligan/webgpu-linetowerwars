import { BufferAttribute, BufferGeometry, CylinderGeometry, IcosahedronGeometry, Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three/webgpu';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise, mulberry } from './noise';
import { registerGeometry } from './parts';

/**
 * Procedural scenery geometry, registered as `pg:` keys for instancing:
 * brush tufts with real 3D blades, windswept dead trees, faceted boulders,
 * and flat cards for light pools and doorways. Every piece stands on y = 0.
 */

interface TuftOpts {
  blades: number;
  height: [number, number];
  width: number;
  lean: number;
  spread: number;
  segments?: number;
}

/** A clump of tapered, bending blades (dead grass, heather stems, bracken fronds). */
function tuft(seed: number, o: TuftOpts): BufferGeometry {
  const rand = mulberry(seed);
  const segs = o.segments ?? 3;
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  for (let b = 0; b < o.blades; b++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * o.spread;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    // Blades splay outward from the clump's centre, with some wind bias toward +x.
    const dir = a + (rand() - 0.5) * 0.8;
    const dx = Math.cos(dir) * 0.8 + 0.35;
    const dz = Math.sin(dir) * 0.8;
    const h = o.height[0] + rand() * (o.height[1] - o.height[0]);
    const lean = o.lean * (0.5 + rand());
    const w = o.width * (0.7 + rand() * 0.6);
    // The blade's flat face turns about its own axis.
    const face = rand() * Math.PI;
    const px = Math.cos(face);
    const pz = Math.sin(face);
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const bend = lean * t * t;
      const x = bx + dx * bend * h;
      const z = bz + dz * bend * h;
      const y = h * t * (1 - 0.25 * lean * t);
      const half = (w * (1 - t)) / 2 + 0.002;
      pos.push(x - px * half, y, z - pz * half, x + px * half, y, z + pz * half);
      // Soft, mostly-up normals so thin blades shade like a mass, not like cards.
      nrm.push(dx * 0.3, 0.9, dz * 0.3, dx * 0.3, 0.9, dz * 0.3);
      if (i < segs) {
        const k = base + i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setIndex(idx);
  g.normalizeNormals();
  return g;
}

const UP = new Vector3(0, 1, 0);

/** A dead tree bent by years of wind: tapered limbs, two orders of branching, leaning toward +x. */
function deadTree(seed: number): BufferGeometry {
  const rand = mulberry(seed);
  const parts: BufferGeometry[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const limb = (from: Vector3, dir: Vector3, len: number, r0: number, depth: number) => {
    // Each limb is a few segments that curve with the wind and droop at the tips.
    let p = from.clone();
    let d = dir.clone().normalize();
    let r = r0;
    const segs = depth === 0 ? 4 : 3;
    for (let i = 0; i < segs; i++) {
      const l = len / segs;
      const r1 = r * 0.72;
      const g = new CylinderGeometry(r1, r, l, 5, 1).translate(0, l / 2, 0);
      q.setFromUnitVectors(UP, d);
      m.compose(p, q, new Vector3(1, 1, 1));
      g.applyMatrix4(m);
      parts.push(g);
      p = p.clone().addScaledVector(d, l);
      d = d.clone().add(new Vector3(0.18 + (rand() - 0.5) * 0.35, depth === 0 ? 0.05 : -0.12, (rand() - 0.5) * 0.35)).normalize();
      r = r1;
      if (depth < 2 && i >= (depth === 0 ? 1 : 0) && rand() < (depth === 0 ? 0.85 : 0.6)) {
        const a = rand() * Math.PI * 2;
        const side = new Vector3(Math.cos(a), 0.55 + rand() * 0.5, Math.sin(a)).add(new Vector3(0.45, 0, 0));
        limb(p, side, len * (depth === 0 ? 0.48 : 0.42) * (0.7 + rand() * 0.5), r * 0.75, depth + 1);
      }
    }
  };
  limb(new Vector3(0, -0.1, 0), new Vector3(0.12 + rand() * 0.1, 1, (rand() - 0.5) * 0.15), 2.2 + rand() * 0.8, 0.14, 0);
  return mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
}

/** A faceted boulder: a lumpy, flattened icosphere. */
function boulder(seed: number): BufferGeometry {
  const n = makeNoise(seed);
  const g = mergeVertices(new IcosahedronGeometry(0.5, 1).deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.getAttribute('position') as BufferAttribute;
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + n(v.x * 2.1 + seed, v.z * 2.1 + v.y * 1.3) * 0.32;
    v.multiplyScalar(k);
    v.y = v.y * 0.62 + 0.18;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

registerGeometry('pg:grass', tuft(11, { blades: 10, height: [0.28, 0.62], width: 0.05, lean: 0.9, spread: 0.16 }));
registerGeometry('pg:grass2', tuft(12, { blades: 8, height: [0.4, 0.85], width: 0.04, lean: 1.1, spread: 0.12 }));
registerGeometry('pg:heather', tuft(13, { blades: 16, height: [0.16, 0.38], width: 0.035, lean: 0.35, spread: 0.24, segments: 2 }));
registerGeometry('pg:bracken', tuft(14, { blades: 6, height: [0.45, 0.75], width: 0.16, lean: 1.5, spread: 0.08, segments: 4 }));
for (let i = 0; i < 3; i++) registerGeometry(`pg:deadTree${i}`, deadTree(101 + i * 17));
for (let i = 0; i < 4; i++) registerGeometry(`pg:boulder${i}`, boulder(201 + i * 13));
registerGeometry('pg:card', new PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
registerGeometry('pg:door', new PlaneGeometry(1, 1).translate(0, 0.5, 0));

export const BRUSH_KINDS = ['pg:grass', 'pg:grass2', 'pg:heather', 'pg:bracken'] as const;
export const DEAD_TREES = ['pg:deadTree0', 'pg:deadTree1', 'pg:deadTree2'] as const;
export const BOULDERS = ['pg:boulder0', 'pg:boulder1', 'pg:boulder2', 'pg:boulder3'] as const;
