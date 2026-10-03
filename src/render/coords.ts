import { LANE_H, LANE_W, MAX_PLAYERS } from '../sim/data/map';

/**
 * World layout: each lane is a canyon running along z, with its citadel gate
 * cut into the rock range at the far end (−z, top of the screen) and the
 * raiders' approach at the near end (+z). Lanes sit side by side along x with
 * a rock plateau between them, centred on the origin. Cell boundaries sit on
 * integer world coordinates.
 *
 * The lane count follows the game (8 normally; fewer in a multiplayer room
 * without bots), so the layout is set with setLaneCount().
 */
export const LANE_GAP = 7;
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
/** Lane row → world z: row 0 (the gate the raiders enter by) is nearest the camera. */
export const toWorldZ = (y: number) => LANE_H / 2 - y;
export const laneCentreX = (lane: number) => laneOriginX(lane) + LANE_W / 2;
export const worldMinX = () => laneOriginX(0) - LANE_GAP;
export const worldMaxX = () => laneOriginX(lanes - 1) + LANE_W + LANE_GAP;

/** World point → lane and lane-local cell, or null if between lanes. */
export function fromWorld(wx: number, wz: number): { lane: number; x: number; y: number } | null {
  const rel = wx - first;
  const lane = Math.floor(rel / STRIDE);
  if (lane < 0 || lane >= lanes) return null;
  const x = Math.floor(rel - lane * STRIDE);
  const y = Math.floor(LANE_H / 2 - wz);
  if (x < 0 || x >= LANE_W || y < 0 || y >= LANE_H) return null;
  return { lane, x, y };
}
