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
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import type { BufferGeometry } from 'three/webgpu';
import type { AttackStyle, GameEvent, Projectile } from '../sim/types';
import { AIR_HEIGHT, toWorldX, toWorldZ } from './coords';

export const STYLE_COLOURS: Record<AttackStyle, string> = {
  ember: '#ff6a2a',
  frost: '#8fdcff',
  venom: '#6dff6a',
  lightning: '#ffe066',
  prism: '#ffffff',
  comet: '#c38bff',
  pulse: '#ffc4f2',
  needle: '#5cf0ff',
};

const GEM_Y = 0.75;
const GROUND_HIT_Y = 0.35;

const beamGeo = new CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
const flashGeo = new SphereGeometry(1, 12, 8);
const ringGeo = new RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2);
const shardGeo = new BoxGeometry(0.08, 0.08, 0.08);
const projGeos: Record<AttackStyle, BufferGeometry> = {
  ember: new IcosahedronGeometry(0.12, 0),
  frost: new OctahedronGeometry(0.1, 0).scale(0.6, 0.6, 2.4),
  venom: new SphereGeometry(0.09, 8, 6),
  lightning: new SphereGeometry(0.08, 6, 4),
  prism: new OctahedronGeometry(0.1, 0),
  comet: new SphereGeometry(0.13, 10, 8),
  pulse: new IcosahedronGeometry(0.1, 1),
  needle: new CylinderGeometry(0.025, 0.025, 0.35, 5).rotateX(Math.PI / 2),
};

interface Effect {
  obj: Mesh;
  mat: MeshBasicMaterial;
  age: number;
  life: number;
  update: (e: Effect, t: number, dt: number) => void;
}

