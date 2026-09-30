import {
  applyCommand,
  boardOptionsFor,
  checkPlacement,
  createGame,
  currentPathLength,
  DT,
  GRID_H,
  GRID_W,
  keepOptionsFor,
  routeFromCells,
  step,
  testBlock,
  WAYPOINTS,
} from '../sim';
import type { BoardOption, Command, GameEvent, GameState, KeepOption, PlaceCheck, Route, Targeting } from '../sim';
import { Cell } from '../sim/types';

export type Selection =
  | { kind: 'pending'; id: number }
  | { kind: 'tower'; id: number }
  | { kind: 'stone'; x: number; y: number }
  | null;

export interface Hover {
  x: number;
  y: number;
  check: PlaceCheck | null;
  preview: Route | null;
  delta: number | null;
}

export type Speed = 1 | 2 | 4 | 10;

export interface Highlight {
  target: { x: number; y: number };
  consumed: { x: number; y: number }[];
}

const SAVE_KEY = 'facet.save.v2';

export class Controller {
  state: GameState;
  speed: Speed = 1;
  paused = false;
  selection: Selection = null;
  hover: Hover | null = null;
  toast: { text: string; id: number } | null = null;
  codexOpen = false;
  /** Tiles an option would affect, shown while hovering it. */
  highlight: Highlight | null = null;
  pathLength = 0;
  version = 0;
  /** Bumped on every new game so views can drop per-run caches. */
  runId = 0;
  private listeners = new Set<() => void>();
  private acc = 0;
  private events: GameEvent[] = [];
  private lastNotify = 0;
  private dirty = false;

  constructor(state?: GameState) {
    this.state = state ?? createGame(randomSeed());
    this.pathLength = currentPathLength(this.state);
  }

  static fromSave(): Controller | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as GameState;
      if (s.version !== 2 || s.phase === 'lost' || s.phase === 'won') return null;
      // Saves are taken on commands and at wave end, so a wave resumes from its start.
      return new Controller(s);
    } catch {
      return null;
    }
  }

  static hasSave(): boolean {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }

  newGame(seed = randomSeed()) {
    this.state = createGame(seed);
    this.runId++;
    this.selection = null;
    this.hover = null;
    this.acc = 0;
    this.paused = false;
    this.codexOpen = false;
    this.events = [];
    this.pathLength = currentPathLength(this.state);
    this.save();
    this.notify(true);
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(force = false) {
    const now = performance.now();
    if (!force && now - this.lastNotify < 120) {
      this.dirty = true;
      return;
    }
    this.lastNotify = now;
    this.dirty = false;
    this.version++;
    for (const fn of this.listeners) fn();
  }

  dispatch(cmd: Command): boolean {
    const { result, events } = applyCommand(this.state, cmd);
    if (!result.ok) {
      this.showToast(result.reason);
      return false;
    }
    this.events.push(...events);
    if (cmd.type === 'keep' || cmd.type === 'board') this.highlight = null;
    if (cmd.type === 'keep') this.selection = null;
    if (cmd.type === 'removeStone') this.selection = null;
    if (cmd.type === 'place' || cmd.type === 'removeStone' || cmd.type === 'keep') {
      this.pathLength = currentPathLength(this.state);
      this.hover = this.hover ? this.computeHover(this.hover.x, this.hover.y) : null;
    }
    this.save();
    this.notify(true);
    return true;
  }

  board(option: BoardOption) {
    this.highlight = null;
    const ok = this.dispatch({ type: 'board', option });
    if (ok) this.selection = { kind: 'tower', id: option.towerId };
    this.notify(true);
  }

  boardOptions(towerId: number) {
    return boardOptionsFor(this.state, towerId);
  }

  setHighlight(h: Highlight | null) {
    this.highlight = h;
    this.notify(true);
  }

  keep(option: KeepOption) {
    this.highlight = null;
    this.dispatch({ type: 'keep', option });
  }

  setTargeting(towerId: number, targeting: Targeting) {
    this.dispatch({ type: 'setTargeting', towerId, targeting });
  }

  showToast(text: string) {
    this.toast = { text, id: (this.toast?.id ?? 0) + 1 };
    this.notify(true);
  }

  setSpeed(speed: Speed) {
    this.speed = speed;
    this.paused = false;
    this.notify(true);
  }

  togglePause() {
    this.paused = !this.paused;
    this.notify(true);
  }

  toggleCodex(open = !this.codexOpen) {
    this.codexOpen = open;
    this.notify(true);
  }

  /** Runs fixed sim ticks for real elapsed time; returns interpolation alpha. */
  tick(dtReal: number): number {
    const s = this.state;
    if (s.phase !== 'wave' || this.paused) {
      this.acc = 0;
      if (this.dirty) this.notify();
      return 1;
    }
    this.acc += Math.min(dtReal, 0.25) * this.speed;
    let stepped = false;
    while (this.acc >= DT && s.phase === 'wave') {
      this.acc -= DT;
      const ev = step(s);
      if (ev.length) this.events.push(...ev);
      stepped = true;
      if (ev.some((e) => e.type === 'waveEnd' || e.type === 'gameOver')) {
        this.pathLength = currentPathLength(s);
        this.save();
        this.notify(true);
        return 1;
      }
    }
    if (stepped) this.notify();
    return s.phase === 'wave' ? this.acc / DT : 1;
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  setHover(tile: { x: number; y: number } | null) {
    if (!tile || tile.x < 0 || tile.y < 0 || tile.x >= GRID_W || tile.y >= GRID_H) {
      if (this.hover) {
        this.hover = null;
        this.notify(true);
      }
      return;
    }
    if (this.hover && this.hover.x === tile.x && this.hover.y === tile.y) return;
    this.hover = this.computeHover(tile.x, tile.y);
    this.notify(true);
  }

  private computeHover(x: number, y: number): Hover {
    const s = this.state;
    const cell = s.grid[y * GRID_W + x];
    if (s.phase !== 'build' || cell !== Cell.Empty) return { x, y, check: null, preview: null, delta: null };
    const check = checkPlacement(s, x, y);
    if (!check.ok) return { x, y, check, preview: null, delta: null };
    const r = testBlock(s.grid, x, y);
    return { x, y, check, preview: r.cells ? routeFromCells(r.cells) : null, delta: check.pathLength - this.pathLength };
  }

  clickTile(x: number, y: number) {
    const s = this.state;
    this.highlight = null;
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return;
    const cell = s.grid[y * GRID_W + x];
    const pending = s.pending.find((p) => p.x === x && p.y === y);
    const tower = s.towers.find((t) => t.x === x && t.y === y);
    if (pending) this.selection = { kind: 'pending', id: pending.id };
    else if (tower) this.selection = { kind: 'tower', id: tower.id };
    else if (cell === Cell.Stone) this.selection = { kind: 'stone', x, y };
    else if (cell === Cell.Empty && s.phase === 'build') {
      this.selection = null;
      this.dispatch({ type: 'place', x, y });
      return;
    } else if (cell === Cell.Waypoint) {
      const w = WAYPOINTS.find((w) => w.x === x && w.y === y);
      this.selection = null;
      if (w) this.showToast(w.name);
    } else this.selection = null;
    this.notify(true);
  }

  keepOptions(gemId: number) {
    return keepOptionsFor(this.state, gemId);
  }

  private save() {
    try {
      const s = this.state;
      if (s.phase === 'lost' || s.phase === 'won') localStorage.removeItem(SAVE_KEY);
      else localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    } catch {
      // Storage may be unavailable (private mode); saving is best-effort.
    }
  }
}

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}
