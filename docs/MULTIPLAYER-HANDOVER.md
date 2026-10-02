# Handover: extract a reusable multiplayer kit

**For:** a fresh Claude Code session on a **new, empty repo**.
**From:** the Siegeline (Line Tower Wars) session, where all of this was
built and proven. The working code is in `kellymilligan/webgpu-linetowerwars`
at commit `5455a7a`. Use it as the reference implementation.

**Goal:** turn the multiplayer stack into a small, documented, tested kit
that any deterministic browser game can adopt. Agents in future sessions
should be able to add "share a URL, play together" to a game in under an
hour. The renderer doesn't matter: WebGPU, WebGL, Canvas2D and DOM games all
fit.

---

## 0. First steps for the new session

1. **Get read access to the reference repo.** Call `add_repo` for
   `kellymilligan/webgpu-linetowerwars` with read access, then clone it to a
   side folder such as `../ref-ltw`. Don't import from it; port the code.
2. **Read the reference files in order:**
   1. `docs/MULTIPLAYER.md`: architecture write-up.
   2. `src/net/protocol.ts`: wire messages.
   3. `src/net/room.ts`: server brain.
   4. `src/net/client.ts`: client session.
   5. `src/net/socket.ts`: PartySocket glue and profile.
   6. `server/index.ts`: Cloudflare Durable Object adapter.
   7. `tests/net.test.ts`: in-memory latency harness.
   8. `scripts/mp-e2e.mjs`: two-browser test.
   9. `scripts/determinism.mjs` and `scripts/determinism-entry.ts`:
      cross-engine check.
   10. `scripts/net-player.ts`: headless bot client.
   11. `.github/workflows/ci.yml`.
   12. `wrangler.jsonc`.
   13. `src/sim/hash.ts`.
   14. For the integration side: `src/app/controller.ts` (search for `net`,
       `tickNet` and `ghosts`) and `src/ui/Lobby.tsx`.
3. **Ask Kelly a few focused questions, each with a recommendation**
   (section 9), then build. Kelly's working style is in section 10.

---

## 1. What exists today (proven)

### Model: server-clocked lockstep

- **Clients send intent, not state.** Every client runs the full
  deterministic simulation and sends only commands (intent).
- **The room owns the clock.** A Cloudflare Durable Object, one per room,
  keeps time and runs the same simulation headless.
- **Every `TURN_MS` (100 ms) the room:**
  1. takes its queued commands;
  2. stamps each with the sender's seat, so nobody can act for someone else;
  3. applies each to its own simulation and keeps only those that succeed,
     sending `reject {reason}` to the sender otherwise;
  4. steps to wall-clock time;
  5. broadcasts `turn {at, upTo, cmds}`: "apply these at tick `at`, then you
     may simulate up to `upTo`".
- **Clients never simulate past the latest `upTo` (the frontier):**
  - they aim to sit about 3 ticks behind it as a jitter buffer;
  - they ease to 0.85× speed when close;
  - they sprint up to 30× when far behind (a slow machine or hidden tab).
- **A slow client only delays itself;** nobody else waits.
- **Desync detection.** Every 150 ticks (5 s at 30 Hz) clients send
  `hash {tick, hash}` (FNV-1a over `JSON.stringify(state)`). The server
  compares it with its own hash for that tick. On a mismatch it sends
  `desync` plus a full `snapshot`, so the client self-heals.
- **Reconnect and refresh.** A token in `localStorage` reclaims the seat.
  The server sends a `snapshot` and the client fast-forwards. Seats are held
  for the whole game.
- **Pause (host only).** The server stops issuing turns. Clients drain to
  the frontier and come to rest on the same tick. Commands sent while paused
  get `reject 'paused'`.
- **Lobby.** It holds:
  - a name and a unique colour per player (taken colours are disabled);
  - seats in join order, with the first to arrive as host;
  - a share link;
  - host settings (for example "fill empty seats with bots"; off means one
    lane per human, with at least 2 humans);
  - start;
  - "back to lobby" after game over.
- **Ghost builds (optimistic UI).**
  - The client draws pending actions immediately as translucent previews.
  - A ghost is cleared when the matching event lands, on reject, or after
    2 s.

### Hosting

