import { BREACH_COST } from './data/rules';
import { LANE_H, LANE_W, SPAWN_X, SPAWN_Y } from './data/map';
import type { Lane } from './types';

/**
 * Flow fields. Each lane keeps two distance-to-keep fields, both built by
 * Dijkstra outward from the keep row:
 *
 * - `open`: towers are walls. Creeps follow this whenever they can.
 * - `breach`: towers can be smashed through at a cost. Creeps fall back to it
 *   when the open field can't reach them, i.e. the road has been blocked.
 *   They stop at the tower in their way and batter it down.
 */
const STRAIGHT = 10;
const DIAGONAL = 14;
export const UNREACHABLE = -1;
const INF = 0x3fffffff;

// Fixed neighbour order so ties always break the same way.
export const DIRS: readonly [number, number, number][] = [
  [0, 1, STRAIGHT],
  [1, 0, STRAIGHT],
  [-1, 0, STRAIGHT],
  [0, -1, STRAIGHT],
  [1, 1, DIAGONAL],
  [-1, 1, DIAGONAL],
  [1, -1, DIAGONAL],
  [-1, -1, DIAGONAL],
];

const N = LANE_W * LANE_H;
const dist = new Int32Array(N);

export const cellIndex = (x: number, y: number) => y * LANE_W + x;

function isWall(grid: readonly number[], x: number, y: number, extra: number): boolean {
  const i = y * LANE_W + x;
  return grid[i] !== 0 || i === extra;
}

/**
 * Distance to the keep from every cell. With `breachable`, tower cells can be
 * entered (orthogonally only) at an extra cost; otherwise they're walls.
 * `extra` is an additional cell treated as a tower (for placement previews).
 */
export function computeField(grid: readonly number[], breachable: boolean, extra = -1): number[] {
  dist.fill(INF);
  const heap = new MinHeap();
  for (let x = 0; x < LANE_W; x++) {
    const i = cellIndex(x, LANE_H - 1);
    dist[i] = 0;
    heap.push(i, 0);
  }
  while (heap.size > 0) {
    const [cur, d] = heap.pop();
    if (d !== dist[cur]) continue;
    const cx = cur % LANE_W;
    const cy = (cur / LANE_W) | 0;
    // A creep in a tower cell can only leave it orthogonally; nothing routes *through* diagonals of walls.
    const curWall = isWall(grid, cx, cy, extra);
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= LANE_W || ny >= LANE_H) continue;
      const nWall = isWall(grid, nx, ny, extra);
      const diag = dx !== 0 && dy !== 0;
      if (diag) {
        if (curWall || nWall) continue;
        if (isWall(grid, cx + dx, cy, extra) || isWall(grid, cx, cy + dy, extra)) continue;
      }
      let step = cost;
      // Entering `cur` from `n` means battering `cur` if it's a wall.
      if (curWall) {
        if (!breachable) continue;
        step += BREACH_COST * STRAIGHT;
      }
      if (nWall && !breachable) continue;
      const ni = ny * LANE_W + nx;
      const nd = d + step;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        heap.push(ni, nd);
      }
    }
  }
  const out = new Array<number>(N);
  for (let i = 0; i < N; i++) out[i] = dist[i] >= INF ? UNREACHABLE : dist[i];
  return out;
}

export const spawnCell = () => cellIndex(Math.floor(SPAWN_X), Math.floor(SPAWN_Y));

export function refreshLane(lane: Lane) {
  lane.open = computeField(lane.grid, false);
  lane.breach = computeField(lane.grid, true);
  const d = lane.open[spawnCell()];
  lane.blocked = d === UNREACHABLE;
  lane.pathLength = d === UNREACHABLE ? -1 : d / STRAIGHT;
}

/** Open path length (tiles) from the gate if `cell` became a tower; -1 if that blocks. */
export function pathLengthWith(grid: readonly number[], cell: number): number {
  const f = computeField(grid, false, cell);
  const d = f[spawnCell()];
  return d === UNREACHABLE ? -1 : d / STRAIGHT;
}

/**
 * Best next cell from (cx, cy) down a field, or -1 at the keep row. Walls are
 * only stepped into orthogonally, matching computeField.
 */
export function nextCell(grid: readonly number[], field: readonly number[], cx: number, cy: number): number {
  const here = field[cellIndex(cx, cy)];
  let best = -1;
  let bestD = here === UNREACHABLE ? INF : here;
  const curWall = grid[cellIndex(cx, cy)] !== 0;
  for (const [dx, dy] of DIRS) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= LANE_W || ny >= LANE_H) continue;
    const ni = cellIndex(nx, ny);
    const d = field[ni];
    if (d === UNREACHABLE) continue;
    if (dx !== 0 && dy !== 0) {
      if (curWall || grid[ni] !== 0) continue;
      if (grid[cellIndex(cx + dx, cy)] !== 0 || grid[cellIndex(cx, cy + dy)] !== 0) continue;
    }
    if (d < bestD) {
      bestD = d;
      best = ni;
    }
  }
  return best;
}

/** Polyline (lane-local, cell centres) from the gate to the keep along the open field. */
export function tracePath(grid: readonly number[], field: readonly number[]): number[] {
  const pts: number[] = [SPAWN_X, SPAWN_Y];
  let cx = Math.floor(SPAWN_X);
  let cy = Math.floor(SPAWN_Y);
  if (field[cellIndex(cx, cy)] === UNREACHABLE) return [];
  for (let guard = 0; guard < LANE_W * LANE_H; guard++) {
    const n = nextCell(grid, field, cx, cy);
    if (n < 0) break;
    cx = n % LANE_W;
    cy = (n / LANE_W) | 0;
    pts.push(cx + 0.5, cy + 0.5);
  }
  pts.push(pts[pts.length - 2], LANE_H);
  return pts;
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
      if (!this.less(i, p)) break;
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
