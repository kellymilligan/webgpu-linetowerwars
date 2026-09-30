import { Color, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three/webgpu';
import { CREEPS } from '../sim/data/creeps';
import type { GameState } from '../sim/types';
import { Batch } from './batch';
import { AIR_HEIGHT, toWorldX, toWorldZ } from './coords';
import { AIMING, CREEP_MODELS, TOWER_MODELS } from './models';
import { BatchSet, PALETTE, pushModel } from './parts';

const BANDIT = new Color(PALETTE.bandit);
/** Creeps are modelled at roughly human scale against 1-tile towers; bump them up to read at a distance. */
const CREEP_SCALE = 1.45;

/** Renders every tower and creep in all lanes with instanced batches. */
export class Actors {
  readonly towers = new BatchSet();
  readonly creeps = new BatchSet();
  private hpBack = new Batch(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.75 }), 64, false);
  private hpFill = new Batch(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: '#ffffff', depthTest: false }), 64, false);
  private houses: Color[] = [];
  private yaw = new Map<number, number>();
  private aim = new Map<number, number>();
  private m = new Matrix4();
  private q = new Quaternion();
  private v = new Vector3();
  private sc = new Vector3();
  private right = new Vector3();
  private c = new Color();

  constructor() {
    this.hpBack.mesh.renderOrder = 10;
    this.hpFill.mesh.renderOrder = 11;
    this.creeps.group.add(this.hpBack.mesh, this.hpFill.mesh);
  }

  clear() {
    this.yaw.clear();
    this.aim.clear();
  }

  /** Remembers where towers last fired so aiming towers face their targets. */
  noteFire(towerId: number, dx: number, dy: number) {
    this.aim.set(towerId, Math.atan2(dx, dy));
  }

  sync(s: GameState, alpha: number, time: number, camQuat: Quaternion, dt: number) {
    if (this.houses.length !== s.players.length) this.houses = s.players.map((p) => new Color(p.colour));

    // Towers.
    this.towers.begin();
    for (const t of s.towers) {
      const frac = t.hp / t.maxHp;
      const shade = 0.45 + 0.55 * frac;
      const yaw = AIMING.has(t.kind) ? (this.aim.get(t.id) ?? 0) : 0;
      pushModel(this.towers, TOWER_MODELS[t.kind][t.level], toWorldX(t.lane, t.x + 0.5), 0, toWorldZ(t.y + 0.5), yaw, 1, this.houses[t.lane], shade);
    }
    this.towers.end();

    // Creeps.
    this.creeps.begin();
    this.hpBack.begin();
    this.hpFill.begin();
    this.right.set(1, 0, 0).applyQuaternion(camQuat);
    const k = 1 - Math.exp(-dt * 12);
    for (const c of s.creeps) {
      if (c.delay > 0) continue;
      const d = CREEPS[c.kind];
      const lx = c.px + (c.x - c.px) * alpha;
      const ly = c.py + (c.y - c.py) * alpha;
      const mx = c.x - c.px;
      const my = c.y - c.py;
      let yaw = this.yaw.get(c.id);
      const want = mx * mx + my * my > 1e-6 ? Math.atan2(mx, my) : (yaw ?? 0);
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
      pushModel(this.creeps, CREEP_MODELS[c.kind], wx, h, wz, yaw, d.size * CREEP_SCALE, house, shade, c.battering ? time * 14 : pace);

      if (c.hp < c.maxHp) {
        const top = h + (d.air ? 0.5 : 1.0) * d.size * CREEP_SCALE + 0.1;
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
