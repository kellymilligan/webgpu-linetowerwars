#!/usr/bin/env node
/**
 * Two-browser multiplayer smoke test against local servers:
 *   npm run server   (wrangler dev on :8787)   and   npm run dev (vite on :5173)
 *   node scripts/mp-e2e.mjs [outDir]
 * Two isolated Chromium contexts join one room, the host begins, both act,
 * then the host pauses and we compare state fingerprints and take screenshots.
 */
import { execSync } from 'node:child_process';

const out = process.argv[2] ?? '.';
const noBots = process.argv.includes('--no-bots');
const root = execSync('npm root -g').toString().trim();
const { chromium } = await import(`${root}/playwright/index.mjs`);
// One browser process per player: software GL in one process starves a second page.
const browsers = [];
const launch = async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  browsers.push(b);
  return b;
};
const room = `e2e${Date.now().toString(36).slice(-4)}`;
const url = `http://localhost:5173/?room=${room}&renderer=webgl`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function player(name) {
  const ctx = await (await launch()).newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('CERT') && console.log(`[${name} console]`, m.text().slice(0, 200)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ltw?.ctl?.net?.connected, null, { timeout: 30000 });
  await page.fill('.lobby input:not([readonly])', name);
  await page.press('.lobby input:not([readonly])', 'Enter');
  return page;
}

const a = await player('Kelly');
const b = await player('Guest');
await wait(800);
await b.click('.swatch-btn:nth-child(3)');
await wait(500);
await a.screenshot({ path: `${out}/mp-lobby.png` });
const who = async (p) => p.evaluate(() => ({ seat: window.ltw.ctl.net.seat, host: window.ltw.ctl.net.host, members: window.ltw.ctl.net.members }));
console.log('A', JSON.stringify(await who(a)));
console.log('B', JSON.stringify((await who(b)).seat));

if (noBots) {
  await a.click('.toggle input');
  await wait(600);
  await a.screenshot({ path: `${out}/mp-lobby-nobots.png` });
}
await a.click('text=Begin the war');
await a.waitForFunction(() => window.ltw.ctl.net.state && window.ltw.ctl.net.phase === 'playing', null, { timeout: 15000 });
await b.waitForFunction(() => window.ltw.ctl.net.state, null, { timeout: 15000 });

// Host builds a wall; guest builds too, then sends once the gates open.
await a.evaluate(() => { const c = window.ltw.ctl; for (let x = 0; x < 10; x++) c.build(x, 6, x % 3 ? 'palisade' : 'archer'); });
await b.evaluate(() => { const c = window.ltw.ctl; for (let x = 1; x < 11; x++) c.build(x, 8, x % 4 ? 'palisade' : 'archer'); });
for (let i = 0; i < 40; i++) {
  const st = await a.evaluate(() => ({ phase: window.ltw.ctl.state.phase, tick: window.ltw.ctl.state.tick, frontier: window.ltw.ctl.net.frontier }));
  if (i % 5 === 0) console.log('host', JSON.stringify(st));
  if (st.phase === 'battle') break;
  await wait(3000);
}
await b.evaluate(() => { window.ltw.ctl.send('levies'); window.ltw.ctl.send('footmen'); });
await wait(9000);

await a.evaluate(() => window.ltw.ctl.togglePause());
// Paused: the server stops issuing turns; wait for both clients to come to rest at the frontier.
for (const p of [a, b]) {
  await p.waitForFunction(() => window.ltw.ctl.net.paused && window.ltw.ctl.state.tick === window.ltw.ctl.net.frontier, null, { timeout: 60000 });
}
await wait(1500);
const fp = (p) => p.evaluate(() => {
  const s = JSON.stringify(window.ltw.ctl.state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const st = window.ltw.ctl.state;
  return { tick: st.tick, hash: h >>> 0, towers: st.towers.filter((t) => t.lane < 2).length, creeps: st.creeps.length, desyncs: window.ltw.ctl.net.desyncs };
});
const fa = await fp(a);
const fb = await fp(b);
console.log('A state', JSON.stringify(fa));
console.log('B state', JSON.stringify(fb));
console.log(fa.tick === fb.tick && fa.hash === fb.hash ? 'IN SYNC' : 'MISMATCH');
await a.evaluate(() => window.ltw.ctl.togglePause());
await wait(4000);
// Ghost build: order a tower while the host pauses (the server holds commands), and capture it.
await a.evaluate(() => window.ltw.ctl.togglePause());
await wait(1200);
await b.evaluate(() => { const c = window.ltw.ctl; c.build(5, 12, 'archer'); c.build(6, 12, 'mangonel'); window.ltw.view.rig.focus(window.ltw.ctl.me * 17 - 12, 0, 28); });
await wait(2500);
await b.screenshot({ path: `${out}/mp-ghost.png` });
console.log('guest ghosts', await b.evaluate(() => window.ltw.ctl.ghosts.length), 'lanes', await b.evaluate(() => window.ltw.ctl.state.players.length));
await a.evaluate(() => window.ltw.ctl.togglePause());
await wait(3000);
await a.screenshot({ path: `${out}/mp-host.png` });
await b.screenshot({ path: `${out}/mp-guest.png` });
for (const b of browsers) await b.close();
