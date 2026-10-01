# Assets

## KayKit (CC0)

The 3D models are from Kay Lousberg's **KayKit** packs, released under
**CC0** (public domain). Credit is appreciated, not required.
- [Medieval Hexagon Pack](https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0):
  castles, towers, houses, mountains, trees, rocks and props.
- [Adventurers Character Pack](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0):
  knight, barbarian, mage and rogues.
- [Skeletons Character Pack](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0):
  wights for the neutral raids.

Licence files ship next to the baked pack in `public/assets/kaykit/`.

## How they get into the game

The game loads one compact pack, not the source glTFs. Characters ship about
3.5 MB of animation each in their source files; the pack is about 3.8 MB in
total (about 1.9 MB gzipped).

```sh
# 1. Fetch the sources into the gitignored cache.
git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0 /tmp/kk/hex
git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 /tmp/kk/Adventures
git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 /tmp/kk/Skeletons
#    Copy their gltf/glb/png files into .cache/kaykit/ (see the paths in scripts/bake/bake.ts).

# 2. Bake (needs `npm run dev` running).
node scripts/bake-assets.mjs
```

The bake (`scripts/bake/bake.ts`, run in headless Chromium):
- **Static models:** all meshes merged into one geometry with positions,
  int8 normals, uvs and an index. Each model draws as a single instanced
  mesh, using the shared texture atlas.
- **Characters:** the walk or run cycle is sampled into 6 frames of skinned
  positions, quantised to int16 (a flipbook). Hundreds of animated creeps
  stay instanced, with one draw call per character frame, instead of each
  being a skinned mesh.

At runtime (`src/render/assets.ts`):
- **Materials:** a slight desaturation and a cold tint, snow dusting on
  upward faces, and snowcaps on mountains by model height.
- **Fallback:** if the pack can't load, everything falls back to the
  procedural primitives.

## Reviewing

- **`?gallery`** lays out every baked model and character in a grid.
- **Adding a model:** add it to the lists in `scripts/bake/bake.ts`,
  re-bake, then place it with `model(...)` in `src/render/board.ts` or via
  `TOWER_ASSETS` / `SEND_CHARS` in `src/render/actors.ts`.
