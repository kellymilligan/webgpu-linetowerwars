import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import type { Blending, BufferGeometry } from 'three/webgpu';
import type { AttackStyle, GameEvent, Projectile } from '../sim/types';
import { AIR_HEIGHT, laneCentreX, toWorldX, toWorldZ } from './coords';
import { LANE_H } from '../sim/data/map';

/**
 * Distinct, readable projectiles per tower: pale arrows, lobbed stones,
 * burning pitch and heavy bolts; plus impacts, deaths, breaches and debris.
 */
const STYLE: Record<AttackStyle, { colour: string; glow: number; geo: BufferGeometry; muzzle: number }> = {
  arrow: { colour: '#e8dcc0', glow: 1.4, geo: new CylinderGeometry(0.02, 0.02, 0.42, 4).rotateX(Math.PI / 2), muzzle: 0.9 },
  stone: { colour: '#6a655e', glow: 0, geo: new IcosahedronGeometry(0.16, 0), muzzle: 0.6 },
  pitch: { colour: '#ff7a2a', glow: 3, geo: new SphereGeometry(0.13, 8, 6), muzzle: 0.9 },
  bolt: { colour: '#cfd6de', glow: 2, geo: new CylinderGeometry(0.035, 0.035, 0.8, 5).rotateX(Math.PI / 2), muzzle: 1.1 },
};

const flashGeo = new SphereGeometry(1, 10, 8);
const ringGeo = new RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2);
const chipGeo = new BoxGeometry(0.09, 0.09, 0.09);
const pillarGeo = new CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, 0.5, 0);

interface Effect {
  obj: Mesh;
  mat: MeshBasicMaterial | MeshStandardMaterial;
  shared: boolean;
  age: number;
  life: number;
  update: (e: Effect, t: number, dt: number) => void;
}

