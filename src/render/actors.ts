import { Color, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three/webgpu';
import { CREEPS } from '../sim/data/creeps';
import type { CreepKind, GameState, TowerKind } from '../sim/types';
import { assetsReady, CHAR_FRAMES, charTex, fitHeight } from './assets';
import { Batch } from './batch';
import { AIR_HEIGHT, toWorldX, toWorldZ } from './coords';
import { LANE_W } from '../sim/data/map';
import { AIMING, CREEP_MODELS, TOWER_MODELS } from './models';
import { BatchSet, PALETTE, pushModel } from './parts';
import type { GeoKey, Part } from './parts';

const BANDIT = new Color(PALETTE.bandit);
const WIGHT = new Color('#7d889a');
const FIRE = new Color(PALETTE.fire);

/** Top of a grey-box model (its parts all stand on their base). */
const topCache = new Map<readonly Part[], number>();
function topOf(parts: readonly Part[]) {
  let t = topCache.get(parts);
  if (t === undefined) {
    t = Math.max(...parts.map((p) => p.p[1] + (p.g === 'sphere' ? p.s[1] / 2 : p.s[1])));
    topCache.set(parts, t);
  }
  return t;
}

/** Which baked KayKit character plays each creep, and how tall it stands (world units; a tile is 1). */
interface CharPick {
  name: string;
  height: number;
  run?: boolean;
}
const SEND_CHARS: Partial<Record<CreepKind, CharPick>> = {
  levy: { name: 'levy', height: 0.9 },
  footman: { name: 'footman', height: 1.0 },
  shieldbearer: { name: 'shieldbearer', height: 1.08 },
  outrider: { name: 'outrider', height: 0.95, run: true },
  friar: { name: 'friar', height: 1.05 },
  knight: { name: 'knight', height: 1.25, run: true },
  warlord: { name: 'warlord', height: 1.9 },
};
/** Neutral raiders are the dead walking down from the north. */
const RAIDER_CHARS: Partial<Record<CreepKind, CharPick>> = {
  levy: { name: 'wight', height: 0.9 },
  footman: { name: 'wightWarrior', height: 1.05 },
  shieldbearer: { name: 'wightWarrior', height: 1.15 },
  outrider: { name: 'wightRunner', height: 0.95, run: true },
};
/** Creeps are modelled at roughly human scale against 1-tile towers; bump them up to read at a distance. */
const CREEP_SCALE = 1.7;

/** Renders every tower and creep in all lanes with instanced batches. */
export class Actors {
  readonly towers = new BatchSet();
  readonly creeps = new BatchSet();
  /** Towers you've ordered in multiplayer, shown until the server's turn confirms them. */
  private ghostMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.4, depthWrite: false });
  readonly ghosts = new BatchSet(this.ghostMat);
  private hpBack = new Batch(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.75 }), 64, false);
  private hpFill = new Batch(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: '#ffffff', depthTest: false }), 64, false);
  private houses: Color[] = [];
  private housesKey = '';
  private yaw = new Map<number, number>();
  private aim = new Map<number, number>();
  private m = new Matrix4();
  private q = new Quaternion();
  private v = new Vector3();
  private sc = new Vector3();
  private right = new Vector3();
  private c = new Color();
  private tmpWhite = new Color('#ffffff');

  constructor() {
    this.hpBack.mesh.renderOrder = 10;
    this.hpFill.mesh.renderOrder = 11;
    this.creeps.group.add(this.hpBack.mesh, this.hpFill.mesh);
  }

  clear() {
    this.yaw.clear();
    this.aim.clear();
  }

  syncGhosts(list: { lane: number; x: number; y: number; kind: TowerKind }[], time: number, colour: string) {
    this.ghosts.begin();
    const c = new Color(colour).lerp(new Color('#ffffff'), 0.5);
    for (const g of list) pushModel(this.ghosts, TOWER_MODELS[g.kind][0], toWorldX(g.lane, g.x + 0.5), 0, toWorldZ(g.y + 0.5), 0, 1, c);
    this.ghosts.end();
    this.ghostMat.opacity = 0.3 + Math.sin(time * 8) * 0.12;
  }

  /** A small flickering flame at (x, y, z) with a pool of light on the ground beneath. */
  private torch(set: BatchSet, x: number, y: number, z: number, size: number, seed: number, pool: number) {
    const t = performance.now() / 1000;
    const f = 0.82 + Math.sin(t * 14 + seed * 1.7) * 0.1 + Math.sin(t * 27.3 + seed) * 0.08;
    set.get('cone', 'ember', false).push(x, y, z, seed, size * 0.8 * f, size * 1.8 * f, size * 0.8 * f, this.c.setScalar(f));
    set.get('sphere', 'ember', false).push(x, y + size * 0.3, z, 0, size, size * 0.7, size, this.c.setScalar(0.5 * f));
    set.get('pg:card', 'pool', false).push(x, 0.035, z, 0, pool * 2 * f, 1, pool * 2 * f, this.c.copy(FIRE).multiplyScalar(0.8 * f));
  }

  /** Remembers where towers last fired so aiming towers face their targets. */
  noteFire(towerId: number, dx: number, dy: number) {
    // Lane rows run toward −z, so a lane-space direction (dx, dy) faces world (dx, −dy).
    this.aim.set(towerId, Math.atan2(dx, -dy));
  }

  /**
   * Visible world-x window and level of detail, set by the scene each frame.
   * Lanes outside the window are skipped; far away, cheap primitives replace the detailed models.
   */
  view = { minX: -Infinity, maxX: Infinity, detailed: true };

  private laneVisible(lane: number) {
    const x0 = toWorldX(lane, 0);
    return x0 + LANE_W > this.view.minX && x0 < this.view.maxX;
  }

  sync(s: GameState, alpha: number, time: number, camQuat: Quaternion, dt: number) {
    // Re-read colours when they change (e.g. a multiplayer snapshot replaces the lobby's placeholder realm).
    // Heraldry is muted and darkened to sit in the bleak world; enough remains to tell houses apart.
    const key = s.players.map((p) => p.colour).join();
    if (key !== this.housesKey) {
      this.housesKey = key;
      this.houses = s.players.map((p) => new Color(p.colour).lerp(new Color('#505050'), 0.3).multiplyScalar(0.8));
    }

    // Towers.
    this.towers.begin();
    for (const t of s.towers) {
      if (!this.laneVisible(t.lane)) continue;
      const frac = t.hp / t.maxHp;
      // Damage darkens a tower; a small per-tower variation keeps rows of the same kind from looking cloned.
      const shade = (0.45 + 0.55 * frac) * (0.93 + ((t.id * 37) % 11) / 100);
      const yaw = AIMING.has(t.kind) ? (this.aim.get(t.id) ?? 0) : 0;
      const tx = toWorldX(t.lane, t.x + 0.5);
      const tz = toWorldZ(t.y + 0.5);
      const model = TOWER_MODELS[t.kind][t.level];
      pushModel(this.towers, model, tx, 0, tz, yaw, 1, this.houses[t.lane], shade);
      // A torch burns on the face toward the plain; its light pools on the ground.
      if (t.kind !== 'palisade' && this.view.detailed) {
        const h = topOf(model) * 0.62;
        this.torch(this.towers, tx + 0.18, h, tz + 0.5, 0.11, t.id, 1.8);
      }
    }
    this.towers.end();

    // Creeps.
    this.creeps.begin();
    this.hpBack.begin();
    this.hpFill.begin();
    this.right.set(1, 0, 0).applyQuaternion(camQuat);
    const k = 1 - Math.exp(-dt * 12);
    for (const c of s.creeps) {
      if (c.delay > 0 || !this.laneVisible(c.lane)) continue;
      const d = CREEPS[c.kind];
      const lx = c.px + (c.x - c.px) * alpha;
      const ly = c.py + (c.y - c.py) * alpha;
      const mx = c.x - c.px;
      const my = c.y - c.py;
      let yaw = this.yaw.get(c.id);
      const want = mx * mx + my * my > 1e-6 ? Math.atan2(mx, -my) : (yaw ?? 0);
      if (yaw === undefined) yaw = want;
      else {
        let dd = want - yaw;
        while (dd > Math.PI) dd -= Math.PI * 2;
        while (dd < -Math.PI) dd += Math.PI * 2;
        yaw += dd * k;
      }
      this.yaw.set(c.id, yaw);
      const wx = toWorldX(c.lane, lx);
      const wz = toWorldZ(ly);
      const h = d.air ? AIR_HEIGHT + Math.sin(time * 3 + c.id) * 0.08 : 0;
      const house = c.owner >= 0 ? this.houses[c.owner] : BANDIT;
      const pace = d.air ? time * 14 + c.id : time * 9 * d.speed + c.id;
      // Hit flash: freshly burning creeps glow a little.
      const shade = c.burnTicks > 0 ? 1.25 : 1;
      const char = assetsReady() && this.view.detailed ? (c.owner < 0 ? RAIDER_CHARS : SEND_CHARS)[c.kind] : undefined;
      let height = (d.air ? 0.5 : 1.0) * d.size * CREEP_SCALE;
      if (char) {
        // A KayKit character on its baked walk cycle, faintly tinted, on a house-coloured disc.
        height = char.height;
        const rate = CHAR_FRAMES * d.speed * (char.run ? 0.42 : 0.6);
        const frame = Math.floor(time * rate + c.id * 0.61) % CHAR_FRAMES;
        const key = `kc:${char.name}:${frame}` as GeoKey;
        const sc = fitHeight(`kc:${char.name}`, char.height);
        // Near-silhouettes: the character material is drained and darkened; a hint of house colour remains.
        this.c.copy(c.owner < 0 ? WIGHT : this.tmpWhite.setScalar(0.85).lerp(house, 0.3));
        this.tmpWhite.set('#ffffff');
        if (shade !== 1) this.c.multiplyScalar(shade);
        // No shadows from characters: from this steep camera they're barely visible, and they're the costliest casters.
        this.creeps.get(key, `char:${charTex(key)}`, false).push(wx, h, wz, yaw, sc, sc, sc, this.c);
        const disc = 0.28 * Math.max(1, char.height);
        this.creeps.get('cyl').push(wx, 0.015, wz, 0, disc, 0.03, disc, c.owner < 0 ? '#14171f' : house);
        // Every third invader, and every knight and warlord, carries a torch in the right hand.
        if (c.owner >= 0 && (c.id % 3 === 0 || c.kind === 'knight' || c.kind === 'warlord')) {
          const rx = -Math.cos(yaw);
          const rz = Math.sin(yaw);
          const fx = Math.sin(yaw);
          const fz = Math.cos(yaw);
          const hx = wx + rx * 0.22 * char.height + fx * 0.12;
          const hz = wz + rz * 0.22 * char.height + fz * 0.12;
          this.creeps.get('cyl').push(hx, char.height * 0.45, hz, 0, 0.035, char.height * 0.42, 0.035, PALETTE.woodDark, 0.25);
          this.torch(this.creeps, hx, char.height * 0.9, hz, 0.13, c.id, 2.0);
        }
      } else {
        pushModel(this.creeps, CREEP_MODELS[c.kind], wx, h, wz, yaw, d.size * CREEP_SCALE, house, shade, c.battering ? time * 14 : pace);
      }

      if (c.hp < c.maxHp) {
        const top = h + height + 0.12;
        const w = 0.5 * Math.max(0.8, d.size);
        const frac = Math.max(0, c.hp / c.maxHp);
        this.v.set(wx, top, wz);
        this.q.copy(camQuat);
        this.m.compose(this.v, this.q, this.sc.set(w + 0.04, 0.1, 1));
        this.hpBack.pushMatrix(this.m, this.c.set('#140f0d'));
        this.v.addScaledVector(this.right, (-(1 - frac) * w) / 2);
        this.m.compose(this.v, this.q, this.sc.set(w * frac, 0.06, 1));
        this.hpFill.pushMatrix(this.m, this.c.set(frac > 0.5 ? '#9fd36a' : frac > 0.25 ? '#e0b43c' : '#d9573b'));
      }
    }
    this.creeps.end();
    this.hpBack.end();
    this.hpFill.end();
    if (this.yaw.size > s.creeps.length * 2 + 64) {
      const live = new Set(s.creeps.map((c) => c.id));
      for (const id of this.yaw.keys()) if (!live.has(id)) this.yaw.delete(id);
    }
  }
}
