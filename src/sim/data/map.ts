/**
 * Lane geometry. Every player holds one lane: a walled road running from an
 * outer gate (y = 0) down to their keep (y = LANE_H - 1). Coordinates are
 * lane-local; the renderer lays the lanes out side by side.
 */
export const LANE_W = 11;
export const LANE_H = 34;
/** Rows at the top and bottom kept clear of building. */
export const GATE_ROWS = 2;
export const KEEP_ROWS = 2;
/** Creeps enter here (lane-local, cell centre). */
export const SPAWN_X = LANE_W / 2;
export const SPAWN_Y = 0.5;
/** A ground creep has escaped once it passes this y. */
export const EXIT_Y = LANE_H - 0.5;

export const MAX_PLAYERS = 8;

export function buildable(x: number, y: number): boolean {
  return x >= 0 && x < LANE_W && y >= GATE_ROWS && y < LANE_H - KEEP_ROWS;
}

export function inLane(x: number, y: number): boolean {
  return x >= 0 && x < LANE_W && y >= 0 && y < LANE_H;
}
