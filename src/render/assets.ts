/**
 * Loads the baked KayKit CC0 pack (scripts/bake-assets.mjs) and registers its
 * models with the instanced batch system:
 * - `kk:<name>`: static models (buildings, nature, props), one atlas texture;
 * - `kc:<char>:<frame>`: character walk-cycle frames, one texture per character.
 *
 * Materials give them the northern look: a little desaturation, snow dusting on
 * upward faces, and snowcaps on mountains.
 */
import { BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute, MeshStandardNodeMaterial, SRGBColorSpace, Texture, TextureLoader, Vector3 } from 'three/webgpu';
import {
  dot,
  float,
  instanceIndex,
  mix,
  mx_noise_float,
  normalWorld,
  positionGeometry,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { MATS, registerGeometry } from './parts';

const BASE = '/assets/kaykit/';

interface PackStatic {
  pos: number;
  nrm: number;
  uv: number;
  verts: number;
  idx: { off: number; count: number; u32: boolean };
  min: number[];
  max: number[];
}
interface PackChar {
  tex: string;
  verts: number;
  frames: number[];
  uv: number;
  idx: { off: number; count: number; u32: boolean };
  min: number[];
  max: number[];
}
interface Pack {
  version: number;
  frames: number;
  statics: Record<string, PackStatic>;
  chars: Record<string, PackChar>;
}

export interface Bounds {
  min: Vector3;
  max: Vector3;
  size: Vector3;
}

const bounds = new Map<string, Bounds>();
export let CHAR_FRAMES = 0;
export const charNames = new Set<string>();
/** How much snow lies on upward faces (0..1); the time of day can nudge it. */
export const snowCover = uniform(0.55);

export const assetBounds = (key: string) => bounds.get(key);
const charTexture = new Map<string, string>();
/** The texture name for a `kc:<char>:<frame>` key. */
export const charTex = (key: string) => charTexture.get(key.split(':')[1]) ?? 'knight';
export const staticKeys = () => [...bounds.keys()].filter((k) => k.startsWith('kk:'));

/** Scale that makes a model `height` tall (by its bounding box). */
export function fitHeight(key: string, height: number): number {
  const b = bounds.get(key);
  return b ? height / Math.max(1e-3, b.size.y) : 1;
}
/** Scale that makes a model's widest horizontal extent `width`. */
export function fitWidth(key: string, width: number): number {
  const b = bounds.get(key);
  return b ? width / Math.max(1e-3, b.size.x, b.size.z) : 1;
}

let loaded = false;
export const assetsReady = () => loaded;

/** Desaturate a little and pull towards a cold slate, for a weathered northern palette. */
function weather(c: Node<'vec3'>, amount = 0.3): Node<'vec3'> {
  const lum = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(c, vec3(lum, lum, lum).mul(vec3(0.95, 0.98, 1.04)), amount);
}

/** Snow settles on upward faces, patchily. */
function snowed(c: Node<'vec3'>, extra: Node<'float'> = float(0)): Node<'vec3'> {
  const up = smoothstep(0.6, 0.9, normalWorld.y);
  const patch = mx_noise_float(positionWorld.xz.mul(0.55)).mul(0.5).add(0.5);
  const cover = smoothstep(float(0.85).sub(snowCover.mul(0.5)), float(0.95).sub(snowCover.mul(0.45)), patch);
  const s = up.mul(cover).add(extra).clamp(0, 1);
  return mix(c, vec3(0.9, 0.93, 0.98), s);
}

function makeMaterials(atlas: Texture, chars: Record<string, Texture>) {
  const base = weather(texture(atlas, uv()).rgb, 0.5);

  const m = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  m.colorNode = snowed(base);
  MATS.atlas = m;

  // Foliage with the atlas texture: sways like the procedural trees.
  const f = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  const phase = float(instanceIndex).mul(1.71);
  const h = positionGeometry.y.clamp(0, 2);
  const sway = sin(time.mul(1.3).add(phase)).mul(0.04).mul(h);
  f.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(0.6)));
  f.colorNode = snowed(weather(texture(atlas, uv()).rgb, 0.35));
  MATS.atlasFoliage = f;

  // Mountains: snowcaps by height plus snow on every flat ledge.
  const p = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  // Snowline in the model's own height (they're re-based to stand on y = 0), broken up by noise.
  const peaks = smoothstep(0.95, 1.25, positionGeometry.y.add(mx_noise_float(positionWorld.xz.mul(0.3)).mul(0.18)));
  p.colorNode = snowed(weather(texture(atlas, uv()).rgb, 0.45), peaks);
  MATS.peak = p;

  for (const [name, tex] of Object.entries(chars)) {
    const c = new MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 });
    c.colorNode = weather(texture(tex, uv()).rgb, 0.2);
    MATS[`char:${name}`] = c;
  }
}

