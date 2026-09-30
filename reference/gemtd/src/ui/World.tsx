import type { Controller, Highlight } from '../app/controller';
import {
  FAMILY_DEFS,
  gemName,
  gemTowerDef,
  GRADE_NAMES,
  SPECIALS_BY_ID,
  STONE_REMOVE_COST,
  towerDef,
  towerName,
} from '../sim';
import type { BoardOption, GameState, GemSpec, KeepOption, PendingGem, Targeting, Tower, TowerDef } from '../sim';
import { GemDot } from './GemDot';
import { attackTags, statLine } from './format';

/**
 * UI that lives in the world: tags over this round's gems, badges advertising
 * combines, and an action popover anchored to whatever is selected.
 */
export function WorldLayer({ ctl, s }: { ctl: Controller; s: GameState }) {
  const between = s.phase === 'build' || s.phase === 'choose';
  const sel = ctl.selection;
  return (
    <>
      {s.pending.map((p) =>
        sel?.kind === 'pending' && sel.id === p.id ? null : <PendingTag key={p.id} ctl={ctl} s={s} p={p} />,
      )}
      {between &&
        s.towers.map((t) => (sel?.kind === 'tower' && sel.id === t.id ? null : <TowerBadge key={t.id} ctl={ctl} t={t} />))}
      <Popover ctl={ctl} s={s} />
    </>
  );
}

function Anchor({ x, y, h, clamp, children, cls = '' }: { x: number; y: number; h: number; clamp?: boolean; children: preact.ComponentChildren; cls?: string }) {
  return (
    <div class={`anchor ${cls}`} data-wx={x + 0.5} data-wy={y + 0.5} data-wh={h} data-clamp={clamp ? '1' : undefined}>
      {children}
    </div>
  );
}

function PendingTag({ ctl, s, p }: { ctl: Controller; s: GameState; p: PendingGem }) {
  const opts = s.phase === 'choose' ? ctl.keepOptions(p.id) : [];
  const combine = opts.some((o) => o.kind === 'combine');
  const forge = opts.some((o) => o.kind === 'recipe' || o.kind === 'upgrade');
  return (
    <Anchor x={p.x} y={p.y} h={1.35}>
      <button class={`tag ${s.phase === 'choose' ? 'live' : ''}`} onClick={() => ctl.clickTile(p.x, p.y)}>
        <GemDot spec={p} />
        <span>{GRADE_NAMES[p.grade]}</span>
        {combine && <i class="badge up" title="Can combine">▲</i>}
        {forge && <i class="badge forge" title="Can forge a special">✦</i>}
      </button>
    </Anchor>
  );
}

function TowerBadge({ ctl, t }: { ctl: Controller; t: Tower }) {
  const opts = ctl.boardOptions(t.id);
  if (opts.length === 0) return null;
  const forge = opts.some((o) => o.kind !== 'boardCombine');
  return (
    <Anchor x={t.x} y={t.y} h={1.5}>
      <button class={`badge-btn ${forge ? 'forge' : 'up'}`} onClick={() => ctl.clickTile(t.x, t.y)} title="Combine available">
        {forge ? '✦' : '▲'}
      </button>
    </Anchor>
  );
}

interface OptionView {
  key: string;
  title: string;
  def: TowerDef;
  spec: GemSpec;
  special?: string;
  highlight: Highlight;
  run: () => void;
  kind: 'keep' | 'up' | 'forge';
}

const tile = (t: { x: number; y: number }) => ({ x: t.x, y: t.y });

function keepViews(ctl: Controller, s: GameState, p: PendingGem): OptionView[] {
  return ctl.keepOptions(p.id).map((o: KeepOption, i) => {
    const run = () => ctl.keep(o);
    switch (o.kind) {
      case 'keep':
        return { key: `k${i}`, title: `Keep ${gemName(o.result.family, o.result.grade)}`, def: gemTowerDef(o.result.family, o.result.grade), spec: o.result, highlight: { target: tile(p), consumed: [] }, run, kind: 'keep' };
      case 'combine':
        return { key: `c${i}`, title: `Combine → ${gemName(o.result.family, o.result.grade)}`, def: gemTowerDef(o.result.family, o.result.grade), spec: o.result, highlight: { target: tile(p), consumed: [] }, run, kind: 'up' };
      case 'recipe': {
        const sp = SPECIALS_BY_ID[o.recipeId];
        const consumed = o.consumed.filter((id) => id !== p.id).map((id) => tile(s.pending.find((q) => q.id === id)!));
        return { key: `r${i}`, title: `Forge ${sp.levels[0].name}`, def: sp.levels[0], spec: { family: sp.family, grade: 4 }, special: sp.id, highlight: { target: tile(p), consumed }, run, kind: 'forge' };
      }
      case 'upgrade': {
        const sp = SPECIALS_BY_ID[o.specialId];
        const t = s.towers.find((x) => x.id === o.towerId)!;
        return { key: `u${i}`, title: `Feed into ${towerName(t)} → ${sp.levels[o.toLevel].name}`, def: sp.levels[o.toLevel], spec: t, special: sp.id, highlight: { target: tile(t), consumed: [tile(p)] }, run, kind: 'forge' };
      }
    }
  });
}

