import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  PMREMGenerator,
  Plane,
  Raycaster,
  RenderPipeline,
  Scene,
  Vector2,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Controller } from '../app/controller';
import { phaseForWave, START_LIVES, waveDef } from '../sim/data/waves';
import { effectiveAttack, towerDef } from '../sim/towers';
import { gemTowerDef } from '../sim/data/gems';
import type { Route, TimePhase } from '../sim/types';
import { Actors } from './actors';
import { Board } from './board';
import { CameraRig } from './camera';
import { toTileX, toTileY, toWorldX, toWorldZ } from './coords';
import { updateGemGlow, FAMILY_COLOURS } from './gems';
import { Overlays } from './overlays';
import { LightState, PRESETS } from './timeOfDay';
import { Vfx } from './vfx';

export class SceneView {
  readonly renderer: WebGPURenderer;
  readonly rig = new CameraRig();
  readonly scene = new Scene();
  private pipeline!: RenderPipeline;
  private bloomNode!: ReturnType<typeof bloom>;
  private sun = new DirectionalLight('#ffffff', 3);
  private hemi = new HemisphereLight('#ffffff', '#444444', 1);
  private board = new Board();
  private actors = new Actors();
  private vfx = new Vfx();
  private overlays = new Overlays();
  private light = new LightState(PRESETS.day);
  private phase: TimePhase = 'day';
  private time = 0;
  private raycaster = new Raycaster();
  private groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private lastGround: Route | null = null;
  private lastPreview: Route | null = null;
  private heartPulse = 0;
  private runId = 0;
  backend = 'WebGPU';

