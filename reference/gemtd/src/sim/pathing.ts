import { GRID_H, GRID_W, WAYPOINTS } from './data/map';
import type { Route } from './types';
import { Cell } from './types';

const STRAIGHT = 10;
const DIAGONAL = 14;
// Neighbour order is fixed so ties always break the same way.
const DIRS: readonly [number, number, number][] = [
  [1, 0, STRAIGHT],
  [0, 1, STRAIGHT],
  [-1, 0, STRAIGHT],
  [0, -1, STRAIGHT],
  [1, 1, DIAGONAL],
  [-1, 1, DIAGONAL],
  [-1, -1, DIAGONAL],
  [1, -1, DIAGONAL],
];

export function walkable(grid: readonly number[], x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return false;
  const c = grid[y * GRID_W + x];
  return c === Cell.Empty || c === Cell.Waypoint;
}

const dist = new Int32Array(GRID_W * GRID_H);
const prev = new Int32Array(GRID_W * GRID_H);

/** Shortest 8-connected path (no corner cutting). Returns cell indices, or null. */
export function findPath(grid: readonly number[], from: number, to: number): number[] | null {
  dist.fill(0x7fffffff);
  prev.fill(-1);
  const heap = new MinHeap();
  dist[from] = 0;
  heap.push(from, 0);
  while (heap.size > 0) {
    const [cur, d] = heap.pop();
    if (d !== dist[cur]) continue;
    if (cur === to) break;
    const cx = cur % GRID_W;
    const cy = (cur / GRID_W) | 0;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(grid, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!walkable(grid, cx + dx, cy) || !walkable(grid, cx, cy + dy))) continue;
      const ni = ny * GRID_W + nx;
      const nd = d + cost;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        prev[ni] = cur;
        heap.push(ni, nd);
      }
    }
  }
  if (dist[to] === 0x7fffffff) return null;
  const path: number[] = [];
  for (let i = to; i !== -1; i = prev[i]) path.push(i);
  return path.reverse();
}

export interface RouteResult {
  cells: number[] | null;
  /** Index of the first leg that could not be completed, or -1. */
  blockedLeg: number;
}

export function computeGroundCells(grid: readonly number[]): RouteResult {
  const cells: number[] = [];
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const a = WAYPOINTS[i];
    const b = WAYPOINTS[i + 1];
    const leg = findPath(grid, a.y * GRID_W + a.x, b.y * GRID_W + b.x);
    if (!leg) return { cells: null, blockedLeg: i };
    if (i > 0) leg.shift();
    for (const c of leg) cells.push(c);
  }
  return { cells, blockedLeg: -1 };
}

export function routeFromCells(cells: readonly number[]): Route {
  const points: number[] = [];
  for (const c of cells) points.push((c % GRID_W) + 0.5, ((c / GRID_W) | 0) + 0.5);
  return routeFromPoints(points);
}

export function routeFromPoints(points: number[]): Route {
  const lengths = [0];
  for (let i = 2; i < points.length; i += 2) {
    const dx = points[i] - points[i - 2];
    const dy = points[i + 1] - points[i - 1];
    lengths.push(lengths[lengths.length - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return { points, lengths, total: lengths[lengths.length - 1] };
}

export function airRoute(): Route {
  const pts: number[] = [];
  for (const w of WAYPOINTS) pts.push(w.x + 0.5, w.y + 0.5);
  return routeFromPoints(pts);
}

/** Would setting this cell to a blocker still leave every leg reachable? */
export function testBlock(grid: number[], x: number, y: number): RouteResult {
  const i = y * GRID_W + x;
  const old = grid[i];
  grid[i] = Cell.Stone;
  const r = computeGroundCells(grid);
  grid[i] = old;
  return r;
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, key: number) {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] < this.keys[i] || (this.keys[p] === this.keys[i] && this.items[p] <= this.items[i])) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.items[0], this.keys[0]];
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.less(l, m)) m = l;
        if (r < this.items.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private less(a: number, b: number) {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.items[a] < this.items[b]);
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}
