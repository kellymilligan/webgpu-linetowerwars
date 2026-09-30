import { Color, InstancedMesh, Matrix4, Object3D } from 'three/webgpu';
import type { BufferGeometry, Material } from 'three/webgpu';

/**
 * A growable InstancedMesh: call begin(), push() each instance, then end().
 * Keeps draw calls to one per part type no matter how many lanes are busy.
 */
export class Batch {
  mesh: InstancedMesh;
  private count = 0;
  private dummy = new Object3D();
  private colour = new Color();

  constructor(
    private geo: BufferGeometry,
    private mat: Material,
    private capacity = 256,
    private shadows = true,
  ) {
    this.mesh = this.make(capacity);
  }

  private make(cap: number) {
    const m = new InstancedMesh(this.geo, this.mat, cap);
    m.castShadow = this.shadows;
    m.receiveShadow = true;
    m.count = 0;
    m.frustumCulled = false;
    // Allocate instance colours up front so the shader variant never changes.
    m.setColorAt(0, this.colour.set('#ffffff'));
    return m;
  }

  begin() {
    this.count = 0;
  }

  /** Adds an instance; grows the buffer (replacing the mesh) if needed. */
  push(x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number, colour: Color | string, rotX = 0, rotZ = 0) {
    if (this.count >= this.capacity) this.grow();
    const d = this.dummy;
    d.position.set(x, y, z);
    d.rotation.set(rotX, rotY, rotZ, 'YXZ');
    d.scale.set(sx, sy, sz);
    d.updateMatrix();
    this.mesh.setMatrixAt(this.count, d.matrix);
    this.mesh.setColorAt(this.count, typeof colour === 'string' ? this.colour.set(colour) : colour);
    this.count++;
  }

  pushMatrix(m: Matrix4, colour: Color) {
    if (this.count >= this.capacity) this.grow();
    this.mesh.setMatrixAt(this.count, m);
    this.mesh.setColorAt(this.count, colour);
    this.count++;
  }

  end() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private grow() {
    const old = this.mesh;
    this.capacity *= 2;
    const next = this.make(this.capacity);
    const m = new Matrix4();
    const c = new Color();
    for (let i = 0; i < this.count; i++) {
      old.getMatrixAt(i, m);
      next.setMatrixAt(i, m);
      old.getColorAt(i, c);
      next.setColorAt(i, c);
    }
    old.parent?.add(next);
    old.parent?.remove(old);
    old.dispose();
    this.mesh = next;
  }
}
