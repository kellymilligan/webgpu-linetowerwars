import { BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardNodeMaterial, PlaneGeometry, PointLight, Vector3 } from 'three/webgpu';
import { float, fract, mix, positionWorld, smoothstep, uniform, vec3 } from 'three/tsl';
import { LANE_H, LANE_W } from '../sim/data/map';
import { Batch } from './batch';
import { laneCount, laneOriginX, STRIDE, toWorldZ, worldMaxX, worldMinX } from './coords';
import { BOULDERS, BRUSH_KINDS, DEAD_TREES } from './flora';
import { fbm, makeNoise, mulberry, smooth } from './noise';
import { BatchSet, GEO, MATS, PALETTE } from './parts';
import type { GeoKey } from './parts';
import { fireLevel, noise4 } from './rock';

/*
 * The Line: a sheer rock range runs across the top of the realm. Each house's
 * citadel is a great gate cut into its face, lit from the deep. From each gate
 * a canyon runs down toward the viewer, walled by a high, broken plateau, and
 * opens onto a bleak plain where the raiders gather. The canyons are the only
 * way in.
 */

/** Plateau height above the canyon floor. */
const PH = 3.4;
/** World z of the canyon mouths (row 0, nearest the camera) and of the far end of the lanes. */
const Z_MOUTH = toWorldZ(0);
const Z_END = toWorldZ(LANE_H);
/** The cliff face's base line, just behind the last row. */
const ZC = Z_END - 1.6;
const CLIFF_H = 24;
/** Lean of the cliff face (z per unit of height). */
const LEAN = 0.12;
/** Citadel gate opening: width, height and recess depth. */
const AW = 8.6;
const AH = 9;
const RECESS = 3.2;
/** Real point lights at the gates (the nearest ones get them). */
const GATE_LIGHTS = 2;

const nWall = makeNoise(5);
const nTop = makeNoise(9);
const nCliff = makeNoise(21);
const nCliff2 = makeNoise(33);

/** How far a canyon wall's foot sits back from the lane edge (always clear of the lane). */
const jag = (z: number, lane: number, side: number) => 0.1 + 0.4 * (nWall(z * 0.55 + lane * 13.1 + side * 5.3, 3.7) * 0.5 + 0.5);

/** 0 on the canyon floor rising to 1 on the plateau, `d` from the lane edge. */
function wallRise(d: number, z: number, lane: number, side: number): number {
  const j = jag(z, lane, side);
  let t = smooth(j, j + 0.75, d);
  // Crags and ledges in the wall face.
  t += nWall(d * 2.2 + lane * 3.1, z * 1.3 + side * 7) * 0.22 * t * (1 - t) * 4;
  return Math.max(0, Math.min(1, t));
}

/** The plateaus end raggedly at the canyon mouths; the ground falls to the plain. */
const mouthEdge = (x: number) => Z_MOUTH + 1.2 + fbm(nTop, x * 0.13, 7.7, 3) * 2.6;
const mouth = (x: number, z: number) => smooth(mouthEdge(x) + 3.5, mouthEdge(x) - 1.2, z);
/** The ground ramps up into the foot of the range. */
const backRamp = (z: number) => smooth(Z_END + 6, ZC - 1, z) * 2.4;

function plateauTop(x: number, z: number) {
  return fbm(nTop, x * 0.21, z * 0.21, 3) * 0.75 + fbm(nTop, x * 0.9 + 40, z * 0.9, 2) * 0.18;
}

/** Terrain height anywhere outside the canyon floors. */
function heightAt(x: number, z: number): number {
  const n = laneCount();
  const first = laneOriginX(0);
  const last = laneOriginX(n - 1) + LANE_W;
  let t: number;
  let extra = 0;
  if (x < first || x > last) {
    // The flanks: plateau rising into hills toward the edges of the world.
    const d = x < first ? first - x : x - last;
    t = wallRise(d, z, x < first ? -1 : n, x < first ? -1 : 1);
    extra = Math.max(0, d - 6) * 0.3 * (0.6 + 0.4 * (fbm(nTop, x * 0.05, z * 0.05, 2) + 1));
    const m = Math.max(mouth(x, z), smooth(12, 40, d));
    return (PH * t + t * plateauTop(x, z) + extra + backRamp(z) * t) * m - 0.06 * (1 - t);
  }
  const lane = Math.min(n - 1, Math.floor((x - first) / STRIDE));
  const local = x - laneOriginX(lane);
  if (local <= LANE_W) return 0;
  const t1 = wallRise(local - LANE_W, z, lane, 1);
  const t2 = wallRise(STRIDE - local, z, lane + 1, -1);
  t = Math.min(t1, t2);
  return (PH * t + t * plateauTop(x, z) + backRamp(z) * t) * mouth(x, z) - 0.06 * (1 - t);
}