export async function loadAssets(): Promise<boolean> {
  try {
    const [json, bin] = await Promise.all([
      fetch(`${BASE}pack.json`).then((r) => r.json() as Promise<Pack>),
      fetch(`${BASE}pack.bin`).then((r) => r.arrayBuffer()),
    ]);
    const loader = new TextureLoader();
    const tex = async (name: string) => {
      const t = await loader.loadAsync(`${BASE}${name}.png`);
      t.colorSpace = SRGBColorSpace;
      t.flipY = false;
      return t;
    };
    const charTexNames = [...new Set(Object.values(json.chars).map((c) => c.tex))];
    const [atlas, ...charTex] = await Promise.all([tex('atlas'), ...charTexNames.map(tex)]);
    makeMaterials(atlas, Object.fromEntries(charTexNames.map((n, i) => [n, charTex[i]])));

    const index = (i: { off: number; count: number; u32: boolean }) =>
      new BufferAttribute(i.u32 ? new Uint32Array(bin, i.off, i.count) : new Uint16Array(bin, i.off, i.count), 1);

    for (const [name, s] of Object.entries(json.statics)) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(bin, s.pos, s.verts * 3), 3));
      // Normals are packed int8x4; read the first three of every four bytes.
      g.setAttribute('normal', new InterleavedBufferAttribute(new InterleavedBuffer(new Int8Array(bin, s.nrm, s.verts * 4), 4), 3, 0, true));
      g.setAttribute('uv', new BufferAttribute(new Float32Array(bin, s.uv, s.verts * 2), 2));
      g.setIndex(index(s.idx));
      // Re-base so the model stands on y = 0, centred on x/z.
      const min = new Vector3(...s.min);
      const max = new Vector3(...s.max);
      g.translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
      const size = max.clone().sub(min);
      bounds.set(`kk:${name}`, { min: new Vector3(-size.x / 2, 0, -size.z / 2), max: new Vector3(size.x / 2, size.y, size.z / 2), size });
      registerGeometry(`kk:${name}`, g);
    }

    CHAR_FRAMES = json.frames;
    for (const [name, c] of Object.entries(json.chars)) {
      const min = new Vector3(...c.min);
      const max = new Vector3(...c.max);
      const size = max.clone().sub(min);
      const uvs = new BufferAttribute(new Float32Array(bin, c.uv, c.verts * 2), 2);
      const idx = index(c.idx);
      c.frames.forEach((off, f) => {
        const q = new Int16Array(bin, off, c.verts * 3);
        const pos = new Float32Array(c.verts * 3);
        for (let i = 0; i < pos.length; i += 3) {
          // Dequantise, standing on y = 0 and centred on x/z.
          pos[i] = ((q[i] + 32768) / 65535) * size.x + min.x - (min.x + max.x) / 2;
          pos[i + 1] = ((q[i + 1] + 32768) / 65535) * size.y;
          pos[i + 2] = ((q[i + 2] + 32768) / 65535) * size.z + min.z - (min.z + max.z) / 2;
        }
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(pos, 3));
        g.setAttribute('uv', uvs);
        g.setIndex(idx);
        g.computeVertexNormals();
        registerGeometry(`kc:${name}:${f}`, g);
      });
      bounds.set(`kc:${name}`, { min: new Vector3(-size.x / 2, 0, -size.z / 2), max: new Vector3(size.x / 2, size.y, size.z / 2), size });
      charNames.add(name);
      charTexture.set(name, c.tex);
    }
    loaded = true;
    return true;
  } catch (e) {
    console.warn('KayKit assets unavailable; using primitives.', e);
    return false;
  }
}
