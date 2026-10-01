import { Color, Group, Mesh, MeshStandardNodeMaterial, PlaneGeometry, Vector3 } from 'three/webgpu';
import { float, fract, mix, mx_noise_float, positionWorld, smoothstep, time, uniform, vec2, vec3 } from 'three/tsl';
import { GATE_ROWS, KEEP_ROWS, LANE_H, LANE_W } from '../sim/data/map';
import { assetsReady, fitHeight, fitWidth, snowCover } from './assets';
import { Batch } from './batch';
import { laneCount, laneOriginX, LANE_GAP, toWorldZ, worldMaxX, worldMinX } from './coords';
import { BatchSet, GEO, MATS, PALETTE, part, pushModel } from './parts';
import type { GeoKey, MatKey, Part } from './parts';

/** Tiny seeded PRNG for cosmetic scatter, so the scenery is the same every load. */
function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Procedural scenery ('house' is just the per-instance tint here) ───────
const SCOTS_PINE: Part[] = [
  part('cyl', 'woodDark', [0, 0, 0], [0.14, 1.1, 0.14]),
  part('cone', 'house', [0, 0.8, 0], [1.0, 1.0, 1.0], undefined, 'foliage'),
  part('cone', 'house', [0, 1.35, 0], [0.75, 0.9, 0.75], undefined, 'foliage'),
  part('cone', 'house', [0, 1.85, 0], [0.45, 0.7, 0.45], undefined, 'foliage'),
];
const BIRCH: Part[] = [
  part('cyl', 'birch', [0, 0, 0], [0.1, 1.3, 0.1]),
  part('rock', 'house', [0, 1.3, 0], [0.9, 1.2, 0.9], undefined, 'foliage'),
  part('rock', 'house', [0.2, 1.05, 0.1], [0.55, 0.7, 0.55], undefined, 'foliage'),
];
const HEATHER: Part[] = [
  part('rock', 'house', [0, 0.04, 0], [0.55, 0.28, 0.55], undefined, 'foliage'),
  part('rock', 'house', [0.22, 0.02, 0.12], [0.35, 0.22, 0.35], undefined, 'foliage'),
];
const TUFT: Part[] = [
  part('cone', 'house', [0, 0, 0], [0.07, 0.42, 0.07], [0.15, 0, 0.1], 'foliage'),
  part('cone', 'house', [0.07, 0, 0.03], [0.06, 0.34, 0.06], [-0.1, 0, -0.25], 'foliage'),
  part('cone', 'house', [-0.06, 0, -0.04], [0.06, 0.38, 0.06], [0.2, 0, 0.3], 'foliage'),
];
const DEAD_TREE: Part[] = [
  part('cyl', 'woodDark', [0, 0, 0], [0.14, 1.6, 0.14]),
  part('cyl', 'woodDark', [0.2, 1.0, 0], [0.07, 0.8, 0.07], [0, 0, -0.8]),
  part('cyl', 'woodDark', [-0.15, 1.2, 0], [0.06, 0.6, 0.06], [0, 0, 0.9]),
];

const PINE_GREENS = ['#24402f', '#2a4734', '#2f4d38', '#223a2e', '#30503c'];
const BIRCH_LEAVES = ['#8a7a2e', '#a0702a', '#6f7a34', '#b0802c'];
const HEATHERS = ['#5e3c5c', '#6c4668', '#523650', '#74506e', '#4a3448'];
const BRACKEN = ['#8a5a2a', '#7a4e26', '#96683a'];

const RIVER_Z0 = LANE_H / 2 + 7.2;
const RIVER_Z1 = LANE_H / 2 + 12.5;

/**
 * A Highland glen: moorland of heather, bracken and old snow under drifting
 * cloud shadow; a walled road per house with a gatehouse at its head and a
 * castle at its foot; a peaty river; crofts and pinewoods; snow-capped
 * mountains all around.
 */