- **Server:** one Cloudflare Worker using `partyserver`, with Durable
  Objects (SQLite-backed, so they work on the Workers Free plan).
- **Routing:** `routePartykitRequest` sends `/parties/room/<code>` to the
  room's Durable Object, and everything else to `env.ASSETS`, the built
  game. One deploy covers both, and there's no CORS or configuration.
- **Client:** `partysocket` gives auto-reconnect.
- **Dev:** `wrangler dev` on :8787, Vite on :5173, and
  `VITE_PARTY_HOST=127.0.0.1:8787` in `.env.development`. In production the
  socket uses `location.host`.
- **Clock:** `setInterval(pump, TURN_MS)` inside the Durable Object, running
  only while a game is in progress and someone is connected. No hibernation.

### Verification that exists

| Check | What it proves |
|---|---|
| `tests/net.test.ts` (Vitest, about 3 s) | In-memory room plus 3 clients over a simulated network with 20–250 ms random per-message latency, ordered per connection. 2.5 minutes of random commands end with all clients byte-identical to the server and 0 desyncs. Also covers spoof rejection, reconnect resync, and the no-bots lane count. |
| `scripts/mp-e2e.mjs` | Two real headless Chromium processes join a room via `wrangler dev`, set names and colours, start, act and pause, then the test asserts the same tick and hash. |
| `scripts/determinism.mjs` and CI | A scripted 28-minute game bundled with esbuild, run in Node and then in Chromium, Firefox and WebKit, comparing hashes at 336 checkpoints. Chromium matched locally; Firefox and WebKit run in GitHub Actions. |
| `scripts/net-player.ts` | A headless player (bot brain over WebSocket) used to play Kelly in the deployed game. |
| Live deploy | Kelly deployed to `*.workers.dev` and played a 3-human, no-bots game (two windows plus the sandbox bot) with no stalls or desyncs reported. |

---

## 2. What to build: the reusable kit

Working name `lockstep-rooms`; confirm with Kelly. Recommended layout is a
single npm workspace repo, since several small packages are easier for
agents than one tangled one:

```
packages/
  core/        # platform-free: protocol, RoomCore, ClientSession, hashing, types
  cloudflare/  # PartyServer Durable Object adapter + Worker fetch helper
  testing/     # in-memory network harness (latency/jitter/drop), fake clock
  ui-preact/   # optional: lobby store + Preact components (name, colour, seats, share, host settings)
  node/        # optional: `ws` server adapter for non-Cloudflare hosting / local tests
tools/
  e2e.mjs            # N-browser smoke test (one browser process per player)
  determinism.mjs    # cross-engine determinism checker (takes a game entry module)
  bot-client.ts      # headless client that plays via a game-supplied `decide()`
examples/
  counter/     # tiniest possible game: proves the API in ~50 lines
  arena/       # small real-time game (e.g. top-down tag or tug-of-war) with a canvas/three renderer and interpolation
templates/
  wrangler.jsonc, .env.development, ci.yml
skill/
  SKILL.md     # agent skill: "add multiplayer to a deterministic game with lockstep-rooms"
docs/
  GUIDE.md     # human + agent guide: concepts, integration steps, determinism rules, deploy, troubleshooting
```

### The game adapter: the one thing a game must provide

Generalise the Siegeline-specific calls in `room.ts` and `client.ts`
(`createGame`, `applyCommand`, `step`, `stateHash`, `HOUSES`, `fillBots`)
behind an interface:

```ts
export interface LockstepGame<S, C, Setup = unknown, E = unknown> {
  /** Fixed simulation rate (ticks per second). Siegeline uses 30. */
  tickRate: number;
  /** Build initial state from the lobby: seed, seats (humans with name/colour/meta) and host settings. */
  create(seed: string, setup: { seats: SeatInfo[]; settings: Setup }): S;
  /** Validate and apply one command for `player`. Must be deterministic and must not throw. */
  apply(state: S, cmd: C, player: number): { ok: true; events?: E[] } | { ok: false; reason: string };
  /** Advance exactly one tick. */
  step(state: S): E[];
  /** Read from state (e.g. state.tick). */
  tick(state: S): number;
  isOver(state: S): boolean;
  /** Optional; default is FNV-1a over JSON.stringify(state). */
  hash?(state: S): number;
  /** Optional; validate/normalise host settings (e.g. { fillBots: boolean }). */
  settings?: { defaults: Setup; validate(raw: unknown): Setup };
  /** Optional: minimum players to start, max seats, colour palette offered in the lobby. */
  seats?: { min: number; max: number; palette: string[] };
}
```

