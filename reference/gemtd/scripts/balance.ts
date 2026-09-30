/** Headless balance report: `npm run balance -- [runs]`. */
import { runBot } from './bot';

const runs = Number(process.argv[2] ?? 10);
const results = [];
const t0 = performance.now();
for (let i = 0; i < runs; i++) {
  const r = runBot(`balance-${i}`);
  results.push(r);
  const st = r.state.stats;
  console.log(
    `seed balance-${i}: ${r.won ? 'WON' : `lost at wave ${r.waveReached}`}  lives=${r.state.lives} ` +
      `towers=${r.state.towers.length} specials=${st.specialsMade} odds=${r.state.oddsLevel} ` +
      `gold=${r.state.gold} maze=${st.mazeLengthByWave.at(-1)} leaks=${st.leaks}`,
  );
}
const waves = results.map((r) => r.waveReached).sort((a, b) => a - b);
console.log(`\nmedian wave ${waves[Math.floor(waves.length / 2)]}, wins ${results.filter((r) => r.won).length}/${runs}, ${((performance.now() - t0) / 1000).toFixed(1)}s`);