function glowMat(colour: string, intensity = 2.5, opacity = 1) {
  return new MeshBasicMaterial({
    color: new Color(colour).multiplyScalar(intensity),
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

const projMats = new Map<AttackStyle, MeshBasicMaterial | MeshStandardMaterial>();
function projMat(style: AttackStyle) {
  let m = projMats.get(style);
  if (!m) {
    const st = STYLE[style];
    m = st.glow > 0 ? new MeshBasicMaterial({ color: new Color(st.colour).multiplyScalar(st.glow) }) : new MeshStandardMaterial({ color: st.colour, roughness: 0.9 });
    projMats.set(style, m);
  }
  return m;
}
const chipMats = new Map<string, MeshStandardMaterial>();
function chipMat(colour: string) {
  let m = chipMats.get(colour);
  if (!m) chipMats.set(colour, (m = new MeshStandardMaterial({ color: colour, roughness: 1, transparent: true })));
  return m;
}

const TOWER_Y = 1.1;
const GROUND_HIT_Y = 0.3;
const MAX_EFFECTS = 600;

export class Vfx {
  readonly group = new Group();
  private effects: Effect[] = [];
  private projectiles = new Map<number, { mesh: Mesh; trail: Mesh[]; style: AttackStyle }>();
  private tmpA = new Vector3();
  /** The player's own lane, which gets the full treatment when busy. */
  focusLane = 0;
  private lastPillar = new Map<number, number>();

  clear() {
    for (const e of this.effects) if (!e.shared) e.mat.dispose();
    this.effects = [];
    this.projectiles.clear();
    this.group.clear();
  }

  private p(lane: number, x: number, y: number, h: number) {
    return new Vector3(toWorldX(lane, x), h, toWorldZ(y));
  }

  handle(events: GameEvent[], busy: boolean) {
    for (const e of events) {
      // Under heavy load, only spend effects on the player's own lane.
      if (busy && 'lane' in e && e.lane !== this.focusLane && e.type !== 'leak' && e.type !== 'towerDestroyed') continue;
      switch (e.type) {
        case 'fire':
          this.flash(this.p(e.lane, e.x, e.y, TOWER_Y + 0.2), STYLE[e.style].colour, 0.12 * STYLE[e.style].muzzle, 0.1, 1.2);
          break;
        case 'hit':
          if (e.style === 'stone') {
            this.ring(this.p(e.lane, e.x, e.y, 0.06), e.splash, '#8a7a62', 0.45, 1, NormalBlending);
            this.chips(this.p(e.lane, e.x, e.y, 0.2), '#5e5347', 7, 2.5);
          } else if (e.style === 'pitch') {
            this.ring(this.p(e.lane, e.x, e.y, 0.05), e.splash, '#ff6a1a', 0.7, 1.4);
            this.flash(this.p(e.lane, e.x, e.y, 0.25), '#ff7a2a', 0.45, 0.35, 1.6);
          } else if (e.style === 'bolt') {
            this.flash(this.p(e.lane, e.x, e.y, e.air ? AIR_HEIGHT : GROUND_HIT_Y + 0.1), '#dfe8f0', 0.3, 0.16, 1.8);
          } else {
            this.flash(this.p(e.lane, e.x, e.y, e.air ? AIR_HEIGHT : GROUND_HIT_Y + 0.1), '#f0e2c0', 0.14, 0.12, 1.2);
          }
          break;
        case 'death':
          this.chips(this.p(e.lane, e.x, e.y, e.air ? AIR_HEIGHT : 0.3), e.air ? '#141414' : '#5a1f1a', e.kind === 'warlord' || e.kind === 'ram' ? 26 : 9, 3);
          break;
        case 'batter':
          this.chips(this.p(e.lane, (e.x + 0.5 + e.cx) / 2, (e.y + 0.5 + e.cy) / 2, 0.5), '#6e4b2f', 4, 2);
          this.flash(this.p(e.lane, (e.x + 0.5 + e.cx) / 2, (e.y + 0.5 + e.cy) / 2, 0.5), '#ffd29a', 0.16, 0.12, 1.4);
          break;
        case 'towerDestroyed':
          this.chips(this.p(e.lane, e.x + 0.5, e.y + 0.5, 0.6), '#6b655c', 22, 4);
          this.ring(this.p(e.lane, e.x + 0.5, e.y + 0.5, 0.05), 1.4, '#9a8a70', 0.6, 1, NormalBlending);
          break;
        case 'built':
          this.ring(this.p(e.lane, e.x + 0.5, e.y + 0.5, 0.04), 0.8, '#b8a888', 0.4, 0.8, NormalBlending);
          break;
        case 'upgraded':
          this.ring(this.p(e.lane, e.x + 0.5, e.y + 0.5, 0.05), 1.1, '#ffd27a', 0.6, 1.4);
          break;
        case 'sold':
          this.chips(this.p(e.lane, e.x + 0.5, e.y + 0.5, 0.3), '#6e4b2f', 8, 2);
          break;
        case 'heal':
          this.ring(this.p(e.lane, e.x, e.y, 0.08), e.radius, '#e8d77a', 0.7, 0.8);
          break;
        case 'leak': {
          // One pillar per keep at a time; a flood of leaks shouldn't stack into a column.
          const now = performance.now();
          if (now - (this.lastPillar.get(e.lane) ?? 0) > 400) {
            this.lastPillar.set(e.lane, now);
            this.pillar(laneCentreX(e.lane), toWorldZ(LANE_H + 1), '#ff3b2a');
          }
          break;
        }
      }
    }
  }

  private add(obj: Mesh, mat: Effect['mat'], life: number, update: Effect['update'], shared = false) {
    if (this.effects.length > MAX_EFFECTS) {
      if (!shared) mat.dispose();
      return;
    }
    this.group.add(obj);
    this.effects.push({ obj, mat, shared, age: 0, life, update });
  }

  private flash(at: Vector3, colour: string, size: number, life: number, intensity: number) {
    const mat = glowMat(colour, intensity);
    const m = new Mesh(flashGeo, mat);
    m.position.copy(at);
    this.add(m, mat, life, (e, t) => {
      e.obj.scale.setScalar(size * (0.5 + t));
      e.mat.opacity = 1 - t;
    });
  }

  private ring(at: Vector3, radius: number, colour: string, life: number, intensity: number, blending: Blending = AdditiveBlending) {
    const mat = glowMat(colour, intensity);
    mat.blending = blending;
    const m = new Mesh(ringGeo, mat);
    m.position.copy(at);
    this.add(m, mat, life, (e, t) => {
      e.obj.scale.setScalar(Math.max(0.05, radius * (0.3 + 0.7 * Math.sqrt(t))));
      e.mat.opacity = (1 - t) * 0.8;
    });
  }

  private pillar(x: number, z: number, colour: string) {
    const mat = glowMat(colour, 2, 0.6);
    const m = new Mesh(pillarGeo, mat);
    m.position.set(x, 0, z);
    this.add(m, mat, 0.9, (e, t) => {
      e.obj.scale.set(1.2 + t * 2, 6 * (1 - t * 0.5), 1.2 + t * 2);
      e.mat.opacity = 0.6 * (1 - t);
    });
  }

  private chips(at: Vector3, colour: string, count: number, power: number) {
    const mat = chipMat(colour);
    for (let i = 0; i < count; i++) {
      const m = new Mesh(chipGeo, mat);
      m.position.copy(at);
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * power;
      const vel = new Vector3(Math.cos(a) * sp, 1.5 + Math.random() * power, Math.sin(a) * sp);
      this.add(
        m,
        mat,
        0.8,
        (e, t, dt) => {
          vel.y -= 12 * dt;
          e.obj.position.addScaledVector(vel, dt);
          if (e.obj.position.y < 0.04) {
            e.obj.position.y = 0.04;
            vel.set(vel.x * 0.4, 0, vel.z * 0.4);
          }
          e.obj.rotation.x += dt * 9;
          e.obj.scale.setScalar(1 - t * t);
        },
        true,
      );
    }
  }

  syncProjectiles(list: Projectile[], alpha: number) {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let v = this.projectiles.get(p.id);
      if (!v) {
        const mesh = new Mesh(STYLE[p.style].geo, projMat(p.style));
        mesh.castShadow = p.style === 'stone';
        const trail: Mesh[] = [];
        if (p.style === 'pitch' || p.style === 'bolt') {
          for (let i = 0; i < 3; i++) {
            const t = new Mesh(STYLE[p.style].geo, projMat(p.style));
            t.scale.setScalar(0.75 - i * 0.2);
            trail.push(t);
            this.group.add(t);
          }
        }
        v = { mesh, trail, style: p.style };
        this.projectiles.set(p.id, v);
        this.group.add(mesh);
        const start = this.p(p.lane, p.sx, p.sy, TOWER_Y);
        mesh.position.copy(start);
        for (const t of trail) t.position.copy(start);
      }
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      // Height: lobbed shots arc over their full flight; direct shots ease to the target height.
      const total = Math.hypot(p.tx - p.sx, p.ty - p.sy) || 1;
      const done = Math.min(1, Math.hypot(x - p.sx, y - p.sy) / total);
      const endH = p.air ? AIR_HEIGHT : GROUND_HIT_Y;
      let h = TOWER_Y + (endH - TOWER_Y) * done;
      if (!p.homing) h += 4 * done * (1 - done) * Math.min(2.2, total * 0.4);
      const prev = this.tmpA.copy(v.mesh.position);
      v.mesh.position.copy(this.p(p.lane, x, y, h));
      const dir = prev.sub(v.mesh.position).negate();
      if (dir.lengthSq() > 1e-6) v.mesh.lookAt(dir.add(v.mesh.position));
      for (let i = v.trail.length - 1; i >= 0; i--) {
        const target = i === 0 ? v.mesh.position : v.trail[i - 1].position;
        v.trail[i].position.lerp(target, 0.5);
      }
    }
    for (const [id, v] of this.projectiles) {
      if (!seen.has(id)) {
        this.group.remove(v.mesh);
        for (const t of v.trail) this.group.remove(t);
        this.projectiles.delete(id);
      }
    }
  }

  update(dt: number) {
    const alive: Effect[] = [];
    for (const e of this.effects) {
      e.age += dt;
      const t = Math.min(1, e.age / e.life);
      e.update(e, t, dt);
      if (t >= 1) {
        this.group.remove(e.obj);
        if (!e.shared) e.mat.dispose();
      } else alive.push(e);
    }
    this.effects = alive;
  }

  get count() {
    return this.effects.length;
  }
}