- **Commands carry no player field on the wire.** The server stamps the
  seat. In Siegeline the command type includes `player` and the server
  overwrites it; the kit should pass `player` separately to `apply`.
- **Snapshots** default to `JSON.stringify(state)`. Allow an optional
  `serialise`/`deserialise` pair for games with non-JSON state, but
  recommend plain JSON.
- **Bots** are the game's business: they're just simulation logic for seats
  without humans. The kit only passes `seats` (humans) and `settings` to
  `create`.

### Server: `RoomCore<S, C>`

- Keep the platform-free `RoomIO` interface: `send`, `broadcast`, `clock`,
  `now`, `seed`.
- Features to keep:
  - lobby, tokens and seats, colours, host and host transfer;
  - settings, start, pause, back to lobby;
  - the turn pump with a `MAX_CATCH_UP` cap;
  - validation by applying commands to the server's own copy;
  - the hash ring buffer, with desync repair by snapshot;
  - reconnect by token;
  - protocol version check.
- Make these configurable:
  - `turnMs` (100), `hashEvery` (150), `maxCatchUpTicks` (5 s);
  - `maxSeats` and `minPlayers`;
  - name sanitiser;
  - whether to accept late joiners (spectators later).
- Add what Siegeline lacks:
  - **Rate limiting:** cap commands per second per connection, and maximum
    message size.
  - **Persistence:** periodically save `{phase, members, state, tick}` to
    Durable Object storage, so a room survives eviction and restarts.
    Siegeline keeps rooms in memory only.
  - **Seat takeover hook:** call `onSeatIdle(seat)` after N seconds
    disconnected, so a game can hand the seat to a bot (deterministically,
    via a server-issued command).
  - **Room lifecycle:** close and clean up empty rooms after a timeout.

### Client: `ClientSession<S, C>`

Port `NetGame`, keeping:
- `advance(dt) → {events, alpha}`, with the pacing constants (target lag 3,
  ease 0.85×, sprint up to 30×, `dt` clamp 1 s).
- `submit(cmd)`.
- The `onNotice` and `onChange` callbacks.
- Snapshot handling and the turn queue.
- **Pause drains to the frontier.** The pause flag must not stop
  `advance`: the server stops issuing turns and clients finish what they
  were cleared for.

Add:
- an **optimistic-intent helper** (ghosts):
  `pending: {cmd, at, key}[]`, cleared by a game-supplied matcher on
  events, by rejects, or by a timeout;
- an **RTT/latency estimate** (ping in turns) for the UI;
- a `connection` status enum.

### Transport and host adapters

- `cloudflare`: an `export class Room extends Server` factory plus a `fetch`
  helper that routes `/parties/*` and falls back to `ASSETS`. Ship the
  `wrangler.jsonc` template: `assets` with SPA fallback, the Durable Object
  binding, and the `new_sqlite_classes` migration.
- Client socket helper: `connect({ host, room, party: 'room', session })`
  wrapping `partysocket`.
- Optional `node` adapter (a `ws` server driving `RoomCore`) for local and
  CI tests without wrangler.

### UI kit (optional, Preact)

- A framework-agnostic lobby store, plus Preact components ported from
  `src/ui/Lobby.tsx`:
  - share link with copy;
  - name input (commit on blur or Enter);
  - colour swatches with taken ones disabled;
  - seats grid (host and away chips);
  - host settings toggles;
  - "Begin" (disabled until `minPlayers`);
  - "Leave".
- An in-game status chip: room code, reconnecting state, host pause.
- Kelly's taste: frosted-glass panels, restrained type, world-anchored UI
  where possible.

### Tools

- **Testing harness** (port `harness()` from `tests/net.test.ts`):
  - a fake clock;
  - per-connection ordered delivery with configurable latency and jitter
    (and optional drop plus reconnect);
  - a helper to "run until settled and compare hashes".
  - It should be importable by game repos, so each game gets a lockstep
    test in about 10 lines.
