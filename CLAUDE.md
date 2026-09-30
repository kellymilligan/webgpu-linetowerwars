# CLAUDE.md

A web-based, multiplayer reimagining of the classic Warcraft III custom map
**Line Tower Wars**. It's the sister project to
[`webgpu-gemtd`](https://github.com/kellymilligan/webgpu-gemtd) (a Gem TD
reimagining, working title *Facet*), and shares its tech, taste and working
style.

Read these before starting work:
- `docs/LTW-BRIEF.md`: our understanding of Line Tower Wars and the open
  design questions.
- `docs/LEARNINGS.md`: what worked, and what to watch for, from the Gem TD
  build.
- `reference/gemtd/`: curated source files from Gem TD to adapt. Don't
  import from this folder; copy what fits into `src/`.

## How Kelly likes to work

- **Research first, then explain, then build.** For new game directions, Kelly
  wants the mechanics researched and explained, and the creative direction
  agreed, before code. Ask a few focused questions, each with a
  recommendation. Once Kelly says "proceed", build without further check-ins.
- **Milestones:** a grey-box playable loop first ("fun with cubes"), then
  content and balance, then art passes. Ship something playable early.
- **Git:** work directly on `main`. Commit in meaningful chunks with clear
  messages, and push when a chunk is done. No PRs unless asked.
- **Verify before reporting:**
  - typecheck, tests and production build;
  - headless screenshots of the real app (`scripts/screenshot.mjs`), sent
    to Kelly with a short caption.
- **Report honestly:**
  - say what was verified and what wasn't;
  - separate sandbox artefacts from real bugs;
  - flag guesses (e.g. half-remembered map details) as guesses.
- **Keep summaries short:** what changed, how to try it, known gaps, and
  suggested next steps.

## Creative taste

- **An homage, not a clone.** Keep the core formula and what makes it
  compelling. Build a tasteful new world, names and presentation around it.
  Modern QoL changes are welcome.
- **Isometric 3D:**
  - beautiful and interesting, but it must run well in the browser;
  - 60 fps on mid-range hardware is the bar;
  - "Dota 2-level" is the aspiration, not a literal requirement.
- **Visual language:**
  - transparency, refraction and glow;
  - distinct, readable projectile effects for each tower type;
  - vegetation and atmosphere;
  - lots of creature variety.
- **Minimal UI:**
  - frosted-glass panels, restrained typography, nothing overbearing;
  - prefer **world-anchored UI** (popovers and badges on the objects
    themselves) over side panels;
  - Kelly found a side-panel keep list "clunky" in Gem TD, and popovers on
    the gems were a hit.
- **Variety matters.** Kelly noticed repetition quickly. Aim for many creature
  types with real mechanics, not just recolours.
- **Assets:** CC0 packs first (e.g. Quaternius, KayKit). Procedural or
  shader-based where it looks good. Paid or generated assets later to unify
  the look.
- **Dev affordances Kelly uses:**
  - 10× speed;
  - a `?seed=` URL param;
  - "New run" with confirmation;
  - resume on refresh via autosave.

## Tech conventions (proven in Gem TD)

- **Stack:** TypeScript, Vite, three.js `WebGPURenderer` with TSL, Preact for
  UI, Vitest for tests.
  - three ≥ r186: the pipeline class is `RenderPipeline`, since
    `PostProcessing` was renamed.
- **Deterministic sim, separate from rendering:**
  - `src/sim` is pure TS with no DOM or three imports;
  - fixed tick (30 Hz) with a seeded PRNG;
  - plain-JSON state, so saves, replays and netcode come for free;
  - only `Math.sqrt` among the transcendental functions in the sim, for
    cross-browser determinism (see `LEARNINGS.md`).
- **Layout:**
  - `src/sim` (rules and data tables);
  - `src/render` (scene);
  - `src/ui` (Preact);
  - `src/app` (controller that bridges them);
  - `scripts/` (bots, balance runner, screenshots).
- **Headless bot and balance runner** from the start. Use them to sanity-check
  difficulty, and say clearly that bots play worse than humans.
- **Sandbox verification:** Chromium lives at `/opt/pw-browsers`, with
  Playwright installed globally. Headless WebGPU is unusable there, so the app
  must auto-fall back to WebGL 2 (see `reference/gemtd/src/render/capabilities.ts`).
