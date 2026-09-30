import type { TowerLevel } from '../sim/data/towers';
import type { TowerKind } from '../sim/types';

export const GLYPH: Record<TowerKind, string> = {
  palisade: '⌇',
  archer: '➶',
  mangonel: '☄',
  cauldron: '♨',
  ballista: '➹',
  banner: '⚑',
};

export const HOTKEY: Record<TowerKind, string> = {
  palisade: 'Q',
  archer: 'W',
  mangonel: 'E',
  cauldron: 'R',
  ballista: 'T',
  banner: 'Y',
};

export const SHORT: Record<TowerKind, string> = {
  palisade: 'Wall',
  archer: 'Archer',
  mangonel: 'Mangonel',
  cauldron: 'Pitch',
  ballista: 'Ballista',
  banner: 'Banner',
};

export function statLine(lv: TowerLevel): string {
  const a = lv.attack;
  if (!a) {
    if (lv.aura > 0) return `+${Math.round(lv.aura * 100)}% attack speed to towers within ${lv.auraRange}`;
    return 'No attack. Shapes the road.';
  }
  const bits = [`${a.damage} dmg`, `${(1 / a.period).toFixed(1)}/s`, `range ${a.range}`];
  if (a.splash) bits.push(`splash ${a.splash}`);
  if (a.slow) bits.push(`slow ${Math.round(a.slow * 100)}%`);
  if (a.burn) bits.push(`burn ${a.burn}/s`);
  if (a.pierce) bits.push('pierces armour');
  bits.push(a.air ? 'ground + air' : 'ground only');
  return bits.join(' · ');
}

export const mmss = (secs: number) => {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