- **`e2e.mjs`:**
  - N players, **one browser process per player**: software GL in one
    Chromium process starved the second page's navigation;
  - `waitUntil: 'domcontentloaded'`, because blocked Google Fonts stall
    `load`;
  - drive the game through a `window.<handle>`, pause, wait until each
    client's `tick === frontier`, then compare hashes.
- **`determinism.mjs`:**
  - takes a path to a game "scenario entry" exporting
    `runScenario(seed, minutes) → number[]`;
  - bundles it with esbuild (IIFE, `platform: neutral`);
  - runs it in a `node:vm` context and in each Playwright engine, comparing
    hash arrays;
  - `--require-all` for CI.
- **`bot-client.ts`:**
  - joins a room over WebSocket and calls a game-supplied
    `decide(state, seat) → C[]` once a second;
  - in Siegeline this ran the in-sim bot brain on a JSON copy of the state
    and recorded the commands it chose;
  - in sandboxes, run with `NODE_USE_ENV_PROXY=1` and
    `NODE_EXTRA_CA_CERTS=<ca bundle>`, because Node's built-in WebSocket
    ignores `HTTPS_PROXY`.

### Examples

- **`examples/counter`:** shared counter and button race. Proves the API end
  to end in minutes, and is the template the skill points to.
- **`examples/arena`:** a small real-time game with movement, render
  interpolation (`px/py` → `x/y` with `alpha`), ghosts and bots. Ideally it
  uses three.js `WebGPURenderer` with the WebGL 2 fallback (port
  `capabilities.ts` from Siegeline) to show that the renderer is irrelevant.

### Agent skill

`skill/SKILL.md` is a step-by-step recipe so a future agent can retrofit
multiplayer into a game:
1. Audit determinism (section 4 checklist and grep).
2. Implement the `LockstepGame` adapter.
3. Add the harness test.
4. Wire `ClientSession` into the game loop: replace local stepping, route
   input through `submit`, use `alpha` for interpolation, disable
   speed-up controls and local autosave.
5. Drop in the lobby.
6. Add the Worker and `wrangler.jsonc`.
7. Run e2e and determinism.
8. Deploy.

Include the pitfalls in section 6.

---

## 3. Protocol (current, proven)

```ts
PROTOCOL_VERSION = 1; TURN_MS = 100; HASH_EVERY = 150; MAX_SEATS = 8

ClientMsg =
  | { t:'hello', v, token, name, colour } | { t:'profile', name, colour }
  | { t:'start' } | { t:'pause', paused } | { t:'toLobby' } | { t:'settings', fillBots }
  | { t:'cmd', cmd } | { t:'hash', tick, hash }

ServerMsg =
  | { t:'welcome', seat, host } | { t:'room', phase, members: SeatView[], paused, fillBots }
  | { t:'snapshot', state } | { t:'turn', at, upTo, cmds }
  | { t:'reject', reason } | { t:'desync', tick } | { t:'error', reason }
```

Generalise `fillBots` into `settings: Setup`. Keep JSON. Bandwidth is tiny:
about 10 turns per second, mostly empty. Only consider binary or delta
snapshots if a game has a huge state. Siegeline's full 8-lane snapshot is
tens of KB.

**Turn semantics:**
- The server applies `cmds` at tick `at` (its current tick before stepping),
  then steps to `upTo`.
- Clients apply the same `cmds` in the same order when `state.tick === at`,
  before stepping.
- Turns arrive in order on one WebSocket. A turn whose `at` is already past
  is skipped, and the next hash check repairs the client.

---

## 4. Determinism contract (document it prominently)

A game is lockstep-safe when the simulation:
- is **pure:** no DOM, `Date`, `performance`, renderer or network access;
- draws all randomness from a **seeded PRNG stored in the state**.
  Siegeline uses sfc32 with splitmix seeding (`src/sim/rng.ts`). Rendering
  may use `Math.random` for cosmetics only;
