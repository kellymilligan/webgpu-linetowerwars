import { Color } from 'three/webgpu';
import type { TimePhase } from '../sim/types';

export interface LightPreset {
  sunColor: string;
  sunIntensity: number;
  /** Elevation in radians and azimuth in radians. */
  sunElevation: number;
  sunAzimuth: number;
  skyColor: string;
  groundColor: string;
  hemiIntensity: number;
  fogColor: string;
  exposure: number;
  /** Multiplier on gem and effect emissive glow. */
  glow: number;
  bloom: number;
  grass: string;
}

export const PRESETS: Record<TimePhase, LightPreset> = {
  day: {
    sunColor: '#fff1dc', sunIntensity: 3.6, sunElevation: 1.0, sunAzimuth: 0.9,
    skyColor: '#cfe6ff', groundColor: '#4a5a30', hemiIntensity: 0.75,
    fogColor: '#b9d7ea', exposure: 0.95, glow: 0.35, bloom: 0.18, grass: '#4f8a2e',
  },
  dusk: {
    sunColor: '#ff9656', sunIntensity: 2.4, sunElevation: 0.32, sunAzimuth: 2.3,
    skyColor: '#ffb48f', groundColor: '#4b3440', hemiIntensity: 0.8,
    fogColor: '#e59c7c', exposure: 1.05, glow: 0.8, bloom: 0.4, grass: '#7a7f3e',
  },
  night: {
    sunColor: '#8aa6ff', sunIntensity: 0.9, sunElevation: 0.9, sunAzimuth: -2.2,
    skyColor: '#22346b', groundColor: '#0c111f', hemiIntensity: 0.55,
    fogColor: '#0d1430', exposure: 1.15, glow: 1.8, bloom: 0.75, grass: '#2f4a3c',
  },
  dawn: {
    sunColor: '#ffc7a6', sunIntensity: 2.0, sunElevation: 0.28, sunAzimuth: -0.6,
    skyColor: '#cdbcff', groundColor: '#4a4540', hemiIntensity: 0.95,
    fogColor: '#efc6c4', exposure: 1.0, glow: 0.6, bloom: 0.3, grass: '#6b8a4f',
  },
};

/** A live, lerpable copy of a preset with Color objects. */
export class LightState {
  sunColor = new Color();
  skyColor = new Color();
  groundColor = new Color();
  fogColor = new Color();
  grass = new Color();
  sunIntensity = 0;
  sunElevation = 0;
  sunAzimuth = 0;
  hemiIntensity = 0;
  exposure = 1;
  glow = 0;
  bloom = 0;

  constructor(p: LightPreset) {
    this.set(p);
  }

  set(p: LightPreset) {
    this.sunColor.set(p.sunColor);
    this.skyColor.set(p.skyColor);
    this.groundColor.set(p.groundColor);
    this.fogColor.set(p.fogColor);
    this.grass.set(p.grass);
    this.sunIntensity = p.sunIntensity;
    this.sunElevation = p.sunElevation;
    this.sunAzimuth = p.sunAzimuth;
    this.hemiIntensity = p.hemiIntensity;
    this.exposure = p.exposure;
    this.glow = p.glow;
    this.bloom = p.bloom;
  }

  /** Moves toward a preset by factor t (0..1). */
  approach(p: LightPreset, t: number) {
    const c = new Color();
    this.sunColor.lerp(c.set(p.sunColor), t);
    this.skyColor.lerp(c.set(p.skyColor), t);
    this.groundColor.lerp(c.set(p.groundColor), t);
    this.fogColor.lerp(c.set(p.fogColor), t);
    this.grass.lerp(c.set(p.grass), t);
    this.sunIntensity += (p.sunIntensity - this.sunIntensity) * t;
    this.sunElevation += (p.sunElevation - this.sunElevation) * t;
    this.sunAzimuth += shortestAngle(this.sunAzimuth, p.sunAzimuth) * t;
    this.hemiIntensity += (p.hemiIntensity - this.hemiIntensity) * t;
    this.exposure += (p.exposure - this.exposure) * t;
    this.glow += (p.glow - this.glow) * t;
    this.bloom += (p.bloom - this.bloom) * t;
  }
}

function shortestAngle(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
