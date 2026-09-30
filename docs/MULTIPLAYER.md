# Multiplayer: server-clocked lockstep on Cloudflare

Siegeline's multiplayer is also a case study in networking a browser 3D game
in general.

## The idea in one paragraph

The game is a **deterministic simulation**:
- pure TypeScript with a fixed 30 Hz tick;
- a seeded RNG;
- plain-JSON state;
- no DOM, three.js, clocks or `Math.random`;
- `Math.sqrt` is the only transcendental maths.

Given the same starting state and the same commands on the same ticks, every
machine computes the same game, bit for bit. So we never send game state over
the network; we send **player intent** (build, upgrade, sell, send). Every
client runs the full simulation of all 8 lanes locally and renders it however
it likes.

WebGPU or WebGL is purely a presentation detail. Two players on different
backends see the same game.

## Who owns time

This is classic RTS lockstep with one twist: the **server owns the clock**.

```
client A ──cmd──►┐                      ┌──turn──► client A (sim ≤ upTo)
client B ──cmd──►├─ Room (Durable Object)├──turn──► client B (sim ≤ upTo)
client C ──cmd──►┘   runs the same sim   └──turn──► client C
```

**Every 100 ms (`TURN_MS`) the room:**
1. takes the commands it has received;
2. stamps each with the sender's seat, so nobody can act for someone else;
3. applies them to **its own copy** of the simulation, dropping any that fail
   (such as too little gold) and telling the sender why;
4. simulates up to wall-clock time;
5. broadcasts `turn { at, upTo, cmds }`: "apply these at tick `at`; you may
   simulate up to `upTo`".

**Clients:**
- never simulate past the latest `upTo` (the **frontier**);
- aim to sit about 3 ticks behind it as a jitter buffer;
- sprint (up to 30×) to catch up after a stall, and ease off when close.

**Why it works this way:**
- A slow or laggy client **only delays itself.** In peer-to-peer lockstep the
  slowest player stalls everyone; here nobody waits.
- **Input delay** is one turn plus network latency, about 100–200 ms. That's
  fine for a tower-defence war.
- **Pause** (host only) just stops the turns. Every client finishes what it
  was cleared for and comes to rest on the same tick.

## Keeping everyone honest

- **Desync detection.** Every 150 ticks (5 s), clients send an FNV hash of
  their full state. The server compares it with its own hash for that tick.
  On a mismatch it sends `desync` and a fresh `snapshot`, so the client
  self-heals.
- **Reconnects and refresh.** Each browser keeps a token in `localStorage`.
  Rejoining with it reclaims your seat, and you get a snapshot of the current
  state. Seats are held for the whole war.
- **Bots** live inside the simulation, so empty seats cost no bandwidth and
  stay deterministic.
- **Bandwidth:**
  - upstream is a few bytes per action;
  - downstream is ten small turns a second, plus a snapshot on join (tens of
    KB);
  - hundreds of creeps cost nothing on the wire.

## Code map

| File | Role |
|---|---|
| `src/net/protocol.ts` | Message types and constants shared by client and server. |
| `src/net/room.ts` | `RoomCore`: lobby, seats, colours, the clock, validation, hashes. Platform-free. |
| `src/net/client.ts` | `NetGame`: frontier-limited sim, turn application, catch-up. DOM-free. |
| `src/net/socket.ts` | PartySocket glue (auto-reconnect), profile (name, colour, token). |
| `server/index.ts` | Cloudflare Worker and the `Room` Durable Object (PartyServer), wrapping `RoomCore`. Also serves the built game. |
| `tests/net.test.ts` | The in-memory harness (see below). |
| `scripts/mp-e2e.mjs` | Two real browsers through a local Durable Object. |

## How it's verified

- **`npm test`** runs the in-memory harness: a room plus 3 clients over a
  simulated network. It checks that:
  - 2.5 minutes of button-mashing war with 20–250 ms random per-message
    latency ends with all three clients byte-identical to the server, with 0
    desyncs;
  - seat spoofing is rejected;
  - reconnecting players rejoin in sync.
- **`node scripts/mp-e2e.mjs`** needs `npm run server` and `npm run dev`
  running. It drives two headless Chromium browsers:
  1. both join a room and pick names and colours;
  2. the host begins, both build, one sends;
  3. the host pauses;
  4. the script checks both clients came to rest on the same tick with the
     same state hash.
- **Caveat:** everything so far ran on V8 (Node, workerd and Chromium). The
  simulation follows the cross-engine rules, but Firefox and Safari
  determinism is untested until we add a Playwright Firefox/WebKit check in CI.

## Run it locally

```sh
npm run build      # the Worker serves dist/
npm run server     # wrangler dev on :8787 (rooms, plus the built game)
npm run dev        # vite on :5173; .env.development points rooms at :8787
```

Then:
1. Open `http://localhost:5173`, click **Multiplayer**, and share the
   `?room=` link with a second browser or profile.
2. Or open `http://localhost:8787/?room=abcde` to use the Worker-served build
   directly.

## Deploy (needs your Cloudflare account)

```sh
npx wrangler login
npm run deploy     # builds, then wrangler deploy
```

- The Worker serves the game and the rooms from one origin, so no
  configuration is needed.
- Rooms are Durable Objects, created on first connect.
- A room's clock only runs while a war is in progress and someone is
  connected.

## Next steps

- **Ghost builds:** show your tower instantly as a translucent preview until
  its turn lands. This hides the ~150 ms input delay.
- **Bot takeover** for players who've been away for a while.
- **Firefox/WebKit determinism check** in CI, replaying a recorded command
  log.
- **Replays:** we already have the seed and every turn, so a replay is just
  the command log.
- **Spectating:** a spectator is a client with no seat.
- **Public quick-match queue** with bot back-fill.
