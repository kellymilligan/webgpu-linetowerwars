import { useEffect, useState } from 'preact/hooks';
import type { Controller } from '../app/controller';
import { MAX_SEATS } from '../net/protocol';
import { HOUSES } from '../sim';

/** The war council: pick a name and colour, share the link, host starts. */
export function Lobby({ ctl }: { ctl: Controller }) {
  const net = ctl.net!;
  const [name, setName] = useState(net.profile.name);
  const [copied, setCopied] = useState(false);
  useEffect(() => setName(net.profile.name), [net.profile.name]);
  const me = net.members.find((m) => m.seat === net.seat);
  const taken = new Set(net.members.filter((m) => m !== me).map((m) => m.colour));
  const link = location.href;
  const commitName = () => {
    if (name.trim() && name !== net.profile.name) net.setProfile(name, me?.colour ?? net.profile.colour);
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
      <div class="sheet panel lobby">
        <h2>War council</h2>
        {net.error ? (
          <p class="bad">{net.error}</p>
        ) : !net.connected ? (
          <p class="dim">Riding to the council…</p>
        ) : (
          <p class="dim">Share this link. Empty seats are filled by bot lords when the host begins.</p>
        )}
        <div class="linkrow">
          <input readOnly value={link} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <label class="field">
          <span class="dim">Your name</span>
          <input
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
                class={`swatch-btn ${me?.colour === h.colour ? 'on' : ''}`}
                style={{ background: h.colour }}
                disabled={taken.has(h.colour)}
                title={taken.has(h.colour) ? 'Taken' : h.name}
                onClick={() => net.setProfile(name, h.colour)}
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
                <span>{m ? m.name : 'Bot lord'}</span>
                {m?.host && <span class="chip">host</span>}
                {m && !m.connected && <span class="chip">away</span>}
              </div>
            );
          })}
        </div>
        <div class="actions">
          {net.host ? (
            <button class="primary" disabled={!net.connected} onClick={() => net.start()}>
              Begin the war
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
