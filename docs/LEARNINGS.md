# Learnings from webgpu-gemtd

Things that worked, pitfalls, and how Kelly reacted, from building *Facet*
(a Gem TD reimagining) up to a playable v0.3.

## Architecture that paid off

- **Pure, deterministic sim with plain-JSON state:**
  - Saves are `JSON.stringify(state)`. Tests assert that two runs with the
    same seed produce identical state, including after a mid-run JSON
    round-trip.
  - This is the foundation for lockstep multiplayer, replays and "same seed"
    races.
  - Keep every random draw in the sim's RNG (`reference/gemtd/src/sim/rng.ts`,
    sfc32). The renderer may use `Math.random` for cosmetics only.
- **Commands in, events out:**
  - The sim takes `Command`s (place, keep, upgrade…) and returns
    `GameEvent`s (fire, hit, death, leak…).
  - The renderer is driven only by events plus the state; it never feeds
    back into the sim.
  - The command log doubles as the network protocol.
- **Controller bridges sim, renderer and UI** (`reference/gemtd/src/app/controller.ts`):
  - fixed-step accumulator with speed multiplier (1/2/4/10×) and render
    interpolation (`px/py → x/y`);
  - hover previews, selection and highlight state;
  - throttled UI notifications (~8 Hz during waves);
  - autosave to localStorage, with a save-format version bump when the
    schema changes.
- **Data-driven content.** Towers, recipes, creeps and waves are tables.
  - Waves are generated from the seed (`wavePlan(seed)`), so runs vary but
    stay reproducible.
  - Creep abilities are declarative (`evasion`, `shield`, `split`, `heal`,
    `haste`, `blink`, `burrow`, `enrage`, `brood`, immunities) and
    implemented generically in combat.
- **Pathing:**
  - 8-way Dijkstra with no corner cutting, and fixed neighbour order for
    deterministic ties.
  - Placement is rejected if any checkpoint leg becomes unreachable.
  - The same function drives the live "path length +N" hover preview, which
    Kelly liked.

## Rendering notes (three.js r186, WebGPURenderer)

- **Capability probe before choosing a backend:**
  - Some Chromium builds expose WebGPU but reject newer descriptor fields;
    three passes `swizzle: 'rgba'`, which crashes mid-render.
  - `capabilities.ts` probes `createView({ swizzle })` and falls back to
    WebGL 2.
  - `?renderer=webgl|webgpu` forces a backend.
- **Pipeline and shadows:**
  - Post-processing is `RenderPipeline` with `pass()` and `bloom()`; set
    `bloomNode.strength.value` per frame.
  - `PCFSoftShadowMap` is removed in the WebGPU renderer; use
    `PCFShadowMap`.
- **Colours and tone mapping:**
  - TSL colour uniforms don't type-check with `.mul()` in @types/three; use a
    `Vector3` uniform for tints.
  - ACES tone mapping and a cooler hemisphere light gave better saturation
    than AgX for the stylised look.
- **Look:**
  - Time-of-day presets (day, dusk, night, dawn) lerp lighting, fog, bloom
    and glow. Kelly loved this, and night is where the glow shines.
  - Gems use `MeshPhysicalMaterial` (transmission, dispersion, clearcoat,
    iridescence for opal).
  - Showing grade progression through geometry (rough chunk → cut → brilliant)
    was a hit.
- **World-anchored UI:**
  - Preact renders elements with `data-wx/wy/wh`.
  - Each frame, `scene.updateAnchors()` projects them to screen, clamping
    popovers to the viewport and flipping them below near the top.
  - This replaced a side panel and was clearly better.
- **Headless screenshots:**
  - SwiftShader runs at about 1 fps, so VFX with a 0.2–0.7 s lifetime linger
    across frames. That's an artefact, not a leak.
  - Cap the live effect count anyway.
  - Drive the game through `window.<debug handle>` and a `--eval` script.

## Balance lessons

- **Opening:** it was "unforgiving" before the maze formed. Easing HP over the
  first 5 waves and delaying elites fixed the complaint.
- **Air waves:** these stayed "really tough" even after buffs. Flyers ignore
  the maze, and few towers cover straight flight lines.
  - For LTW, give anti-air clear, affordable answers from the start.
  - Visualise air coverage.
- **Bots:** a greedy bot gives a useful floor but plays much worse than a
  human, and must not over-value niche towers (it once kept only air-only
  gems and died on wave 5).
- **Combining:** combining must beat keeping separate pieces. We made each
  step ×2.2 damage per grade.
- **Mixed waves:** Kelly worried about speed mismatches. Support creeps now
  travel at the pack's pace, and different packs spawn one after another.

## Process lessons

- **Ask, recommend, then execute.** Kelly answered design questions quickly
  when they came with a recommended option.
- **Review in screenshots:** a gallery screenshot (every creep in a grid) was
  an efficient way to review variety.
- **Killing the dev server:** don't `pkill -f "vite --port"` from a shell whose
  own command line matches the pattern; it kills the shell (exit 144). Use
  `pgrep -f "[n]ode.*vite --port 5173"`.
