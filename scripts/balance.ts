/**
 * Headless balance report: `npm run balance -- [games]`.
 * Plays full 8-bot matches and summarises pace and outcomes. Bots play worse
 * than people, so read this as a floor, not a prediction.
 */
import { createGame, step, TICK_RATE, MUSTER_TIME, CREEPS } from '../src/sim';
import type { GameState } from '../src/sim';

export function playOut(seed: string, maxMinutes = 45): GameState {
  const s = createGame(seed, { humans: [] });
  const max = maxMinutes * 60 * TICK_RATE;
  while (s.phase !== 'over' && s.tick < max) step(s);
  return s;
}

const games = Number(process.argv[2] ?? 6);
// Experiment knob: HP=1.4 scales every creep's hp (sends and raids) for this run.
if (process.env.HP) for (const c of Object.values(CREEPS)) c.hp = Math.round(c.hp * Number(process.env.HP));
const t0 = performance.now();
const lengths: number[] = [];
for (let g = 0; g < games; g++) {
  const tg = performance.now();
  const s = playOut(`balance-${g}`);
  const mins = (s.tick / TICK_RATE - MUSTER_TIME) / 60;
  lengths.push(mins);
  const fallen = s.fallen.map((id) => `${s.players[id].name}@${((s.players[id].eliminatedAt! / TICK_RATE - MUSTER_TIME) / 60).toFixed(1)}m`);
  console.log(`game ${g}: ${s.phase === 'over' ? `winner ${s.players[s.winner!]?.name}` : 'UNFINISHED'} after ${mins.toFixed(1)} min, raids ${s.raidNumber} (${((performance.now() - tg) / 1000).toFixed(0)}s)`);
  console.log(`  fallen: ${fallen.join(', ')}`);
  for (const p of s.players) {
    const st = p.stats;
    console.log(
      `  ${p.name.padEnd(8)} agg=${p.bot!.aggression.toFixed(2)} place=${p.place} income=${p.income} ` +
        `towers=${st.goldTowers}g sends=${st.goldSent}g (${st.sent}) kills=${st.kills} leaked=${st.leaked} took=${st.livesTaken} lost=${st.towersLost}`,
    );
  }
}
lengths.sort((a, b) => a - b);
console.log(`\nmedian length ${lengths[Math.floor(lengths.length / 2)].toFixed(1)} min, ${((performance.now() - t0) / 1000).toFixed(1)}s total`);
