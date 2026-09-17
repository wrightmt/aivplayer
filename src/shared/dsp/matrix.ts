import type { RearMode, Side } from '../types';

export interface MatrixParams {
  enabled: boolean;
  mode: RearMode;
  singleSide: Side;
  /** Linear gain (front volume × rear gain). */
  gain: number;
}

/** [rearL←L, rearL←R, rearR←L, rearR←R] */
export type Coeffs = [number, number, number, number];

/** L−R can reach twice single-channel amplitude, so it is halved before user gain. */
export const DIFFERENCE_SCALE = 0.5;

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function targetCoeffs(p: MatrixParams): Coeffs {
  if (!p.enabled) return [0, 0, 0, 0];
  const a = DIFFERENCE_SCALE * p.gain;
  switch (p.mode) {
    case 'difference':
      return [a, -a, a, -a];
    case 'wide':
      return [a, -a, -a, a];
    case 'single':
      return p.singleSide === 'L' ? [a, -a, 0, 0] : [0, 0, a, -a];
  }
}

const CLIP_T = Math.pow(10, -1 / 20);

/** Transparent below −1 dBFS, tanh knee above; output magnitude never exceeds 1. */
export function softClip(x: number): number {
  const ax = Math.abs(x);
  if (ax <= CLIP_T) return x;
  const y = CLIP_T + (1 - CLIP_T) * Math.tanh((ax - CLIP_T) / (1 - CLIP_T));
  return x < 0 ? -y : y;
}

/** Applies the rear matrix with linear coefficient ramps (click-free mode/gain changes). */
export class RearMatrix {
  private cur: Coeffs = [0, 0, 0, 0];
  private target: Coeffs = [0, 0, 0, 0];
  private step: Coeffs = [0, 0, 0, 0];
  private remaining = 0;

  constructor(private readonly rampFrames: number) {}

  setTarget(c: Coeffs): void {
    this.target = [...c];
    this.remaining = this.rampFrames;
    for (let k = 0; k < 4; k++) this.step[k] = (c[k] - this.cur[k]) / this.rampFrames;
  }

  coeffs(): Coeffs {
    return [...this.cur];
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number): void {
    const c = this.cur;
    for (let i = 0; i < frames; i++) {
      if (this.remaining > 0) {
        if (--this.remaining === 0) {
          c[0] = this.target[0]; c[1] = this.target[1]; c[2] = this.target[2]; c[3] = this.target[3];
        } else {
          c[0] += this.step[0]; c[1] += this.step[1]; c[2] += this.step[2]; c[3] += this.step[3];
        }
      }
      const l = inL[i];
      const r = inR[i];
      outL[i] = softClip(c[0] * l + c[1] * r);
      outR[i] = softClip(c[2] * l + c[3] * r);
    }
  }
}
