import { LANE_H, LANE_W, MAX_PLAYERS } from '../sim/data/map';

/**
 * World layout: lanes run along +z (gate at the far end, keep near), placed
 * side by side along x with a strip of wild ground between them.
 * Cell boundaries sit on integer world coordinates.
 */
export const LANE_GAP = 6;
export const STRIDE = LANE_W + LANE_GAP;
const FIRST = -Math.round(((MAX_PLAYERS - 1) * STRIDE + LANE_W) / 2);

export const AIR_HEIGHT = 1.9;

export const laneOriginX = (lane: number) => FIRST + lane * STRIDE;
export const toWorldX = (lane: number, x: number) => laneOriginX(lane) + x;
export const toWorldZ = (y: number) => y - LANE_H / 2;
export const laneCentreX = (lane: number) => laneOriginX(lane) + LANE_W / 2;

export const WORLD_MIN_X = laneOriginX(0) - LANE_GAP;
export const WORLD_MAX_X = laneOriginX(MAX_PLAYERS - 1) + LANE_W + LANE_GAP;

/** World point → lane and lane-local cell, or null if between lanes. */
export function fromWorld(wx: number, wz: number): { lane: number; x: number; y: number } | null {
  const rel = wx - FIRST;
  const lane = Math.floor(rel / STRIDE);
  if (lane < 0 || lane >= MAX_PLAYERS) return null;
  const x = Math.floor(rel - lane * STRIDE);
  const y = Math.floor(wz + LANE_H / 2);
  if (x < 0 || x >= LANE_W || y < 0 || y >= LANE_H) return null;
  return { lane, x, y };
}
