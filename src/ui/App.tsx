import { useEffect, useState } from 'preact/hooks';
import type { Controller, Speed } from '../app/controller';
import { ordinal } from '../app/controller';
import {
  battleTime,
  checkSend,
  INCOME_PERIOD,
  MUSTER_TIME,
  nextAlive,
  SENDS,
  START_LIVES,
  SUDDEN_DEATH,
  TICK_RATE,
  TOWER_KINDS,
  TOWERS,
} from '../sim';
import type { GameState } from '../sim';
import { GLYPH, HOTKEY, mmss, SHORT } from './format';
import { WorldLayer } from './World';
import { Lobby } from './Lobby';
import { newRoomCode } from 'lobbyhop/client';

export function App({ ctl, backend }: { ctl: Controller; backend: string }) {
  const [, setV] = useState(0);
  useEffect(() => ctl.subscribe(() => setV(ctl.version)), [ctl]);
  const s = ctl.state;
  if (ctl.net && (!ctl.net.state || ctl.net.phase === 'lobby')) {
    // The council: just the realm in the background and the lobby.
    return (
      <>
        <Lobby ctl={ctl} />
        <div class="backend">{backend}</div>
      </>
    );
  }
  return (
    <>
      <WorldLayer ctl={ctl} s={s} />
      <Controls ctl={ctl} />
      <Hud ctl={ctl} s={s} />
      <Roster ctl={ctl} s={s} />
      <Feed ctl={ctl} />
      <BuildBar ctl={ctl} s={s} />
      <SendDock ctl={ctl} s={s} />
      {ctl.toast && <Toast key={ctl.toast.id} text={ctl.toast.text} />}
      {ctl.confirmNew && <ConfirmNew ctl={ctl} />}
      {s.phase === 'over' && <GameOver ctl={ctl} s={s} />}
      {ctl.net?.state && ctl.net.paused && <div class="toast">Paused by the host</div>}
      <div class="backend">
        {backend} · seed {s.seed}
      </div>
    </>
  );
}

function Controls({ ctl }: { ctl: Controller }) {
  const net = ctl.net;
  if (net) {
    return (
      <div class="controls panel">
        <span class="title">Siegeline</span>
        <span class="dim small">
          Room <b>{new URLSearchParams(location.search).get('room')}</b>
          {!net.connected && <span class="bad"> · reconnecting…</span>}
        </span>
        {net.host && net.state && (
          <button class={`icon ${net.paused ? 'on' : ''}`} onClick={() => ctl.togglePause()} title="Pause for everyone (P)">
            ❚❚
          </button>
        )}
        <button class="icon" onClick={() => ctl.focusLane(ctl.me)} title="Home (Space)">
          ⌂
        </button>
        <button class="icon" onClick={() => (location.search = '')}>
          Leave
        </button>
      </div>
    );
  }
  return (
    <div class="controls panel">
      <span class="title">Siegeline</span>
      {([1, 2, 4, 10] as Speed[]).map((sp) => (
        <button key={sp} class={`icon ${ctl.speed === sp && !ctl.paused ? 'on' : ''}`} onClick={() => ctl.setSpeed(sp)}>
          {sp}×
        </button>
      ))}
      <button class={`icon ${ctl.paused ? 'on' : ''}`} onClick={() => ctl.togglePause()} title="Pause (P)">
        ❚❚
      </button>
      <button class="icon" onClick={() => ctl.focusLane(ctl.me)} title="Home (Space)">
        ⌂
      </button>
      <button
        class="icon"
        onClick={() => {
          ctl.confirmNew = true;
          ctl.notify(true);
        }}
      >
        New
      </button>
      <button class="icon" onClick={() => (location.search = `?room=${newRoomCode()}`)} title="Open a war council and invite friends">
        Multiplayer
      </button>
    </div>
  );
}