- uses **no transcendental maths**, apart from `Math.sqrt`. No
  `sin/cos/pow/exp/log/atan2/hypot`. Use lookup tables, integer powers by
  repeated multiplication, or fixed point. `+ - * /` and `sqrt` are
  IEEE-exact everywhere;
- has **no unordered iteration** that affects outcomes: no `for…in` over
  objects with numeric-like keys from different sources, no `Set`/`Map`
  order from non-deterministic insertion, no `Array.sort` with inconsistent
  comparators;
- keeps **plain-JSON state**, so snapshots round-trip exactly. Test: run, do
  `JSON.parse(JSON.stringify(state))` mid-game, keep running, and compare;
- keeps **bots inside the simulation**, driven by the simulation's RNG, so
  they cost no bandwidth and stay deterministic;
- applies **commands only through `apply`**. The UI never mutates state.
  Debug hooks such as "autoplay my seat" must be disabled in rooms.

**Audit grep for the skill:**

```sh
grep -rnE "Math\.(random|sin|cos|tan|pow|exp|log|atan|hypot)|performance\.|Date\.|\.sort\(|for \(const .* in " <sim dir>
```

---

## 5. Deployment (Cloudflare)

1. `npm install`, then `npx wrangler login` (one-time, browser OAuth).
2. `npm run deploy`, which runs `vite build` then `wrangler deploy`, giving
   `https://<name>.<subdomain>.workers.dev`.
   - The Workers Free plan covers SQLite-backed Durable Objects.
   - The game and the rooms share one origin.
3. **Dev:** `npm run build && npm run server` (wrangler on :8787), plus
   `npm run dev` (Vite on :5173, with `.env.development` pointing rooms at
   :8787).

**Sandbox notes (cloud sessions):**
- **`wrangler dev` works.** It prints an update-check stack trace at start;
  that's harmless.
- **Deploying needs Kelly's account.** Agents can't log in.
- **`workers.dev` hosts are blocked** by the egress proxy unless added in
  the environment's **Network access** settings.
- **`codeload.github.com` tarballs can be refused** for unattached repos.
  `git clone --depth 1` worked instead.

---

## 6. Pitfalls already hit (and fixed): put these in the guide and the skill

1. **Pause must not stop the client sim.** The server stops issuing turns;
   clients drain to the frontier. Otherwise clients rest on different ticks
   and the hash comparison is meaningless.
2. **Commands during pause** were silently dropped. Reject them with a
   message instead.
3. **Seat stamping on the server.** Never trust a client's `player` field.
4. **Host is the first to *arrive*,** not the first to open the page.
   Network timing decides; tests must find the host, not assume seat 0.
5. **Lobby reseating:** mutate seat numbers in place. Copying member
   objects broke connection-to-member identity.
6. **Catch-up limits:** clamping `dt` to 0.25 s with an 8× rate cap meant a
   1 fps client could never catch up. Use a `dt` clamp of 1 s and up to 30×.
7. **Placeholder state behind the lobby:** caches keyed by player count
   (house colours) went stale when the snapshot replaced the placeholder.
   Key caches by content, or reset them on snapshot (`runId++`).
8. **Debug or "autoplay" hooks** that mutate state locally desync rooms.
   Disable them when networked.
9. **Variable seat count:** with bots off, the world has N lanes. Renderer
   layout must be data-driven by the state's player count, not a constant.
10. **Headless e2e:** use one browser process per player; wait for
    `domcontentloaded`; at about 1 fps, poll for `tick === frontier`
    instead of sleeping.
11. **Node WebSocket behind a proxy** needs `NODE_USE_ENV_PROXY=1`.
12. **OOM in the sandbox** when wrangler, Vite and several Chromiums ran
    alongside builds. Run them sequentially and kill them when done.
    Kill-by-pattern with `pgrep -f "[n]ode.*vite"` can still kill your own
    shell; prefer PIDs you started.
13. **Workers `Date.now()`** only advances between events. It's fine with
    `setInterval`, but don't busy-wait.

---

## 7. Known gaps and roadmap (prioritise with Kelly)

- **Room persistence** in Durable Object storage. Currently a room
  evicted while empty loses its game.
- **Bot takeover** for idle seats, via a server-issued deterministic
  command.
