# Siegeline: design (v0.1, grey box)

*Siegeline* is the working title. It's an homage to Line Tower Wars, set in a
gritty, low-magic late-medieval world of warring houses, castles, levies,
horses and siege engines. The numbers in the code are the source of truth
(`src/sim/data/`); this doc explains the intent.

## Agreed with Kelly (2026-09-30)

- **8-player free-for-all** first. Team modes later.
- **One starting class** (the Garrison) to keep balance tractable. Builder
  races come later.
- **Sends go to the next living player on your right.** When that player
  falls, your target moves on to the next one.
- **Leaks chain.** A creep that breaks through a keep marches on into the
  following holding. It's capped at two lanes (`MAX_LANES`), then it goes
  home with its loot. An uncapped chain snowballed games into two-minute
  wipeouts in bot testing.
- **Blocking is allowed but costly.** If a lane has no open road, creeps
  path through the cheapest wall and batter it down. Siege units (the
  Battering Ram, then Knights and the Warlord) hit towers far harder. Lost
  towers are lost gold. This gives blocking real strategy without making it
  free.
- **Plunder.** Breaking through pays the sender a little gold per life taken
  (`PLUNDER_PER_LIFE`). It ties the loop to the "pillaging" fantasy.
- **Solo against 7 bots first.** Rooms come later, on the lockstep-ready sim.
- **Target match length:** 20–30 minutes, with sudden death from 25:00.

## Core loop

- **Muster (30 s):** build only. Then the gates open and sends unlock.
- **Income** pays every 12 s. Each send permanently raises it.
  - Payback is about 20–28 gold per +1, i.e. 4–6 minutes, so economies grow
    steadily instead of exponentially. At about 12 gold per +1, income
    exploded to 2,000+ by minute 18 in bot tests.
- **Kills** pay a small bounty to the lane owner.
- **Raids:** a neutral warband hits every lane on a timer. Raids start small,
  grow tougher, and escalate hard in sudden death.
- **Stock:** each send type has a small stock that restocks over time. This
  stops one-frame mega-dumps without capping the economy.

## The Garrison (towers)

Every tower sits on one tile and has three levels, except the palisade.

| Tower | Role |
|---|---|
| Palisade (5g) | Cheap wall for mazing. Raise it into any tower for the price difference. |
| Archer | Steady single target. Hits air. |
| Mangonel | Lobbed splash. Ground only. |
| Pitch Cauldron | Short range. Slows and burns. Ground only. |
| Ballista | Long range, pierces armour. Hits air. |
| War Banner | Aura: attack speed to nearby towers. |

- Selling refunds 60%.
- Mazing is the core skill: serpentine walls with alternating gaps.

## Sends

| Send | Twist |
|---|---|
| Levies | Cheap swarm |
| Footmen | Armoured |
| Outriders | Fast |
| Carrion Crows | Air: ignore the maze |
| Shieldwall | 50% armour: bring ballistae |
| Friars (+ footmen) | Heal nearby allies |
| Knights | Fast and tough. 2 lives each. |
| Battering Ram | Siege. 3 lives. |
| Warlord | Boss. Rallies nearby troops (+25% speed). 6 lives. |

Sends unlock over time (0:00 to 9:00 after the gates open).

## Presentation

**Look (v0.5, The Line):** dark, cold and bleak, in the spirit of
Winterfell, the Blackwater and the battles of LOTR. It is abstract-realistic
and procedural for now, with no stock scenery assets.
- **The Line:** a sheer rock range runs across the top of the realm. Each
  house's citadel is a great gate cut into its face, a way into a vast city
  in the deep: dressed-stone pillars, long house banners, and lit slits up
  the façade. A fallen house's gate goes dark and is choked with rubble.
- **Canyons:** each lane is a channel sunk into a high, broken plateau,
  walled by crags. The canyons are the only way in, which is why the
  raiders must take the line. They open at the near end onto a bleak plain.
- **Ground:** thick 3D brush (dead grass, heather, bracken) sways in the
  wind on the plateaus and the plain, with boulders and the odd windswept
  dead tree. Canyon floors are frozen mud.
- **Light:** one bleak arc per war, with no bright day:
  - cold overcast at the muster;
  - dusk from 6:00;
  - night from 14:00.
- **Firelight** is the only warm colour:
  - gate fires and braziers;
  - a torch on every tower;
  - torches carried by a third of the invaders.
  A selective grade drains the dark, cold world but keeps fire warm. There's
  also sleet, film grain and a heavy vignette.
- **Invaders:** KayKit characters, drained and darkened to near-silhouettes,
  standing on muted house-coloured discs.
- **Towers:** grey-box, in dark weathered stone and timber.
- **Camera:** about 12° off straight-on and 40° down, looking up the
  canyons toward the range.

- **Colours:** creeps wear a hint of their sender's house colour; raiders
  are pale wights from the north.
- **World-anchored UI:**
  - a banner over each citadel (name, lives, income, blocked state);
  - popovers on tiles and towers.
- **Side UI:** a slim roster, a send dock and a build bar.
- **Build QoL:**
  - hotkeys (Q–Y towers, 1–9 sends);
  - drag-to-paint walls;
  - a road-length readout;
  - live path preview while hovering;
  - an orange hover when a tile would block the road.

## Known gaps and next steps

- **Balance is first-pass.** See the balance runner, and remember that bots
  play worse than people.
- **Bot variety:** no blocking, targeting or counter-sending beyond anti-air
  and crow bias.
- **Art:** primitives only. Plan: CC0 medieval packs (Quaternius, KayKit),
  then a unifying art pass.
- **Multiplayer:** rooms (lockstep relay) aren't built yet. The sim is ready
  for it: commands in, plain-JSON state, seeded RNG.
