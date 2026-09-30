import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  RingGeometry,
  CircleGeometry,
} from 'three/webgpu';
import { float, fract, smoothstep, time, uniform, uv, vec4 } from 'three/tsl';
import type { Route } from '../sim/types';
import { toWorldX, toWorldZ } from './coords';

/** A flat ribbon along a route with animated flow dashes. */
class Ribbon {
  readonly mesh: Mesh;
  private colour = uniform(new Color('#ffffff'));
  private alpha = uniform(0.6);

  constructor(colour: string, alpha: number, private width: number, private height: number, speed: number, dash: number) {
    this.colour.value.set(colour);
    this.alpha.value = alpha;
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
    const u = uv();
    const along = u.x;
    const flow = fract(along.mul(1 / dash).sub(time.mul(speed / dash)));
    const chevron = smoothstep(0.0, 0.15, flow).mul(float(1).sub(smoothstep(0.45, 0.6, flow)));
    const edge = float(1).sub(smoothstep(0.35, 0.5, u.y.sub(0.5).abs()));
    mat.colorNode = vec4(this.colour, chevron.mul(0.75).add(0.25).mul(edge).mul(this.alpha));
    this.mesh = new Mesh(new BufferGeometry(), mat);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
  }

  setAlpha(a: number) {
    this.alpha.value = a;
  }

  set(route: { points: number[] } | null) {
    this.mesh.visible = !!route && route.points.length >= 4;
    if (!route || route.points.length < 4) return;
    const pts = route.points;
    const n = pts.length / 2;
    const pos = new Float32Array(n * 2 * 3);
    const uvs = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    let dist = 0;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2];
      const y = pts[i * 2 + 1];
      if (i > 0) dist += Math.hypot(x - pts[i * 2 - 2], y - pts[i * 2 - 1]);
      // Averaged tangent for a mitred joint.
      const px = pts[Math.max(0, i - 1) * 2];
      const py = pts[Math.max(0, i - 1) * 2 + 1];
      const nx = pts[Math.min(n - 1, i + 1) * 2];
      const ny = pts[Math.min(n - 1, i + 1) * 2 + 1];
      let tx = nx - px;
      let ty = ny - py;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const ox = -ty * this.width * 0.5;
      const oy = tx * this.width * 0.5;
      pos.set([toWorldX(x + ox), this.height, toWorldZ(y + oy), toWorldX(x - ox), this.height, toWorldZ(y - oy)], i * 6);
      uvs.set([dist, 0, dist, 1], i * 4);
      if (i < n - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('uv', new BufferAttribute(uvs, 2));
    g.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }
}

export class Overlays {
  readonly group = new Group();
  private groundPath = new Ribbon('#fff4d6', 0.55, 0.16, 0.04, 1.6, 1.2);
  private previewPath = new Ribbon('#ffc44d', 0.9, 0.2, 0.06, 2.4, 1.0);
  private airPath = new Ribbon('#b9d8ff', 0.28, 0.1, 0.05, 1.2, 0.8);
  private hover: Mesh;
  private hoverMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false });
  private range: Mesh;
  private rangeFill: Mesh;
  private rangeMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide });
  private rangeFillMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.08, depthWrite: false, side: DoubleSide });
  private select: Mesh;
  private marks: Mesh[] = [];
  private markGeo = new RingGeometry(0.34, 0.46, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2);
  private consumeMat = new MeshBasicMaterial({ color: new Color('#ff8a5c').multiplyScalar(2), transparent: true, opacity: 0.9, depthWrite: false });
  private targetMat = new MeshBasicMaterial({ color: new Color('#ffd27a').multiplyScalar(2.5), transparent: true, opacity: 0.95, depthWrite: false });

  constructor() {
    this.hover = new Mesh(new PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2), this.hoverMat);
    this.hover.position.y = 0.02;
    this.hover.renderOrder = 3;
    this.range = new Mesh(new RingGeometry(0.97, 1, 96).rotateX(-Math.PI / 2), this.rangeMat);
    this.rangeFill = new Mesh(new CircleGeometry(1, 96).rotateX(-Math.PI / 2), this.rangeFillMat);
    this.range.position.y = 0.05;
    this.rangeFill.position.y = 0.045;
    this.select = new Mesh(
      new RingGeometry(0.5, 0.58, 40).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: new Color('#ffffff').multiplyScalar(2), transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.select.position.y = 0.06;
    this.group.add(this.groundPath.mesh, this.previewPath.mesh, this.airPath.mesh, this.hover, this.range, this.rangeFill, this.select);
    this.setHover(null);
    this.setRange(null);
    this.setSelected(null);
    this.previewPath.set(null);
  }

  setRoutes(ground: Route, air: Route) {
    this.groundPath.set(ground);
    this.airPath.set(air);
  }

  setPreview(route: Route | null) {
    this.previewPath.set(route);
    this.groundPath.mesh.visible = !route;
  }

  setHover(tile: { x: number; y: number; ok: boolean } | null) {
    this.hover.visible = !!tile;
    if (!tile) return;
    this.hover.position.x = toWorldX(tile.x + 0.5);
    this.hover.position.z = toWorldZ(tile.y + 0.5);
    this.hoverMat.color.set(tile.ok ? '#b8ffcf' : '#ff6b6b');
  }

  setRange(r: { x: number; y: number; radius: number; colour?: string } | null) {
    this.range.visible = this.rangeFill.visible = !!r;
    if (!r) return;
    for (const m of [this.range, this.rangeFill]) {
      m.position.x = toWorldX(r.x);
      m.position.z = toWorldZ(r.y);
      m.scale.setScalar(r.radius);
    }
    this.rangeMat.color.set(r.colour ?? '#ffffff');
    this.rangeFillMat.color.set(r.colour ?? '#ffffff');
  }

  setSelected(tile: { x: number; y: number } | null) {
    this.select.visible = !!tile;
    if (!tile) return;
    this.select.position.x = toWorldX(tile.x + 0.5);
    this.select.position.z = toWorldZ(tile.y + 0.5);
  }

  /** Emphasises the flight path when flyers are due. */
  setAirEmphasis(on: boolean) {
    this.airPath.setAlpha(on ? 0.75 : 0.28);
  }

  /** Marks tiles a combine will consume, and where the result will stand. */
  setMarks(target: { x: number; y: number } | null, consumed: { x: number; y: number }[]) {
    const all = target ? [{ ...target, target: true }, ...consumed.map((c) => ({ ...c, target: false }))] : [];
    while (this.marks.length < all.length) {
      const m = new Mesh(this.markGeo, this.consumeMat);
      m.renderOrder = 4;
      this.group.add(m);
      this.marks.push(m);
    }
    this.marks.forEach((m, i) => {
      const t = all[i];
      m.visible = !!t;
      if (!t) return;
      m.material = t.target ? this.targetMat : this.consumeMat;
      m.position.set(toWorldX(t.x + 0.5), 0.07, toWorldZ(t.y + 0.5));
    });
  }

  update(t: number) {
    this.select.scale.setScalar(1 + Math.sin(t * 4) * 0.05);
    for (const m of this.marks) m.scale.setScalar(1 + Math.sin(t * 6) * 0.08);
  }
}
