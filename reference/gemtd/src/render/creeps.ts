import {
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three/webgpu';
import type { BufferGeometry, Material, Object3D } from 'three/webgpu';
import type { Archetype } from '../sim/data/creeps';

/**
 * Grey-box creature models assembled from primitives. Each archetype picks a
 * body plan and colours; CC0 or bespoke models can replace these later.
 */
export interface CreepModel {
  root: Group;
  /** Main body material, tinted by status effects. */
  tint: MeshStandardMaterial;
  colour: Color;
  /** Pairs of wings flapped around their local Z axis. */
  wings: Object3D[];
  /** Segments that wiggle side to side (worms, tails). */
  segments: Object3D[];
  /** Parts that pulse in scale (jellies, wisps). */
  pulse: Object3D[];
  /** Legs that scuttle. */
  legs: Object3D[];
  /** Height of the top of the model, for health bars. */
  height: number;
}

const geoCache = new Map<string, BufferGeometry>();
const geo = (key: string, make: () => BufferGeometry) => {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
};

function mat(colour: string, a: Archetype, extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}) {
  return new MeshStandardMaterial({
    color: colour,
    roughness: 0.55,
    flatShading: true,
    emissive: a.glow ? new Color(colour) : new Color('#000000'),
    emissiveIntensity: a.glow ? 0.9 : 0,
    ...extra,
  });
}

