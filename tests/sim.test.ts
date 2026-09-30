import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  CREEPS,
  createGame,
  LANE_H,
  LANE_W,
  MUSTER_TIME,
  nextAlive,
  START_LIVES,
  step,
  TICK_RATE,
} from '../src/sim';
import type { GameState } from '../src/sim';
import { mazeTemplate } from '../src/sim/bot';

const run = (s: GameState, secs: number) => {
  for (let i = 0; i < secs * TICK_RATE && s.phase !== 'over'; i++) step(s);
};

describe('determinism', () => {
  it('two 8-bot games with the same seed stay identical', () => {
    const a = createGame('det', { humans: [] });
    const b = createGame('det', { humans: [] });
    run(a, 240);
    run(b, 240);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('survives a JSON round-trip mid-game (saves and reconnects)', () => {
    const a = createGame('rt', { humans: [] });
    run(a, 120);
    const b = JSON.parse(JSON.stringify(a)) as GameState;
    run(a, 120);
    run(b, 120);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds diverge', () => {
    const a = createGame('x1', { humans: [] });
    const b = createGame('x2', { humans: [] });
    run(a, 120);
    run(b, 120);
    expect(JSON.stringify(a.towers)).not.toBe(JSON.stringify(b.towers));
  });
});

describe('building and the road', () => {
  it('rejects building outside the lane body, on towers, or without gold', () => {
    const s = createGame('b');
    expect(applyCommand(s, { type: 'build', player: 0, x: 5, y: 0, kind: 'archer' }).result.ok).toBe(false);
    expect(applyCommand(s, { type: 'build', player: 0, x: 5, y: 10, kind: 'archer' }).result.ok).toBe(true);
    expect(applyCommand(s, { type: 'build', player: 0, x: 5, y: 10, kind: 'archer' }).result.ok).toBe(false);
    s.players[0].gold = 3;
    expect(applyCommand(s, { type: 'build', player: 0, x: 6, y: 10, kind: 'palisade' }).result.ok).toBe(false);
  });

  it('a serpentine maze lengthens the road without blocking it', () => {
    const s = createGame('m');
    s.players[0].gold = 10000;
    const straight = s.lanes[0].pathLength;
    for (const c of mazeTemplate(3, false)) applyCommand(s, { type: 'build', player: 0, x: c.x, y: c.y, kind: 'palisade' });
    expect(s.lanes[0].blocked).toBe(false);
    expect(s.lanes[0].pathLength).toBeGreaterThan(straight * 2.5);
  });

  it('blocking is allowed, and creeps batter through the wall', () => {
    const s = createGame('blk', { humans: [0, 1] });
    s.players[0].gold = 10000;
    for (let x = 0; x < LANE_W; x++) applyCommand(s, { type: 'build', player: 0, x, y: 10, kind: 'palisade' });
    expect(s.lanes[0].blocked).toBe(true);
    run(s, MUSTER_TIME + 1);
    // Player 7 sends at player 0.
    s.players[7].gold = 1000;
    const before = s.towers.filter((t) => t.lane === 0).length;
    applyCommand(s, { type: 'send', player: 7, send: 'footmen' });
    let destroyed = 0;
    for (let i = 0; i < 90 * TICK_RATE && s.phase !== 'over'; i++) destroyed += step(s).filter((e) => e.type === 'towerDestroyed' && e.lane === 0).length;
    expect(destroyed).toBeGreaterThan(0);
    expect(s.towers.filter((t) => t.lane === 0).length).toBeLessThan(before);
  });
});

describe('sends, leaks and the chain', () => {
  it('sends hit the next living player and raise income', () => {
    const s = createGame('s', { humans: [0, 1, 2, 3, 4, 5, 6, 7] });
    run(s, MUSTER_TIME + 1);
    const inc = s.players[0].income;
    expect(applyCommand(s, { type: 'send', player: 0, send: 'levies' }).result.ok).toBe(true);
    expect(s.players[0].income).toBe(inc + 1);
    expect(s.creeps.filter((c) => c.owner === 0).every((c) => c.lane === 1)).toBe(true);
    s.players[1].alive = false;
    expect(nextAlive(s, 0)).toBe(2);
  });

  it('a breakthrough costs lives, pays plunder, and marches into one more lane', () => {
    const s = createGame('leak', { humans: [0, 1, 2, 3, 4, 5, 6, 7] });
    run(s, MUSTER_TIME + 1);
    applyCommand(s, { type: 'send', player: 0, send: 'levies' });
    const gold0 = s.players[0].gold;
    const lanesSeen = new Set<number>();
    let leaks = 0;
    for (let i = 0; i < 120 * TICK_RATE; i++) {
      for (const e of step(s)) if (e.type === 'leak' && e.owner === 0) {
        leaks++;
        lanesSeen.add(e.lane);
      }
    }
    // Undefended: every levy breaks through lane 1, then lane 2, then goes home.
    expect([...lanesSeen].sort()).toEqual([1, 2]);
    expect(leaks).toBe(10);
    expect(s.players[1].lives).toBeLessThan(START_LIVES);
    expect(s.players[2].lives).toBeLessThan(START_LIVES);
    expect(s.players[0].gold).toBeGreaterThan(gold0);
  });

  it('eliminates at zero lives, razes the lane, and ends with one standing', () => {
    const s = createGame('elim', { humans: [0, 1, 2, 3, 4, 5, 6, 7] });
    run(s, 1);
    for (let p = 1; p < 8; p++) s.players[p].lives = 0;
    applyCommand(s, { type: 'build', player: 3, x: 3, y: 10, kind: 'archer' });
    step(s);
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(0);
    expect(s.players[0].place).toBe(1);
    expect(s.towers.some((t) => t.lane === 3)).toBe(false);
  });

  it('gold never goes negative in bot games', () => {
    const s = createGame('neg', { humans: [] });
    for (let i = 0; i < 360 * TICK_RATE && s.phase !== 'over'; i++) {
      step(s);
      for (const p of s.players) expect(p.gold).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('creeps', () => {
  it('flyers ignore the maze', () => {
    const s = createGame('air', { humans: [0, 1, 2, 3, 4, 5, 6, 7] });
    s.players[1].gold = 10000;
    for (const c of mazeTemplate(3, false)) applyCommand(s, { type: 'build', player: 1, x: c.x, y: c.y, kind: 'palisade' });
    run(s, MUSTER_TIME + 91);
    applyCommand(s, { type: 'send', player: 0, send: 'crows' });
    const ticks = Math.ceil(((LANE_H + 2) / CREEPS.crow.speed) * TICK_RATE) + 60;
    let leaked = false;
    for (let i = 0; i < ticks && !leaked; i++) leaked = step(s).some((e) => e.type === 'leak' && e.kind === 'crow' && e.lane === 1);
    expect(leaked).toBe(true);
  });
});
