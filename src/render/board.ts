import { Color, Group, Mesh, MeshStandardNodeMaterial, PlaneGeometry, Vector3 } from 'three/webgpu';
import { float, fract, mix, mx_noise_float, positionWorld, smoothstep, time, uniform, vec2, vec3 } from 'three/tsl';
import { GATE_ROWS, KEEP_ROWS, LANE_H, LANE_W } from '../sim/data/map';
import { laneCount, laneOriginX, LANE_GAP, toWorldZ, worldMaxX, worldMinX } from './coords';
import { Batch } from './batch';
import { BatchSet, GEO, MATS, PALETTE, part, pushModel } from './parts';
import type { Part } from './parts';

/** Tiny seeded PRNG for cosmetic scatter, so the scenery is the same every load. */
function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Scenery models ('house' here is just the per-instance tint) ────────────
const PINE: Part[] = [
  part('cyl', 'woodDark', [0, 0, 0], [0.16, 0.5, 0.16]),
  part('cone', 'house', [0, 0.35, 0], [1.1, 1.3, 1.1], undefined, 'foliage'),
  part('cone', 'house', [0, 1.0, 0], [0.85, 1.1, 0.85], undefined, 'foliage'),
  part('cone', 'house', [0, 1.55, 0], [0.55, 0.9, 0.55], undefined, 'foliage'),
];
const OAK: Part[] = [
  part('cyl', 'woodDark', [0, 0, 0], [0.18, 1.0, 0.18]),
  part('rock', 'house', [0, 1.35, 0], [1.5, 1.2, 1.5], undefined, 'foliage'),
  part('rock', 'house', [0.45, 1.1, 0.2], [0.9, 0.8, 0.9], undefined, 'foliage'),
  part('rock', 'house', [-0.35, 1.2, -0.3], [1.0, 0.85, 1.0], undefined, 'foliage'),
];
const BUSH: Part[] = [
  part('rock', 'house', [0, 0.18, 0], [0.7, 0.5, 0.7], undefined, 'foliage'),
  part('rock', 'house', [0.25, 0.14, 0.1], [0.45, 0.38, 0.45], undefined, 'foliage'),
];
const TUFT: Part[] = [
  part('cone', 'house', [0, 0, 0], [0.08, 0.38, 0.08], [0.15, 0, 0.1], 'foliage'),
  part('cone', 'house', [0.07, 0, 0.03], [0.07, 0.3, 0.07], [-0.1, 0, -0.25], 'foliage'),
  part('cone', 'house', [-0.06, 0, -0.04], [0.07, 0.33, 0.07], [0.2, 0, 0.3], 'foliage'),
];
const DEAD_TREE: Part[] = [
  part('cyl', 'woodDark', [0, 0, 0], [0.14, 1.6, 0.14]),
  part('cyl', 'woodDark', [0.2, 1.0, 0], [0.07, 0.8, 0.07], [0, 0, -0.8]),
  part('cyl', 'woodDark', [-0.15, 1.2, 0], [0.06, 0.6, 0.06], [0, 0, 0.9]),
];
const COTTAGE: Part[] = [
  part('box', 'house', [0, 0, 0], [1.6, 0.9, 1.1]),
  part('cone4', 'thatch', [0, 0.9, 0], [2.1, 0.8, 1.6]),
  part('box', 'woodDark', [0, 0, 0.56], [0.32, 0.55, 0.02]),
  part('box', 'woodDark', [-0.5, 0.45, 0.56], [0.22, 0.2, 0.02]),
  part('box', 'stoneDark', [0.55, 0.9, -0.2], [0.18, 0.7, 0.18]),
];

const LEAF_GREENS = ['#3f7a2e', '#4f8a34', '#5e9a3a', '#3a6b34', '#6f9e3c'];
const AUTUMN = ['#d9822b', '#c4532f', '#e0b23a', '#b8432e'];
const PINE_GREENS = ['#2c5a34', '#2f6338', '#356b3a', '#27503a'];
const FLOWERS = ['#9b5fc0', '#e8c43c', '#f2efe6', '#d8443a', '#6b8fe0', '#e07ab0'];
const FIELDS = ['#c9a64a', '#a8b84a', '#8fae3e', '#d8b85a', '#7d9a3a', '#b88a4a'];