function part(g: BufferGeometry, m: Material, x = 0, y = 0, z = 0): Mesh {
  const o = new Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

function legs(root: Group, m: Material, n: number, spread: number, y: number, len = 0.26): Object3D[] {
  const out: Object3D[] = [];
  const g = geo(`leg${len}`, () => new CylinderGeometry(0.018, 0.012, len, 4).translate(0, -len / 2, 0));
  for (let i = 0; i < n; i++) {
    for (const side of [-1, 1]) {
      const pivot = new Group();
      pivot.position.set(side * spread * 0.6, y, (i - (n - 1) / 2) * spread * 0.55);
      const leg = new Mesh(g, m);
      leg.rotation.z = side * 0.9;
      pivot.add(leg);
      pivot.userData.side = side;
      pivot.userData.index = i;
      root.add(pivot);
      out.push(pivot);
    }
  }
  return out;
}

function wingPair(root: Group, g: BufferGeometry, m: Material, y: number, z = 0): Object3D[] {
  const l = new Group();
  const r = new Group();
  l.position.set(0, y, z);
  r.position.set(0, y, z);
  l.add(new Mesh(g, m));
  const rm = new Mesh(g, m);
  rm.scale.x = -1;
  r.add(rm);
  l.userData.side = 1;
  r.userData.side = -1;
  root.add(l, r);
  return [l, r];
}

export function buildCreepModel(a: Archetype): CreepModel {
  const root = new Group();
  const body = mat(a.colour, a);
  const accent = mat(a.accent, a, { emissiveIntensity: a.glow ? 1.4 : 0, emissive: a.glow ? new Color(a.accent) : new Color('#000') });
  const dark = new MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.7 });
  const m: CreepModel = { root, tint: body, colour: new Color(a.colour), wings: [], segments: [], pulse: [], legs: [], height: 0.8 };
  const wingMat = (c: string, o = 0.8) => new MeshStandardMaterial({ color: c, side: DoubleSide, transparent: true, opacity: o, emissive: a.glow ? new Color(c) : new Color('#000'), emissiveIntensity: a.glow ? 0.6 : 0 });

  switch (a.plan) {
    case 'beetle': {
      root.add(part(geo('beetleShell', () => new SphereGeometry(0.3, 10, 6).scale(1, 0.6, 1.35)), body, 0, 0.22, 0));
      root.add(part(geo('beetleSeam', () => new CylinderGeometry(0.012, 0.012, 0.78, 4).rotateX(Math.PI / 2)), accent, 0, 0.4, -0.02));
      root.add(part(geo('beetleHead', () => new SphereGeometry(0.14, 8, 6)), accent, 0, 0.2, 0.42));
      if (a.id === 'stag' || a.id === 'goliath') {
        const horn = geo('stagHorn', () => new ConeGeometry(0.04, 0.28, 5).rotateX(Math.PI / 2 - 0.4));
        root.add(part(horn, accent, 0.07, 0.26, 0.58), part(horn, accent, -0.07, 0.26, 0.58));
      }
      m.legs = legs(root, dark, 3, 0.36, 0.2);
      m.height = 0.6;
      break;
    }
    case 'spider': {
      root.add(part(geo('spiderAbd', () => new SphereGeometry(0.26, 9, 6).scale(1, 0.8, 1.2)), body, 0, 0.3, -0.18));
      root.add(part(geo('spiderHead', () => new SphereGeometry(0.15, 8, 6)), accent, 0, 0.26, 0.16));
      m.legs = legs(root, dark, 4, 0.42, 0.28, 0.36);
      m.height = 0.65;
      break;
    }
    case 'tortoise': {
      root.add(part(geo('tortShell', () => new SphereGeometry(0.42, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1.1)), body, 0, 0.1, 0));
      root.add(part(geo('tortRim', () => new TorusGeometry(0.42, 0.04, 4, 12).rotateX(Math.PI / 2).scale(1, 1, 1.1)), accent, 0, 0.1, 0));
      root.add(part(geo('tortHead', () => new SphereGeometry(0.13, 8, 6)), accent, 0, 0.18, 0.5));
      m.legs = legs(root, accent, 2, 0.6, 0.1, 0.14);
      m.height = 0.55;
      break;
    }
    case 'snail':
    case 'slug': {
      root.add(part(geo('slugBody', () => new CapsuleGeometry(0.13, 0.5, 3, 8).rotateX(Math.PI / 2).scale(1, 0.7, 1)), a.plan === 'slug' ? body : accent, 0, 0.1, 0));
      if (a.plan === 'snail') root.add(part(geo('snailShell', () => new TorusGeometry(0.17, 0.1, 6, 12).rotateY(Math.PI / 2)), body, 0, 0.32, -0.06));
      const stalk = geo('stalk', () => new CylinderGeometry(0.015, 0.015, 0.18, 4).translate(0, 0.09, 0));
      const s1 = part(stalk, a.plan === 'slug' ? accent : body, 0.05, 0.14, 0.34);
      const s2 = part(stalk, a.plan === 'slug' ? accent : body, -0.05, 0.14, 0.34);
      s1.rotation.x = s2.rotation.x = 0.5;
      root.add(s1, s2);
      m.segments = [s1, s2];
      m.height = 0.55;
      break;
    }
    case 'rootling': {
      root.add(part(geo('rootBody', () => new CapsuleGeometry(0.17, 0.35, 3, 6)), body, 0, 0.35, 0));
      const leaf = part(geo('rootLeaf', () => new ConeGeometry(0.22, 0.3, 5)), accent, 0, 0.75, 0);
      root.add(leaf);
      m.pulse = [leaf];
      const rootG = geo('rootLeg', () => new ConeGeometry(0.05, 0.25, 4).rotateX(Math.PI));
      m.legs = [part(rootG, body, 0.1, 0.12, 0), part(rootG, body, -0.1, 0.12, 0)];
      for (const l of m.legs) root.add(l);
      m.height = 0.95;
      break;
    }
    case 'wisp': {
      const core = part(geo('wispCore', () => new IcosahedronGeometry(0.18, 1)), body, 0, 0.55, 0);
      const halo = part(geo('wispHalo', () => new IcosahedronGeometry(0.28, 0)), new MeshStandardMaterial({ color: a.accent, transparent: true, opacity: 0.35, emissive: new Color(a.accent), emissiveIntensity: 1 }), 0, 0.55, 0);
      const tail = part(geo('wispTail', () => new ConeGeometry(0.12, 0.4, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.25)), body, 0, 0.55, 0);
      root.add(core, halo, tail);
      m.pulse = [halo];
      m.segments = [tail];
      m.height = 0.85;
      break;
    }
    case 'worm': {
      const segG = geo('wormSeg', () => new SphereGeometry(0.13, 8, 6));
      for (let i = 0; i < 5; i++) {
        const seg = part(segG, i === 0 ? accent : body, 0, 0.13, 0.3 - i * 0.17);
        seg.scale.setScalar(1 - i * 0.1);
        seg.userData.index = i;
        root.add(seg);
        m.segments.push(seg);
      }
      m.height = 0.45;
      break;
    }
    case 'golem': {
      root.add(part(geo('golemBody', () => new DodecahedronGeometry(0.4, 0).scale(1, 1, 0.9)), body, 0, 0.5, 0));
      root.add(part(geo('golemCap', () => new SphereGeometry(0.34, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.05, 0.5, 1.1)), accent, 0, 0.7, 0));
      const arm = geo('golemArm', () => new DodecahedronGeometry(0.15, 0).scale(0.8, 1.4, 0.8));
      const l = part(arm, body, 0.42, 0.4, 0.05);
      const r = part(arm, body, -0.42, 0.4, 0.05);
      root.add(l, r);
      m.legs = [l, r];
      m.height = 1.0;
      break;
    }
    case 'toad': {
      root.add(part(geo('toadBody', () => new SphereGeometry(0.28, 9, 6).scale(1.1, 0.75, 1)), body, 0, 0.22, 0));
      const eye = geo('toadEye', () => new SphereGeometry(0.07, 6, 4));
      root.add(part(eye, accent, 0.12, 0.4, 0.14), part(eye, accent, -0.12, 0.4, 0.14));
      const leg = geo('toadLeg', () => new CapsuleGeometry(0.06, 0.2, 2, 5).rotateX(1.1));
      m.legs = [part(leg, body, 0.2, 0.1, -0.1), part(leg, body, -0.2, 0.1, -0.1)];
      for (const l of m.legs) root.add(l);
      m.height = 0.55;
      break;
    }
    case 'hog': {
      root.add(part(geo('hogBody', () => new CapsuleGeometry(0.2, 0.4, 3, 7).rotateX(Math.PI / 2)), body, 0, 0.3, 0));
      root.add(part(geo('hogHead', () => new SphereGeometry(0.16, 7, 5).scale(1, 0.9, 1.2)), body, 0, 0.3, 0.38));
      const spike = geo('hogSpike', () => new ConeGeometry(0.04, 0.2, 4));
      for (let i = 0; i < 4; i++) root.add(part(spike, accent, 0, 0.52, 0.2 - i * 0.14));
      m.legs = legs(root, dark, 2, 0.3, 0.2, 0.18);
      m.height = 0.7;
      break;
    }
    case 'mushroom': {
      root.add(part(geo('mushStem', () => new CylinderGeometry(0.09, 0.12, 0.32, 7)), accent, 0, 0.2, 0));
      const cap = part(geo('mushCap', () => new SphereGeometry(0.26, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1)), body, 0, 0.34, 0);
      root.add(cap);
      const dot = geo('mushDot', () => new SphereGeometry(0.04, 5, 3));
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        root.add(part(dot, accent, Math.cos(ang) * 0.14, 0.47, Math.sin(ang) * 0.14));
      }
      m.pulse = [cap];
      m.height = 0.6;
      break;
    }
    case 'moth':
    case 'bat': {
      root.add(part(geo('mothBody', () => new CapsuleGeometry(0.08, 0.35, 3, 6).rotateX(Math.PI / 2)), body, 0, 0, 0));
      const wg =
        a.plan === 'bat'
          ? geo('batWing', () => new PlaneGeometry(0.55, 0.3).translate(0.3, 0, 0).rotateX(-Math.PI / 2))
          : geo('mothWing', () => new PlaneGeometry(0.55, 0.4).translate(0.3, 0, 0).rotateX(-Math.PI / 2));
      m.wings = wingPair(root, wg, wingMat(a.accent, 0.85), 0.02);
      m.height = 0.4;
      break;
    }
    case 'dragonfly': {
      root.add(part(geo('dfBody', () => new CapsuleGeometry(0.05, 0.6, 3, 6).rotateX(Math.PI / 2)), body, 0, 0, 0));
      root.add(part(geo('dfHead', () => new SphereGeometry(0.08, 6, 4)), accent, 0, 0, 0.36));
      const wg = geo('dfWing', () => new PlaneGeometry(0.5, 0.12).translate(0.27, 0, 0).rotateX(-Math.PI / 2));
      m.wings = [...wingPair(root, wg, wingMat('#e8f8ff', 0.55), 0.03, 0.1), ...wingPair(root, wg, wingMat('#e8f8ff', 0.55), 0.03, -0.05)];
      m.height = 0.35;
      break;
    }
    case 'seedpod': {
      root.add(part(geo('seed', () => new ConeGeometry(0.2, 0.35, 6).translate(0, 0.17, 0).rotateX(Math.PI / 2)), body, 0, 0, 0));
      const wg = geo('seedWing', () => new PlaneGeometry(0.5, 0.14).translate(0.25, 0, 0).rotateX(-Math.PI / 2));
      m.wings = wingPair(root, wg, wingMat('#f4ecd2', 0.8), 0);
      m.height = 0.35;
      break;
    }
    case 'jelly': {
      const bell = part(geo('jellyBell', () => new SphereGeometry(0.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), new MeshStandardMaterial({ color: a.colour, transparent: true, opacity: 0.7, emissive: new Color(a.colour), emissiveIntensity: a.glow ? 0.8 : 0.2 }), 0, 0.1, 0);
      root.add(bell);
      const tg = geo('jellyTent', () => new CylinderGeometry(0.015, 0.005, 0.4, 3).translate(0, -0.2, 0));
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const t = part(tg, accent, Math.cos(ang) * 0.18, 0.1, Math.sin(ang) * 0.18);
        t.userData.index = i;
        root.add(t);
        m.segments.push(t);
      }
      m.tint = bell.material as MeshStandardMaterial;
      m.pulse = [bell];
      m.height = 0.45;
      break;
    }
    case 'bird': {
      root.add(part(geo('birdBody', () => new CapsuleGeometry(0.1, 0.4, 3, 6).rotateX(Math.PI / 2)), body, 0, 0, 0));
      root.add(part(geo('birdNeck', () => new CylinderGeometry(0.035, 0.04, 0.3, 5).rotateX(-0.7).translate(0, 0.1, 0.3)), body, 0, 0, 0));
      root.add(part(geo('birdBeak', () => new ConeGeometry(0.03, 0.2, 4).rotateX(Math.PI / 2).translate(0, 0.21, 0.5)), accent, 0, 0, 0));
      const wg = geo('birdWing', () => new PlaneGeometry(0.7, 0.28).translate(0.38, 0, 0).rotateX(-Math.PI / 2));
      m.wings = wingPair(root, wg, wingMat(a.colour, 0.95), 0.03);
      m.height = 0.45;
      break;
    }
  }
  return m;
}
