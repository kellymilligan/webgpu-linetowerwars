import type { Command, GameState } from '../sim/types';

/**
 * Wire protocol for server-clocked lockstep.
 *
 * The room server owns the clock. Every TURN_MS it takes the commands it has
 * received, validates them against its own copy of the sim, and broadcasts a
 * turn: "apply these commands at tick `at`, then you may simulate up to tick
 * `upTo`". Every client runs the same deterministic sim, so the only traffic
 * is player intent. A slow client just falls behind and catches up; it never
 * stalls anyone else.
 */
export const PROTOCOL_VERSION = 1;
export const TURN_MS = 100;
/** Peers exchange state fingerprints at ticks divisible by this. */
export const HASH_EVERY = 150;
export const MAX_SEATS = 8;

export type RoomPhase = 'lobby' | 'playing' | 'over';

export interface SeatView {
  /** Seat (and lane) index once the war starts; join order in the lobby. */
  seat: number;
  name: string;
  colour: string;
  connected: boolean;
  host: boolean;
}

export type ClientMsg =
  | { t: 'hello'; v: number; token: string; name: string; colour: string }
  | { t: 'profile'; name: string; colour: string }
  | { t: 'start' }
  | { t: 'pause'; paused: boolean }
  | { t: 'toLobby' }
  | { t: 'cmd'; cmd: Command }
  | { t: 'hash'; tick: number; hash: number };

export type ServerMsg =
  | { t: 'welcome'; seat: number; host: boolean }
  | { t: 'room'; phase: RoomPhase; members: SeatView[]; paused: boolean }
  /** Full state, e.g. at the start, on reconnect, or to repair a desync. */
  | { t: 'snapshot'; state: GameState }
  | { t: 'turn'; at: number; upTo: number; cmds: Command[] }
  | { t: 'reject'; reason: string }
  | { t: 'desync'; tick: number }
  | { t: 'error'; reason: string };

export const encode = (m: ClientMsg | ServerMsg) => JSON.stringify(m);
