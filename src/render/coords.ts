import { LANE_H, LANE_W, MAX_PLAYERS } from '../sim/data/map';

/**
 * World layout: lanes run along +z (gate at the far end, keep near), placed
 * side by side along x with a strip of wild ground between them, centred on
 * the origin. Cell boundaries sit on integer world coordinates.
 *
 * The lane count follows the game (8 normally; fewer in a multiplayer room
 * without bots), so the layout is set with setLaneCount().
 */
export const LANE_GAP = 6;
export const STRIDE = LANE_W + LANE_GAP;

export const AIR_HEIGHT = 1.9;

let lanes = MAX_PLAYERS;
let first = firstFor(lanes);
function firstFor(n: number) {
  return -Math.round(((n - 1) * STRIDE + LANE_W) / 2);
}

/** Returns true if the layout changed. */
export function setLaneCount(n: number): boolean {
  if (n === lanes) return false;
  lanes = n;
  first = firstFor(n);
  return true;
}

export const laneCount = () => lanes;
export const laneOriginX = (lane: number) => first + lane * STRIDE;
export const toWorldX = (lane: number, x: number) => laneOriginX(lane) + x;
export const toWorldZ = (y: number) => y - LANE_H / 2;
export const laneCentreX = (lane: number) => laneOriginX(lane) + LANE_W / 2;
export const worldMinX = () => laneOriginX(0) - LANE_GAP;
export const worldMaxX = () => laneOriginX(lanes - 1) + LANE_W + LANE_GAP;

/** World point → lane and lane-local cell, or null if between lanes. */
export function fromWorld(wx: number, wz: number): { lane: number; x: number; y: number } | null {
  const rel = wx - first;
  const lane = Math.floor(rel / STRIDE);
  if (lane < 0 || lane >= lanes) return null;
  const x = Math.floor(rel - lane * STRIDE);
  const y = Math.floor(wz + LANE_H / 2);
  if (x < 0 || x >= LANE_W || y < 0 || y >= LANE_H) return null;
  return { lane, x, y };
}
