#!/usr/bin/env node
/**
 * Headless screenshot of the running dev server, for checking visuals.
 *
 *   node scripts/screenshot.mjs <out.png> [--url URL] [--eval file.js] [--wait ms] [--after ms] [--stats]
 *
 * --eval runs a JS file in the page after load (e.g. to drive the game via a
 * window debug handle), then waits --after ms before capturing.
 * --stats prints frame time, draw calls and triangles (a relative measure:
 * software rendering is far slower than any real GPU).
 *
 * Notes: headless Chromium in cloud sandboxes often lacks usable WebGPU, so the
 * app should fall back to WebGL 2. SwiftShader renders at ~1 fps, so short-lived
 * effects linger in captures; that is an artefact, not a bug.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return await import(`${root}/playwright/index.mjs`);
  }
}

const args = process.argv.slice(2);
const out = args[0] ?? 'screenshot.png';
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const url = opt('url', 'http://localhost:5173/');
const evalFile = opt('eval');
const wait = Number(opt('wait', 4000));
const after = Number(opt('after', 3000));

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForTimeout(wait);
if (evalFile) {
  await page.evaluate(readFileSync(evalFile, 'utf8'));
  await page.waitForTimeout(after);
}
if (args.includes('--stats')) {
  const st = await page.evaluate(async () => {
    const r = window.ltw.view.renderer;
    const t0 = performance.now();
    let frames = 0;
    await new Promise((done) => {
      const f = () => (++frames >= 5 ? done() : requestAnimationFrame(f));
      requestAnimationFrame(f);
    });
    const ms = (performance.now() - t0) / frames;
    return { ms: Math.round(ms), calls: r.info.render.drawCalls, triangles: r.info.render.triangles };
  });
  console.log(`stats: ${st.ms} ms/frame (software), ${st.calls} draw calls, ${st.triangles} triangles`);
}
await page.screenshot({ path: out, timeout: 180_000 });
console.log(`saved ${out}`);
await browser.close();
