import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { LANE_H } from '../sim/data/map';
import { worldMaxX, worldMinX } from './coords';

/**
 * A narrow-FOV perspective camera orbiting a ground target: steep (65° down)
 * so the build grid is easy to read and click, and just off straight-on (8°)
 * looking up the canyons toward the rock range. Rotation snaps in 90° steps.
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(28, 1, 1, 600);
  readonly target = new Vector3(0, 0, 0);
  private goalTarget = new Vector3(0, 0, 0);
  yaw = 0.14;
  private goalYaw = 0.14;
  pitch = 1.13;
  distance = 86;
  private goalDistance = 86;
  private keys = new Set<string>();
  /** Short screen shake, e.g. when your keep is breached. */
  private shake = 0;

  constructor() {
    this.apply();
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  zoom(delta: number) {
    this.goalDistance = clamp(this.goalDistance * Math.exp(delta * 0.0012), 16, 190);
  }

  rotate(steps: number) {
    this.goalYaw += (steps * Math.PI) / 2;
  }

  /** Glides to a world point. */
  focus(x: number, z: number, distance?: number) {
    this.goalTarget.set(x, 0, z);
    if (distance) this.goalDistance = distance;
    this.clampTarget();
  }

  snap() {
    this.target.copy(this.goalTarget);
    this.distance = this.goalDistance;
    this.yaw = this.goalYaw;
    this.apply();
  }

  kick(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  /** Pans by screen-space pixels. */
  panPixels(dx: number, dy: number, viewportH: number) {
    const worldPerPx = (2 * this.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / viewportH;
    this.panWorld(-dx * worldPerPx, (dy * worldPerPx) / Math.sin(this.pitch));
  }

  private panWorld(right: number, forward: number) {
    const sx = Math.cos(this.yaw);
    const sz = -Math.sin(this.yaw);
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    this.goalTarget.x += sx * right + fx * forward;
    this.goalTarget.z += sz * right + fz * forward;
    this.clampTarget();
  }

  setKey(code: string, down: boolean) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  update(dt: number) {
    const speed = this.distance * 0.9 * dt;
    let r = 0;
    let f = 0;
    if (this.keys.has('ArrowLeft')) r -= speed;
    if (this.keys.has('ArrowRight')) r += speed;
    if (this.keys.has('ArrowUp')) f += speed;
    if (this.keys.has('ArrowDown')) f -= speed;
    if (r || f) this.panWorld(r, f);
    const k = 1 - Math.exp(-dt * 8);
    this.target.lerp(this.goalTarget, k);
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.distance += (this.goalDistance - this.distance) * k;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.apply();
  }

  private clampTarget() {
    this.goalTarget.x = clamp(this.goalTarget.x, worldMinX(), worldMaxX());
    this.goalTarget.z = clamp(this.goalTarget.z, -LANE_H / 2 - 8, LANE_H / 2 + 6);
  }

  private apply() {
    const c = Math.cos(this.pitch);
    const s = this.shake * this.shake * 0.35;
    const jx = s ? (Math.random() - 0.5) * s : 0;
    const jz = s ? (Math.random() - 0.5) * s : 0;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * c * this.distance + jx,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * c * this.distance + jz,
    );
    this.camera.lookAt(this.target.x + jx, this.target.y, this.target.z + jz);
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
