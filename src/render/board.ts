import { Color, Group, Mesh, MeshStandardNodeMaterial, PlaneGeometry, Vector3 } from 'three/webgpu';
import { float, fract, mix, mx_noise_float, positionWorld, smoothstep, uniform, vec3 } from 'three/tsl';
import { GATE_ROWS, KEEP_ROWS, LANE_H, LANE_W } from '../sim/data/map';
import { laneOriginX, LANE_GAP, toWorldZ, WORLD_MAX_X, WORLD_MIN_X } from './coords';
import { BatchSet, PALETTE, part, pushModel } from './parts';
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

const PINE: Part[] = [
  part('cyl', 'woodDark', [0, 0, 0], [0.16, 0.5, 0.16]),
  part('cone', 'house', [0, 0.35, 0], [1.1, 1.3, 1.1]),
  part('cone', 'house', [0, 1.0, 0], [0.85, 1.1, 0.85]),
  part('cone', 'house', [0, 1.55, 0], [0.55, 0.9, 0.55]),
];
const DEAD_TREE: Part[] = [
  part('cyl', 'woodDark', [0, 0, 0], [0.14, 1.6, 0.14]),
  part('cyl', 'woodDark', [0.2, 1.0, 0], [0.07, 0.8, 0.07], [0, 0, -0.8]),
  part('cyl', 'woodDark', [-0.15, 1.2, 0], [0.06, 0.6, 0.06], [0, 0, 0.9]),
];

/**
 * Terrain and fixed architecture: a mottled moor, eight walled roads, a gate
 * at the head of each and a keep at its foot, with pines and rocks between.
 */
export class Board {
  readonly group = new Group();
  readonly statics = new BatchSet();
  readonly gridOpacity = uniform(0.35);
  /** Grass tint as a vec3 uniform (colour uniforms don't type-check with vec3 maths). */
  readonly grass = uniform(new Vector3(0.23, 0.25, 0.19));
  private keeps = new BatchSet();
  private fallen: boolean[] = [];
  private houses: Color[] = [];

  constructor() {
    // Ground: mottled moorland.
    const groundMat = new MeshStandardNodeMaterial({ roughness: 1 });
    const n = mx_noise_float(positionWorld.xz.mul(0.09)).mul(0.5).add(0.5);
    const n2 = mx_noise_float(positionWorld.xz.mul(0.5)).mul(0.5).add(0.5);
    groundMat.colorNode = mix(this.grass.mul(0.7), this.grass.mul(1.15), n.mul(0.7).add(n2.mul(0.3)));
    const ground = new Mesh(new PlaneGeometry(WORLD_MAX_X - WORLD_MIN_X + 120, LANE_H + 100).rotateX(-Math.PI / 2), groundMat);
    ground.position.set((WORLD_MIN_X + WORLD_MAX_X) / 2, -0.02, 0);
    ground.receiveShadow = true;
    this.group.add(ground);

    // Road beds with a faint build grid.
    const roadMat = new MeshStandardNodeMaterial({ roughness: 0.95 });
    const p = positionWorld.xz;
    const mud = mix(vec3(0.075, 0.06, 0.045), vec3(0.13, 0.105, 0.08), mx_noise_float(p.mul(0.8)).mul(0.5).add(0.5));
    const f = fract(p);
    const edge = f.x.min(f.y).min(float(1).sub(f.x)).min(float(1).sub(f.y));
    const line = float(1).sub(smoothstep(0.0, 0.04, edge));
    roadMat.colorNode = mix(mud, vec3(0.3, 0.27, 0.22), line.mul(this.gridOpacity));
    const cobbleMat = new MeshStandardNodeMaterial({ roughness: 0.9 });
    cobbleMat.colorNode = mix(vec3(0.07, 0.068, 0.065), vec3(0.14, 0.135, 0.13), mx_noise_float(p.mul(2.2)).mul(0.5).add(0.5));

    const bedH = LANE_H - GATE_ROWS - KEEP_ROWS;
    for (let lane = 0; lane < 8; lane++) {
      const ox = laneOriginX(lane);
      const bed = new Mesh(new PlaneGeometry(LANE_W, bedH).rotateX(-Math.PI / 2), roadMat);
      bed.position.set(ox + LANE_W / 2, 0.005, toWorldZ(GATE_ROWS + bedH / 2));
      bed.receiveShadow = true;
      const gate = new Mesh(new PlaneGeometry(LANE_W, GATE_ROWS).rotateX(-Math.PI / 2), cobbleMat);
      gate.position.set(ox + LANE_W / 2, 0.006, toWorldZ(GATE_ROWS / 2));
      gate.receiveShadow = true;
      const keep = new Mesh(new PlaneGeometry(LANE_W, KEEP_ROWS + 5).rotateX(-Math.PI / 2), cobbleMat);
      keep.position.set(ox + LANE_W / 2, 0.006, toWorldZ(LANE_H - KEEP_ROWS + (KEEP_ROWS + 5) / 2));
      keep.receiveShadow = true;
      this.group.add(bed, gate, keep);
    }
    this.group.add(this.statics.group, this.keeps.group);
    this.buildStatics();
  }

