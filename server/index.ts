/**
 * Cloudflare Worker: one Durable Object per war room (lobbyhop), and the
 * built game for everything else. Same origin, so the client needs no host
 * config in production.
 */
import { createRoomServer, createWorker } from 'lobbyhop/cloudflare';
import { game } from '../src/multiplayer/game';

// Must match "class_name" in wrangler.jsonc (and the existing v1 migration).
export const Room = createRoomServer(game);
export default createWorker({ binding: 'Room' });
