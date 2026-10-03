import { Color } from 'three/webgpu';
import { MUSTER_TIME } from '../sim/data/rules';

/**
 * Lighting moods. A war is one long fall into darkness: it opens in a low,
 * golden late-afternoon sun, greys over, sinks into a bruised dusk, and the
 * late game and sudden death are fought at night. Firelight (gates, braziers,
 * torches) matters more as the light fails. Each preset is a full grade: sun,
 * sky, fog, bloom and colour grading.
 */
export interface LightPreset {
  sun: string;
  sunIntensity: number;
  /** Elevation and azimuth in radians. */
  sunElevation: number;
  sunAzimuth: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  zenith: string;
  horizon: string;
  fog: string;
  exposure: number;
  /** Multiplier on firelight: torches, braziers, the gates. */
  glow: number;
  bloom: number;
  saturation: number;
  /** Cold/warm tint applied in grading (multiplied into the image). */
  tint: string;
}

export type Mood = 'golden' | 'overcast' | 'dusk' | 'night';

export const PRESETS: Record<Mood, LightPreset> = {
  golden: {
    sun: '#ffdcae', sunIntensity: 3.0, sunElevation: 0.68, sunAzimuth: 0.9,
    hemiSky: '#a7b1c0', hemiGround: '#2a2826', hemiIntensity: 1.35,
    zenith: '#4c5c76', horizon: '#cfb08e', fog: '#8e8c88',
    exposure: 1.0, glow: 0.65, bloom: 0.3, saturation: 0.72, tint: '#f6f1ea',
  },
  overcast: {
    sun: '#c3c9d2', sunIntensity: 2.6, sunElevation: 0.45, sunAzimuth: 1.05,
    hemiSky: '#8a94a2', hemiGround: '#1d1e22', hemiIntensity: 1.2,
    zenith: '#353c47', horizon: '#6a717b', fog: '#555c66',
    exposure: 0.95, glow: 1.0, bloom: 0.35, saturation: 0.55, tint: '#dfe5ec',
  },
  dusk: {
    sun: '#a093a0', sunIntensity: 1.9, sunElevation: 0.4, sunAzimuth: 0.9,
    hemiSky: '#66718e', hemiGround: '#1a1b21', hemiIntensity: 1.3,
    zenith: '#1b212c', horizon: '#45414c', fog: '#30333c',
    exposure: 1.0, glow: 1.5, bloom: 0.5, saturation: 0.5, tint: '#d4d9e4',
  },
  night: {
    sun: '#8698c2', sunIntensity: 1.5, sunElevation: 0.9, sunAzimuth: -0.4,
    hemiSky: '#4a5a86', hemiGround: '#10121a', hemiIntensity: 1.35,
    zenith: '#05070c', horizon: '#141925', fog: '#10141c',
    exposure: 1.15, glow: 2.1, bloom: 0.7, saturation: 0.45, tint: '#c3cbde',
  },
};

/** The mood for a point in the match (seconds since the muster began). */
export function moodAt(seconds: number): Mood {
  const battle = seconds - MUSTER_TIME;
  if (battle < 5 * 60) return 'golden';
  if (battle < 11 * 60) return 'overcast';
  if (battle < 18 * 60) return 'dusk';
  return 'night';
}

const COLOURS = ['sun', 'hemiSky', 'hemiGround', 'zenith', 'horizon', 'fog', 'tint'] as const;

/** A live, lerpable copy of a preset with Color objects. */
export class LightState {
  sun = new Color();
  hemiSky = new Color();
  hemiGround = new Color();
  zenith = new Color();
  horizon = new Color();
  fog = new Color();
  tint = new Color();
  sunIntensity = 0;
  sunElevation = 0;
  sunAzimuth = 0;
  hemiIntensity = 0;
  exposure = 1;
  glow = 0;
  bloom = 0;
  saturation = 1;

  constructor(p: LightPreset) {
    this.set(p);
  }

  set(p: LightPreset) {
    for (const k of COLOURS) this[k].set(p[k]);
    this.sunIntensity = p.sunIntensity;
    this.sunElevation = p.sunElevation;
    this.sunAzimuth = p.sunAzimuth;
    this.hemiIntensity = p.hemiIntensity;
    this.exposure = p.exposure;
    this.glow = p.glow;
    this.bloom = p.bloom;
    this.saturation = p.saturation;
  }

  /** Moves toward a preset by factor t (0..1). */
  approach(p: LightPreset, t: number) {
    const c = new Color();
    for (const k of COLOURS) this[k].lerp(c.set(p[k]), t);
    this.sunIntensity += (p.sunIntensity - this.sunIntensity) * t;
    this.sunElevation += (p.sunElevation - this.sunElevation) * t;
    this.sunAzimuth += shortestAngle(this.sunAzimuth, p.sunAzimuth) * t;
    this.hemiIntensity += (p.hemiIntensity - this.hemiIntensity) * t;
    this.exposure += (p.exposure - this.exposure) * t;
    this.glow += (p.glow - this.glow) * t;
    this.bloom += (p.bloom - this.bloom) * t;
    this.saturation += (p.saturation - this.saturation) * t;
  }
}

function shortestAngle(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