function boardViews(ctl: Controller, s: GameState, t: Tower): OptionView[] {
  return ctl.boardOptions(t.id).map((o: BoardOption, i) => {
    const run = () => ctl.board(o);
    const target = s.towers.find((x) => x.id === o.towerId)!;
    const consumed = o.consumed.map((id) => tile(s.towers.find((x) => x.id === id)!));
    const highlight = { target: tile(target), consumed };
    switch (o.kind) {
      case 'boardCombine':
        return { key: `bc${i}`, title: `Combine ${o.consumed.length + 1} → ${gemName(o.result.family, o.result.grade)}`, def: gemTowerDef(o.result.family, o.result.grade), spec: o.result, highlight, run, kind: 'up' };
      case 'boardRecipe': {
        const sp = SPECIALS_BY_ID[o.recipeId];
        return { key: `br${i}`, title: `Forge ${sp.levels[0].name}`, def: sp.levels[0], spec: { family: sp.family, grade: 4 }, special: sp.id, highlight, run, kind: 'forge' };
      }
      case 'boardUpgrade': {
        const sp = SPECIALS_BY_ID[o.specialId];
        const title = target.id === t.id ? `Upgrade → ${sp.levels[o.toLevel].name}` : `Feed into ${towerName(target)} → ${sp.levels[o.toLevel].name}`;
        return { key: `bu${i}`, title, def: sp.levels[o.toLevel], spec: target, special: sp.id, highlight, run, kind: 'forge' };
      }
    }
  });
}

function OptionButton({ ctl, v }: { ctl: Controller; v: OptionView }) {
  const tags = attackTags(v.def);
  return (
    <button class={`option ${v.kind}`} onClick={v.run} onMouseEnter={() => ctl.setHighlight(v.highlight)} onMouseLeave={() => ctl.setHighlight(null)}>
      <GemDot spec={v.spec} special={v.special} />
      <span class="otext">
        <span class="otitle">{v.title}</span>
        <span class="ostats">
          {statLine(v.def)}
          {tags.length > 0 && <> · {tags.join(' · ')}</>}
        </span>
      </span>
    </button>
  );
}

function Popover({ ctl, s }: { ctl: Controller; s: GameState }) {
  const sel = ctl.selection;
  if (!sel) return null;
  const close = () => {
    ctl.selection = null;
    ctl.setHighlight(null);
  };
  if (sel.kind === 'pending') {
    const p = s.pending.find((q) => q.id === sel.id);
    if (!p) return null;
    const def = gemTowerDef(p.family, p.grade);
    const views = s.phase === 'choose' ? keepViews(ctl, s, p) : [];
    return (
      <Anchor x={p.x} y={p.y} h={1.2} clamp cls="pop">
        <div class="popover panel">
          <Header spec={p} title={gemName(p.family, p.grade)} sub={FAMILY_DEFS[p.family].role} onClose={close} />
          <div class="pstats">
            {statLine(def)}
            {attackTags(def).length > 0 && <> · {attackTags(def).join(' · ')}</>}
          </div>
          {views.length > 0 ? (
            <div class="options">
              {views.map((v) => (
                <OptionButton key={v.key} ctl={ctl} v={v} />
              ))}
            </div>
          ) : (
            <p class="dim small">Place all five gems, then choose which to keep.</p>
          )}
        </div>
      </Anchor>
    );
  }
  if (sel.kind === 'stone') {
    return (
      <Anchor x={sel.x} y={sel.y} h={0.9} clamp cls="pop">
        <div class="popover panel narrow">
          <Header title="Mossy stone" sub="Left by an unkept gem. Part of your maze." onClose={close} />
          <button class="primary" disabled={s.gold < STONE_REMOVE_COST || s.phase !== 'build'} onClick={() => ctl.dispatch({ type: 'removeStone', x: sel.x, y: sel.y })}>
            Clear stone · {STONE_REMOVE_COST}◆
          </button>
        </div>
      </Anchor>
    );
  }
  const t = s.towers.find((x) => x.id === sel.id);
  if (!t) return null;
  const def = towerDef(t);
  const sp = t.specialId ? SPECIALS_BY_ID[t.specialId] : null;
  const nextUp = sp && t.level + 1 < sp.levels.length ? sp.upgrades[t.level] : null;
  const views = boardViews(ctl, s, t);
  return (
    <Anchor x={t.x} y={t.y} h={1.5} clamp cls="pop">
      <div class="popover panel">
        <Header spec={t} special={t.specialId} title={towerName(t)} sub={sp ? def.description : FAMILY_DEFS[t.family].role} onClose={close} />
        <div class="pstats">
          {statLine(def)}
          {attackTags(def).length > 0 && <> · {attackTags(def).join(' · ')}</>}
          {t.auraBonus > 0 && <span class="good"> · +{Math.round(t.auraBonus * 100)}% speed from aura</span>}
        </div>
        <div class="pstats dim">
          {t.kills} kills · {Math.round(t.damage).toLocaleString()} damage
        </div>
        {views.length > 0 && (
          <div class="options">
            {views.map((v) => (
              <OptionButton key={v.key} ctl={ctl} v={v} />
            ))}
          </div>
        )}
        {views.length === 0 && s.phase === 'wave' && ctl.boardOptions(t.id).length === 0 && <p class="dim small">Combines are available between waves.</p>}
        {nextUp && <p class="dim small">Upgrades with a {gemName(nextUp.family, nextUp.grade)} → {sp!.levels[t.level + 1].name}</p>}
        <div class="targeting">
          {(['first', 'last', 'strongest', 'weakest', 'closest'] as Targeting[]).map((x) => (
            <button key={x} class={t.targeting === x ? 'on' : ''} onClick={() => ctl.setTargeting(t.id, x)}>
              {x}
            </button>
          ))}
        </div>
      </div>
    </Anchor>
  );
}

function Header({ spec, special, title, sub, onClose }: { spec?: GemSpec; special?: string; title: string; sub: string; onClose: () => void }) {
  return (
    <div class="phead">
      {spec && <GemDot spec={spec} special={special} />}
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
