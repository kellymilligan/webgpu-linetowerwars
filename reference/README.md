# reference/gemtd

Curated files copied from `webgpu-gemtd` at commit `33b1fac`, to adapt. They
aren't compiled here, and their imports point at Gem TD paths.

| File | What it's good for |
|---|---|
| `src/sim/rng.ts` | Seeded sfc32 PRNG with serialisable state. Reuse as-is. |
| `src/sim/pathing.ts` | Grid Dijkstra (8-way, no corner cutting), checkpoint routes, block tests. |
| `src/render/capabilities.ts` | WebGPU capability probe with WebGL 2 fallback. Reuse as-is. |
| `src/render/scene.ts` | Renderer, shadows, bloom pipeline, picking, world→screen anchors. |
| `src/render/camera.ts` | Isometric-style rig: pan, zoom, 90° rotation. |
| `src/render/timeOfDay.ts` | Lighting presets and lerping. |
| `src/render/overlays.ts` | Animated path ribbons, hover tile, range rings, highlight marks. |
| `src/render/vfx.ts` | Projectiles, beams, chain lightning, flashes, bursts. |
| `src/render/creeps.ts` | Primitive creature models from 18 body plans, with animation hooks. |
| `src/app/controller.ts` | Fixed-step loop, speed control, selection and hover, autosave. |
| `src/ui/World.tsx` | World-anchored popovers, tags and badges (Preact). |
| `src/ui/styles.css` | Frosted-glass UI tokens and components. |
| `scripts/bot.ts`, `scripts/balance.ts` | Headless bot and balance runner pattern. |
| `package.json`, `tsconfig.json`, `vite.config.ts` | Toolchain setup that works. |
