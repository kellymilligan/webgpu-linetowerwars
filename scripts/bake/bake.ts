/**
 * Asset baker (runs in a browser page; driven by scripts/bake-assets.mjs).
 *
 * Turns the chosen KayKit CC0 models into one compact pack the game loads in
 * a single fetch:
 * - static models: every mesh merged into one geometry (position, uv, index)
 *   so each can be drawn as one InstancedMesh;
 * - characters: a walk cycle baked into a few frames of skinned positions
 *   (a flipbook), quantised to int16, so hundreds of animated creeps stay
 *   instanced instead of being individual skinned meshes.
 * Normals are recomputed at load time.
 */
import { AnimationMixer, Box3, BufferAttribute, BufferGeometry, Mesh, Object3D, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SRC = '/.cache/kaykit/';

const STATICS: Record<string, string> = {};
for (const n of ['tree_single_A', 'tree_single_B', 'rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E', 'mountain_A', 'mountain_B', 'mountain_C']) STATICS[n] = `decoration/nature/${n}.gltf`;
for (const n of ['castle', 'home_A', 'home_B', 'tavern', 'church', 'windmill', 'well', 'blacksmith', 'tower_A', 'tower_B', 'tower_base', 'tower_catapult', 'market', 'watermill']) STATICS[n] = `buildings/blue/building_${n}_blue.gltf`;
for (const n of ['building_destroyed']) STATICS[n.replace('building_', '')] = `buildings/neutral/${n}.gltf`;
for (const n of ['barrel', 'crate_A_big', 'sack', 'resource_lumber', 'resource_stone', 'wheelbarrow']) STATICS[n] = `decoration/props/${n}.gltf`;

interface CharSpec {
  file: string;
  tex: string;
  anim: string;
  keep: string[];
}
const CHARS: Record<string, CharSpec> = {
  levy: { file: 'Rogue_Hooded.glb', tex: 'rogue', anim: 'Walking_A', keep: ['Knife', 'Rogue_Cape'] },
  footman: { file: 'Knight.glb', tex: 'knight', anim: 'Walking_A', keep: ['1H_Sword', 'Round_Shield', 'Knight_Helmet', 'Knight_Cape'] },
  shieldbearer: { file: 'Knight.glb', tex: 'knight', anim: 'Walking_B', keep: ['1H_Sword', 'Rectangle_Shield', 'Knight_Helmet', 'Knight_Cape'] },
  outrider: { file: 'Rogue.glb', tex: 'rogue', anim: 'Running_A', keep: ['Knife', 'Knife_Offhand', 'Rogue_Cape'] },
  friar: { file: 'Mage.glb', tex: 'mage', anim: 'Walking_A', keep: ['2H_Staff', 'Mage_Hat', 'Mage_Cape'] },
  knight: { file: 'Knight.glb', tex: 'knight', anim: 'Running_A', keep: ['2H_Sword', 'Knight_Helmet', 'Knight_Cape'] },
  warlord: { file: 'Barbarian.glb', tex: 'barbarian', anim: 'Walking_A', keep: ['2H_Axe', 'Barbarian_Hat', 'Barbarian_Cape'] },
  wight: { file: 'Skeleton_Minion.glb', tex: 'skeleton', anim: 'Walking_A', keep: [] },
  wightWarrior: { file: 'Skeleton_Warrior.glb', tex: 'skeleton', anim: 'Walking_A', keep: ['Skeleton_Warrior_Helmet'] },
  wightRunner: { file: 'Skeleton_Rogue.glb', tex: 'skeleton', anim: 'Running_A', keep: [] },
};
const FRAMES = 6;

const chunks: ArrayBuffer[] = [];
let offset = 0;
function put(arr: Float32Array | Int16Array | Int8Array | Uint16Array | Uint32Array): number {
  const at = offset;
  const copy = arr.slice().buffer;
  chunks.push(copy);
  offset += copy.byteLength;
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(new ArrayBuffer(pad));
    offset += pad;
  }
  return at;
}

const loader = new GLTFLoader();
const load = (p: string) => loader.loadAsync(SRC + p);

function strip(g: BufferGeometry): BufferGeometry {
  const out = new BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  const uv = g.getAttribute('uv') ?? new BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2);
  out.setAttribute('uv', uv);
  if (g.getAttribute('normal')) out.setAttribute('normal', g.getAttribute('normal'));
  else {
    g.computeVertexNormals();
    out.setAttribute('normal', g.getAttribute('normal'));
  }
  out.setIndex(g.getIndex() ?? [...Array(g.getAttribute('position').count).keys()]);
  return out;
}

function indexOut(g: BufferGeometry) {
  const idx = g.getIndex()!.array;
  const big = g.getAttribute('position').count > 65535;
  return { off: put(big ? new Uint32Array(idx) : new Uint16Array(idx)), count: idx.length, u32: big };
}

