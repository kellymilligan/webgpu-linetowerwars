# lobbyhop feedback from the Siegeline migration

This file lists the friction points from moving Siegeline (an 8-lane lockstep
tower-defence game with a 3D renderer and a custom Preact lobby) from its
hand-rolled PartyServer stack onto `lobbyhop@0.1.1`. It's for the lobbyhop
session.

**Summary.** The migration was smooth:
- The game definition, harness tests and determinism scenario all worked on
  the first run.
- The client and server ported in about an hour.
- Net code fell by ~560 lines, and we gained idle-seat bot takeover, kick and
  spectators.

Most of the friction is in the **e2e tool** with custom lobbies and heavy
renderers.

Each item has a severity, what happened, the workaround, and a suggestion.

## e2e (`npx lobbyhop e2e`)

1. **Custom lobbies must copy the stock lobby's CSS classes.** *(high)*
   - **What happened:**
     - The runner drives the lobby through `.lh-panel input[type=text]`,
       `.lh-swatch` and `.lh-panel .lh-primary`.
     - GUIDE.md says to "render from the RoomClient fields" for a custom
       lobby, but with a custom lobby `click('.lh-panel .lh-primary')` times
       out.
     - Nothing documents that the runner needs these classes.
   - **Workaround:** added `lh-panel`, `lh-swatch` and `lh-primary` classes
     (and `type="text"`) to our Preact lobby. (Siegeline later switched to
     `mountLobby`, which made this moot.)
   - **Suggestion:** document the selector contract in GUIDE "Real browsers".
     Or fall back to `window.lobbyhop.room.setProfile(...)` and `.start()`
     when `.lh-panel` is absent, or offer `--lobby api`.

2. **A slow end-of-run screenshot crashes the run.** *(high)*
   - **What happened:**
     - With 3 software-rendered WebGL pages on 4 cores,
       `page.screenshot(player1.png)` hit Playwright's 30 s timeout.
     - The uncaught `TimeoutError` killed the script with a stack trace, so
       there was no sync check and no PASS/FAIL line.
   - **Workaround:** a `?lite` URL flag in the game (half resolution, no
     shadows), passed via `--url "http://localhost:8787/?lite"`. Query strings
     on `--url` are preserved, which was nice.
   - **Suggestion:**
     - Wrap screenshots in try/catch and report "screenshot timed out";
       still run the sync check.
     - Add `--viewport WxH` and maybe `--no-screenshots`.
     - Mention in TROUBLESHOOTING that heavy 3D pages need a lite mode for
       3+ browsers.

3. **`act` gets no context.** *(medium)*
   - **What happened:** the script wanted to write extra screenshots to the
     same `--out` dir, so it had to parse `process.argv` itself.
   - **Suggestion:** pass a context object as a 4th argument:
     `act(page, i, round, { out, room, players, url })`.

4. **No way to hold a command in `pending` for a screenshot.** *(medium)*
   - **What happened:** under software rendering a screenshot takes several
     seconds, so a ghost (pending build) is confirmed before it's captured.
   - **Workaround:** the e2e script monkeypatches `WebSocket.prototype.send`
     to buffer outgoing frames for 10 s, simulating a laggy uplink.
   - **Suggestion:** a debug affordance such as `room.debug.holdOutgoing(ms)`,
     or `joinRoom({ simulateLatencyMs })`. It would also help people *feel*
     high latency in dev.

5. **Rounds run in lockstep across all pages.** *(low)*
   - **What happened:** `act` runs for all pages with `Promise.all` per
     round, so one slow page slows every player's round.
   - **Suggestion:** at least document it, so scripts schedule by game state
     (as ours does) rather than by round count.

## Game definition

6. **No settings-dependent start rule.** *(medium)*
   - **What happened:**
     - Siegeline used to require at least 2 humans when bots are off.
     - `seats.min` is static, and there's no `canStart(seats, settings)`.
   - **Workaround:** `create` gives a lone lord one bot rival when
     `fillBots` is off.
   - **Suggestion:** a `canStart?(seats, settings) => string | null` hook.
     The server would reject `start` with the reason, and `mountLobby` would
     disable Start with it as a tooltip.

