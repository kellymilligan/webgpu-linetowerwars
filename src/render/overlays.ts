import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  RingGeometry,
} from 'three/webgpu';
import { float, fract, smoothstep, time, uniform, uv, vec4 } from 'three/tsl';
import { toWorldX, toWorldZ } from './coords';

/** A flat ribbon along a lane-local polyline with animated flow chevrons. */
class Ribbon {
  readonly mesh: Mesh;
  private colour = uniform(new Color('#ffffff'));
  private alpha = uniform(0.6);

  constructor(colour: string, alpha: number, private width: number, private height: number, speed: number, dash: number) {
    this.colour.value.set(colour);
    this.alpha.value = alpha;
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
    const u = uv();
    const flow = fract(u.x.mul(1 / dash).sub(time.mul(speed / dash)));
    const chevron = smoothstep(0.0, 0.15, flow).mul(float(1).sub(smoothstep(0.45, 0.6, flow)));
    const edge = float(1).sub(smoothstep(0.35, 0.5, u.y.sub(0.5).abs()));
    mat.colorNode = vec4(this.colour, chevron.mul(0.75).add(0.25).mul(edge).mul(this.alpha));
    this.mesh = new Mesh(new BufferGeometry(), mat);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
  }

  setColour(c: string) {
    this.colour.value.set(c);
  }

  set(lane: number, pts: number[] | null) {
    this.mesh.visible = !!pts && pts.length >= 4;
    if (!pts || pts.length < 4) return;
    const n = pts.length / 2;
    const pos = new Float32Array(n * 2 * 3);
    const uvs = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    let dist = 0;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2];
      const y = pts[i * 2 + 1];
      if (i > 0) dist += Math.hypot(x - pts[i * 2 - 2], y - pts[i * 2 - 1]);
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
      pos.set([toWorldX(lane, x + ox), this.height, toWorldZ(y + oy), toWorldX(lane, x - ox), this.height, toWorldZ(y - oy)], i * 6);
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

export type HoverState = 'ok' | 'blocks' | 'bad';

/** Road preview, hover tile, range ring and selection marker. */
export class Overlays {
  readonly group = new Group();
  private road = new Ribbon('#f2e6c8', 0.4, 0.16, 0.04, 1.4, 1.2);
  private preview = new Ribbon('#ffc44d', 0.9, 0.2, 0.06, 2.4, 1.0);
  private hover: Mesh;
  private hoverMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false });
  private range: Mesh;
  private rangeFill: Mesh;
  private rangeMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide });
  private rangeFillMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.07, depthWrite: false, side: DoubleSide });
  private select: Mesh;

  constructor() {
    this.hover = new Mesh(new PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2), this.hoverMat);
    this.hover.position.y = 0.03;
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
    this.group.add(this.road.mesh, this.preview.mesh, this.hover, this.range, this.rangeFill, this.select);
    this.setHover(null);
    this.setRange(null);
    this.setSelected(null);
    this.preview.set(0, null);
  }

  setRoad(lane: number, pts: number[] | null, blocked: boolean) {
    this.road.setColour(blocked ? '#ff6b4a' : '#f2e6c8');
    this.road.set(lane, pts);
    this.roadShown = this.road.mesh.visible;
  }

  private roadShown = false;

  setPreview(lane: number, pts: number[] | null) {
    this.preview.set(lane, pts);
    this.road.mesh.visible = !pts && this.roadShown;
  }

  setHover(tile: { lane: number; x: number; y: number; state: HoverState } | null) {
    this.hover.visible = !!tile;
    if (!tile) return;
    this.hover.position.x = toWorldX(tile.lane, tile.x + 0.5);
    this.hover.position.z = toWorldZ(tile.y + 0.5);
    this.hoverMat.color.set(tile.state === 'ok' ? '#b8ffcf' : tile.state === 'blocks' ? '#ffb347' : '#ff6b6b');
  }

  setRange(r: { lane: number; x: number; y: number; radius: number; colour?: string } | null) {
    this.range.visible = this.rangeFill.visible = !!r;
    if (!r) return;
    for (const m of [this.range, this.rangeFill]) {
      m.position.x = toWorldX(r.lane, r.x);
      m.position.z = toWorldZ(r.y);
      m.scale.setScalar(r.radius);
    }
    this.rangeMat.color.set(r.colour ?? '#ffffff');
    this.rangeFillMat.color.set(r.colour ?? '#ffffff');
  }

  setSelected(tile: { lane: number; x: number; y: number } | null) {
    this.select.visible = !!tile;
    if (!tile) return;
    this.select.position.x = toWorldX(tile.lane, tile.x + 0.5);
    this.select.position.z = toWorldZ(tile.y + 0.5);
  }

  update(t: number) {
    this.select.scale.setScalar(1 + Math.sin(t * 4) * 0.05);
  }
}