  private buildStatics() {
    const S = this.statics;
    S.begin();
    const white = new Color('#ffffff');
    const rand = mulberry(7);
    for (let lane = 0; lane < 8; lane++) {
      const ox = laneOriginX(lane);
      // Side walls with posts.
      for (const wx of [ox - 0.25, ox + LANE_W + 0.25]) {
        S.get('box').push(wx, 0, toWorldZ(LANE_H / 2 - 1.5), 0, 0.5, 0.45, LANE_H + 3, PALETTE.stoneDark);
        for (let y = -1; y <= LANE_H + 1; y += 2) S.get('box').push(wx, 0.45, toWorldZ(y), 0, 0.56, 0.18, 0.4, PALETTE.stone);
      }
      // Gate: two squat towers and a lintel.
      const gz = toWorldZ(-0.9);
      for (const gx of [ox - 0.3, ox + LANE_W + 0.3]) {
        S.get('box').push(gx, 0, gz, 0, 1.5, 2.4, 1.5, PALETTE.stone);
        S.get('box').push(gx, 2.4, gz, 0, 1.7, 0.25, 1.7, PALETTE.stoneDark);
      }
      S.get('box').push(ox + LANE_W / 2, 2.0, gz, 0, LANE_W + 0.6, 0.5, 0.8, PALETTE.stoneDark);
      S.get('box').push(ox + LANE_W / 2, 1.85, gz, 0, LANE_W - 1, 0.15, 0.12, PALETTE.iron);
      // Scatter: pines, dead trees and rocks in the gap to the right of this lane.
      const gx0 = ox + LANE_W + 0.9;
      const gw = LANE_GAP - 1.8;
      for (let i = 0; i < 26; i++) {
        const x = gx0 + rand() * gw;
        const z = toWorldZ(-3 + rand() * (LANE_H + 12));
        const r = rand();
        if (r < 0.62) pushModel(S, PINE, x, 0, z, rand() * 6, 0.6 + rand() * 0.8, new Color().setHSL(0.28 + rand() * 0.06, 0.25, 0.14 + rand() * 0.06));
        else if (r < 0.75) pushModel(S, DEAD_TREE, x, 0, z, rand() * 6, 0.8 + rand() * 0.5, white);
        else S.get('rock').push(x, 0.05, z, rand() * 6, 0.4 + rand() * 0.7, 0.3 + rand() * 0.4, 0.4 + rand() * 0.7, new Color(PALETTE.stoneDark).multiplyScalar(0.8 + rand() * 0.4));
      }
    }
    // Forest fringe beyond the play area.
    for (let i = 0; i < 700; i++) {
      const x = WORLD_MIN_X - 40 + rand() * (WORLD_MAX_X - WORLD_MIN_X + 80);
      const far = rand() < 0.5;
      const z = far ? toWorldZ(-6 - rand() * 30) : toWorldZ(LANE_H + 9 + rand() * 30);
      pushModel(S, PINE, x, 0, z, rand() * 6, 0.8 + rand() * 1.2, new Color().setHSL(0.27 + rand() * 0.07, 0.22, 0.1 + rand() * 0.06));
    }
    for (let i = 0; i < 90; i++) {
      const x = rand() < 0.5 ? WORLD_MIN_X - rand() * 30 : WORLD_MAX_X + rand() * 30;
      pushModel(S, PINE, x, 0, toWorldZ(-5 + rand() * (LANE_H + 10)), rand() * 6, 0.8 + rand() * 1.2, new Color().setHSL(0.27 + rand() * 0.07, 0.22, 0.1 + rand() * 0.06));
    }
    S.end();
  }

  /** Keeps are drawn per frame so they can show their house colour and fall. */
  update(houses: string[], fallen: boolean[], time: number) {
    if (this.houses.length !== houses.length) this.houses = houses.map((h) => new Color(h));
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
        K.get('box').push(cx, 0, kz - 1.45, 0, 1.4, 1.6, 0.1, PALETTE.woodDark);
      }
      for (const dx of [-2.6, 2.6]) {
        const th = down ? 1.2 : 3.6;
        K.get('cyl').push(cx + dx, 0, kz - 0.4, 0, 1.4, th, 1.4, stone);
        if (!down) K.get('cone').push(cx + dx, th, kz - 0.4, 0, 1.7, 1.5, 1.7, house);
      }
      if (!down) {
        // House banner on a tall pole, and torches either side of the door.
        K.get('cyl').push(cx, h, kz, 0, 0.08, 2.2, 0.08, PALETTE.wood);
        K.get('box').push(cx + 0.45, h + 1.2, kz, 0, 0.85, 0.9 + Math.sin(time * 2 + lane) * 0.03, 0.04, house);
        for (const tx of [-1.0, 1.0]) {
          const flick = 0.9 + Math.sin(time * 13 + lane * 3 + tx) * 0.1;
          K.get('sphere', 'glow', false).push(cx + tx, 1.35, kz - 1.5, 0, 0.18 * flick, 0.26 * flick, 0.18 * flick, PALETTE.fire);
        }
      }
      // Gate torches.
      for (const gx of [ox - 0.3, ox + LANE_W + 0.3]) {
        const flick = 0.9 + Math.sin(time * 11 + lane + gx) * 0.1;
        K.get('sphere', 'glow', false).push(gx, 2.75, toWorldZ(-0.1), 0, 0.2 * flick, 0.3 * flick, 0.2 * flick, down ? '#402018' : PALETTE.fire);
      }
    }
    K.end();
  }
}
