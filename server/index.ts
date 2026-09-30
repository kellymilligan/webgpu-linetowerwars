/**
 * Cloudflare Worker entry: serves the built game and hosts one Durable Object
 * per war room (via PartyServer). All game logic lives in RoomCore, shared
 * with tests; this file only adapts it to the platform.
 */
import { routePartykitRequest, Server } from 'partyserver';
import type { Connection } from 'partyserver';
import { TURN_MS } from '../src/net/protocol';
import { RoomCore } from '../src/net/room';

interface Env {
  Room: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export class Room extends Server<Env> {
  private core = new RoomCore({
    send: (conn, msg) => this.getConnection(conn)?.send(JSON.stringify(msg)),
    broadcast: (msg) => this.broadcast(JSON.stringify(msg)),
    clock: (on) => this.setClock(on),
    now: () => Date.now(),
    seed: () => crypto.randomUUID().slice(0, 8),
  });
  private timer: ReturnType<typeof setInterval> | null = null;

  private setClock(on: boolean) {
    if (on && !this.timer) this.timer = setInterval(() => this.core.pump(), TURN_MS);
    if (!on && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onConnect(conn: Connection) {
    this.core.onConnect(conn.id);
  }

  onMessage(conn: Connection, message: string | ArrayBuffer | ArrayBufferView) {
    if (typeof message === 'string') this.core.onMessage(conn.id, message);
  }

  onClose(conn: Connection) {
    this.core.onClose(conn.id);
  }

  onError(conn: Connection) {
    this.core.onClose(conn.id);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await routePartykitRequest(request, env as unknown as Record<string, unknown>)) ?? env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