function glowMat(colour: string, intensity = 3, opacity = 1) {
  return new MeshBasicMaterial({
    color: new Color(colour).multiplyScalar(intensity),
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

const projMats = new Map<AttackStyle, MeshBasicMaterial>();
function projMat(style: AttackStyle) {
  let m = projMats.get(style);
  if (!m) projMats.set(style, (m = glowMat(STYLE_COLOURS[style], 4)));
  return m;
}

const UP = new Vector3(0, 1, 0);

export class Vfx {
  readonly group = new Group();
  private effects: Effect[] = [];
  private projectiles = new Map<number, { mesh: Mesh; trail: Mesh[] }>();
  private tmpA = new Vector3();
  private tmpB = new Vector3();
  private q = new Quaternion();

  clear() {
    for (const e of this.effects) e.mat.dispose();
    this.effects = [];
    this.projectiles.clear();
    this.group.clear();
  }

  handle(events: GameEvent[], glow: number) {
    const boost = 0.6 + glow * 0.5;
    for (const e of events) {
      switch (e.type) {
        case 'fire':
          if (e.instant && e.style !== 'lightning') {
            this.beam(this.p(e.x, e.y, GEM_Y), this.p(e.tx, e.ty, e.air ? AIR_HEIGHT : GROUND_HIT_Y), e.style, e.crit ? 0.07 : 0.04, boost * (e.crit ? 2 : 1));
          } else if (e.instant) {
            this.lightning([e.x, e.y, e.tx, e.ty], e.air, e.style, boost);
          }
          if (e.style === 'pulse' && e.instant) this.ring(e.x, e.y, 0.05, 3, e.style, 0.5, boost);
          break;
        case 'chain':
          this.lightning(e.points, false, e.style, boost);
          break;
        case 'hit':
          this.flash(e.x, e.y, e.air, e.style, e.crit ? 0.45 : 0.22, boost * (e.crit ? 1.8 : 1));
          if (e.splash > 0) this.ring(e.x, e.y, e.air ? AIR_HEIGHT - 0.3 : 0.06, e.splash, e.style, 0.35, boost);
          break;
        case 'death':
          this.burst(e.x, e.y, e.air, e.archetype === 'wisp' ? '#ffe28a' : '#e8f0d8', e.archetype === 'colossus' || e.archetype === 'mothQueen' ? 40 : 12);
          break;
        case 'placed':
          this.ring(e.gem.x + 0.5, e.gem.y + 0.5, 0.05, 0.9, 'prism', 0.5, 0.5);
          break;
        case 'miss':
          this.ring(e.x, e.y, e.air ? AIR_HEIGHT : 0.3, 0.45, 'prism', 0.25, 0.4);
          break;
        case 'heal':
          this.ring(e.x, e.y, 0.08, e.radius, 'venom', 0.6, 0.7);
          break;
        case 'blink':
          this.flash(e.fromX, e.fromY, false, 'needle', 0.3, 0.8);
          this.flash(e.x, e.y, false, 'needle', 0.35, 1);
          break;
        case 'burrow':
          this.burst(e.x, e.y, false, '#8a7a5a', 8);
          break;
        case 'shieldBreak':
          this.burst(e.x, e.y, e.air, '#bfe8ff', 16);
          break;
        case 'boardAction':
          this.ring(e.x + 0.5, e.y + 0.5, 0.06, 1.6, 'lightning', 0.8, 1.2);
          this.flash(e.x + 0.5, e.y + 0.5, false, 'prism', 0.6, 1.2);
          for (const st of e.stones) this.burst(st.x + 0.5, st.y + 0.5, false, '#cfc8b8', 10);
          break;
        case 'stoneRemoved':
          this.burst(e.x + 0.5, e.y + 0.5, false, '#9a978e', 14);
          break;
      }
    }
  }

  private p(x: number, y: number, h: number) {
    return new Vector3(toWorldX(x), h, toWorldZ(y));
  }

  private add(obj: Mesh, mat: MeshBasicMaterial, life: number, update: Effect['update']) {
    // Guard against event floods (e.g. a background tab catching up).
    if (this.effects.length > 800) return;
    this.group.add(obj);
    this.effects.push({ obj, mat, age: 0, life, update });
  }

  private beam(a: Vector3, b: Vector3, style: AttackStyle, width: number, boost: number) {
    const mat = glowMat(STYLE_COLOURS[style], 3 * boost);
    const m = new Mesh(beamGeo, mat);
    this.orient(m, a, b, width);
    const base = mat.opacity;
    this.add(m, mat, 0.14, (e, t) => {
      e.mat.opacity = base * (1 - t);
      e.obj.scale.x = e.obj.scale.z = width * (1 - t * 0.7);
    });
  }

  private orient(m: Mesh, a: Vector3, b: Vector3, width: number) {
    const dir = this.tmpA.subVectors(b, a);
    const len = dir.length();
    m.position.copy(a);
    this.q.setFromUnitVectors(UP, dir.normalize());
    m.quaternion.copy(this.q);
    m.scale.set(width, len, width);
  }

  private lightning(points: number[], air: boolean, style: AttackStyle, boost: number) {
    const mat = glowMat(STYLE_COLOURS[style], 3.5 * boost);
    for (let i = 0; i + 3 < points.length; i += 2) {
      const a = this.p(points[i], points[i + 1], i === 0 ? GEM_Y : air ? AIR_HEIGHT : GROUND_HIT_Y);
      const b = this.p(points[i + 2], points[i + 3], air ? AIR_HEIGHT : GROUND_HIT_Y);
      // Jagged: split each hop into a few offset segments.
      const n = 4;
      let prev = a;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const next = new Vector3().lerpVectors(a, b, t);
        if (k < n) next.add(new Vector3((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35));
        const m = new Mesh(beamGeo, mat);
        this.orient(m, prev, next, 0.035);
        this.add(m, mat, 0.16, (e, tt) => {
          e.mat.opacity = 1 - tt;
        });
        prev = next;
      }
    }
  }

  private flash(x: number, y: number, air: boolean, style: AttackStyle, size: number, boost: number) {
    const mat = glowMat(STYLE_COLOURS[style], 2.5 * boost);
    const m = new Mesh(flashGeo, mat);
    m.position.copy(this.p(x, y, air ? AIR_HEIGHT : GROUND_HIT_Y));
    this.add(m, mat, 0.22, (e, t) => {
      e.obj.scale.setScalar(size * (0.5 + t));
      e.mat.opacity = 1 - t;
    });
  }

  private ring(x: number, y: number, h: number, radius: number, style: AttackStyle, life: number, boost: number) {
    const mat = glowMat(STYLE_COLOURS[style], 2 * boost);
    const m = new Mesh(ringGeo, mat);
    m.position.copy(this.p(x, y, h));
    this.add(m, mat, life, (e, t) => {
      e.obj.scale.setScalar(radius * (0.3 + 0.7 * Math.sqrt(t)));
      e.mat.opacity = 1 - t;
    });
  }

  private burst(x: number, y: number, air: boolean, colour: string, count: number) {
    const mat = glowMat(colour, 1.5);
    const origin = this.p(x, y, air ? AIR_HEIGHT : 0.3);
    for (let i = 0; i < count; i++) {
      const m = new Mesh(shardGeo, mat);
      m.position.copy(origin);
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 2.5;
      const vel = new Vector3(Math.cos(a) * sp, 2 + Math.random() * 3, Math.sin(a) * sp);
      this.add(m, mat, 0.7, (e, t, dt) => {
        vel.y -= 12 * dt;
        e.obj.position.addScaledVector(vel, dt);
        e.obj.rotation.x += dt * 8;
        e.obj.scale.setScalar(1 - t);
        e.mat.opacity = 1 - t;
      });
    }
  }

  syncProjectiles(list: Projectile[], alpha: number) {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let v = this.projectiles.get(p.id);
      if (!v) {
        const mesh = new Mesh(projGeos[p.style], projMat(p.style));
        const trail: Mesh[] = [];
        if (p.style === 'comet' || p.style === 'ember') {
          for (let i = 0; i < 4; i++) {
            const t = new Mesh(projGeos[p.style], projMat(p.style));
            t.scale.setScalar(0.8 - i * 0.18);
            trail.push(t);
            this.group.add(t);
          }
        }
        v = { mesh, trail };
        this.projectiles.set(p.id, v);
        this.group.add(mesh);
        const start = this.p(p.x, p.y, GEM_Y);
        mesh.position.copy(start);
        for (const t of trail) t.position.copy(start);
      }
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      // Height: rise from the gem toward the target height; embers arc.
      const dx = p.tx - x;
      const dy = p.ty - y;
      const remain = Math.sqrt(dx * dx + dy * dy);
      const endH = p.air ? AIR_HEIGHT : GROUND_HIT_Y;
      const k = Math.min(1, 1 / (1 + remain * 0.6));
      let h = GEM_Y + (endH - GEM_Y) * k;
      if (p.style === 'ember') h += Math.min(remain, 3) * 0.35;
      const prev = this.tmpB.copy(v.mesh.position);
      v.mesh.position.copy(this.p(x, y, h));
      const vel = this.tmpA.subVectors(v.mesh.position, prev);
      if (vel.lengthSq() > 1e-6) v.mesh.lookAt(this.tmpB.copy(v.mesh.position).add(vel));
      for (let i = v.trail.length - 1; i >= 0; i--) {
        const target = i === 0 ? prev : v.trail[i - 1].position;
        v.trail[i].position.lerp(target, 0.6);
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
        e.mat.dispose();
      } else alive.push(e);
    }
    this.effects = alive;
  }
}