export class Board {
  readonly group = new Group();
  readonly statics = new BatchSet();
  readonly gridOpacity = uniform(0.35);
  /** Grass tint as a vec3 uniform (colour uniforms don't type-check with vec3 maths). */
  readonly grass = uniform(new Vector3(0.35, 0.4, 0.27));
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
  private waterMat = new MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0.15 });
  private lanes = 0;

  constructor() {
    const p = positionWorld.xz;
    // Drifting cloud shadows shared by every ground surface.
    const cloud = smoothstep(0.15, 0.65, mx_noise_float(p.mul(0.02).add(vec2(time.mul(0.016), time.mul(0.006)))).mul(0.5).add(0.5));
    const shade = mix(float(1), float(0.62), cloud);

    // Moorland: olive grass, wide drifts of heather, rusty bracken, peat, and
    // old snow lying thicker towards the north (the gates, −z).
    const n1 = mx_noise_float(p.mul(0.05)).mul(0.5).add(0.5);
    const n2 = mx_noise_float(p.mul(0.3)).mul(0.5).add(0.5);
    const n3 = mx_noise_float(p.mul(0.09).add(vec2(17, 3))).mul(0.5).add(0.5);
    const n4 = mx_noise_float(p.mul(0.14).add(vec2(-9, 41))).mul(0.5).add(0.5);
    // Fine breakup so patches read as growth, not flat blobs.
    const fine = mx_noise_float(p.mul(1.7)).mul(0.5).add(0.5);
    const grain = mx_noise_float(p.mul(4.1)).mul(0.5).add(0.5);
    let ground = mix(this.grass.mul(0.72), this.grass.mul(1.08), n1.mul(0.5).add(n2.mul(0.3)).add(grain.mul(0.2)));
    const heatherMask = smoothstep(0.45, 0.7, n3.mul(0.65).add(fine.mul(0.35)));
    ground = mix(ground, mix(vec3(0.22, 0.13, 0.22), vec3(0.34, 0.2, 0.32), grain), heatherMask.mul(0.75));
    ground = mix(ground, vec3(0.34, 0.2, 0.1), smoothstep(0.6, 0.8, n4.mul(0.7).add(fine.mul(0.3))).mul(0.55));
    ground = mix(ground, vec3(0.12, 0.1, 0.08), smoothstep(0.72, 0.9, n2).mul(smoothstep(0.55, 0.75, n1)).mul(0.5));
    const north = smoothstep(10, -30, positionWorld.z);
    // Old snow: soft-edged and broken by the grain; thicker towards the north.
    const snowN = mx_noise_float(p.mul(0.16).add(vec2(5, 5))).mul(0.5).add(0.5).mul(0.75).add(fine.mul(0.25));
    const drift = smoothstep(float(0.74).sub(north.mul(0.2)).sub(snowCover.mul(0.1)), float(0.9).sub(north.mul(0.15)), snowN);
    ground = mix(ground, vec3(0.84, 0.87, 0.92), drift.mul(0.9));
    const bank = smoothstep(2.0, 0.4, positionWorld.z.sub((RIVER_Z0 + RIVER_Z1) / 2).abs().sub((RIVER_Z1 - RIVER_Z0) / 2));
    ground = mix(ground, vec3(0.32, 0.3, 0.27), bank.mul(0.85));
    this.groundMat.colorNode = ground.mul(shade);

    // Roads: dark peaty earth with gravel and a faint build grid; snow along the verges.
    const earth = mix(vec3(0.1, 0.075, 0.055), vec3(0.19, 0.15, 0.11), mx_noise_float(p.mul(0.8)).mul(0.5).add(0.5));
    const gravel = smoothstep(0.55, 0.8, mx_noise_float(p.mul(5.5))).mul(0.1);
    const f = fract(p);
    const edge = f.x.min(f.y).min(float(1).sub(f.x)).min(float(1).sub(f.y));
    const line = float(1).sub(smoothstep(0.0, 0.04, edge));
    const slush = smoothstep(0.78, 0.95, mx_noise_float(p.mul(1.3).add(vec2(3, 9))).mul(0.5).add(0.5)).mul(0.18).mul(snowCover);
    this.roadMat.colorNode = mix(mix(earth.add(gravel), vec3(0.7, 0.72, 0.76), slush), vec3(0.4, 0.38, 0.34), line.mul(this.gridOpacity)).mul(shade);

    // Cobbles: grey granite setts with dark joints.
    const c = fract(p.mul(vec2(2.2, 3.1)));
    const cEdge = c.x.min(c.y).min(float(1).sub(c.x)).min(float(1).sub(c.y));
    const stone = mix(vec3(0.22, 0.22, 0.23), vec3(0.38, 0.38, 0.39), mx_noise_float(p.mul(3.3)).mul(0.5).add(0.5));
    this.cobbleMat.colorNode = mix(vec3(0.07, 0.07, 0.075), stone, smoothstep(0.03, 0.09, cEdge)).mul(shade);

    // River: peat-dark water with cold glints.
    const flow = p.mul(vec2(0.5, 1.4)).add(vec2(time.mul(0.35), 0));
    const glint = smoothstep(0.6, 0.88, mx_noise_float(flow.mul(1.8))).mul(0.28);
    const depth = mx_noise_float(p.mul(0.2).add(vec2(time.mul(0.05), 0))).mul(0.5).add(0.5);
    this.waterMat.colorNode = mix(vec3(0.05, 0.08, 0.1), vec3(0.13, 0.2, 0.23), depth).add(glint).mul(mix(float(1), float(0.8), cloud));

    this.group.add(this.layoutGroup, this.statics.group, this.keeps.group, this.motes.mesh);
    this.layout();
  }

  /** Forces scenery to rebuild (e.g. once models have loaded). */
  rebuild() {
    this.lanes = 0;
    this.layout();
  }

  /** (Re)builds ground, roads and scenery for the current lane count. */
  layout() {
    const count = laneCount();
    if (count === this.lanes) return;
    this.lanes = count;
    for (const c of [...this.layoutGroup.children]) (c as Mesh).geometry.dispose();
    this.layoutGroup.clear();
    const w = worldMaxX() - worldMinX() + 260;
    const cx = (worldMinX() + worldMaxX()) / 2;
    const ground = new Mesh(new PlaneGeometry(w, LANE_H + 200).rotateX(-Math.PI / 2), this.groundMat);
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
    const kk = assetsReady();
    const white = new Color('#ffffff');
    const rand = mulberry(7);
    const pick = (list: string[]) => new Color(list[Math.floor(rand() * list.length)]).multiplyScalar(0.85 + rand() * 0.3);
    const stoneVar = () => new Color(PALETTE.stone).multiplyScalar(0.85 + rand() * 0.25);
    /** Places a loaded model scaled to a footprint `width` (or a `height` if negative). */
    const model = (name: string, x: number, z: number, rot: number, size: number, mat: MatKey = 'atlas', tint: Color | string = white) => {
      const key = `kk:${name}` as GeoKey;
      const s = size < 0 ? fitHeight(key, -size) : fitWidth(key, size);
      S.get(key, mat).push(x, 0, z, rot, s, s, s, tint);
    };
    const tree = (x: number, z: number, scale: number) => {
      const r = rand();
      if (kk && r < 0.3) model(rand() < 0.5 ? 'tree_single_A' : 'tree_single_B', x, z, rand() * 6, 1.2 * scale, 'atlasFoliage', new Color('#b8c8b0').multiplyScalar(0.75 + rand() * 0.2));
      else if (r < 0.82) pushModel(S, SCOTS_PINE, x, 0, z, rand() * 6, scale * (0.9 + rand() * 0.5), pick(PINE_GREENS));
      else if (r < 0.95) pushModel(S, BIRCH, x, 0, z, rand() * 6, scale * 0.8, pick(BIRCH_LEAVES));
      else pushModel(S, DEAD_TREE, x, 0, z, rand() * 6, scale, white);
    };
    const heather = (x: number, z: number, n: number, spread: number) => {
      for (let i = 0; i < n; i++) pushModel(S, HEATHER, x + (rand() - 0.5) * spread, 0, z + (rand() - 0.5) * spread, rand() * 6, 0.6 + rand() * 0.7, pick(HEATHERS));
    };
    const boulder = (x: number, z: number, size: number) => {
      if (kk) model(['rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E'][Math.floor(rand() * 5)], x, z, rand() * 6, size);
      else S.get('rock').push(x, 0.05, z, rand() * 6, size, size * 0.6, size, new Color(PALETTE.stoneDark));
    };

    for (let lane = 0; lane < this.lanes; lane++) {
      const ox = laneOriginX(lane);
      const cx = ox + LANE_W / 2;
      // Side walls: grey stone courses with merlons.
      for (const wx of [ox - 0.25, ox + LANE_W + 0.25]) {
        S.get('box').push(wx, 0, toWorldZ(LANE_H / 2 - 1.5), 0, 0.5, 0.45, LANE_H + 3, PALETTE.stoneDark);
        for (let y = -1; y <= LANE_H + 1; y += 2) S.get('box').push(wx, 0.45, toWorldZ(y), 0, 0.56, 0.2, 0.42, stoneVar());
      }
      // Gatehouse: towers either side of a lintel.
      const gz = toWorldZ(-0.9);
      for (const gx of [ox - 0.3, ox + LANE_W + 0.3]) {
        if (kk) model('tower_A', gx, gz, 0, 1.9);
        else {
          S.get('box').push(gx, 0, gz, 0, 1.5, 2.4, 1.5, stoneVar());
          S.get('cone4').push(gx, 2.65, gz, 0, 2.0, 1.1, 2.0, PALETTE.roofRed);
        }
      }
      S.get('box').push(cx, 2.0, gz, 0, LANE_W + 0.6, 0.5, 0.8, PALETTE.stoneDark);
      S.get('box').push(cx, 1.85, gz, 0, LANE_W - 1, 0.15, 0.12, PALETTE.iron);
      // A croft village around the keep, with stores and clutter.
      const kz = toWorldZ(LANE_H + 3.2);
      if (kk) {
        const spots: [string, number, number, number, number][] = [
          ['home_A', -5.0, 0.6, 0.4, 1.7],
          ['home_B', 5.0, 1.2, -0.5, 1.8],
          [['tavern', 'church', 'blacksmith', 'windmill', 'watermill', 'market'][lane % 6], -4.2, 3.6, 1.2, 2.2],
          ['well', 3.6, 3.8, 0, 0.9],
        ];
        for (const [name, dx, dz, rot, size] of spots) model(name, cx + dx, kz + dz, rot, size);
        for (let i = 0; i < 6; i++) {
          const prop = ['barrel', 'crate_A_big', 'sack', 'resource_lumber', 'resource_stone', 'wheelbarrow'][i];
          model(prop, cx + (rand() < 0.5 ? -1 : 1) * (2.8 + rand() * 1.5), kz - 1.4 + rand() * 1.2, rand() * 6, 0.35 + rand() * 0.3);
        }
      }
      // The glen between this lane and the next: pines, birches, heather, bracken and boulders.
      const gx0 = ox + LANE_W + 0.9;
      const gw = LANE_GAP - 1.8;
      for (let i = 0; i < 13; i++) tree(gx0 + rand() * gw, toWorldZ(-3 + rand() * (LANE_H + 10)), 0.75 + rand() * 0.6);
      for (let i = 0; i < 14; i++) heather(gx0 + rand() * gw, toWorldZ(rand() * (LANE_H + 6)), 4 + Math.floor(rand() * 4), 1.3);
      for (let i = 0; i < 24; i++) pushModel(S, TUFT, gx0 - 0.4 + rand() * (gw + 0.8), 0, toWorldZ(rand() * (LANE_H + 6)), rand() * 6, 0.8 + rand() * 0.6, pick(BRACKEN));
      for (let i = 0; i < 6; i++) boulder(gx0 + rand() * gw, toWorldZ(rand() * (LANE_H + 8)), 0.6 + rand() * 1.0);
    }

    const x0 = worldMinX() - 80;
    const span = worldMaxX() - worldMinX() + 160;
    // Open moor beyond the gates and across the river: heather drifts, bracken and boulders.
    for (let i = 0; i < 420; i++) {
      const x = x0 + rand() * span;
      const z = rand() < 0.6 ? toWorldZ(-4 - rand() * 22) : RIVER_Z1 + 1 + rand() * 16;
      const r = rand();
      if (r < 0.62) heather(x, z, 3 + Math.floor(rand() * 5), 1.6);
      else if (r < 0.85) pushModel(S, TUFT, x, 0, z, rand() * 6, 1 + rand() * 0.6, pick(BRACKEN));
      else boulder(x, z, 0.8 + rand() * 1.8);
    }
    // Pinewoods: scattered stands on the moor and dense woods further out.
    for (let i = 0; i < 520; i++) {
      const x = x0 + rand() * span;
      const far = rand() < 0.55;
      const z = far ? toWorldZ(-14 - rand() * 34) : RIVER_Z1 + 4 + rand() * 28;
      tree(x, z, 1.0 + rand() * 1.3);
    }
    for (let i = 0; i < 120; i++) {
      const x = rand() < 0.5 ? worldMinX() - 2 - rand() * 50 : worldMaxX() + 2 + rand() * 50;
      tree(x, toWorldZ(-5 + rand() * (LANE_H + 12)), 1.0 + rand() * 1.2);
    }
    // Snow-capped mountains ringing the glen.
    if (kk) {
      const peaks = ['mountain_A', 'mountain_B', 'mountain_C'];
      for (let x = x0 - 20; x < x0 + span + 20; x += 14 + rand() * 10) {
        model(peaks[Math.floor(rand() * 3)], x, toWorldZ(-62 - rand() * 26), rand() * 6, 22 + rand() * 18, 'peak');
        if (rand() < 0.5) model(peaks[Math.floor(rand() * 3)], x + 7, RIVER_Z1 + 46 + rand() * 18, rand() * 6, 18 + rand() * 12, 'peak');
      }
      for (const side of [-1, 1]) {
        for (let z = -40; z < 50; z += 12 + rand() * 8) {
          const x = side < 0 ? worldMinX() - 60 - rand() * 25 : worldMaxX() + 60 + rand() * 25;
          model(peaks[Math.floor(rand() * 3)], x, z, rand() * 6, 18 + rand() * 12, 'peak');
        }
      }
    }
    S.end();
    // Ambient motes scattered over the realm.
    this.mote = Array.from({ length: 220 }, () => ({ x: x0 + 80 + rand() * (span - 160), y: 0.3 + rand() * 2.2, z: toWorldZ(-4 + rand() * (LANE_H + 14)), p: rand() * 100 }));
  }

  /** Keeps, banners and motes are drawn per frame: house colours, falls, flicker and wind. */
  update(houses: string[], fallen: boolean[], time: number, glow: number) {
    const key = houses.join();
    if (key !== this.housesKey) {
      this.housesKey = key;
      this.houses = houses.map((h) => new Color(h));
    }
    this.fallen = fallen;
    const kk = assetsReady();
    const K = this.keeps;
    K.begin();
    const burnt = new Color('#2a2624');
    const white = new Color('#ffffff');
    for (let lane = 0; lane < houses.length; lane++) {
      const ox = laneOriginX(lane);
      const cx = ox + LANE_W / 2;
      const kz = toWorldZ(LANE_H + 3.2);
      const down = this.fallen[lane];
      const house = down ? burnt : this.houses[lane];
      const keepTop = kk ? 8.5 : 2.8;
      if (kk) {
        // The castle, or its ruin.
        const name = down ? 'kk:destroyed' : 'kk:castle';
        const s = down ? fitWidth(name, 5.5) : fitWidth(name, 5.2);
        K.get(name as GeoKey, 'atlas').push(cx, 0, kz + 0.4, Math.PI, s, s, s, down ? new Color('#6a6560') : white);
      } else {
        const stone = down ? '#3a3734' : PALETTE.stone;
        const h = down ? 0.9 : 2.8;
        K.get('box').push(cx, 0, kz, 0, 4.2, h, 2.8, stone);
        for (const dx of [-2.6, 2.6]) {
          const th = down ? 1.2 : 3.6;
          K.get('cyl').push(cx + dx, 0, kz - 0.4, 0, 1.4, th, 1.4, stone);
          if (!down) K.get('cone').push(cx + dx, th, kz - 0.4, 0, 1.7, 1.5, 1.7, house);
        }
      }
      if (!down) {
        // The house standard over the keep, and torches at the door.
        const sx = cx + (kk ? 1.6 : 0);
        K.get('cyl').push(sx, keepTop - 2.2, kz, 0, 0.08, 2.6, 0.08, PALETTE.wood);
        K.get('box', 'cloth', false).push(sx + 0.6, keepTop - 0.25, kz, 0, 1.2, 0.85, 0.04, house);
        for (const tx of [-1.1, 1.1]) {
          const flick = 0.9 + Math.sin(time * 13 + lane * 3 + tx) * 0.1;
          K.get('sphere', 'glow', false).push(cx + tx, 1.35, kz - 1.9, 0, 0.18 * flick, 0.26 * flick, 0.18 * flick, PALETTE.fire);
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
          const top = kk ? 4.0 : 3.6;
          K.get('cyl').push(gx, top, toWorldZ(-0.9), 0, 0.05, 1.0, 0.05, PALETTE.woodDark);
          K.get('box', 'cloth', false).push(gx + 0.3, top + 0.65, toWorldZ(-0.9), 0, 0.6, 0.34, 0.03, house);
        }
      }
      // Gate torches.
      for (const gx of [ox - 0.3, ox + LANE_W + 0.3]) {
        const flick = 0.9 + Math.sin(time * 11 + lane + gx) * 0.1;
        K.get('sphere', 'glow', false).push(gx + (gx < cx ? 0.8 : -0.8), 1.6, toWorldZ(-0.1), 0, 0.18 * flick, 0.27 * flick, 0.18 * flick, down ? '#402018' : PALETTE.fire);
      }
    }
    K.end();

    // Motes: drifting snowflakes by day, fireflies-like embers at night.
    const night = Math.min(1, Math.max(0, (glow - 0.6) / 1.1));
    const m = this.motes;
    m.begin();
    const col = new Color().lerpColors(new Color('#e8eef8'), new Color('#ffcf7a'), night);
    for (const d of this.mote) {
      const t = time * 0.4 + d.p;
      const blink = night > 0 ? Math.max(0, Math.sin(t * 2.3 + d.p * 7)) : 0.6;
      const size = (0.03 + night * 0.035) * (0.4 + blink);
      // Snow falls gently and wraps; embers wander.
      const fall = night > 0.5 ? 0 : ((time * 0.35 + d.p) % 3);
      m.push(d.x + Math.sin(t) * 1.2, d.y + 1.2 - fall + Math.sin(t * 1.7) * 0.3, d.z + Math.cos(t * 0.8) * 1.2, 0, size, size, size, col);
    }
    m.end();
  }
}
