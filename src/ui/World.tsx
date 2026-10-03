import type { Controller } from '../app/controller';
import {
  battleTime,
  LANE_H,
  LANE_W,
  RAISE_KINDS,
  sellValue,
  TOWER_KINDS,
  TOWERS,
  towerLevel,
  upgradeCost,
} from '../sim';
import type { GameState, Tower, TowerKind } from '../sim';
import { GLYPH, HOTKEY, statLine } from './format';

/**
 * UI that lives in the world: a banner over each house's citadel gate, and an action
 * popover anchored to whatever the player has selected.
 */
export function WorldLayer({ ctl, s }: { ctl: Controller; s: GameState }) {
  return (
    <>
      {s.players.map((p) => (
        <div key={p.id} class="anchor" data-lane={p.id} data-wx={LANE_W / 2} data-wy={LANE_H + 1.5} data-wh={9.5} data-fade={p.id === ctl.me ? undefined : '1'}>
          <div class={`banner ${p.id === ctl.me ? 'me' : ''} ${p.alive ? '' : 'fallen'}`} onClick={() => ctl.focusLane(p.id)}>
            <i class="swatch" style={{ background: p.colour }} />
            <b>{p.id === ctl.me ? 'You' : p.name}</b>
            {p.alive ? (
              <span class="num">
                ♥ {p.lives} · +{p.income}
              </span>
            ) : (
              <span class="dim">fallen</span>
            )}
            {s.lanes[p.id].blocked && p.alive && <span class="blocked">⛌ blocked</span>}
          </div>
        </div>
      ))}
      <Popover ctl={ctl} s={s} />
    </>
  );
}

function Anchor({ lane, x, y, h, children }: { lane: number; x: number; y: number; h: number; children: preact.ComponentChildren }) {
  return (
    <div class="anchor pop" data-lane={lane} data-wx={x + 0.5} data-wy={y + 0.5} data-wh={h} data-clamp="1">
      {children}
    </div>
  );
}

function Header({ title, sub, onClose }: { title: string; sub: string; onClose: () => void }) {
  return (
    <div class="phead">
      <div class="ptitle">
        <b>{title}</b>
        <span class="dim">{sub}</span>
      </div>
      <button class="icon close" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

function BuildOption({ ctl, s, kind, onPick, costOverride }: { ctl: Controller; s: GameState; kind: TowerKind; onPick: () => void; costOverride?: number }) {
  const lv = TOWERS[kind].levels[0];
  const cost = costOverride ?? lv.cost;
  const gold = s.players[ctl.me].gold;
  return (
    <button class="option" disabled={gold < cost} onClick={onPick} title={TOWERS[kind].role}>
      <span class="glyph">{GLYPH[kind]}</span>
      <span class="otext">
        <span class="otitle">
          <span>
            {lv.name} <kbd>{HOTKEY[kind]}</kbd>
          </span>
          <span class="gold num">{cost}g</span>
        </span>
        <span class="ostats">{statLine(lv)}</span>
      </span>
    </button>
  );
}

function Popover({ ctl, s }: { ctl: Controller; s: GameState }) {
  const sel = ctl.selection;
  if (!sel) return null;
  const close = () => ctl.select(null);
  if (sel.kind === 'tile') {
    const chk = ctl.hover && ctl.hover.x === sel.x && ctl.hover.y === sel.y ? ctl.hover.check : null;
    return (
      <Anchor lane={sel.lane} x={sel.x} y={sel.y} h={0.4}>
        <div class="popover panel">
          <Header title="Build" sub={`Road length ${s.lanes[ctl.me].pathLength.toFixed(0)} tiles`} onClose={close} />
          {chk?.blocks && <div class="warn">⚠ This closes the road. Foes will batter through your towers.</div>}
          <div class="options">
            {TOWER_KINDS.map((k) => (
              <BuildOption
                key={k}
                ctl={ctl}
                s={s}
                kind={k}
                onPick={() => {
                  if (ctl.build(sel.x, sel.y, k)) ctl.select(null);
                }}
              />
            ))}
          </div>
        </div>
      </Anchor>
    );
  }
  const t = s.towers.find((x) => x.id === sel.id);
  if (!t) return null;
  return <TowerPopover ctl={ctl} s={s} t={t} onClose={close} />;
}

function TowerPopover({ ctl, s, t, onClose }: { ctl: Controller; s: GameState; t: Tower; onClose: () => void }) {
  const lv = towerLevel(t);
  const mine = t.lane === ctl.me;
  const owner = s.players[t.lane];
  const gold = s.players[ctl.me].gold;
  const next = t.kind !== 'palisade' ? TOWERS[t.kind].levels[t.level + 1] : null;
  const cost = upgradeCost(t);
  return (
    <Anchor lane={t.lane} x={t.x} y={t.y} h={1.6}>
      <div class="popover panel">
        <Header title={lv.name} sub={mine ? TOWERS[t.kind].role : `House ${owner.name}`} onClose={onClose} />
        <div class="hpline">
          <i style={{ width: `${(100 * t.hp) / t.maxHp}%`, background: t.hp / t.maxHp < 0.4 ? 'var(--bad)' : undefined }} />
        </div>
        <div class="pstats">
          {statLine(lv)}
          {t.haste > 0 && <span class="good"> · +{Math.round(t.haste * 100)}% from banner</span>}
        </div>
        <div class="pstats dim">
          {Math.ceil(t.hp)}/{t.maxHp} hp · {t.kills} kills · {Math.round(t.damage).toLocaleString()} damage
        </div>
        {mine && t.kind === 'palisade' && (
          <div class="options">
            {RAISE_KINDS.map((k) => (
              <BuildOption key={k} ctl={ctl} s={s} kind={k} costOverride={upgradeCost(t, k)!} onPick={() => ctl.upgrade(t.id, k)} />
            ))}
          </div>
        )}
        {mine && (
          <div class="split">
            {next && cost !== null && (
              <button class="primary" disabled={gold < cost} onClick={() => ctl.upgrade(t.id)} title={statLine(next)}>
                Upgrade · {cost}g <kbd>U</kbd>
              </button>
            )}
            <button onClick={() => ctl.sell(t.id)}>
              Sell · {sellValue(t)}g <kbd>X</kbd>
            </button>
          </div>
        )}
        {mine && next && <div class="pstats dim">Next: {statLine(next)}</div>}
        {!mine && battleTime(s) < 0 && <div class="pstats dim">Scout your rivals while the gates are shut.</div>}
      </div>
    </Anchor>
  );
}
