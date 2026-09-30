import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { GRID_H, GRID_W } from '../sim/data/map';

/**
 * Isometric-style rig: a narrow-FOV perspective camera orbiting a ground
 * target. Rotation snaps in 90° steps so the board always reads cleanly.
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(28, 1, 1, 400);
  readonly target = new Vector3(0, 0, 0);
  private goalTarget = new Vector3(0, 0, 0);
  yaw = Math.PI / 4;
  private goalYaw = Math.PI / 4;
  pitch = 0.92;
  distance = 46;
  private goalDistance = 46;
  private keys = new Set<string>();

  constructor() {
    this.apply();
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  zoom(delta: number) {
    this.goalDistance = clamp(this.goalDistance * Math.exp(delta * 0.0012), 14, 85);
  }

  rotate(steps: number) {
    this.goalYaw += (steps * Math.PI) / 2;
  }

  /** Pans by screen-space pixels. */
  panPixels(dx: number, dy: number, viewportH: number) {
    const worldPerPx = (2 * this.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / viewportH;
    this.panWorld(-dx * worldPerPx, (dy * worldPerPx) / Math.sin(this.pitch));
  }

  private panWorld(right: number, forward: number) {
    const sx = Math.cos(this.yaw);
    const sz = -Math.sin(this.yaw);
    // Forward is the camera's view direction projected onto the ground.
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
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) r -= speed;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) r += speed;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += speed;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= speed;
    if (r || f) this.panWorld(r, f);
    const k = 1 - Math.exp(-dt * 10);
    this.target.lerp(this.goalTarget, k);
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.distance += (this.goalDistance - this.distance) * k;
    this.apply();
  }

  private clampTarget() {
    const hw = GRID_W / 2 + 4;
    const hh = GRID_H / 2 + 4;
    this.goalTarget.x = clamp(this.goalTarget.x, -hw, hw);
    this.goalTarget.z = clamp(this.goalTarget.z, -hh, hh);
  }

  private apply() {
    const c = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * c * this.distance,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * c * this.distance,
    );
    this.camera.lookAt(this.target);
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
