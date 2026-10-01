#!/usr/bin/env node
/**
 * Bakes KayKit CC0 assets into public/assets/kaykit/ (pack.json + pack.bin +
 * textures). Needs the source packs in .cache/kaykit (see docs/ASSETS.md) and
 * a running `npm run dev`.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

const root = execSync('npm root -g').toString().trim();
const { chromium } = await import(`${root}/playwright/index.mjs`);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/scripts/bake/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.bakeReady, null, { timeout: 60000 });
const { json, bin } = await page.evaluate(() => window.bake());
await browser.close();

const out = 'public/assets/kaykit';
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/pack.json`, JSON.stringify(json));
writeFileSync(`${out}/pack.bin`, Buffer.from(bin, 'base64'));
copyFileSync('.cache/kaykit/decoration/nature/hexagons_medieval.png', `${out}/atlas.png`);
for (const t of ['knight', 'barbarian', 'rogue', 'mage', 'skeleton']) copyFileSync(`.cache/kaykit/${t}_texture.png`, `${out}/${t}.png`);
for (const l of ['hexagon', 'adventurers', 'skeletons']) copyFileSync(`.cache/kaykit/LICENSE-${l}.txt`, `${out}/LICENSE-${l}.txt`);
console.log(`baked ${Object.keys(json.statics).length} models, ${Object.keys(json.chars).length} characters, ${(Buffer.from(bin, 'base64').length / 1024).toFixed(0)} KB`);