- **Spectators** (a client with no seat; late join while playing).
- **Rate limiting and abuse protection;** a room code namespace (avoid
  guessable codes, or add an optional password).
- **Replays:** the seed plus every turn is the replay. Add record and
  export, plus a `?replay=` player.
- **Public quick-match** queue with bot back-fill. Its own Durable Object
  holds the queue.
- **In-room chat and emotes** (just another message type, not part of the
  simulation).
- **Latency display and a "slow connection" indicator.**
- Possibly **rollback** for twitchy games: out of scope for lockstep, but
  note where the kit would extend.

---

## 8. Acceptance criteria for the new repo

- `npm test`:
  - core unit tests;
  - the harness test (3+ clients, jittery network, random commands, all
    hashes equal, 0 desyncs);
  - spoof rejection, reconnect, pause drain, settings, and rate limit.
- **`examples/counter` and `examples/arena`** run locally with
  `npm run dev:example <name>` (Vite) plus `npm run server` (wrangler).
- `tools/e2e.mjs` passes on `examples/arena` with 2–3 browser processes.
- `tools/determinism.mjs --require-all` passes in CI on Chromium, Firefox
  and WebKit.
- `skill/SKILL.md` and `docs/GUIDE.md` let an agent integrate the kit into
  a toy game from scratch. **Test this:** a subagent following only the
  skill adds multiplayer to a tiny game without reading the kit's source.
- **Deploy instructions** are verified up to the point that needs Kelly's
  account.
- **Packaging** is consumable two ways: as npm workspace packages
  (publishable later), and by copy-paste of `packages/core` for repos that
  don't want a dependency.

---

## 9. Questions to ask Kelly first (with recommendations)

1. **Name and scope:** `lockstep-rooms` monorepo with core, cloudflare,
   testing and ui-preact? *Recommended:* yes, publish to npm later.
2. **Hosting targets:** Cloudflare only, or also a Node `ws` adapter?
   *Recommended:* Cloudflare first, with Node as a thin adapter for tests and
   self-hosting.
3. **UI:** ship Preact components, or a headless store only?
   *Recommended:* a headless store plus optional Preact components in Kelly's
   frosted-glass style.
4. **Example game:** what should `examples/arena` be? *Recommended:* a tiny
   top-down arena (move, tag, bots) with a Canvas2D renderer, plus a three.js
   variant later.
5. **Persistence and spectators** in v1, or roadmap? *Recommended:* add
   persistence in v1 (small), and put spectators on the roadmap.
6. **Retrofit Siegeline** onto the kit afterwards, to prove it?
   *Recommended:* yes, as the final milestone (a PR to the Siegeline repo).

---

## 10. Kelly's working style (bring this into the new repo's CLAUDE.md)

- **Research first, then explain, then build.** Ask a few focused
  questions, each with a recommendation. Once Kelly says "proceed", build
  without further check-ins.
- **Ship something working early,** then iterate in meaningful commits. Work
  on `main` and push when a chunk is done. No PRs unless asked.
- **Verify before reporting:**
  - typecheck, tests and build;
  - real runs (headless e2e and screenshots where visual);
  - send screenshots with short captions.
- **Report honestly:**
  - say what was verified and what wasn't;
  - separate sandbox artefacts from real bugs;
  - flag guesses as guesses.
- **Keep summaries short:** what changed, how to try it, known gaps, next
  steps.
- **Stack taste:** TypeScript, Vite, Vitest, Preact, three.js
  `WebGPURenderer` with TSL (three ≥ r186, `RenderPipeline`), with a WebGL 2
  fallback. A deterministic simulation separate from rendering.

---

## Suggested milestones

1. **Core + harness + counter example.** Port `protocol`, `RoomCore`,
   `ClientSession` and `hash` behind the adapter, plus the in-memory harness
   test. Run counter locally with wrangler.
2. **Cloudflare adapter + templates + e2e tool.** Two browsers on counter.
3. **Arena example:** interpolation, ghosts, bots and the lobby UI kit.
4. **Determinism tool + CI.** All three engines.
5. **Hardening:** rate limits, persistence, idle-seat hook, room cleanup.
6. **Guide + skill.** Validate with a subagent retrofit on a toy game.
7. **Optional:** retrofit Siegeline onto the kit.
