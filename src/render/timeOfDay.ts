import { Color } from 'three/webgpu';

/**
 * Lighting moods. The match cycles through them (dawn → day → golden hour →
 * dusk → night) so the realm feels alive over a 25-minute war. Each preset
 * is a full grade: sun, sky, fog, ground tint, bloom and colour grading.
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
  /** Multiplier on torches, fire and other glowing things. */
  glow: number;
  bloom: number;
  saturation: number;
  /** Warm/cool tint applied in grading (multiplied into the image). */
  tint: string;
  grass: string;
}

export type Mood = 'dawn' | 'day' | 'golden' | 'dusk' | 'night';

// The North: cold, misty and muted, with a low warm sun that makes the
// heather and snow glow when it breaks through.
export const PRESETS: Record<Mood, LightPreset> = {
  dawn: {
    sun: '#ffc6a8', sunIntensity: 2.3, sunElevation: 0.24, sunAzimuth: -0.7,
    hemiSky: '#a7b2d4', hemiGround: '#38343a', hemiIntensity: 0.95,
    zenith: '#5f6f9c', horizon: '#e2b8ad', fog: '#a9a6b3',
    exposure: 1.0, glow: 0.8, bloom: 0.3, saturation: 0.95, tint: '#f1ecf4', grass: '#525e3e',
  },
  day: {
    sun: '#fff2df', sunIntensity: 3.1, sunElevation: 0.62, sunAzimuth: 0.6,
    hemiSky: '#c2cfde', hemiGround: '#3a3934', hemiIntensity: 0.9,
    zenith: '#7590b2', horizon: '#d3dbe2', fog: '#b3bcc6',
    exposure: 0.95, glow: 0.4, bloom: 0.18, saturation: 0.92, tint: '#eef2f8', grass: '#5d6a45',
  },
  golden: {
    sun: '#ffbf80', sunIntensity: 3.4, sunElevation: 0.3, sunAzimuth: 1.9,
    hemiSky: '#a9b6cf', hemiGround: '#3c3530', hemiIntensity: 0.8,
    zenith: '#61789f', horizon: '#efc394', fog: '#c2b3a3',
    exposure: 1.02, glow: 0.7, bloom: 0.3, saturation: 1.05, tint: '#fff3e6', grass: '#69683f',
  },
  dusk: {
    sun: '#ff8a5a', sunIntensity: 1.9, sunElevation: 0.16, sunAzimuth: 2.4,
    hemiSky: '#8790b8', hemiGround: '#2c2830', hemiIntensity: 0.8,
    zenith: '#3a4472', horizon: '#d08670', fog: '#776d80',
    exposure: 1.05, glow: 1.1, bloom: 0.42, saturation: 1.0, tint: '#f2e4ea', grass: '#474e38',
  },
  night: {
    sun: '#9fb4ff', sunIntensity: 0.8, sunElevation: 0.85, sunAzimuth: -2.2,
    hemiSky: '#3c4f94', hemiGround: '#12151f', hemiIntensity: 0.55,
    zenith: '#0d1336', horizon: '#26325f', fog: '#1a2246',
    exposure: 1.05, glow: 1.9, bloom: 0.7, saturation: 0.95, tint: '#c9d4ff', grass: '#34493c',
  },
};

/** The day cycle: [start fraction, mood]. One full day every DAY_SECONDS of war. */
const CYCLE: [number, Mood][] = [
  [0.0, 'dawn'],
  [0.08, 'day'],
  [0.42, 'golden'],
  [0.58, 'dusk'],
  [0.68, 'night'],
  [0.92, 'dawn'],
];
export const DAY_SECONDS = 8 * 60;

/** The mood for a point in the match (seconds since the muster began). */
export function moodAt(seconds: number): Mood {
  const f = (((seconds + DAY_SECONDS * 0.05) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS / DAY_SECONDS;
  let mood: Mood = 'dawn';
  for (const [start, m] of CYCLE) if (f >= start) mood = m;
  return mood;
}

/** A live, lerpable copy of a preset with Color objects. */
export class LightState {
  sun = new Color();
  hemiSky = new Color();
  hemiGround = new Color();
  zenith = new Color();
  horizon = new Color();
  fog = new Color();
  tint = new Color();
  grass = new Color();
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
    for (const k of ['sun', 'hemiSky', 'hemiGround', 'zenith', 'horizon', 'fog', 'tint', 'grass'] as const) this[k].set(p[k]);
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
    for (const k of ['sun', 'hemiSky', 'hemiGround', 'zenith', 'horizon', 'fog', 'tint', 'grass'] as const) this[k].lerp(c.set(p[k]), t);
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
