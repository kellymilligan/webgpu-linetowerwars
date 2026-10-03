import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  Plane,
  Raycaster,
  RenderPipeline,
  Scene,
  Vector2,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { float, luminance, mix, mx_noise_float, pass, saturation, screenUV, smoothstep, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { Controller } from '../app/controller';
import { towerLevel } from '../sim/data/towers';
import { cellIndex, tracePath } from '../sim/pathing';
import { Actors } from './actors';
import { Board } from './board';
import { CameraRig } from './camera';
import { fromWorld, laneCentreX, laneCount, setLaneCount, toWorldX, toWorldZ } from './coords';
import { Overlays } from './overlays';
import { Vfx } from './vfx';
import { BatchSet, setGlow } from './parts';
import type { GeoKey } from './parts';
import { charNames, charTex, fitHeight, fitWidth, staticKeys } from './assets';
import { LightState, moodAt, PRESETS } from './timeOfDay';
import type { Mood } from './timeOfDay';
import { TICK_RATE } from '../sim/data/rules';

export class SceneView {
  readonly renderer: WebGPURenderer;
  readonly rig = new CameraRig();
  readonly scene = new Scene();
  private pipeline!: RenderPipeline;
  private bloomNode!: ReturnType<typeof bloom>;
  private sun = new DirectionalLight('#ffffff', 3);
  private hemi = new HemisphereLight('#ffffff', '#444444', 1);
  private light = new LightState(PRESETS.golden);
  /** Pins a mood (debug, screenshots); null follows the day cycle. */
  forceMood: Mood | null = null;
  private galleryMode = false;
  private zenith = uniform(new Color('#353c47'));
  private horizon = uniform(new Color('#6a717b'));
  private saturationU = uniform(0.55);
  private tintU = uniform(new Vector3(1, 1, 1));
  private board = new Board();
  private actors = new Actors();
  private vfx = new Vfx();
  private overlays = new Overlays();
  private time = 0;
  /** Adaptive resolution: the pixel ratio drops when frames are slow and recovers when they're smooth. */
  private res = { max: 1, min: 1, ratio: 1, fixed: false, ema: 1 / 60, slow: 0, fast: 0, blocked: 0, blockUntil: 0 };
  private raycaster = new Raycaster();
  private groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private runId = -1;
  private roadKey = '';
  private lastPreview: number[] | null = null;
  backend = 'WebGPU';

  constructor(private canvas: HTMLCanvasElement, forceWebGL = false) {
    this.renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL });
  }

  async init() {
    await this.renderer.init();
    const backend = (this.renderer as unknown as { backend: { isWebGPUBackend?: boolean } }).backend;
    this.backend = backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
    // `?lite`: half resolution and no shadows, for slow machines and multi-browser tests.
    const params = new URLSearchParams(location.search);
    const lite = params.has('lite');
    const pinned = Number(params.get('dpr'));
    const max = pinned > 0 ? pinned : lite ? 0.5 : Math.min(window.devicePixelRatio, 2);
    this.res = { ...this.res, max, min: Math.min(max, Math.max(0.5, max * 0.6)), ratio: max, fixed: pinned > 0 || lite };
    this.renderer.setPixelRatio(max);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = !lite;
    this.renderer.shadowMap.type = PCFShadowMap;

    // No environment map: image-based lighting costs every lit pixel and added little under this sky;
    // the hemisphere light carries the fill.
    this.scene.fog = new Fog('#555c66', 60, 200);
    // Sky: a vertical gradient from horizon to zenith behind everything.
    this.scene.backgroundNode = mix(this.horizon, this.zenith, smoothstep(0.35, 0.0, screenUV.y));

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -34;
    sc.right = 34;
    sc.top = 34;
    sc.bottom = -34;
    sc.near = 1;
    sc.far = 160;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.scene.add(this.board.group, this.actors.towers.group, this.actors.ghosts.group, this.actors.creeps.group, this.vfx.group, this.overlays.group);
    this.pipeline = new RenderPipeline(this.renderer);
    const scenePass = pass(this.scene, this.rig.camera);
    const colour = scenePass.getTextureNode('output');
    this.bloomNode = bloom(colour, 0.3, 0.4, 0.8);
    // Grade: drained colour and a cold tint, a heavy vignette, and a little film grain for grit.
    const lit = colour.add(this.bloomNode);
    // Selective: the world is drained and cooled, but firelight (strongly warm for its brightness) keeps its colour.
    const lum = luminance(lit.rgb);
    const warmth = lit.r.sub(lit.b).div(lit.r.add(0.02));
    const keep = smoothstep(0.55, 0.78, warmth).mul(smoothstep(0.04, 0.18, lum)).max(smoothstep(0.6, 1.0, lum));
    const graded = saturation(lit.rgb, mix(this.saturationU, float(1.05), keep)).mul(mix(this.tintU, vec3(1, 1, 1), keep));
    const d = screenUV.sub(0.5).length();
    const vignette = mix(float(1), float(0.55), smoothstep(0.35, 0.85, d));
    const grain = mx_noise_float(vec3(screenUV.mul(vec2(1400, 900)), time.mul(37))).mul(0.03);
    this.pipeline.outputNode = vec4(graded.mul(vignette).add(grain), lit.a);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
  }

  focusLane(lane: number, snap = false) {
    // Frame the canyon with its citadel gate and the face of the range above it.
    this.rig.focus(laneCentreX(lane), -4.5);
    if (snap) this.rig.snap();
  }

  /** Converts a client-space pointer position to a lane cell. */
  pick(clientX: number, clientY: number): { lane: number; x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hit = new Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    return fromWorld(hit.x, hit.z);
  }

  private tmpV = new Vector3();

  project(wx: number, wy: number, wz: number): { x: number; y: number; visible: boolean } {
    const v = this.tmpV.set(wx, wy, wz).project(this.rig.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * rect.width + rect.left, y: ((1 - v.y) / 2) * rect.height + rect.top, visible: v.z < 1 && v.x > -1.2 && v.x < 1.2 };
  }

  /**
   * Keeps world-anchored UI glued to the scene. Elements carry data-lane plus
   * lane-local data-wx / data-wy, and an optional height data-wh.
   */
  updateAnchors(root: HTMLElement) {
    const els = root.querySelectorAll<HTMLElement>('[data-wx]');
    const vw = window.innerWidth;
    for (const el of els) {
      const lane = Number(el.dataset.lane ?? 0);
      const p = this.project(toWorldX(lane, Number(el.dataset.wx)), Number(el.dataset.wh ?? 1.2), toWorldZ(Number(el.dataset.wy)));
      let x = p.x;
      if (el.dataset.clamp) {
        const child = el.firstElementChild as HTMLElement | null;
        const w = child?.offsetWidth ?? 0;
        const h = child?.offsetHeight ?? 0;
        x = Math.max(w / 2 + 12, Math.min(vw - w / 2 - 12, x));
        el.classList.toggle('below', p.y - h - 24 < 64);
      }
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(p.y)}px)`;
      el.style.visibility = p.visible ? '' : 'hidden';
      // Fade labels out when zoomed far away so the overview stays clean.
      if (el.dataset.fade) el.style.opacity = String(Math.max(0, Math.min(1, (150 - this.rig.distance) / 40)));
    }
  }

  /**
   * Keeps frame time near the display's: below ~45 fps for 2 s steps the
   * resolution down; a steady 57+ fps for 6 s steps it back up. It won't
   * retry a level that was too slow for 30 s, so it doesn't oscillate.
   * `?dpr=` pins it.
   */
  private adaptResolution(dt: number) {
    const r = this.res;
    if (r.fixed || dt <= 0) return;
    r.ema += (dt - r.ema) * 0.05;
    if (r.ema > 1 / 45) {
      r.slow += dt;
      r.fast = 0;
    } else if (r.ema < 1 / 57) {
      r.fast += dt;
      r.slow = 0;
    } else r.slow = r.fast = 0;
    let next = r.ratio;
    if (r.slow > 2 && r.ratio > r.min) {
      next = Math.max(r.min, r.ratio - 0.25);
      r.blocked = r.ratio;
      r.blockUntil = this.time + 30;
    } else if (r.fast > 6 && r.ratio < r.max && !(this.time < r.blockUntil && r.ratio + 0.25 >= r.blocked)) {
      next = Math.min(r.max, r.ratio + 0.25);
    }
    if (next !== r.ratio) {
      r.ratio = next;
      r.slow = r.fast = 0;
      r.ema = 1 / 60;
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }

  frame(ctl: Controller, alpha: number, dt: number) {
    this.time += dt;
    this.adaptResolution(dt);
    const s = ctl.state;
    if (this.galleryMode) ctl.focusRequest = null;
    if (ctl.focusRequest !== null) {
      this.focusLane(ctl.focusRequest, this.runId === -1);
      ctl.focusRequest = null;
    }
    this.rig.update(dt);
    // Fog follows zoom so the overview stays legible and close-ups stay moody.
    const fog = this.scene.fog as Fog;
    fog.near = this.rig.distance * 0.9;
    fog.far = this.rig.distance * 2.8 + 40;

    // Keep the shadow frustum centred on what the camera is looking at.
    const t = this.rig.target;
    this.sun.target.position.set(t.x, 0, t.z);
    const ms = ctl.state.tick / TICK_RATE;
    const mood = this.forceMood ?? moodAt(ms);
    this.light.approach(PRESETS[mood], 1 - Math.exp(-dt * 0.6));
    const Lt = this.light;
    this.sun.color.copy(Lt.sun);
    this.sun.intensity = Lt.sunIntensity;
    this.hemi.color.copy(Lt.hemiSky);
    this.hemi.groundColor.copy(Lt.hemiGround);
    this.hemi.intensity = Lt.hemiIntensity * 1.15;
    (this.scene.fog as Fog).color.copy(Lt.fog);
    this.zenith.value.copy(Lt.zenith);
    this.horizon.value.copy(Lt.horizon);
    this.saturationU.value = Lt.saturation;
    this.tintU.value.set(Lt.tint.r, Lt.tint.g, Lt.tint.b);
    this.renderer.toneMappingExposure = Lt.exposure;
    setGlow(Lt.glow);
    const ce = Math.cos(Lt.sunElevation);
    const d = 70;
    this.sun.position.set(t.x + Math.sin(Lt.sunAzimuth) * ce * d, Math.sin(Lt.sunElevation) * d, t.z + Math.cos(Lt.sunAzimuth) * ce * d);

    if (ctl.runId !== this.runId) {
      this.runId = ctl.runId;
      // A room without bots has fewer lanes; re-lay the realm to match.
      if (setLaneCount(s.players.length)) {
        this.board.layout();
        this.focusLane(ctl.me, true);
      }
      this.actors.clear();
      this.vfx.clear();
      this.roadKey = '';
    }
    const events = ctl.drainEvents();
    for (const e of events) {
      if (e.type === 'fire') this.actors.noteFire(e.towerId, e.tx - e.x, e.ty - e.y);
      if (e.type === 'leak' && e.victim === ctl.me) this.rig.kick(0.6 + Math.min(0.6, e.lives * 0.15));
    }
    this.vfx.focusLane = ctl.me;
    this.vfx.handle(events, ctl.speed >= 4 || this.vfx.count > 350);
    this.board.update(
      s.players.map((p) => p.colour),
      s.players.map((p) => !p.alive),
      this.time,
      this.light.glow,
      this.rig.target,
    );
    // Only lanes near the view get drawn; zoomed far out, cheap stand-ins replace detailed models.
    const cam = this.rig;
    const half = cam.distance * Math.tan((cam.camera.fov * Math.PI) / 360) * cam.camera.aspect * 1.9 + 8;
    this.actors.view.minX = cam.target.x - half;
    this.actors.view.maxX = cam.target.x + half;
    this.actors.view.detailed = cam.distance < 115;
    this.board.setDetail(cam.distance < 130);
    this.actors.sync(s, alpha, this.time, this.rig.camera.quaternion, dt);
    this.actors.syncGhosts(ctl.ghosts, this.time, s.players[ctl.me]?.colour ?? '#ffffff');
    this.vfx.syncProjectiles(s.projectiles, alpha);
    this.vfx.update(dt);

    // The player's road, and the preview while hovering a build spot.
    const L = s.lanes[ctl.me];
    const key = `${s.towers.length}:${L.pathLength}:${L.blocked}:${this.runId}`;
    if (key !== this.roadKey) {
      this.roadKey = key;
      this.overlays.setRoad(ctl.me, L.blocked ? tracePath(L.grid, L.breach) : tracePath(L.grid, L.open), L.blocked);
    }
    const preview = ctl.hover?.preview ?? null;
    if (preview !== this.lastPreview) {
      this.lastPreview = preview;
      this.overlays.setPreview(ctl.me, preview);
    }
    const h = ctl.hover;
    const showHover = h && h.lane === ctl.me && s.phase !== 'over' && (h.check || ctl.armed);
    this.overlays.setHover(showHover ? { lane: h.lane, x: h.x, y: h.y, state: !h.check?.ok ? 'bad' : h.check.blocks ? 'blocks' : 'ok' } : null);
    this.board.gridOpacity.value += ((ctl.armed || ctl.selection?.kind === 'tile' ? 0.55 : 0.12) - this.board.gridOpacity.value) * Math.min(1, dt * 4);
    this.updateSelection(ctl);
    this.overlays.update(this.time);

    this.bloomNode.strength.value = this.light.bloom;
    this.pipeline.render();
  }

  private updateSelection(ctl: Controller) {
    const s = ctl.state;
    const sel = ctl.selection;
    let range: { lane: number; x: number; y: number; radius: number; colour?: string } | null = null;
    let tile: { lane: number; x: number; y: number } | null = null;
    const ringFor = (t: (typeof s.towers)[number]) => {
      const lv = towerLevel(t);
      const r = lv.attack?.range ?? lv.auraRange;
      return r > 0 ? { lane: t.lane, x: t.x + 0.5, y: t.y + 0.5, radius: r, colour: lv.attack ? '#ffe2a8' : '#ffd27a' } : null;
    };
    if (sel?.kind === 'tower') {
      const t = s.towers.find((t) => t.id === sel.id);
      if (t) {
        tile = t;
        range = ringFor(t);
      }
    } else if (sel?.kind === 'tile') tile = sel;
    if (!range && ctl.hover) {
      const id = s.lanes[ctl.hover.lane].grid[cellIndex(ctl.hover.x, ctl.hover.y)];
      const t = id ? s.towers.find((t) => t.id === id) : undefined;
      if (t) range = ringFor(t);
    }
    this.overlays.setRange(range);
    this.overlays.setSelected(tile);
  }

  /** Debug and screenshots: jump straight to a mood (null resumes the cycle). */
  snapMood(m: Mood | null) {
    this.forceMood = m;
    if (m) this.light.set(PRESETS[m]);
  }

  /** Rebuild scenery once loaded models are available. */
  assetsChanged() {
    this.board.rebuild();
  }

  /** Debug: lay out every loaded model in a grid for review (?gallery). */
  gallery() {
    const set = new BatchSet();
    set.begin();
    const keys = [...[...charNames].map((c) => `kc:${c}:0`), ...staticKeys()];
    keys.forEach((key, i) => {
      const x = (i % 10) * 4 - 18;
      const z = Math.floor(i / 10) * 4 - 12;
      const isChar = key.startsWith('kc:');
      const s = isChar ? fitHeight(key.split(':').slice(0, 2).join(':'), 2) : fitWidth(key, 3.2);
      const mat = isChar ? (`char:${charTex(key)}` as const) : key.includes('mountain') ? 'peak' : key.includes('tree') ? 'atlasFoliage' : 'atlas';
      set.get(key as GeoKey, mat).push(x, 0, z, 0.6, s, s, s, '#ffffff');
    });
    set.end();
    this.scene.add(set.group);
    for (const g of [this.board.group, this.actors.towers.group, this.actors.creeps.group, this.overlays.group]) g.visible = false;
    this.galleryMode = true;
    this.rig.focus(0, -2, 64);
    this.rig.snap();
  }

  /** Debug: frame the whole realm. */
  overview() {
    this.rig.focus(0, 2, 60 + laneCount() * 15);
  }
}