  constructor(private canvas: HTMLCanvasElement, forceWebGL = false) {
    this.renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL });
  }

  async init() {
    await this.renderer.init();
    const backend = (this.renderer as unknown as { backend: { isWebGPUBackend?: boolean } }).backend;
    this.backend = backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.fog = new Fog('#cfe2ee', 95, 230);
    this.scene.background = new Color('#cfe2ee');

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -24;
    sc.right = 24;
    sc.top = 24;
    sc.bottom = -24;
    sc.near = 1;
    sc.far = 120;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.scene.add(this.board.group, this.actors.group, this.vfx.group, this.overlays.group);

    this.pipeline = new RenderPipeline(this.renderer);
    const scenePass = pass(this.scene, this.rig.camera);
    const colour = scenePass.getTextureNode('output');
    this.bloomNode = bloom(colour, 0.3, 0.35, 0.85);
    this.pipeline.outputNode = colour.add(this.bloomNode);

    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
  }

  /** Converts a client-space pointer position to a board tile. */
  pick(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hit = new Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    return { x: toTileX(hit.x), y: toTileY(hit.z) };
  }

  /** Debug/preview: pin the time of day, jumping straight to it. */
  forcePhase: TimePhase | null = null;
  snapLighting(phase: TimePhase) {
    this.forcePhase = phase;
    this.light.set(PRESETS[phase]);
  }

  private tmpV = new Vector3();

  /** World position of a tile (plus height) in canvas pixels. */
  project(x: number, y: number, h: number): { x: number; y: number; visible: boolean } {
    const v = this.tmpV.set(toWorldX(x), h, toWorldZ(y)).project(this.rig.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * rect.width + rect.left, y: ((1 - v.y) / 2) * rect.height + rect.top, visible: v.z < 1 };
  }

  /**
   * Keeps world-anchored UI (popovers, badges) glued to the scene. Elements
   * carry data-wx / data-wy (tile coords) and optional data-wh (height).
   */
  updateAnchors(root: HTMLElement) {
    const els = root.querySelectorAll<HTMLElement>('[data-wx]');
    const vw = window.innerWidth;
    for (const el of els) {
      const p = this.project(Number(el.dataset.wx), Number(el.dataset.wy), Number(el.dataset.wh ?? 1.2));
      let x = p.x;
      if (el.dataset.clamp) {
        // Keep popovers on screen: clamp sideways, flip below near the top.
        const child = el.firstElementChild as HTMLElement | null;
        const w = child?.offsetWidth ?? 0;
        const h = child?.offsetHeight ?? 0;
        x = Math.max(w / 2 + 12, Math.min(vw - w / 2 - 12, x));
        el.classList.toggle('below', p.y - h - 24 < 64);
      }
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(p.y)}px)`;
      el.style.visibility = p.visible ? '' : 'hidden';
    }
  }

  frame(ctl: Controller, alpha: number, dt: number) {
    this.time += dt;
    const s = ctl.state;
    this.rig.update(dt);

    // Time of day follows the wave; transitions ease over a few seconds.
    this.phase = this.forcePhase ?? phaseForWave(s.wave);
    this.light.approach(PRESETS[this.phase], 1 - Math.exp(-dt * 0.8));
    this.applyLighting();

    if (ctl.runId !== this.runId) {
      this.runId = ctl.runId;
      this.actors.clear();
      this.vfx.clear();
    }
    const events = ctl.drainEvents();
    for (const e of events) if (e.type === 'leak') this.heartPulse = 1;
    this.vfx.handle(events, this.light.glow);
    this.board.syncStones(s.grid);
    this.actors.sync(s, alpha, this.time);
    this.vfx.syncProjectiles(s.projectiles, alpha);
    this.vfx.update(dt);
    this.heartPulse = Math.max(0, this.heartPulse - dt * 2);
    this.board.update(this.time, this.light.glow + this.heartPulse * 3, s.lives / START_LIVES);

    // Overlays.
    if (s.groundRoute !== this.lastGround) {
      this.lastGround = s.groundRoute;
      this.overlays.setRoutes(s.groundRoute, s.airRoute);
    }
    const preview = ctl.hover?.preview ?? null;
    if (preview !== this.lastPreview) {
      this.lastPreview = preview;
      this.overlays.setPreview(preview);
    }
    const h = ctl.hover;
    this.overlays.setHover(h && s.phase === 'build' ? { x: h.x, y: h.y, ok: !!h.check?.ok } : null);
    this.board.gridOpacity.value += ((s.phase === 'build' ? 0.4 : 0.08) - this.board.gridOpacity.value) * Math.min(1, dt * 4);
    this.updateSelectionOverlay(ctl);
    const hl = ctl.highlight;
    this.overlays.setMarks(hl?.target ?? null, hl?.consumed ?? []);
    this.overlays.setAirEmphasis(s.phase !== 'wave' && waveDef(s.seed, s.wave).groups.some((g) => g.archetype.air));
    this.overlays.update(this.time);

    this.pipeline.render();
  }

  private updateSelectionOverlay(ctl: Controller) {
    const s = ctl.state;
    const sel = ctl.selection;
    let range: { x: number; y: number; radius: number; colour?: string } | null = null;
    let tile: { x: number; y: number } | null = null;
    if (sel?.kind === 'tower') {
      const t = s.towers.find((t) => t.id === sel.id);
      if (t) {
        tile = t;
        range = { x: t.x + 0.5, y: t.y + 0.5, radius: effectiveAttack(towerDef(t), this.phase).range, colour: FAMILY_COLOURS[t.family] };
      }
    } else if (sel?.kind === 'pending') {
      const p = s.pending.find((p) => p.id === sel.id);
      if (p) {
        tile = p;
        range = { x: p.x + 0.5, y: p.y + 0.5, radius: gemTowerDef(p.family, p.grade).attack.range, colour: FAMILY_COLOURS[p.family] };
      }
    } else if (sel?.kind === 'stone') tile = sel;
    if (!range && ctl.hover) {
      const t = s.towers.find((t) => t.x === ctl.hover!.x && t.y === ctl.hover!.y);
      if (t) range = { x: t.x + 0.5, y: t.y + 0.5, radius: effectiveAttack(towerDef(t), this.phase).range, colour: FAMILY_COLOURS[t.family] };
    }
    this.overlays.setRange(range);
    this.overlays.setSelected(tile);
  }

  private applyLighting() {
    const L = this.light;
    this.sun.color.copy(L.sunColor);
    this.sun.intensity = L.sunIntensity;
    const d = 60;
    const ce = Math.cos(L.sunElevation);
    this.sun.position.set(Math.sin(L.sunAzimuth) * ce * d, Math.sin(L.sunElevation) * d, Math.cos(L.sunAzimuth) * ce * d);
    this.hemi.color.copy(L.skyColor);
    this.hemi.groundColor.copy(L.groundColor);
    this.hemi.intensity = L.hemiIntensity;
    (this.scene.fog as Fog).color.copy(L.fogColor);
    (this.scene.background as Color).copy(L.fogColor);
    this.scene.environmentIntensity = 0.15 + L.hemiIntensity * 0.3;
    this.renderer.toneMappingExposure = L.exposure;
    this.bloomNode.strength.value = L.bloom;
    this.board.grass.value.set(L.grass.r, L.grass.g, L.grass.b);
    updateGemGlow(L.glow);
  }
}
