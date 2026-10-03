import { render } from 'preact';
import { Controller } from './app/controller';
import { webgpuUsable } from './render/capabilities';
import { SceneView } from './render/scene';
import { loadAssets } from './render/assets';
import { createGame, SENDS, TOWER_KINDS } from './sim';
import { joinRoom, roomFromUrl } from 'lobbyhop/client';
import { mountLobby } from 'lobbyhop/lobby-ui';
import { game } from './multiplayer/game';
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
  // Models load alongside renderer start-up; primitives stand in if they can't.
  await Promise.all([view.init(), loadAssets()]);
  view.assetsChanged();
  if (params.has('gallery')) view.gallery();

  const room = roomFromUrl();
  const seed = params.get('seed');
  let ctl: Controller;
  if (room) {
    // Multiplayer: a quiet placeholder realm shows behind the lobby until the war starts.
    ctl = new Controller(createGame('council', { humans: [] }));
    // Dev aid: ?lag=250 adds a simulated 250 ms round trip, to feel ghosts and interpolation under a slow link.
    const lag = Number(params.get('lag') ?? 0);
    const joined = joinRoom(game, { room, host: import.meta.env.VITE_ROOM_HOST as string | undefined, profileKey: 'siegeline.profile', simulateLatency: lag });
    ctl.attachNet(joined);
    mountLobby(joined, {
      title: 'War council',
      subtitle: 'Share the link. Each lord holds a lane; send troops at the house on your right.',
      settings: [{ key: 'fillBots', label: 'Fill empty seats with bot lords', type: 'toggle', hint: 'Off: one holding per lord (a lone lord faces one bot).' }],
      emptySeat: (s) => (s.fillBots ? 'Bot lord' : 'Open seat'),
      overText: (r) => {
        const s = r.state;
        return s && s.winner !== null ? `House ${s.players[s.winner].name} holds the realm.` : 'The war is over.';
      },
      labels: { start: 'Begin the war', waiting: 'Waiting for the host to begin…', rematch: 'Rematch', toLobby: 'Back to the council', openSeat: 'Open seat' },
    });
    // For lobbyhop's e2e runner and the console.
    (window as unknown as { lobbyhop: unknown }).lobbyhop = { room: joined };
  } else {
    ctl = (!seed && Controller.fromSave()) || new Controller();
    if (seed) ctl.newGame(seed);
  }
  ctl.focusRequest = ctl.me;

  render(<App ctl={ctl} backend={view.backend} />, uiRoot);
  bindInput(canvas, view, ctl);
  window.addEventListener('resize', () => view.resize());

  let last = performance.now();
  const loop = (now: number) => {
    const raw = (now - last) / 1000;
    const dt = Math.min(0.1, raw);
    last = now;
    // A room paces itself (and sprints to catch up after a stall), so it gets the real elapsed time.
    const alpha = ctl.tick(ctl.net ? raw : dt);
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
      // Local only: in a room this would desync from the server.
      if (!ctl.net) ctl.state.players[ctl.me].bot = createBrain(ctl.state.rng);
    },
  };
  if (params.has('autoplay') && !room) ctl.state.players[ctl.me].bot = createBrain(ctl.state.rng);
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
