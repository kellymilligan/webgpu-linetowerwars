# Siegeline (webgpu-linetowerwars)

A web-based reimagining of the Warcraft III custom map *Line Tower Wars*.
It's set in a gritty medieval world of warring houses and rendered in
isometric 3D with three.js and WebGPU (with a WebGL 2 fallback). It's the
sister project to [webgpu-gemtd](https://github.com/kellymilligan/webgpu-gemtd).

**Status:** v0.1 grey box. You play one house against 7 bot lords in an
8-player free-for-all. See [`docs/DESIGN.md`](docs/DESIGN.md) for the rules
and direction.

## Run

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # sim tests
npm run balance -- 6 # headless 8-bot matches (bots play worse than people)
```

URL params:
- `?seed=abc` starts a fixed seed.
- `?renderer=webgl|webgpu` forces a backend.
- `?autoplay` hands your seat to a bot.

The game autosaves, and refreshing resumes the match.

## How to play

1. **Muster (30 s).** Wall your road with **palisades** (5g) to make a long
   maze.
2. **Raise palisades** into towers: click a palisade and pick a tower. Build
   serpentine walls with alternating gaps.
3. **Gates open.** Spend gold on towers (defence) or **sends** (troops
   marched at the next house on your right).
   - Every send permanently raises your **income**, paid every 12 s.
   - Troops that break through a keep take lives and plunder gold, then
     march on into the next holding.
4. **Blocking the road is allowed**, but enemies will batter down whatever
   is in the way. Rams are built for exactly that.
5. **Last house standing wins.** Sudden death starts at 25:00.

## Controls

| Input | Action |
|---|---|
| Q W E R T Y | Arm a tower (palisade, archer, mangonel, cauldron, ballista, banner). Click, or drag to paint. |
| 1–9 | Send troops |
| Click tile or tower | Build popover, or tower popover (upgrade, sell) |
| U / X | Upgrade / sell the selected tower |
| Esc / right-click | Disarm, then deselect |
| Right-drag, arrows | Pan |
| Wheel | Zoom |
| [ ] | Rotate |
| Space | Home |
| O | Overview |
| P | Pause |

## Layout

- `src/sim`: deterministic, lockstep-ready rules, bots and data tables.
- `src/render`: the three.js scene.
- `src/ui`: Preact UI.
- `src/app`: the controller that bridges them.
- `scripts/`: balance runner and screenshots.
- `reference/gemtd/`: files carried over from Gem TD. Not compiled.
