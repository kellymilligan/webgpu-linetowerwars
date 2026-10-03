/**
 * A brain for lobbyhop's headless player: plays a seat with Siegeline's bot
 * logic over a real WebSocket. Handy for testing a deployment, or a quick game.
 *
 *   npx lobbyhop bot scripts/bot-brain.ts --host 127.0.0.1:8787 --room abcde --name Claude --start
 *   (behind a proxy: NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca bundle> npx lobbyhop bot …)
 */
import { createBrain, decide as botDecide } from '../src/sim/bot';
import type { BotBrain, GameState } from '../src/sim';
import { seedRng } from '../src/sim/rng';
import type { NetCommand } from '../src/multiplayer/game';
export { game } from '../src/multiplayer/game';

export const thinkMs = 800;

const brains = new Map<number, BotBrain>();
let lastLog = -Infinity;

export function decide(state: GameState, seat: number): NetCommand[] {
  let brain = brains.get(seat);
  if (!brain) brains.set(seat, (brain = createBrain(seedRng(`net-bot:${seat}`))));
  if (state.tick - lastLog >= 30 * 15) {
    // A status line every ~15 s of war, so a run against a deployment shows progress.
    lastLog = state.tick;
    const p = state.players[seat];
    console.log(`  t=${Math.floor(state.tick / 30)}s ${state.phase} · lives ${p.lives} · gold ${p.gold} · income ${p.income} · towers ${state.towers.filter((t) => t.lane === seat).length}`);
  }
  // The sim's bot thinks on a copy and records its commands; the server stamps our seat.
  return botDecide(state, seat, brain).map(({ player: _, ...cmd }) => cmd as NetCommand);
}