const RIVER_Z0 = LANE_H / 2 + 7.2;
const RIVER_Z1 = LANE_H / 2 + 12.5;

/**
 * Terrain and fixed architecture: a mottled meadow with drifting cloud
 * shadows, a walled road per player with a gate at its head and a keep at its
 * foot, a river in front of the keeps, villages, fields and woodland.
 */
export class Board {
  readonly group = new Group();
  readonly statics = new BatchSet();
  readonly gridOpacity = uniform(0.35);
  /** Grass tint as a vec3 uniform (colour uniforms don't type-check with vec3 maths). */
  readonly grass = uniform(new Vector3(0.3, 0.45, 0.18));
  private keeps = new BatchSet();
  private motes = new Batch(GEO.sphere, MATS.glow, 256, false);
  private mote: { x: number; y: number; z: number; p: number }[] = [];
  private fallen: boolean[] = [];
  private houses: Color[] = [];
  private housesKey = '';
  private layoutGroup = new Group();
  private groundMat = new MeshStandardNodeMaterial({ roughness: 1 });
  private roadMat = new MeshStandardNodeMaterial({ roughness: 0.95 });
  private cobbleMat = new MeshStandardNodeMaterial({ roughness: 0.9 });
  private waterMat = new MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0.1 });
  private lanes = 0;

  constructor() {
    const p = positionWorld.xz;
    // Drifting cloud shadows shared by every ground surface.
    const cloud = smoothstep(0.15, 0.65, mx_noise_float(p.mul(0.022).add(vec2(time.mul(0.018), time.mul(0.007)))).mul(0.5).add(0.5));
    const shade = mix(float(1), float(0.68), cloud);

    // Meadow: lush and dry patches, heather, darker earth, sandy river banks.
    const n1 = mx_noise_float(p.mul(0.06)).mul(0.5).add(0.5);
    const n2 = mx_noise_float(p.mul(0.33)).mul(0.5).add(0.5);
    const n3 = mx_noise_float(p.mul(0.11).add(vec2(17, 3))).mul(0.5).add(0.5);
    let ground = mix(this.grass.mul(0.72), this.grass.mul(1.12), n1.mul(0.7).add(n2.mul(0.3)));
    ground = mix(ground, vec3(0.42, 0.38, 0.14), smoothstep(0.62, 0.8, n3).mul(0.55));
    ground = mix(ground, vec3(0.3, 0.17, 0.3), smoothstep(0.72, 0.86, n2).mul(smoothstep(0.5, 0.7, n1)).mul(0.5));
    const bank = smoothstep(2.2, 0.4, positionWorld.z.sub((RIVER_Z0 + RIVER_Z1) / 2).abs().sub((RIVER_Z1 - RIVER_Z0) / 2));
    ground = mix(ground, vec3(0.5, 0.42, 0.28), bank.mul(0.85));
    this.groundMat.colorNode = ground.mul(shade);

    // Roads: warm packed earth with pebbles and a faint build grid.
    const earth = mix(vec3(0.15, 0.1, 0.06), vec3(0.27, 0.19, 0.11), mx_noise_float(p.mul(0.8)).mul(0.5).add(0.5));
    const pebbles = smoothstep(0.55, 0.8, mx_noise_float(p.mul(5.5))).mul(0.12);
    const f = fract(p);
    const edge = f.x.min(f.y).min(float(1).sub(f.x)).min(float(1).sub(f.y));
    const line = float(1).sub(smoothstep(0.0, 0.04, edge));
    this.roadMat.colorNode = mix(earth.add(pebbles), vec3(0.42, 0.36, 0.26), line.mul(this.gridOpacity)).mul(shade);

    // Cobbles: stones with darker mortar.
    const c = fract(p.mul(vec2(2.2, 3.1)));
    const cEdge = c.x.min(c.y).min(float(1).sub(c.x)).min(float(1).sub(c.y));
    const stone = mix(vec3(0.24, 0.22, 0.2), vec3(0.4, 0.37, 0.32), mx_noise_float(p.mul(3.3)).mul(0.5).add(0.5));
    this.cobbleMat.colorNode = mix(vec3(0.1, 0.09, 0.08), stone, smoothstep(0.03, 0.09, cEdge)).mul(shade);

    // River: deep teal with drifting glints.
    const flow = p.mul(vec2(0.5, 1.4)).add(vec2(time.mul(0.35), 0));
    const glint = smoothstep(0.55, 0.85, mx_noise_float(flow.mul(1.8))).mul(0.35);
    const depth = mx_noise_float(p.mul(0.2).add(vec2(time.mul(0.05), 0))).mul(0.5).add(0.5);
    this.waterMat.colorNode = mix(vec3(0.03, 0.16, 0.2), vec3(0.08, 0.32, 0.36), depth).add(glint).mul(mix(float(1), float(0.8), cloud));

    this.group.add(this.layoutGroup, this.statics.group, this.keeps.group, this.motes.mesh);
    this.layout();
  }

  /** (Re)builds ground, roads and scenery for the current lane count. */
  layout() {
    const count = laneCount();
    if (count === this.lanes) return;
    this.lanes = count;
    for (const c of [...this.layoutGroup.children]) (c as Mesh).geometry.dispose();
    this.layoutGroup.clear();
    const w = worldMaxX() - worldMinX() + 160;
    const cx = (worldMinX() + worldMaxX()) / 2;
    const ground = new Mesh(new PlaneGeometry(w, LANE_H + 120).rotateX(-Math.PI / 2), this.groundMat);
    ground.position.set(cx, -0.02, 0);
    ground.receiveShadow = true;
    const river = new Mesh(new PlaneGeometry(w, RIVER_Z1 - RIVER_Z0).rotateX(-Math.PI / 2), this.waterMat);
    river.position.set(cx, 0.01, (RIVER_Z0 + RIVER_Z1) / 2);
    river.receiveShadow = true;
    this.layoutGroup.add(ground, river);
    const bedH = LANE_H - GATE_ROWS - KEEP_ROWS;
    for (let lane = 0; lane < count; lane++) {
      const ox = laneOriginX(lane);
      const bed = new Mesh(new PlaneGeometry(LANE_W, bedH).rotateX(-Math.PI / 2), this.roadMat);
      bed.position.set(ox + LANE_W / 2, 0.005, toWorldZ(GATE_ROWS + bedH / 2));
      bed.receiveShadow = true;
      const gate = new Mesh(new PlaneGeometry(LANE_W, GATE_ROWS).rotateX(-Math.PI / 2), this.cobbleMat);
      gate.position.set(ox + LANE_W / 2, 0.006, toWorldZ(GATE_ROWS / 2));
      gate.receiveShadow = true;
      const keep = new Mesh(new PlaneGeometry(LANE_W, KEEP_ROWS + 5).rotateX(-Math.PI / 2), this.cobbleMat);
      keep.position.set(ox + LANE_W / 2, 0.006, toWorldZ(LANE_H - KEEP_ROWS + (KEEP_ROWS + 5) / 2));
      keep.receiveShadow = true;
      // A bridge over the river from each keep.
      const bridge = new Mesh(new PlaneGeometry(2.4, RIVER_Z1 - RIVER_Z0 + 1).rotateX(-Math.PI / 2), this.cobbleMat);
      bridge.position.set(ox + LANE_W / 2, 0.08, (RIVER_Z0 + RIVER_Z1) / 2);
      bridge.receiveShadow = true;
      this.layoutGroup.add(bed, gate, keep, bridge);
    }
    this.buildStatics();
  }

  private buildStatics() {
    const S = this.statics;
    S.begin();
    const white = new Color('#ffffff');
    const rand = mulberry(7);
    const pick = (list: string[]) => new Color(list[Math.floor(rand() * list.length)]).multiplyScalar(0.85 + rand() * 0.3);
    const stoneVar = () => new Color(PALETTE.stone).multiplyScalar(0.85 + rand() * 0.25);
    const tree = (x: number, z: number, scale: number) => {
      const r = rand();
      if (r < 0.45) pushModel(S, PINE, x, 0, z, rand() * 6, scale, pick(PINE_GREENS));
      else if (r < 0.92) pushModel(S, OAK, x, 0, z, rand() * 6, scale * 0.9, rand() < 0.22 ? pick(AUTUMN) : pick(LEAF_GREENS));
      else pushModel(S, DEAD_TREE, x, 0, z, rand() * 6, scale, white);
    };
    const flowers = (x: number, z: number, n: number, spread: number) => {
      const col = pick(FLOWERS);
      for (let i = 0; i < n; i++) S.get('sphere').push(x + (rand() - 0.5) * spread, 0.08, z + (rand() - 0.5) * spread, 0, 0.09, 0.07, 0.09, col);
    };
    for (let lane = 0; lane < this.lanes; lane++) {
      const ox = laneOriginX(lane);
      // Side walls: stone courses with merlons in varied stone.
      for (const wx of [ox - 0.25, ox + LANE_W + 0.25]) {
        S.get('box').push(wx, 0, toWorldZ(LANE_H / 2 - 1.5), 0, 0.5, 0.45, LANE_H + 3, PALETTE.stoneDark);
        for (let y = -1; y <= LANE_H + 1; y += 2) S.get('box').push(wx, 0.45, toWorldZ(y), 0, 0.56, 0.2, 0.42, stoneVar());
      }
      // Gate: two towers with roofs and a lintel.
      const gz = toWorldZ(-0.9);
      for (const gx of [ox - 0.3, ox + LANE_W + 0.3]) {
        S.get('box').push(gx, 0, gz, 0, 1.5, 2.4, 1.5, stoneVar());
        S.get('box').push(gx, 2.4, gz, 0, 1.7, 0.25, 1.7, PALETTE.stoneDark);
        S.get('cone4').push(gx, 2.65, gz, 0, 2.0, 1.1, 2.0, PALETTE.roofRed);
      }
      S.get('box').push(ox + LANE_W / 2, 2.0, gz, 0, LANE_W + 0.6, 0.5, 0.8, PALETTE.stoneDark);
      S.get('box').push(ox + LANE_W / 2, 1.85, gz, 0, LANE_W - 1, 0.15, 0.12, PALETTE.iron);
      // A village around the keep: whitewashed cottages with thatch.
      const kz = toWorldZ(LANE_H + 3.2);
      for (const [dx, dz, rot] of [[-4.6, 0.8, 0.2], [4.5, 1.6, -0.3], [-3.6, 3.4, 1.4]] as const) {
        pushModel(S, COTTAGE, ox + LANE_W / 2 + dx, 0, kz + dz, rot, 0.85, new Color('#e9dcc2').multiplyScalar(0.9 + rand() * 0.15));
      }
      // The gap to the right of this lane: trees, bushes, tufts, flowers and rocks.
      const gx0 = ox + LANE_W + 0.9;
      const gw = LANE_GAP - 1.8;
      for (let i = 0; i < 16; i++) tree(gx0 + rand() * gw, toWorldZ(-3 + rand() * (LANE_H + 10)), 0.6 + rand() * 0.7);
      for (let i = 0; i < 14; i++) pushModel(S, BUSH, gx0 + rand() * gw, 0, toWorldZ(rand() * (LANE_H + 6)), rand() * 6, 0.7 + rand() * 0.6, pick(LEAF_GREENS));
      for (let i = 0; i < 40; i++) pushModel(S, TUFT, gx0 - 0.4 + rand() * (gw + 0.8), 0, toWorldZ(rand() * (LANE_H + 6)), rand() * 6, 0.8 + rand() * 0.6, new Color('#8fb04a').multiplyScalar(0.8 + rand() * 0.4));
      for (let i = 0; i < 8; i++) flowers(gx0 + rand() * gw, toWorldZ(rand() * (LANE_H + 6)), 6 + Math.floor(rand() * 6), 0.9);
      for (let i = 0; i < 5; i++) S.get('rock').push(gx0 + rand() * gw, 0.05, toWorldZ(rand() * (LANE_H + 8)), rand() * 6, 0.4 + rand() * 0.7, 0.3 + rand() * 0.4, 0.4 + rand() * 0.7, new Color(PALETTE.stoneDark).multiplyScalar(0.8 + rand() * 0.4));
    }
    const x0 = worldMinX() - 60;
    const span = worldMaxX() - worldMinX() + 120;
    // Patchwork fields beyond the gates, with hay bales.
    for (let fx = x0; fx < x0 + span; fx += 7 + rand() * 4) {
      for (let row = 0; row < 2; row++) {
        const z = toWorldZ(-5.5 - row * 6.5 - rand() * 1.5);
        const fw = 5 + rand() * 4;
        S.get('box', 'matte').push(fx + fw / 2, -0.01, z, (rand() - 0.5) * 0.12, fw, 0.04, 5 + rand() * 1.5, pick(FIELDS));
        if (rand() < 0.4) for (let b = 0; b < 3; b++) S.get('cyl').push(fx + 1 + rand() * (fw - 2), 0, z + (rand() - 0.5) * 3, rand() * 3, 0.5, 0.45, 0.5, PALETTE.thatch);
      }
    }
    // Woodland beyond the fields and across the river.
    for (let i = 0; i < 650; i++) {
      const x = x0 + rand() * span;
      const far = rand() < 0.5;
      const z = far ? toWorldZ(-19 - rand() * 28) : RIVER_Z1 + 2.5 + rand() * 30;
      tree(x, z, 0.9 + rand() * 1.3);
    }
    for (let i = 0; i < 120; i++) {
      const x = rand() < 0.5 ? worldMinX() - 2 - rand() * 40 : worldMaxX() + 2 + rand() * 40;
      tree(x, toWorldZ(-5 + rand() * (LANE_H + 12)), 0.9 + rand() * 1.2);
    }
    // Flowers and tufts along the riverbanks and meadows.
    for (let i = 0; i < 220; i++) {
      const x = x0 + rand() * span;
      const z = rand() < 0.5 ? RIVER_Z0 - 0.8 - rand() * 2.5 : RIVER_Z1 + 0.6 + rand() * 2;
      if (rand() < 0.5) flowers(x, z, 4 + Math.floor(rand() * 5), 0.8);
      else pushModel(S, TUFT, x, 0, z, rand() * 6, 0.9 + rand() * 0.5, new Color('#8fb04a').multiplyScalar(0.8 + rand() * 0.4));
    }
    S.end();
    // Ambient motes scattered over the realm.
    this.mote = Array.from({ length: 220 }, () => ({ x: x0 + 60 + rand() * (span - 120), y: 0.3 + rand() * 2.2, z: toWorldZ(-4 + rand() * (LANE_H + 14)), p: rand() * 100 }));
  }

  /** Keeps, banners and motes are drawn per frame: house colours, falls, flicker and wind. */
  update(houses: string[], fallen: boolean[], time: number, glow: number) {
    const key = houses.join();
    if (key !== this.housesKey) {
      this.housesKey = key;
      this.houses = houses.map((h) => new Color(h));
    }
    this.fallen = fallen;
    const K = this.keeps;
    K.begin();
    const burnt = new Color('#2a2624');
    for (let lane = 0; lane < houses.length; lane++) {
      const ox = laneOriginX(lane);
      const cx = ox + LANE_W / 2;
      const kz = toWorldZ(LANE_H + 3.2);
      const down = this.fallen[lane];
      const house = down ? burnt : this.houses[lane];
      const stone = down ? '#3a3734' : PALETTE.stone;
      const h = down ? 0.9 : 2.8;
      K.get('box').push(cx, 0, kz, 0, 4.2, h, 2.8, stone);
      if (!down) {
        K.get('box').push(cx, h, kz, 0, 4.5, 0.3, 3.1, PALETTE.stoneDark);
        for (let mx = -2; mx <= 2; mx++) K.get('box').push(cx + mx * 1.05, h + 0.3, kz - 1.45, 0, 0.5, 0.35, 0.3, PALETTE.stone);
        K.get('box').push(cx, 0, kz - 1.45, 0, 1.4, 1.6, 0.1, PALETTE.woodDark);
        for (const wx of [-1.3, 1.3]) K.get('box').push(cx + wx, 1.7, kz - 1.42, 0, 0.3, 0.5, 0.05, '#1c1712');
      }
      for (const dx of [-2.6, 2.6]) {
        const th = down ? 1.2 : 3.6;
        K.get('cyl').push(cx + dx, 0, kz - 0.4, 0, 1.4, th, 1.4, stone);
        if (!down) K.get('cone').push(cx + dx, th, kz - 0.4, 0, 1.7, 1.5, 1.7, house);
      }
      if (!down) {
        // The house standard on the keep, and torches either side of the door.
        K.get('cyl').push(cx, h, kz, 0, 0.08, 2.4, 0.08, PALETTE.wood);
        K.get('box', 'cloth', false).push(cx + 0.55, h + 1.45, kz, 0, 1.1, 0.8, 0.04, house);
        for (const tx of [-1.0, 1.0]) {
          const flick = 0.9 + Math.sin(time * 13 + lane * 3 + tx) * 0.1;
          K.get('sphere', 'glow', false).push(cx + tx, 1.35, kz - 1.5, 0, 0.18 * flick, 0.26 * flick, 0.18 * flick, PALETTE.fire);
        }
        // Pennants along both walls in the house colours.
        for (let y = 4; y < LANE_H - 2; y += 7) {
          for (const [wx, side] of [[ox - 0.25, -1], [ox + LANE_W + 0.25, 1]] as const) {
            const z = toWorldZ(y + (side > 0 ? 3.5 : 0));
            K.get('cyl').push(wx, 0.5, z, 0, 0.05, 1.5, 0.05, PALETTE.woodDark);
            K.get('box', 'cloth', false).push(wx + side * 0.3, 1.55, z, side > 0 ? 0 : Math.PI, 0.6, 0.32, 0.03, house);
          }
        }
        // Gate flags.
        for (const gx of [ox - 0.3, ox + LANE_W + 0.3]) {
          K.get('cyl').push(gx, 3.6, toWorldZ(-0.9), 0, 0.05, 1.0, 0.05, PALETTE.woodDark);
          K.get('box', 'cloth', false).push(gx + 0.3, 4.25, toWorldZ(-0.9), 0, 0.6, 0.34, 0.03, house);
        }
      }
      // Gate torches.
      for (const gx of [ox - 0.3, ox + LANE_W + 0.3]) {
        const flick = 0.9 + Math.sin(time * 11 + lane + gx) * 0.1;
        K.get('sphere', 'glow', false).push(gx, 2.2, toWorldZ(-0.1), 0, 0.2 * flick, 0.3 * flick, 0.2 * flick, down ? '#402018' : PALETTE.fire);
      }
    }
    K.end();

    // Motes: faint pollen by day, fireflies at night.
    const night = Math.min(1, Math.max(0, (glow - 0.6) / 1.1));
    const m = this.motes;
    m.begin();
    const col = new Color().lerpColors(new Color('#fff2c0'), new Color('#c8ff6a'), night);
    for (const d of this.mote) {
      const t = time * 0.4 + d.p;
      const blink = night > 0 ? Math.max(0, Math.sin(t * 2.3 + d.p * 7)) : 0.5;
      const size = (0.025 + night * 0.05) * (0.4 + blink);
      m.push(d.x + Math.sin(t) * 1.2, d.y + Math.sin(t * 1.7) * 0.4, d.z + Math.cos(t * 0.8) * 1.2, 0, size, size, size, col);
    }
    m.end();
  }
}
