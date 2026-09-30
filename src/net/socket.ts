import { PartySocket } from 'partysocket';
import { HOUSES } from '../sim';
import { NetGame } from './client';
import type { Profile } from './client';
import type { ServerMsg } from './protocol';

const PROFILE_KEY = 'siegeline.profile';

/** Name, colour and a stable token that lets a refresh reclaim the same seat. */
export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as Profile | null;
    if (p?.token) return p;
  } catch {
    // Fall through to a fresh profile.
  }
  const p = { token: crypto.randomUUID(), name: 'Wanderer', colour: HOUSES[0].colour };
  saveProfile(p);
  return p;
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // Best-effort.
  }
}

/**
 * Where rooms live. Deployed, the Worker serves the game and the rooms from one
 * origin; in dev, Vite serves the game and `npm run server` (wrangler) the rooms.
 */
const partyHost = () => (import.meta.env.VITE_PARTY_HOST as string | undefined) || location.host;

export function joinRoom(code: string): NetGame {
  let socket: PartySocket | null = null;
  const net = new NetGame((m) => socket?.send(JSON.stringify(m)), loadProfile());
  socket = new PartySocket({ host: partyHost(), party: 'room', room: code });
  socket.addEventListener('open', () => net.open());
  socket.addEventListener('close', () => net.closed());
  socket.addEventListener('message', (e: MessageEvent) => net.receive(JSON.parse(String(e.data)) as ServerMsg));
  const setProfile = net.setProfile.bind(net);
  net.setProfile = (name, colour) => {
    setProfile(name, colour);
    saveProfile(net.profile);
  };
  return net;
}

const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
export function newRoomCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