async function bakeStatic(path: string) {
  const gltf = await load(path);
  gltf.scene.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  gltf.scene.traverse((o: Object3D) => {
    if ((o as Mesh).isMesh) {
      const g = strip((o as Mesh).geometry.clone().applyMatrix4(o.matrixWorld));
      parts.push(g);
    }
  });
  const g = mergeGeometries(parts)!;
  const box = new Box3().setFromBufferAttribute(g.getAttribute('position') as BufferAttribute);
  // Normals packed as int8x4 (the 4th byte pads for alignment).
  const n = g.getAttribute('normal');
  const nrm = new Int8Array(n.count * 4);
  for (let i = 0; i < n.count; i++) {
    nrm[i * 4] = Math.round(n.getX(i) * 127);
    nrm[i * 4 + 1] = Math.round(n.getY(i) * 127);
    nrm[i * 4 + 2] = Math.round(n.getZ(i) * 127);
  }
  return {
    nrm: put(nrm),
    pos: put(new Float32Array(g.getAttribute('position').array)),
    uv: put(new Float32Array(g.getAttribute('uv').array)),
    verts: g.getAttribute('position').count,
    idx: indexOut(g),
    min: box.min.toArray(),
    max: box.max.toArray(),
  };
}

async function bakeChar(spec: CharSpec) {
  const gltf = await load(spec.file);
  const root = gltf.scene;
  const clip = gltf.animations.find((a) => a.name === spec.anim)!;
  const mixer = new AnimationMixer(root);
  mixer.clipAction(clip).play();
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    if ((o as SkinnedMesh).isSkinnedMesh || spec.keep.includes(o.name)) meshes.push(o as Mesh);
  });
  // Topology (uv + index) once; positions per frame.
  const uvParts: number[] = [];
  const idxParts: number[] = [];
  let base = 0;
  for (const m of meshes) {
    const g = m.geometry;
    const n = g.getAttribute('position').count;
    const uv = g.getAttribute('uv');
    for (let i = 0; i < n; i++) uvParts.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idxParts.push(index.getX(i) + base);
    else for (let i = 0; i < n; i++) idxParts.push(i + base);
    base += n;
  }
  const frames: Float32Array[] = [];
  const box = new Box3();
  const v = new Vector3();
  for (let f = 0; f < FRAMES; f++) {
    mixer.setTime((clip.duration * f) / FRAMES);
    root.updateMatrixWorld(true);
    const pos = new Float32Array(base * 3);
    let k = 0;
    for (const m of meshes) {
      const n = m.geometry.getAttribute('position').count;
      const skinned = (m as SkinnedMesh).isSkinnedMesh;
      if (skinned) (m as SkinnedMesh).skeleton.update();
      for (let i = 0; i < n; i++) {
        if (skinned) (m as SkinnedMesh).getVertexPosition(i, v);
        else v.fromBufferAttribute(m.geometry.getAttribute('position'), i);
        v.applyMatrix4(m.matrixWorld);
        pos[k++] = v.x;
        pos[k++] = v.y;
        pos[k++] = v.z;
        box.expandByPoint(v);
      }
    }
    frames.push(pos);
  }
  // Quantise every frame to int16 inside the shared bounds.
  const size = box.getSize(new Vector3());
  const q = frames.map((pos) => {
    const out = new Int16Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      out[i] = Math.round(((pos[i] - box.min.x) / (size.x || 1)) * 65535 - 32768);
      out[i + 1] = Math.round(((pos[i + 1] - box.min.y) / (size.y || 1)) * 65535 - 32768);
      out[i + 2] = Math.round(((pos[i + 2] - box.min.z) / (size.z || 1)) * 65535 - 32768);
    }
    return put(out);
  });
  const big = base > 65535;
  return {
    tex: spec.tex,
    verts: base,
    frames: q,
    uv: put(new Float32Array(uvParts)),
    idx: { off: put(big ? new Uint32Array(idxParts) : new Uint16Array(idxParts)), count: idxParts.length, u32: big },
    min: box.min.toArray(),
    max: box.max.toArray(),
  };
}

async function bake() {
  const statics: Record<string, unknown> = {};
  for (const [name, path] of Object.entries(STATICS)) statics[name] = await bakeStatic(path);
  const chars: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(CHARS)) chars[name] = await bakeChar(spec);
  const bin = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    bin.set(new Uint8Array(c), at);
    at += c.byteLength;
  }
  let s = '';
  for (let i = 0; i < bin.length; i += 0x8000) s += String.fromCharCode(...bin.subarray(i, i + 0x8000));
  return { json: { version: 1, frames: FRAMES, statics, chars }, bin: btoa(s) };
}

(window as unknown as { bake: typeof bake }).bake = bake;
(window as unknown as { bakeReady: boolean }).bakeReady = true;
