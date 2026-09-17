import { describe, expect, it } from 'vitest';
import { StereoDelayLine } from '../../src/shared/dsp/delayLine';
import { hermite } from '../../src/shared/dsp/hermite';

describe('StereoDelayLine', () => {
  it('delays by exactly N frames across block boundaries', () => {
    const d = new StereoDelayLine(3);
    const outL: number[] = [];
    const outR: number[] = [];
    for (let block = 0; block < 3; block++) {
      const inL = Float32Array.from([1, 2], (v) => v + block * 2);
      const inR = inL.map((v) => -v);
      const oL = new Float32Array(2);
      const oR = new Float32Array(2);
      d.process(inL, inR, oL, oR, 2);
      outL.push(...oL);
      outR.push(...oR);
    }
    expect(outL).toEqual([0, 0, 0, 1, 2, 3]);
    expect(outR).toEqual([0, 0, 0, -1, -2, -3]);
  });

  it('works in place and clears', () => {
    const d = new StereoDelayLine(1);
    const l = Float32Array.from([5, 6]);
    const r = Float32Array.from([7, 8]);
    d.process(l, r, l, r, 2);
    expect(Array.from(l)).toEqual([0, 5]);
    d.clear();
    d.process(l, r, l, r, 1);
    expect(l[0]).toBe(0);
  });

  it('zero frames is passthrough', () => {
    const d = new StereoDelayLine(0);
    const oL = new Float32Array(2);
    const oR = new Float32Array(2);
    d.process(Float32Array.from([1, 2]), Float32Array.from([3, 4]), oL, oR, 2);
    expect(Array.from(oL)).toEqual([1, 2]);
    expect(Array.from(oR)).toEqual([3, 4]);
  });
});

describe('hermite', () => {
  it('hits the sample points and reproduces lines/parabolas exactly', () => {
    expect(hermite(1, 2, 3, 4, 0)).toBe(2);
    expect(hermite(1, 2, 3, 4, 1)).toBe(3);
    expect(hermite(1, 2, 3, 4, 0.25)).toBeCloseTo(2.25, 12);
    const f = (x: number) => x * x;
    expect(hermite(f(-1), f(0), f(1), f(2), 0.5)).toBeCloseTo(0.25, 12);
  });

  it('interpolates a well-sampled sine accurately', () => {
    const w = (2 * Math.PI * 1000) / 48000;
    let maxErr = 0;
    for (let n = 1; n < 200; n++) {
      const t = 0.37;
      const y = hermite(Math.sin(w * (n - 1)), Math.sin(w * n), Math.sin(w * (n + 1)), Math.sin(w * (n + 2)), t);
      maxErr = Math.max(maxErr, Math.abs(y - Math.sin(w * (n + t))));
    }
    expect(maxErr).toBeLessThan(1e-3);
  });
});
