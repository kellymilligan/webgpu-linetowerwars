import { render } from 'preact';
import { Controller } from './app/controller';
import { webgpuUsable } from './render/capabilities';
import { SceneView } from './render/scene';
import { SENDS, TOWER_KINDS } from './sim';
import { createBrain } from './sim/bot';
import type { TowerKind } from './sim';
import { App } from './ui/App';
import { HOTKEY } from './ui/format';
import './ui/styles.css';

async function main() {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui')!;
  const params = new URLSearchParams(location.search);
  const forced = params.get('renderer');
  const forceWebGL = forced === 'webgl' || (forced !== 'webgpu' && !(await webgpuUsable()));
  const view = new SceneView(canvas, forceWebGL);
  await view.init();

  const seed = params.get('seed');
  const ctl = (!seed && Controller.fromSave()) || new Controller();
  if (seed) ctl.newGame(seed);
  ctl.focusRequest = ctl.me;

  render(<App ctl={ctl} backend={view.backend} />, uiRoot);
  bindInput(canvas, view, ctl);
  window.addEventListener('resize', () => view.resize());

  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const alpha = ctl.tick(dt);
    view.frame(ctl, alpha, dt);
    view.updateAnchors(uiRoot);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Debug handle for headless screenshots and poking at the sim.
  (window as unknown as { ltw: unknown }).ltw = {
    ctl,
    view,
    /** Hands your seat to a bot (for testing and screenshots). */
    autoplay: () => {
      ctl.state.players[ctl.me].bot = createBrain(ctl.state.rng);
    },
  };
  if (params.has('autoplay')) ctl.state.players[ctl.me].bot = createBrain(ctl.state.rng);
}

const KIND_BY_KEY = Object.fromEntries(TOWER_KINDS.map((k) => [`Key${HOTKEY[k]}`, k])) as Record<string, TowerKind>;

function bindInput(canvas: HTMLCanvasElement, view: SceneView, ctl: Controller) {
  let dragging = false;
  let panned = false;
  let painting = false;
  let lastX = 0;
  let lastY = 0;
  let lastPaint = '';

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus();
    lastX = e.clientX;
    lastY = e.clientY;
    if (e.button === 2 || e.button === 1) {
      dragging = true;
      panned = false;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const t = view.pick(e.clientX, e.clientY);
    if (!t) {
      ctl.select(null);
      return;
    }
    // With a tower armed, hold and drag to paint a wall.
    if (ctl.armed && t.lane === ctl.me) {
      painting = true;
      lastPaint = `${t.x},${t.y}`;
      canvas.setPointerCapture(e.pointerId);
    }
    ctl.clickTile(t.lane, t.x, t.y);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) panned = true;
      view.rig.panPixels(dx, dy, canvas.clientHeight);
      lastX = e.clientX;
      lastY = e.clientY;
      return;
    }
    const t = view.pick(e.clientX, e.clientY);
    ctl.setHover(t);
    if (painting && t && t.lane === ctl.me && ctl.armed) {
      const key = `${t.x},${t.y}`;
      if (key !== lastPaint) {
        lastPaint = key;
        ctl.clickTile(t.lane, t.x, t.y);
      }
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (dragging && !panned && e.button === 2) ctl.cancel();
    dragging = false;
    painting = false;
  });
  canvas.addEventListener('pointerleave', () => ctl.setHover(null));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.rig.zoom(e.deltaY);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    view.rig.setKey(e.code, true);
    if (e.repeat) return;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const sd = SENDS[Number(digit[1]) - 1];
      if (sd) ctl.send(sd.id);
      return;
    }
    if (KIND_BY_KEY[e.code]) {
      ctl.arm(KIND_BY_KEY[e.code]);
      return;
    }
    const sel = ctl.selection;
    switch (e.code) {
      case 'Escape':
        ctl.cancel();
        break;
      case 'Space':
        e.preventDefault();
        ctl.focusLane(ctl.me);
        break;
      case 'KeyP':
        ctl.togglePause();
        break;
      case 'KeyU':
        if (sel?.kind === 'tower') ctl.upgrade(sel.id);
        break;
      case 'KeyX':
        if (sel?.kind === 'tower') ctl.sell(sel.id);
        break;
      case 'BracketLeft':
        view.rig.rotate(-1);
        break;
      case 'BracketRight':
        view.rig.rotate(1);
        break;
      case 'KeyO':
        view.overview();
        break;
    }
  });
  window.addEventListener('keyup', (e) => view.rig.setKey(e.code, false));
  window.addEventListener('blur', () => {
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) view.rig.setKey(k, false);
  });
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<div class="fatal">Couldn't start the renderer.<br/><small>${String(err)}</small></div>`;
});