/** An indexed grid over (xs × zs) with heights from `f`, facing up. */
function heightGrid(xs: number[], zs: number[], f: (x: number, z: number) => number): BufferGeometry {
  const nx = xs.length;
  const pos = new Float32Array(nx * zs.length * 3);
  let k = 0;
  for (const z of zs) for (const x of xs) {
    pos[k++] = x;
    pos[k++] = f(x, z);
    pos[k++] = z;
  }
  const idx: number[] = [];
  for (let iz = 0; iz < zs.length - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix;
      const b = a + nx;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** An indexed grid over (xs × ys) with depth z from `f`, facing +z (toward the camera). */
function faceGrid(xs: number[], ys: number[], f: (x: number, y: number) => number): BufferGeometry {
  const nx = xs.length;
  const pos = new Float32Array(nx * ys.length * 3);
  let k = 0;
  for (const y of ys) for (const x of xs) {
    pos[k++] = x;
    pos[k++] = y;
    pos[k++] = f(x, y);
  }
  const idx: number[] = [];
  for (let iy = 0; iy < ys.length - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iy * nx + ix;
      const c = a + nx;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let v = a; v < b; v += step) out.push(v);
  out.push(b);
  return out;
};

/** Sample positions across a span, dense near both ends (where the walls are). */
function edgeDense(a: number, b: number, edge = 1.6, fine = 0.12, coarse = 0.4): number[] {
  const out: number[] = [];
  let v = a;
  while (v < b) {
    out.push(v);
    v += Math.min(v - a, b - v) < edge ? fine : coarse;
  }
  out.push(b);
  return out;
}

const laneCx = (lane: number) => laneOriginX(lane) + LANE_W / 2;

/** Depth of the range's face at (x, y): crags, ledges, and a carved recess at each citadel. */
function cliffZ(x: number, y: number): number {
  let z = ZC - y * LEAN + fbm(nCliff, x * 0.11, y * 0.13, 4) * 1.4 + nCliff2(x * 0.55, y * 0.6) * 0.4;
  // Vertical fissures: deep, narrow grooves give the face a sheer, columnar grain.
  const col = Math.abs(Math.sin(x * 1.15 + nCliff(x * 0.08, y * 0.04) * 3.2));
  z -= Math.pow(1 - col, 3) * 0.75;
  // Ledges: the face steps back at each stratum.
  const s = y * 0.34 + 0.3 * nCliff(x * 0.05, 3.3);
  z -= smooth(0.55, 0.64, s - Math.floor(s)) * 0.55;
  const n = laneCount();
  for (let lane = 0; lane < n; lane++) {
    const dx = Math.abs(x - laneCx(lane));
    if (dx > AW / 2 + 3) continue;
    // A dressed façade above each gate: the rock is cut back flat.
    const facade = smooth(AW / 2 + 2.6, AW / 2 + 1.2, dx) * smooth(21, 18, y);
    z = z + (ZC - y * LEAN - 0.35 - z) * facade * 0.9;
    // The gate recess itself.
    const inside = smooth(AW / 2 + 0.2, AW / 2 - 0.1, dx) * smooth(AH + 0.5, AH - 0.1, y);
    z = z + (ZC - RECESS - z) * inside;
  }
  return Math.min(z, Z_END - 0.35);
}

interface GateWindow {
  lane: number;
  x: number;
  y: number;
  z: number;
  h: number;
}

/**
 * The realm's terrain and scenery. Static geometry is rebuilt when the lane
 * count changes; gates, fires, banners and weather are drawn per frame.
 */
export class Board {
  readonly group = new Group();
  readonly statics = new BatchSet();
  /** Brush in frustum-culled chunks: most of it is off screen at any time. */
  private brushChunks = new Map<string, BatchSet>();
  private brushGroup = new Group();
  readonly gridOpacity = uniform(0.35);
  /** World x of the first lane's edge, for the canyon floor's shading. */
  private laneFirst = uniform(0);
  private keeps = new BatchSet();
  private sleet = new Batch(GEO.box, new MeshBasicMaterial({ color: '#9aa4b0', transparent: true, opacity: 0.4, depthWrite: false }), 512, false);
  private flakes: { x: number; y: number; z: number; s: number }[] = [];
  private lights: PointLight[] = [];
  private windows: GateWindow[] = [];
  private houses: Color[] = [];
  private housesKey = '';
  private layoutGroup = new Group();
  private roadMat = new MeshStandardNodeMaterial({ roughness: 0.95 });
  private lanes = 0;

  constructor() {
    const p = positionWorld.xz;
    // Canyon floor: trodden, frozen mud and grit, frost in the ruts, and a faint build grid.
    // Two samples of the baked noise volume: (0.36, 0.72, 1.44, 2.88) and (1.9, 3.8, 7.6, 15) per unit.
    const pw = vec3(positionWorld.x, 0.37, positionWorld.z);
    const lo = noise4(pw.mul(0.09));
    const hi = noise4(pw.mul(0.475));
    const mud = mix(vec3(0.07, 0.066, 0.062), vec3(0.17, 0.158, 0.142), lo.r.mul(0.6).add(hi.r.mul(0.4)));
    const grit = smoothstep(0.62, 0.85, hi.b).mul(0.06);
    const frost = smoothstep(0.7, 0.85, lo.g).mul(0.35);
    const f = fract(p);
    const edge = f.x.min(f.y).min(float(1).sub(f.x)).min(float(1).sub(f.y));
    const line = float(1).sub(smoothstep(0.0, 0.035, edge));
    const ground = mix(mud.add(grit), vec3(0.2, 0.21, 0.23), frost);
    // Fake occlusion at the foot of the canyon walls.
    const local = positionWorld.x.sub(this.laneFirst).mod(STRIDE);
    const ao = mix(float(0.45), float(1), smoothstep(0.0, 1.8, local).mul(smoothstep(LANE_W, LANE_W - 1.8, local)));
    this.roadMat.colorNode = mix(ground.mul(ao), vec3(0.42, 0.42, 0.4), line.mul(this.gridOpacity));

    for (let i = 0; i < GATE_LIGHTS; i++) {
      // Firelight spilling from the citadel gates nearest the view (each real light costs every lit pixel).
      const l = new PointLight('#ff8a3a', 0, 22, 1.6);
      this.lights.push(l);
      this.group.add(l);
    }
    const rand = mulberry(77);
    this.flakes = Array.from({ length: 420 }, () => ({ x: rand(), y: rand(), z: rand(), s: rand() }));
    this.group.add(this.layoutGroup, this.statics.group, this.brushGroup, this.keeps.group, this.sleet.mesh);
    this.layout();
  }

  /** Forces scenery to rebuild (e.g. once models have loaded). */
  rebuild() {
    this.lanes = 0;
    this.layout();
  }

  /** (Re)builds terrain and scenery for the current lane count. */
  layout() {
    const count = laneCount();
    if (count === this.lanes) return;
    this.lanes = count;
    this.laneFirst.value = laneOriginX(0);
    for (const c of [...this.layoutGroup.children]) (c as Mesh).geometry.dispose();
    this.layoutGroup.clear();
    const add = (g: BufferGeometry, mat = MATS.terrain!, shadow = true) => {
      const m = new Mesh(g, mat);
      m.receiveShadow = true;
      m.castShadow = shadow;
      this.layoutGroup.add(m);
      return m;
    };
    const x0 = worldMinX() - 110;
    const x1 = worldMaxX() + 110;

    // The plain the raiders cross, running under everything.
    const plain = new PlaneGeometry(x1 - x0, 260).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, -0.04, Z_MOUTH - 60);
    add(plain, MATS.terrain, false);

    // Canyon floors, running back into each gate's recess.
    for (let lane = 0; lane < count; lane++) {
      const len = Z_MOUTH + 2 - (ZC - RECESS - 0.5);
      add(new PlaneGeometry(LANE_W, len).rotateX(-Math.PI / 2).translate(laneCx(lane), 0.004, Z_MOUTH + 2 - len / 2), this.roadMat, false);
    }

    // Plateaus between the canyons, and the flanks beyond the outermost ones.
    const zs = range(ZC - 3, Z_MOUTH + 7, 0.4);
    for (let lane = 0; lane < count - 1; lane++) {
      const xa = laneOriginX(lane) + LANE_W;
      add(heightGrid(edgeDense(xa, xa + (STRIDE - LANE_W)), zs, heightAt));
    }
    const first = laneOriginX(0);
    const last = laneOriginX(count - 1) + LANE_W;
    const flankZ = range(ZC - 3, Z_MOUTH + 40, 0.6);
    const flank = (a: number, b: number, nearEdge: 'a' | 'b') => {
      const xs: number[] = [];
      // Dense at the canyon wall, coarse toward the hills.
      const edgeX = nearEdge === 'a' ? a : b;
      let v = nearEdge === 'a' ? a : b;
      const sign = nearEdge === 'a' ? 1 : -1;
      while ((sign > 0 ? v < b : v > a)) {
        xs.push(v);
        const d = Math.abs(v - edgeX);
        v += sign * (d < 2 ? 0.12 : d < 12 ? 0.45 : 1.4);
      }
      xs.push(sign > 0 ? b : a);
      xs.sort((p, q) => p - q);
      add(heightGrid(xs, flankZ, heightAt), MATS.terrain, false);
    };
    flank(x0, first, 'b');
    flank(last, x1, 'a');

    // The range: its face, then the high ground and peaks behind.
    const fx: number[] = [];
    for (let x = x0; x < x1; x += x > worldMinX() - 8 && x < worldMaxX() + 8 ? 0.4 : 1.0) fx.push(x);
    fx.push(x1);
    // The sun is always in front of the range, so its shadows would fall behind it, out of view: no casting.
    add(faceGrid(fx, range(-0.6, CLIFF_H, 0.35), cliffZ), MATS.rock, false);
    const topZ0 = ZC - CLIFF_H * LEAN - 0.6;
    const topXs = range(x0, x1, 1.4);
    const topZs = range(topZ0 - 150, topZ0 + 0.8, 1.5);
    add(
      heightGrid(topXs, topZs, (x, z) => {
        const back = Math.max(0, topZ0 - z);
        const ridge = 1 - Math.abs(fbm(nCliff, x * 0.03, z * 0.03, 3));
        return CLIFF_H - 0.4 + back * 0.28 * ridge + fbm(nCliff2, x * 0.07, z * 0.07, 3) * 3 * smooth(0, 10, back);
      }),
      MATS.rock,
      false,
    );

    this.buildStatics();
  }

  private brushChunk(x: number, z: number): BatchSet {
    const key = `${Math.floor(x / 40)},${Math.floor(z / 40)}`;
    let set = this.brushChunks.get(key);
    if (!set) {
      set = new BatchSet();
      set.begin();
      this.brushChunks.set(key, set);
      this.brushGroup.add(set.group);
    }
    return set;
  }

  /** Brush is detail: it's hidden when zoomed far out. */
  setDetail(detailed: boolean) {
    this.brushGroup.visible = detailed;
  }

  private buildStatics() {
    const S = this.statics;
    S.begin();
    for (const set of this.brushChunks.values()) this.brushGroup.remove(set.group);
    this.brushChunks.clear();
    const rand = mulberry(7);
    const c = new Color();
    const tint = (hex: string, v = 0.25) => c.set(hex).multiplyScalar(1 - v / 2 + rand() * v);
    const BRUSH_TONES: Record<(typeof BRUSH_KINDS)[number], string[]> = {
      'pg:grass': ['#8a7f68', '#786e5a', '#958a70'],
      'pg:grass2': ['#9a8e74', '#80765f'],
      'pg:heather': ['#4e3a48', '#3f3240', '#5a4250', '#463438'],
      'pg:bracken': ['#6a4a30', '#5a3e28', '#74503a'],
    };
    const slope = (x: number, z: number) => Math.hypot(heightAt(x + 0.3, z) - heightAt(x - 0.3, z), heightAt(x, z + 0.3) - heightAt(x, z - 0.3)) / 0.6;
    const onFloor = (x: number, z: number) => {
      const first = laneOriginX(0);
      const lane = Math.floor((x - first) / STRIDE);
      const local = x - laneOriginX(lane);
      return lane >= 0 && lane < this.lanes && local > -0.05 && local < LANE_W + 0.05 && z < Z_MOUTH + 0.5 && z > ZC - RECESS - 1;
    };
    const brush = (x: number, z: number, scale = 1) => {
      if (onFloor(x, z) || slope(x, z) > 1.1) return;
      const kind = BRUSH_KINDS[Math.floor(rand() * BRUSH_KINDS.length)];
      const tones = BRUSH_TONES[kind];
      const s = (0.8 + rand() * 0.6) * scale;
      this.brushChunk(x, z).get(kind as GeoKey, 'brush', false).push(x, heightAt(x, z) - 0.03, z, rand() * 6.28, s, s * (0.8 + rand() * 0.5), s, tint(tones[Math.floor(rand() * tones.length)]));
    };
    const tree = (x: number, z: number) => {
      if (onFloor(x, z) || slope(x, z) > 0.8) return;
      const s = 0.8 + rand() * 0.7;
      S.get(DEAD_TREES[Math.floor(rand() * DEAD_TREES.length)] as GeoKey, 'matte').push(x, heightAt(x, z) - 0.05, z, (rand() - 0.5) * 0.5, s, s * (0.85 + rand() * 0.4), s, tint('#2b241f', 0.4));
    };
    const boulder = (x: number, z: number, size: number) => {
      if (onFloor(x, z)) return;
      S.get(BOULDERS[Math.floor(rand() * BOULDERS.length)] as GeoKey, 'rock').push(x, heightAt(x, z) - size * 0.15, z, rand() * 6.28, size, size * (0.6 + rand() * 0.6), size * (0.8 + rand() * 0.4), tint('#ffffff', 0.3));
    };

    const first = laneOriginX(0);
    const last = laneOriginX(this.lanes - 1) + LANE_W;
    // The plateaus between canyons: thick dead heath, scattered stones, the odd dead tree.
    for (let lane = 0; lane < this.lanes - 1; lane++) {
      const xa = laneOriginX(lane) + LANE_W;
      const gw = STRIDE - LANE_W;
      for (let i = 0; i < 460; i++) brush(xa + rand() * gw, ZC + rand() * (Z_MOUTH + 4 - ZC));
      for (let i = 0; i < 10; i++) boulder(xa + 0.6 + rand() * (gw - 1.2), ZC + rand() * (Z_MOUTH + 4 - ZC), 0.4 + rand() * 0.9);
      for (let i = 0; i < 2; i++) tree(xa + 1.5 + rand() * (gw - 3), Z_END + 4 + rand() * (Z_MOUTH - Z_END - 6));
    }
    // Flanks.
    for (const side of [-1, 1]) {
      const edge = side < 0 ? first : last;
      for (let i = 0; i < 1400; i++) {
        const d = Math.pow(rand(), 1.6) * 45;
        brush(edge + side * (0.4 + d), ZC + rand() * (Z_MOUTH + 14 - ZC), 1 + d * 0.02);
      }
      for (let i = 0; i < 40; i++) boulder(edge + side * (1 + rand() * 50), ZC + rand() * (Z_MOUTH + 20 - ZC), 0.6 + rand() * 2.2);
      for (let i = 0; i < 16; i++) tree(edge + side * (2 + rand() * 40), ZC + 2 + rand() * (Z_MOUTH + 12 - ZC));
    }
    // The approach: a broad, bleak plain of brush and boulders, darkening into the distance.
    for (let i = 0; i < 3200; i++) {
      const x = first - 30 + rand() * (last - first + 60);
      const z = Z_MOUTH - 1 + Math.pow(rand(), 1.4) * 34;
      brush(x, z);
    }
    for (let i = 0; i < 90; i++) boulder(first - 30 + rand() * (last - first + 60), Z_MOUTH + 1 + rand() * 34, 0.4 + rand() * 1.6);
    for (let i = 0; i < 26; i++) tree(first - 30 + rand() * (last - first + 60), Z_MOUTH + 2 + rand() * 30);

    // The citadels: dressed stone set into the face of the range.
    for (let lane = 0; lane < this.lanes; lane++) {
      const cx = laneCx(lane);
      const pz = Z_END - 1.1;
      const st = (x: number, y: number, z: number, w: number, h: number, d: number, rotX = 0, shade = 1) =>
        S.get('box', 'cutStone').push(x, y, z, 0, w, h, d, c.setScalar(shade), rotX);
      for (const side of [-1, 1]) {
        const px = cx + side * (AW / 2 - 0.85);
        st(px, 0, pz, 2.0, 0.8, 2.0);
        st(px, 0.8, pz, 1.5, AH - 1.7, 1.5);
        st(px, AH - 0.9, pz, 2.0, 0.55, 2.0);
        // Inner jambs step the doorway in for depth.
        st(cx + side * (AW / 2 - 2.05), 0, Z_END - 2.4, 0.7, AH - 1.4, 1.2, 0, 0.85);
        // Buttresses climbing the façade.
        const by = AH + 1.4;
        const bh = 19.5 - by;
        st(cx + side * (AW / 2 - 0.4), by, ZC - (by + bh / 2) * LEAN - 0.2, 1.0, bh, 1.6, -LEAN, 0.92);
      }
      st(cx, AH - 0.35, pz, AW + 1.4, 1.4, 2.1);
      st(cx, AH + 1.05, pz - 0.25, AW - 0.8, 0.9, 1.7, 0, 0.95);
      st(cx, AH + 1.95, pz - 0.5, AW - 3, 0.8, 1.4, 0, 0.9);
      st(cx, AH - 2.2, Z_END - 2.4, AW - 3.2, 0.8, 1.2, 0, 0.85);
      // Steps up to the threshold.
      for (let i = 0; i < 3; i++) st(cx, 0, Z_END - 0.9 - i * 0.65, AW - 3.6, 0.15 * (i + 1), 0.7, 0, 0.9);
      // Rubble and boulders where the canyon walls meet the range.
      for (let i = 0; i < 4; i++) boulder(cx + (rand() < 0.5 ? -1 : 1) * (LANE_W / 2 + 1 + rand() * 2), Z_END - 0.5 - rand() * 1.5, 0.6 + rand() * 0.8);
    }
    S.end();
    for (const set of this.brushChunks.values()) {
      set.end();
      for (const m of set.group.children as InstancedMesh[]) {
        m.frustumCulled = true;
        m.computeBoundingSphere();
      }
    }

    // Lit slits in the façades: the city within.
    this.windows = [];
    for (let lane = 0; lane < this.lanes; lane++) {
      const cx = laneCx(lane);
      for (let i = 0; i < 9; i++) {
        const y = AH + 3 + rand() * 9;
        const x = cx + (rand() - 0.5) * (AW - 2.8);
        this.windows.push({ lane, x, y, z: ZC - y * LEAN - 0.32, h: 0.4 + rand() * 0.5 });
      }
    }
  }

  /** Gates, fires, banners and weather are drawn per frame: house colours, falls, flicker and wind. */
  update(houses: string[], fallen: boolean[], time: number, glow: number, focus: Vector3) {
    const key = houses.join();
    if (key !== this.housesKey) {
      this.housesKey = key;
      // Heraldry, weathered: muted and darkened, so firelight stays the brightest thing in view.
      this.houses = houses.map((h) => new Color(h).lerp(new Color('#4a4a4a'), 0.35).multiplyScalar(0.75));
    }
    fireLevel.value = glow;
    const K = this.keeps;
    K.begin();
    const c = new Color();
    const fire = new Color(PALETTE.fire);
    const flame = (x: number, y: number, z: number, size: number, seed: number, pool = 3) => {
      const f = 0.85 + Math.sin(time * 13 + seed) * 0.08 + Math.sin(time * 23.7 + seed * 2.1) * 0.07;
      K.get('cone', 'ember', false).push(x, y, z, seed, size * 0.7 * f, size * 1.5 * f, size * 0.7 * f, c.setScalar(f));
      K.get('sphere', 'ember', false).push(x, y + size * 0.25, z, 0, size * 0.9, size * 0.6 * f, size * 0.9, c.setScalar(0.6 * f));
      if (pool > 0) K.get('pg:card', 'pool', false).push(x, 0.03, z, 0, pool * 2, 1, pool * 2, c.copy(fire).multiplyScalar(f));
      // Embers rise and fade.
      for (let i = 0; i < 3; i++) {
        const t = (time * 0.45 + seed * 0.37 + i / 3) % 1;
        const e = 0.035 * (1 - t);
        K.get('sphere', 'ember', false).push(x + Math.sin(t * 9 + seed + i) * 0.3 * t + t * 0.4, y + 0.3 + t * 2.4, z + Math.cos(t * 7 + i) * 0.2 * t, 0, e, e, e, c.setScalar(1 - t));
      }
    };
    const brazier = (x: number, z: number, lit: boolean, seed: number) => {
      K.get('box', 'cutStone').push(x, 0, z, 0, 0.55, 0.9, 0.55, c.setScalar(0.85));
      K.get('cyl', 'metal').push(x, 0.9, z, 0, 0.7, 0.28, 0.7, c.set(PALETTE.iron));
      if (lit) flame(x, 1.2, z, 0.32, seed);
    };

    for (let lane = 0; lane < this.lanes; lane++) {
      const cx = laneCx(lane);
      const down = !!fallen[lane];
      const ox = laneOriginX(lane);
      // The doorway: firelight from the deep, or a black hole choked with rubble once it falls.
      K.get('pg:door', 'portal', false).push(cx, 0.45, Z_END - 2.95, 0, AW - 3.5, AH - 2.7, 1, c.setScalar(down ? 0.03 : 1));
      if (down) {
        const r = mulberry(lane + 1);
        for (let i = 0; i < 9; i++) {
          const s = 0.5 + r() * 1.1;
          K.get('box', 'cutStone').push(cx + (r() - 0.5) * (AW - 3), s * 0.3, Z_END - 1.4 - r() * 1.6, r() * 3, s, s * 0.7, s * 0.9, c.setScalar(0.6), r() - 0.5, r() - 0.5);
        }
      } else {
        // Long house banners hang down the pillar faces.
        for (const side of [-1, 1]) {
          const px = cx + side * (AW / 2 - 0.85);
          K.get('box', 'cloth', false).push(px, AH - 0.9 - 2.75, Z_END - 0.33, 0, 5.4, 1.05, 0.04, this.houses[lane], 0, -Math.PI / 2);
        }
      }
      // Braziers at the threshold and at the canyon mouth.
      brazier(ox + 1.3, toWorldZ(LANE_H - 0.6), !down, lane * 7 + 1);
      brazier(ox + LANE_W - 1.3, toWorldZ(LANE_H - 0.6), !down, lane * 7 + 2);
      brazier(ox + 0.5, toWorldZ(0.6), !down, lane * 7 + 3);
      brazier(ox + LANE_W - 0.5, toWorldZ(0.6), !down, lane * 7 + 4);
      if (!down) K.get('pg:card', 'pool', false).push(cx, 0.02, Z_END + 1.5, 0, AW, 1, 7, c.copy(fire).multiplyScalar(0.8));
    }
    // Real lights go to the standing gates nearest the view; the rest glow with doorways and pools alone.
    const near = Array.from({ length: this.lanes }, (_, l) => l)
      .filter((l) => !fallen[l])
      .sort((a, b) => Math.abs(laneCx(a) - focus.x) - Math.abs(laneCx(b) - focus.x));
    this.lights.forEach((L, i) => {
      const lane = near[i];
      if (lane === undefined) {
        L.intensity = 0;
        return;
      }
      L.position.set(laneCx(lane), 2.4, Z_END - 1.2);
      L.intensity = (34 + Math.sin(time * 9 + lane) * 4 + Math.sin(time * 21 + lane * 3) * 3) * glow;
    });
    for (const w of this.windows) {
      if (fallen[w.lane]) continue;
      const f = 0.6 + 0.4 * Math.max(0, Math.sin(time * 0.7 + w.x * 3.1 + w.y));
      K.get('box', 'ember', false).push(w.x, w.y, w.z, 0, 0.18, w.h, 0.06, c.setScalar(f * 0.55));
    }
    K.end();

    // Sleet, blown on a cold wind, in a box that follows the view.
    const S = this.sleet;
    S.begin();
    const span = 90;
    const depth = 70;
    const top = 16;
    const vy = 9;
    const vx = 3.2;
    const tilt = Math.atan2(vx, vy);
    for (const f of this.flakes) {
      const t = (time * vy) / top + f.s * 13.7;
      const fy = (1 - (t - Math.floor(t))) * top;
      const wx = ((f.x * span + (time * vx + f.s * 40) - focus.x) % span + span) % span - span / 2 + focus.x;
      const wz = focus.z - depth / 2 + f.z * depth;
      S.push(wx, fy, wz, 0, 0.02, 0.32, 0.02, c.setScalar(1), 0, -tilt);
    }
    S.end();
  }
}
