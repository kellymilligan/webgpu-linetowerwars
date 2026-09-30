/**
 * A simple greedy player for headless balance runs and tests. It is not meant
 * to play well, only consistently.
 */
import {
  applyCommand,
  boardOptionsFor,
  checkPlacement,
  computeGroundCells,
  createGame,
  estimateDps,
  GRID_W,
  keepOptionsFor,
  oddsUpgradeCost,
  SPECIALS_BY_ID,
  step,
  towerDef,
  waveDef,
} from '../src/sim';
import type { BoardOption, GameState, KeepOption, Tower } from '../src/sim';
import { nextInt, seedRng } from '../src/sim/rng';

export interface BotOptions {
  /** Candidate tiles sampled per placement. */
  samples?: number;
  /** Keep this much gold in reserve before buying odds. */
  oddsReserve?: number;
  maxTicks?: number;
}

export interface BotResult {
  state: GameState;
  waveReached: number;
  won: boolean;
  ticks: number;
}

export function runBot(seed: string, opts: BotOptions = {}): BotResult {
  const samples = opts.samples ?? 24;
  const s = createGame(seed);
  const botRng = seedRng(`bot:${seed}`);
  let ticks = 0;
  const maxTicks = opts.maxTicks ?? 30 * 60 * 60 * 3;
  while (s.phase !== 'lost' && s.phase !== 'won' && ticks < maxTicks) {
    if (s.phase === 'build') {
      if (s.pending.length === 0) boardActions(s);
      buyOdds(s, opts.oddsReserve ?? 0);
      placeBest(s, samples, botRng);
    } else if (s.phase === 'choose') {
      applyCommand(s, { type: 'keep', option: bestKeep(s) });
    } else {
      step(s);
      ticks++;
    }
  }
  return { state: s, waveReached: s.wave, won: s.phase === 'won', ticks };
}

function buyOdds(s: GameState, reserve: number) {
  for (;;) {
    const cost = oddsUpgradeCost(s);
    if (cost === null || s.gold - reserve < cost) return;
    applyCommand(s, { type: 'upgradeOdds' });
  }
}

function placeBest(s: GameState, samples: number, rng: ReturnType<typeof seedRng>) {
  const cells = computeGroundCells(s.grid).cells!;
  // Candidates: tiles on or beside the current path.
  const cand = new Set<number>();
  for (const c of cells) {
    const x = c % GRID_W;
    const y = (c / GRID_W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cand.add((y + dy) * GRID_W + (x + dx));
  }
  const list = [...cand];
  let best = -1;
  let bestLen = -1;
  for (let i = 0; i < samples && list.length > 0; i++) {
    const idx = list.splice(nextInt(rng, list.length), 1)[0];
    const x = idx % GRID_W;
    const y = (idx / GRID_W) | 0;
    const r = checkPlacement(s, x, y);
    if (r.ok && r.pathLength > bestLen) {
      bestLen = r.pathLength;
      best = idx;
    }
  }
  if (best < 0) {
    // Fall back to any legal tile.
    for (let i = 0; i < s.grid.length; i++) {
      if (checkPlacement(s, i % GRID_W, (i / GRID_W) | 0).ok) {
        best = i;
        break;
      }
    }
  }
  applyCommand(s, { type: 'place', x: best % GRID_W, y: (best / GRID_W) | 0 });
}

const hasAir = (s: GameState, w: number) => waveDef(s.seed, Math.min(50, w)).groups.some((g) => g.archetype.air);

function towerValue(s: GameState, t: Pick<Tower, 'kind' | 'family' | 'grade' | 'specialId' | 'level'>): number {
  const airSoon = [0, 1, 2].some((k) => hasAir(s, s.wave + k));
  const airTowers = s.towers.filter((x) => towerDef(x).attack.targets === 'air').length;
  const a = towerDef(t).attack;
  let v = estimateDps(a);
  if (a.targets === 'air') v *= (airSoon ? 1.0 : 0.3) * (airTowers >= 2 ? 0.4 : 1);
  if (a.targets === 'ground' && hasAir(s, s.wave)) v *= 0.8;
  if (towerDef(t).aura) v += 8 * s.towers.length;
  return v;
}

/** Greedily applies board combines, forges and upgrades that add value. */
function boardActions(s: GameState) {
  for (let guard = 0; guard < 20; guard++) {
    let best: BoardOption | null = null;
    let bestGain = 0;
    for (const t of s.towers) {
      for (const o of boardOptionsFor(s, t.id)) {
        const target = s.towers.find((x) => x.id === o.towerId)!;
        const before = [target, ...o.consumed.map((id) => s.towers.find((x) => x.id === id)!)].reduce((sum, x) => sum + towerValue(s, x), 0);
        const after =
          o.kind === 'boardCombine'
            ? towerValue(s, { ...target, grade: o.result.grade })
            : o.kind === 'boardRecipe'
              ? towerValue(s, { kind: 'special', family: SPECIALS_BY_ID[o.recipeId].family, grade: 4, specialId: o.recipeId, level: 0 })
              : towerValue(s, { ...target, level: o.toLevel });
        const gain = after - before;
        if (gain > bestGain) {
          bestGain = gain;
          best = o;
        }
      }
    }
    if (!best) return;
    applyCommand(s, { type: 'board', option: best });
  }
}

function optionValue(s: GameState, o: KeepOption): number {
  const fake = (t: Pick<Tower, 'kind' | 'family' | 'grade' | 'specialId' | 'level'>) => towerValue(s, t);
  switch (o.kind) {
    case 'keep':
    case 'combine':
      return fake({ kind: 'gem', family: o.result.family, grade: o.result.grade, level: 0 });
    case 'recipe':
      return fake({ kind: 'special', family: SPECIALS_BY_ID[o.recipeId].family, grade: 4, specialId: o.recipeId, level: 0 }) * 1.1;
    case 'upgrade': {
      const t = s.towers.find((t) => t.id === o.towerId)!;
      return fake({ ...t, level: o.toLevel }) - fake(t) * 0.5;
    }
  }
}

function bestKeep(s: GameState): KeepOption {
  const options = s.pending.flatMap((p) => keepOptionsFor(s, p.id));
  let best = options[0];
  let bestV = -Infinity;
  for (const o of options) {
    const v = optionValue(s, o);
    if (v > bestV) {
      bestV = v;
      best = o;
    }
  }
  return best;
}