7. **`create`'s seat contract differs from `recordHashes`.** *(medium)*
   - **What happened:**
     - `Setup.seats` is documented as "always contiguous (0..n-1)".
     - `recordHashes({ seats: [0, 3] })` passes non-contiguous seats.
     - It also passes `colour: ''` and `name: 'P0'`.
     - Code that indexes `seats[i]` works in rooms but silently builds a
       different game in the determinism scenario.
   - **Workaround:** `seats.find((x) => x.seat === i)`.
   - **Suggestion:** either recommend lookup by `.seat` in the docs, or make
     `recordHashes` contiguous. Give it palette colours rather than `''`.

8. **Commands that already carry a `player` field.** *(low)*
   - **What happened:**
     - Retrofitting means stripping `player` from a union of command types.
     - That needs a distributive helper:
       `type WithoutPlayer<T> = T extends unknown ? Omit<T, 'player'> : never`.
     - On the client, `const { player: _, ...intent } = cmd`.
   - **Suggestion:** a short "your commands already have a player field"
     snippet in GUIDE's Retrofitting section.

9. **The arena example's `recordHashes(game as never, ...)` cast is
   unnecessary.** *(nit)*
   - `recordHashes(game, ...)` typechecks fine with a real definition. The
     cast in `examples/arena/determinism.ts` suggests otherwise, and people
     copy it.

## Testing harness

10. **No typed access to the server's state.** *(medium)*
    - **What happened:** tests that assert on the authoritative state (lanes,
      bot takeover) need
      `(h.room.engine as unknown as { state }).state`.
    - **Suggestion:** `h.serverState()` (typed `StateOf<G>`), or type
      `engine.state` on `RoomCore<G>`.

## Client

11. **Clamped frame `dt` hobbles catch-up.** *(medium; it bit us before)*
    - **What happened:**
      - Games commonly clamp `dt` (ours was 0.1 s) for the local sim.
      - `advance` already clamps to 1 s and sprints up to 30×.
      - Passing it a pre-clamped `dt` slows recovery after a stall or a
        hidden tab.
    - **Suggestion:** a pitfall line: "pass the real elapsed time to
      `advance`; don't reuse your local-sim clamp."

12. **`RoomClient` vs `JoinedRoom` types.** *(nit)*
    - **What happened:** storing the joined room as `RoomClient<G>` loses
      `leave()`.
    - **Suggestion:** export a `JoinedRoom<G>` type from `lobbyhop/client`,
      or mention it in API.md.

## CLI tools

13. **`bot` is silent while playing.** *(low)*
    - **What happened:** it logs "joining" and phase changes only, so you
      can't tell whether it's doing anything against a deployment.
    - **Workaround:** our brain prints a status line every 15 s.
    - **Suggestion:** a `--status <s>` flag that logs tick, phase and
      commands sent.

14. **`bot` writes bundles into `node_modules/lobbyhop/dist-examples/` and
    never deletes them.** *(low)*
    - This litters `node_modules` and breaks on read-only installs.
    - **Suggestion:** write to `os.tmpdir()` and delete on exit.

15. **Undeclared tool dependencies.** *(low)*
    - **What happened:** `determinism`, `e2e` and `bot` import `esbuild` and
      `playwright` from the host project, but `package.json` declares
      neither. It worked here only because Siegeline already had both.
    - **Suggestion:** list them as optional peers, and print
      "`npm i -D esbuild playwright`" on a failed import.

16. **Killing `npx lobbyhop bot` loses its output.** *(nit)*
    - **What happened:** `timeout 45 npx lobbyhop bot …` printed nothing.
      Running `node node_modules/lobbyhop/tools/bot.mjs` directly worked.
    - **Suggestion:** probably just npx buffering; worth a TROUBLESHOOTING
      line.

17. **`audit` flags local `new Set`/`new Map` lookups.** *(nit)*
    - Four hits, all benign temporaries. The ignore comment works well. This
      is fine as designed; just noting the noise level for a real sim (4
      hits across 11 files).

## What worked well (keep it)

- **Agent workflow:** the skill → GUIDE → API flow is excellent for an agent,
  and the docs answered nearly everything.
- **Wrapping the sim:** `defineLockstep` around an existing sim was trivial,
  and `from.system` plus hooks made idle bot takeover a 10-line feature.
- **Harness:** `createHarness` replaced our 60-line bespoke harness, and the
  ported tests passed on the first run.
- **Durable Object migration:** `createRoomServer` + `createWorker` with the
  same `Room` class name kept the existing migration valid.
- **e2e:** `--script` plus a query string on `--url` was flexible enough to
  port everything.
- **Profiles:** `profileKey` let existing players keep their name and token.
