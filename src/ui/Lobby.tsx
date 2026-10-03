import { useEffect, useState } from 'preact/hooks';
import type { Controller } from '../app/controller';
import { MAX_SEATS } from '../multiplayer/game';
import { HOUSES } from '../sim';

/**
 * The war council: pick a name and colour, share the link, host starts.
 * Rendered from lobbyhop's RoomClient fields. The `lh-*` classes let
 * `npx lobbyhop e2e` drive it like the stock lobby.
 */
export function Lobby({ ctl }: { ctl: Controller }) {
  const net = ctl.net!;
  const [name, setName] = useState(net.profile.name);
  const [copied, setCopied] = useState(false);
  useEffect(() => setName(net.profile.name), [net.profile.name]);
  const me = net.members.find((m) => m.seat === net.seat);
  const taken = new Set(net.members.filter((m) => m !== me).map((m) => m.colour));
  const link = location.href;
  const commitName = () => {
    if (name.trim() && name !== net.profile.name) net.setProfile({ name });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the link is selectable anyway.
    }
  };
  return (
    <div class="modal">
      <div class="sheet panel lobby lh-panel">
        <h2>War council</h2>
        {net.error ? (
          <p class="bad">{net.error.reason}</p>
        ) : !net.connected ? (
          <p class="dim">Riding to the council…</p>
        ) : (
          <p class="dim">
            Share this link.{' '}
            {net.settings.fillBots ? 'Empty seats are filled by bot lords when the host begins.' : 'No bots: the realm has one holding per player (a lone lord faces one bot).'}
          </p>
        )}
        <div class="linkrow">
          <input readOnly value={link} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <label class="field">
          <span class="dim">Your name</span>
          <input
            type="text"
            value={name}
            maxLength={16}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
        <div class="field">
          <span class="dim">Your colours</span>
          <div class="swatches">
            {HOUSES.map((h) => (
              <button
                key={h.colour}
                class={`swatch-btn lh-swatch ${me?.colour === h.colour ? 'on' : ''}`}
                style={{ background: h.colour }}
                disabled={taken.has(h.colour)}
                title={taken.has(h.colour) ? 'Taken' : h.name}
                onClick={() => net.setProfile({ colour: h.colour })}
              />
            ))}
          </div>
        </div>
        <div class="seats">
          {Array.from({ length: MAX_SEATS }, (_, i) => {
            const m = net.members.find((x) => x.seat === i);
            return (
              <div key={i} class={`seat ${m ? '' : 'empty'} ${m?.seat === net.seat ? 'me' : ''}`}>
                <i class="swatch" style={{ background: m?.colour ?? 'rgba(255,255,255,0.12)' }} />
                <span>{m ? m.name : net.settings.fillBots ? 'Bot lord' : 'Open seat'}</span>
                {m?.host && <span class="chip">host</span>}
                {m && !m.connected && <span class="chip">away</span>}
                {net.host && m && m.seat !== net.seat && (
                  <button class="kick" title={`Send ${m.name} away`} onClick={() => net.kick(m.seat)}>
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <label class={`toggle ${net.host ? '' : 'readonly'}`} title={net.host ? '' : 'The host decides'}>
          <input type="checkbox" checked={net.settings.fillBots} disabled={!net.host} onChange={(e) => net.setSettings({ fillBots: (e.target as HTMLInputElement).checked })} />
          <span>Fill empty seats with bot lords</span>
        </label>
        <div class="actions">
          {net.host ? (
            <button class="primary lh-primary" disabled={!net.connected} onClick={() => net.start()}>
              Begin the war{!net.settings.fillBots && ` · ${Math.max(2, net.members.length)} holdings`}
            </button>
          ) : (
            <span class="dim">Waiting for the host to begin…</span>
          )}
          <button onClick={() => (location.search = '')}>Leave</button>
        </div>
      </div>
    </div>
  );
}
