/**
 * A headless player that joins a room over WebSocket and plays its seat with
 * the bot brain. Handy for testing a deployment, or for a quick game.
 *
 *   npx vite-node scripts/net-player.ts -- <host> <room> [name] [--start]
 *   e.g.  npx vite-node scripts/net-player.ts -- 127.0.0.1:8787 abcde Claude --start
 */
import { NetGame } from '../src/net/client';
import type { ServerMsg } from '../src/net/protocol';
import { createBrain, decide } from '../src/sim/bot';
import { seedRng } from '../src/sim/rng';
import { HOUSES } from '../src/sim';

const args = process.argv.slice(2).filter((a) => a !== '--');
const [host, room, name = 'Claude'] = args;
const startIfHost = args.includes('--start');
if (!host || !room) {
  console.log('usage: net-player <host> <room> [name] [--start]');
  process.exit(1);
}
const secure = !/^(localhost|127\.)/.test(host);
const url = `${secure ? 'wss' : 'ws'}://${host}/parties/room/${room}`;
const ws = new WebSocket(url);
const net = new NetGame((m) => ws.readyState === 1 && ws.send(JSON.stringify(m)), {
  token: `bot-${name}-${room}`,
  name,
  colour: HOUSES[6].colour,
});
const brain = createBrain(seedRng(`${name}:${room}`));
let log = '';
const say = (t: string) => {
  if (t !== log) console.log(`[${new Date().toISOString().slice(11, 19)}] ${t}`);
  log = t;
};
net.onNotice = (t) => say(`server: ${t}`);
ws.onopen = () => {
  say(`connected to ${url}`);
  net.open();
};
ws.onmessage = (e) => net.receive(JSON.parse(String(e.data)) as ServerMsg);
ws.onclose = () => {
  say('disconnected');
  process.exit(0);
};

let lastThink = 0;
let lastStatus = 0;
let started = false;
setInterval(() => {
  if (net.error) {
    say(`error: ${net.error}`);
    process.exit(1);
  }
  if (net.phase === 'lobby' && net.host && startIfHost && !started && net.members.length >= 1) {
    started = true;
    setTimeout(() => net.start(), 1500);
  }
  net.advance(0.05);
  const s = net.state;
  if (!s || net.phase === 'lobby') return;
  const now = Date.now();
  const me = s.players[net.seat];
  if (me?.alive && now - lastThink > 1000) {
    lastThink = now;
    for (const cmd of decide(s, net.seat, brain)) net.submit(cmd);
  }
  if (now - lastStatus > 15000) {
    lastStatus = now;
    const t = Math.max(0, Math.round(s.tick / 30 - 30));
    say(`t=${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} ${s.players.map((p) => `${p.name}${p.alive ? `♥${p.lives}` : '✝'}`).join(' ')} | my gold ${me?.gold} income ${me?.income}`);
  }
  if (s.phase === 'over') {
    say(`war over: ${s.winner !== null ? s.players[s.winner].name : 'nobody'} wins; I placed ${me?.place}`);
    ws.close();
  }
}, 50);