function Hud({ ctl, s }: { ctl: Controller; s: GameState }) {
  const me = s.players[ctl.me];
  const bt = battleTime(s);
  const periodTicks = INCOME_PERIOD * TICK_RATE;
  const untilIncome = Math.max(0, s.nextIncome - s.tick);
  const frac = s.phase === 'muster' ? 0 : 1 - untilIncome / periodTicks;
  const sudden = bt >= SUDDEN_DEATH;
  return (
    <div class="hud panel">
      <div class="clock">
        {bt < 0 ? mmss(-bt) : mmss(bt)}
        <small class={sudden ? 'bad' : ''}>{bt < 0 ? 'gates open in' : sudden ? 'sudden death' : `raid ${s.raidNumber + 1} in ${mmss((s.nextRaid - s.tick) / TICK_RATE)}`}</small>
      </div>
      <div class="sep" />
      <div class="stat">
        <b class="gold">{me.gold}</b>
        <span>gold</span>
      </div>
      <div class="stat" title={`Paid every ${INCOME_PERIOD}s. Sends raise it permanently.`}>
        <b class="good">+{me.income}</b>
        <span>income</span>
        <div class="income-bar">
          <i style={{ width: `${frac * 100}%` }} />
        </div>
      </div>
      <div class="stat">
        <b class={me.lives <= 8 ? 'bad' : ''}>{me.lives}</b>
        <span>lives</span>
      </div>
      <div class="sep" />
      <div class="stat" title="Tiles creeps walk from gate to keep. Longer is better.">
        <b>{s.lanes[ctl.me].blocked ? '⛌' : s.lanes[ctl.me].pathLength.toFixed(0)}</b>
        <span>road</span>
      </div>
    </div>
  );
}

