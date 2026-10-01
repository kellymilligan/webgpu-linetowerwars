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

export const PRESETS: Record<Mood, LightPreset> = {
  dawn: {
    sun: '#ffc9a0', sunIntensity: 2.4, sunElevation: 0.32, sunAzimuth: -0.7,
    hemiSky: '#c9c4ff', hemiGround: '#4a4034', hemiIntensity: 1.0,
    zenith: '#7f93d6', horizon: '#f2c3b0', fog: '#cfb8b4',
    exposure: 1.0, glow: 0.7, bloom: 0.32, saturation: 1.15, tint: '#fff1ea', grass: '#5d7a3a',
  },
  day: {
    sun: '#fff0d6', sunIntensity: 3.4, sunElevation: 0.95, sunAzimuth: 0.6,
    hemiSky: '#bfe0ff', hemiGround: '#4e4a30', hemiIntensity: 0.9,
    zenith: '#5f9be0', horizon: '#cfe4f2', fog: '#b9d3e4',
    exposure: 0.95, glow: 0.35, bloom: 0.2, saturation: 1.12, tint: '#fff6e8', grass: '#4f7a2e',
  },
  golden: {
    sun: '#ffc88a', sunIntensity: 3.0, sunElevation: 0.42, sunAzimuth: 1.9,
    hemiSky: '#ffd6a8', hemiGround: '#4f3a28', hemiIntensity: 0.85,
    zenith: '#6d8fd0', horizon: '#ffcf96', fog: '#e9c39a',
    exposure: 1.0, glow: 0.6, bloom: 0.3, saturation: 1.16, tint: '#fff6ea', grass: '#5f8a33',
  },
  dusk: {
    sun: '#ff7e4a', sunIntensity: 2.0, sunElevation: 0.2, sunAzimuth: 2.4,
    hemiSky: '#e8a2b8', hemiGround: '#3c2a34', hemiIntensity: 0.85,
    zenith: '#4a4f9a', horizon: '#ff9a74', fog: '#c48c88',
    exposure: 1.08, glow: 1.0, bloom: 0.45, saturation: 1.25, tint: '#ffe6e0', grass: '#5d6a3a',
  },
  night: {
    sun: '#9fb4ff', sunIntensity: 0.8, sunElevation: 0.85, sunAzimuth: -2.2,
    hemiSky: '#4057a8', hemiGround: '#141826', hemiIntensity: 0.55,
    zenith: '#0f1640', horizon: '#2c3a72', fog: '#1d2650',
    exposure: 1.05, glow: 1.9, bloom: 0.7, saturation: 1.1, tint: '#c9d4ff', grass: '#3a5c46',
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
