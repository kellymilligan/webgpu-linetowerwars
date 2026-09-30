#!/usr/bin/env node
/**
 * Cross-engine determinism check. Bundles the sim with a scripted war, runs it
 * in Node (V8) as the reference, then in Chromium, Firefox and WebKit via
 * Playwright, and compares the state hash every 5 s of game time.
 *
 *   node scripts/determinism.mjs              # runs whichever engines are installed
 *   node scripts/determinism.mjs --require-all  # CI: every engine must be present
 */
import { build } from 'esbuild';
import vm from 'node:vm';

const requireAll = process.argv.includes('--require-all');
// A long war that reaches sudden death, plus a shorter second seed.
const SCENARIOS = [
  ['det-a', 28],
  ['det-b', 10],
];

const out = await build({ entryPoints: ['scripts/determinism-entry.ts'], bundle: true, format: 'iife', write: false, platform: 'neutral', target: 'es2020' });
const code = out.outputFiles[0].text;

const ctx = vm.createContext({ JSON, Math, Object, Array, Set, Map, Number, String, Symbol, Error });
vm.runInContext(code, ctx);
const reference = SCENARIOS.map(([seed, mins]) => ctx.runScenario(seed, mins));
console.log(`node: ${SCENARIOS.map(([s], i) => `${s} ${reference[i].length - 2} checkpoints, final tick ${reference[i].at(-2)}`).join('; ')}`);

let playwright;
try {
  playwright = await import('playwright');
} catch {
  console.log('playwright not installed; skipping browsers');
  process.exit(requireAll ? 1 : 0);
}

let failed = false;
for (const name of ['chromium', 'firefox', 'webkit']) {
  let browser;
  try {
    browser = await playwright[name].launch();
  } catch (e) {
    console.log(`${name}: not available (${String(e.message).split('\n')[0].slice(0, 80)})`);
    if (requireAll) failed = true;
    continue;
  }
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>determinism</title>');
  await page.addScriptTag({ content: code });
  const t0 = Date.now();
  const results = await page.evaluate((sc) => sc.map(([seed, mins]) => globalThis.runScenario(seed, mins)), SCENARIOS);
  await browser.close();
  for (let i = 0; i < SCENARIOS.length; i++) {
    const a = reference[i];
    const b = results[i];
    const at = a.findIndex((h, k) => h !== b[k]);
    if (at === -1 && a.length === b.length) continue;
    failed = true;
    console.log(`${name}: MISMATCH in ${SCENARIOS[i][0]} at checkpoint ${at} (≈ tick ${(at + 1) * 150})`);
  }
  if (!failed) console.log(`${name}: identical (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
process.exit(failed ? 1 : 0);