function Roster({ ctl, s }: { ctl: Controller; s: GameState }) {
  const target = nextAlive(s, ctl.me);
  // Whoever has you as their next living neighbour sends at you.
  const from = s.players.find((p) => p.alive && p.id !== ctl.me && nextAlive(s, p.id) === ctl.me)?.id ?? null;
  return (
    <div class="roster panel">
      <h3>The Realm</h3>
      {s.players.map((p) => (
        <div key={p.id} class={`lord ${p.id === ctl.me ? 'me' : ''} ${p.alive ? '' : 'fallen'}`} onClick={() => ctl.focusLane(p.id)} title="Show this holding">
          <i class="swatch" style={{ background: p.colour }} />
          <div>
            <div class="lname">
              {p.id === ctl.me ? 'You' : p.name}
              {ctl.net && p.bot && <span class="chip">bot</span>}
              {ctl.net && !p.bot && ctl.net.members.find((m) => m.seat === p.id)?.connected === false && <span class="chip">away</span>}
              {p.alive && p.id === target && <span class="arrow out">your target</span>}
              {p.alive && p.id === from && <span class="arrow in">sends at you</span>}
            </div>
            <div class="lbar">
              <i class={p.lives <= 8 ? 'low' : ''} style={{ width: `${(100 * Math.max(0, p.lives)) / START_LIVES}%` }} />
            </div>
          </div>
          <div>
            {p.alive ? (
              <>
                <div class="lives">♥ {p.lives}</div>
                <div class="lmeta num">+{p.income}</div>
              </>
            ) : (
              <div class="lmeta">{ordinal(p.place ?? 0)}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Feed({ ctl }: { ctl: Controller }) {
  const now = performance.now();
  const items = ctl.feed.filter((f) => now - f.at < 9000);
  return (
    <div class="feed">
      {items.map((f) => (
        <div key={f.id} class={f.tone}>
          {f.text}
        </div>
      ))}
    </div>
  );
}

function BuildBar({ ctl, s }: { ctl: Controller; s: GameState }) {
  const gold = s.players[ctl.me].gold;
  return (
    <div class="buildbar panel">
      <div class="row">
        {TOWER_KINDS.map((k) => (
          <button key={k} class={`tbtn ${ctl.armed === k ? 'on' : ''}`} disabled={!s.players[ctl.me].alive} onClick={() => ctl.arm(k)} title={`${TOWERS[k].levels[0].name}: ${TOWERS[k].role}`}>
            <kbd>{HOTKEY[k]}</kbd>
            <span class="glyph">{GLYPH[k]}</span>
            <span>{SHORT[k]}</span>
            <span class={gold >= TOWERS[k].levels[0].cost ? 'gold num' : 'bad num'}>{TOWERS[k].levels[0].cost}g</span>
          </button>
        ))}
      </div>
      <div class="hint">
        {ctl.armed ? (
          <>
            Click your road to build {TOWERS[ctl.armed].levels[0].name}s. <kbd>Esc</kbd> or right-click to stop.
          </>
        ) : (
          <>Pick a tower, or click an empty tile in your lane. Wall off the road with palisades, then raise them into towers.</>
        )}
      </div>
    </div>
  );
}

function SendDock({ ctl, s }: { ctl: Controller; s: GameState }) {
  const me = s.players[ctl.me];
  const target = nextAlive(s, ctl.me);
  return (
    <div class="dock panel">
      <div class="dock-head">
        <span class="serif">Send troops</span>
        <span class="dim">
          {target !== null ? (
            <>
              at <b style={{ color: s.players[target].colour }}>House {s.players[target].name}</b>. Survivors march on into the next holding.
            </>
          ) : (
            'No one left to attack'
          )}
        </span>
      </div>
      <div class="cards">
        {SENDS.map((sd, i) => {
          const chk = checkSend(s, ctl.me, sd.id);
          const locked = chk.unlocksIn > 0 || s.phase === 'muster';
          const lockText = s.phase === 'muster' ? `gates in ${mmss(MUSTER_TIME - s.tick / TICK_RATE)}` : `in ${mmss(chk.unlocksIn)}`;
          return (
            <button key={sd.id} class="card" disabled={!chk.ok} onClick={() => ctl.send(sd.id)} title={`${sd.blurb} ${sd.units.map((u) => `${u.count}× ${u.kind}`).join(', ')}`}>
              <kbd>{i + 1}</kbd>
              <span class="cname">{sd.name}</span>
              <span>
                <span class="cost">{sd.cost}g</span> <span class="inc">+{sd.income}</span>
              </span>
              <span class="stock">
                {Array.from({ length: sd.stock }, (_, k) => (
                  <i key={k} class={k < me.stock[sd.id] ? '' : 'empty'} />
                ))}
              </span>
              {locked && <span class="lock">{lockText}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Toast({ text }: { text: string }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShow(false), 1800);
    return () => clearTimeout(t);
  }, []);
  return show ? <div class="toast">{text}</div> : null;
}

function ConfirmNew({ ctl }: { ctl: Controller }) {
  return (
    <div class="modal" onClick={() => ctl.cancel()}>
      <div class="sheet panel" onClick={(e) => e.stopPropagation()}>
        <h2>Start a new war?</h2>
        <p class="dim">This match will be abandoned.</p>
        <div class="actions">
          <button class="primary" onClick={() => ctl.newGame()}>
            New war
          </button>
          <button onClick={() => ctl.cancel()}>Keep fighting</button>
        </div>
      </div>
    </div>
  );
}

function GameOver({ ctl, s }: { ctl: Controller; s: GameState }) {
  const me = s.players[ctl.me];
  const won = s.winner === ctl.me;
  const ranked = [...s.players].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
  const mins = ((s.tick / TICK_RATE - MUSTER_TIME) / 60).toFixed(1);
  return (
    <div class="modal">
      <div class="sheet panel">
        <h2>{won ? 'Victory' : `You place ${ordinal(me.place ?? 0)}`}</h2>
        <div class="dim">
          {won ? 'Every rival keep has fallen.' : `House ${s.winner !== null ? s.players[s.winner].name : '—'} holds the realm.`} {mins} minutes.
        </div>
        <IncomeGraph s={s} me={ctl.me} />
        <table class="standings">
          <thead>
            <tr>
              <th>#</th>
              <th>House</th>
              <th>Income</th>
              <th>Sent</th>
              <th>Towers</th>
              <th>Kills</th>
              <th>Lives taken</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.id} class={p.id === ctl.me ? 'me' : ''}>
                <td>{p.place}</td>
                <td>
                  <i class="swatch" style={{ background: p.colour, display: 'inline-block', width: '8px', height: '12px', marginRight: '6px' }} />
                  {p.id === ctl.me ? 'You' : p.name}
                </td>
                <td>{p.income}</td>
                <td>{p.stats.goldSent}g</td>
                <td>{p.stats.goldTowers}g</td>
                <td>{p.stats.kills}</td>
                <td>{p.stats.livesTaken}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div class="actions">
          {ctl.net ? (
            <>
              {ctl.net.host ? (
                <button class="primary" onClick={() => ctl.net!.toLobby()}>
                  Back to the council
                </button>
              ) : (
                <span class="dim">Waiting for the host…</span>
              )}
              <button onClick={() => (location.search = '')}>Leave</button>
            </>
          ) : (
            <button class="primary" onClick={() => ctl.newGame()}>
              New war
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Income over time for every house; yours drawn on top. */
function IncomeGraph({ s, me }: { s: GameState; me: number }) {
  const max = Math.max(1, ...s.players.flatMap((p) => p.stats.incomeHistory));
  const len = Math.max(2, ...s.players.map((p) => p.stats.incomeHistory.length));
  const W = 500;
  const H = 110;
  const line = (h: number[]) => h.map((v, i) => `${((i / (len - 1)) * W).toFixed(1)},${(H - (v / max) * (H - 6)).toFixed(1)}`).join(' ');
  const order = [...s.players].sort((a) => (a.id === me ? 1 : -1));
  return (
    <svg class="graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {order.map((p) => (
        <polyline key={p.id} points={line(p.stats.incomeHistory)} fill="none" stroke={p.colour} stroke-width={p.id === me ? 2.5 : 1.2} opacity={p.id === me ? 1 : 0.55} vector-effect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
