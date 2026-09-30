# Line Tower Wars: brief

Status: **pre-design, initial research done.** This captures our current understanding and the
questions to settle with Kelly before building. The mechanics below come from
memory of the WC3 map(s). There were many versions, and exact numbers varied,
so treat specifics as approximate.
- **Next step:** research to confirm (web search works in the sandbox, but
  many fan sites are blocked by the egress proxy), then run a direction
  conversation with Kelly.

## Research findings (2026-09-30)

Most fan sites (Hive Workshop, wc3maps, w3reforged, Blogspot) are blocked by
the egress proxy, so these come from search-result snippets. They're
directionally reliable, but not verified against a map file.

- **Classic numbers (one widely described version):**
  - 30 lives each;
  - 25 starting income, paid out every 15 s;
  - sends are bought from shrines in the middle of the map, get stronger by
    tier (Shrine, Shrine 2, Super Shrine), and hit the **next player to your
    right**;
  - most sends raise your income.
- **Anti-block:** in at least one version, "anti-cheat" NPCs patrol and
  destroy towers that block the path. Walls you upgrade into real towers
  were a common pattern.
- **Team LTW:** players took on roles, with a "sender" building team income
  and stealing lives while a "builder" held the lanes.
- **Stolen lives:** *LTW Evolution* and others framed leaks as stealing
  lives, where the sender gains what the victim loses.
- **Modern relatives, to learn from and stay distinct from:**
  - [*Line Tower Wars*](https://store.steampowered.com/app/4954340/) (Steam,
    July 2026), free to play:
    - 2–12 players, FFA;
    - 5 base elements plus 10 pairwise hybrids (15 lines, 105 towers);
    - a 90 s planning phase before the gates open;
    - "wall, then promote walls into towers";
    - sends skip your lane and hit **everyone else's**.
  - [ltw.mithryl.dev](https://ltw.mithryl.dev/): a maze TD with a
    rogue-lite climb.

## The classic map as we understand it

**Players and lanes**
- Usually 4–10 players, free-for-all or teams.
- Each player owns one long, narrow lane (the "line").
- Creeps enter at the top of your lane and exit at the bottom.

**Lives and win condition**
- Every creep that exits costs lives (commonly around 20–50 to start).
- At zero you're eliminated. The last player or team standing wins.

**Sending: the defining mechanic**
- You spend gold to send creeps into an opponent's lane, typically the next
  player in turn order, and in some versions a target you choose.
- Each send permanently increases your income.
- Income pays out on a fixed timer (roughly every 10–20 s) rather than
  per kill, though kills may also give a small bounty.

**The core tension**
- Every gold piece is a choice between towers (defence now) and sends
  (pressure on opponents plus economy later).
- Over-send and you leak; under-send and you fall behind in income.

**Base waves and pace**
- In many versions a baseline creep wave also spawns for everyone on a timer
  and escalates, so turtling alone isn't enough.
- Play is continuous and real time, with no separate build and combat
  phases. You build and send while creeps are walking.

**Mazing**
- Towers are placed inside your narrow lane to lengthen the path.
- Fully blocking was forbidden or punished, e.g. creeps attacking towers or
  the block being auto-removed.
- The narrow width makes mazing tight and pattern-driven: zig-zags and
  switchbacks.

**Builders and races**
- Many versions let you pick a builder or race with its own tower tree and
  upgrade paths (splash, slow, single-target, anti-air, auras).

**Send roster**
- Tiers from cheap swarms up to tanky, fast, air, regenerating, invisible and
  immune creeps, plus expensive late sends and bosses.
- Some sends are only worth it against specific defences.

**Metagame**
- Scouting neighbours' lanes.
- Timing big sends when someone is weak or has just spent.
- Income racing.
- Recognising and exploiting a neighbour's weakness, such as no anti-air.

**Relatives:** Legion TD grew from similar roots (sending units and income),
but with fighters rather than a maze. Worth knowing so we don't drift into
it by accident.

## Why this suits our stack

- The deterministic, seeded, command-driven sim from Gem TD fits
  **lockstep multiplayer**:
  - every client simulates all lanes from the same ordered input stream;
  - bandwidth is tiny, since only commands are sent;
  - all information in LTW is public, so there's no hidden state to protect.
- Bots are needed anyway, to fill empty seats, for solo practice and for
  balance. The Gem TD bot and balance-runner pattern carries over.

## Multiplayer architecture: proposal to discuss

**Recommended: server-relayed lockstep with an authoritative snapshot**
- A tiny room server:
  - collects commands;
  - stamps each with an execution tick (input delay ~100–150 ms);
  - broadcasts them;
  - also runs the same TS sim headless, for snapshots, reconnects and desync
    checks.
- Clients run the full sim and render their own lane in detail, with the
  others as minimaps or a spectator view.
- Periodic state checksums catch desyncs early.
- Determinism rules:
  - no `Math.sin/cos/pow/exp` in the sim, or precompute tables;
  - integer or fixed-point wherever practical.

**Hosting options**
- **Cloudflare Workers + Durable Objects:** one object per room, WebSockets.
  PartyKit is built on this and gives a nice room model.
- **Colyseus** on a small Node host.
- Either can run the shared `src/sim` package.

**Lobbies, in stages**
1. **Private rooms:** share a link or room code, host starts, bots fill empty
   seats. This covers playing with friends and is the easy win.
2. **Public quick-match queue** with a short countdown, back-filled by bots.
3. **Later:** accounts, ranked play and spectating.

**Build order**
1. Solo against bots, fully local.
2. Local "hot-seat" lockstep harness: two sims in one tab kept in sync, to
   prove determinism.
3. Real rooms.

## Reinterpretation opportunities (homage, not clone)

- A new world and theme, as Facet did for Gem TD. Lanes could be terraced
  rivers, canyons, sky-bridges or garden rows, with a strong silhouette in an
  isometric view.
- **QoL:**
  - send previews ("this will hit Player 3 in ~12 s");
  - income forecast;
  - neighbour-lane peeks as world popovers;
  - maze path preview (proven in Gem TD);
  - clear anti-air coverage view;
  - post-game graphs of income, sends and leaks.
- **Readability at scale:** 8 lanes of creeps need strong LOD and a good
  minimap or overview.
- **Session length:** classic games could run long. Consider escalation
  (income ramps, sudden-death waves) to target 20–30 minute matches.

## Open questions for Kelly

1. **Their version:** which version or details do they remember (players,
   races, how send targets worked, blocking rules)?
2. **Player count and modes:** 8-player FFA, team modes, or both?
3. **Races:** several builder races, or one shared tower tree to start?
4. **Theme:** fresh direction? Reuse Facet's valley, or something distinct?
5. **Multiplayer priority:** solo against bots first (recommended), with rooms
   right after?
6. **Match length target.**
7. **Sharing code with Gem TD:** copy code in now (recommended for speed), or
   extract a shared engine package later?
