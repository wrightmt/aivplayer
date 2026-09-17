import { describe, expect, it } from 'vitest';
import { dbToGain, RearMatrix, softClip, targetCoeffs, type MatrixParams } from '../../src/shared/dsp/matrix';

const params = (over: Partial<MatrixParams> = {}): MatrixParams => ({
  enabled: true, mode: 'difference', singleSide: 'L', gain: 1, ...over,
});

function render(m: RearMatrix, l: number[], r: number[]): { L: number[]; R: number[] } {
  const outL = new Float32Array(l.length);
  const outR = new Float32Array(l.length);
  m.process(Float32Array.from(l), Float32Array.from(r), outL, outR, l.length);
  return { L: Array.from(outL), R: Array.from(outR) };
}

describe('targetCoeffs', () => {
  it('maps each mode to the rear matrix', () => {
    expect(targetCoeffs(params())).toEqual([0.5, -0.5, 0.5, -0.5]);
    expect(targetCoeffs(params({ mode: 'wide' }))).toEqual([0.5, -0.5, -0.5, 0.5]);
    expect(targetCoeffs(params({ mode: 'single', singleSide: 'L' }))).toEqual([0.5, -0.5, 0, 0]);
    expect(targetCoeffs(params({ mode: 'single', singleSide: 'R' }))).toEqual([0, 0, 0.5, -0.5]);
    expect(targetCoeffs(params({ enabled: false }))).toEqual([0, 0, 0, 0]);
    expect(targetCoeffs(params({ gain: 2 }))).toEqual([1, -1, 1, -1]);
  });

  it('dbToGain', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 10);
  });
});

describe('softClip', () => {
  it('is transparent below -1 dBFS and bounded above', () => {
    expect(softClip(0.5)).toBe(0.5);
    expect(softClip(-0.8)).toBe(-0.8);
    for (const x of [0.95, 1, 2, 10, 1000]) {
      expect(softClip(x)).toBeLessThanOrEqual(1);
      expect(softClip(-x)).toBeGreaterThanOrEqual(-1);
    }
    expect(softClip(1.2)).toBeGreaterThan(softClip(1));
  });
});

describe('RearMatrix', () => {
  const settled = (p: MatrixParams): RearMatrix => {
    const m = new RearMatrix(4);
    m.setTarget(targetCoeffs(p));
    render(m, [0, 0, 0, 0], [0, 0, 0, 0]);
    return m;
  };

  it('mono input is silent on the rear in every mode', () => {
    for (const mode of ['difference', 'wide', 'single'] as const) {
      for (const singleSide of ['L', 'R'] as const) {
        const out = render(settled(params({ mode, singleSide })), [0.3, -0.7, 0.9], [0.3, -0.7, 0.9]);
        expect([...out.L, ...out.R].every((v) => v === 0)).toBe(true);
      }
    }
  });

  it('difference plays (L-R)/2 on both, wide inverts the right', () => {
    const d = render(settled(params()), [0.6], [0.2]);
    expect(d.L[0]).toBeCloseTo(0.2, 6);
    expect(d.R[0]).toBeCloseTo(0.2, 6);
    const w = render(settled(params({ mode: 'wide' })), [0.6], [0.2]);
    expect(w.L[0]).toBeCloseTo(0.2, 6);
    expect(w.R[0]).toBeCloseTo(-0.2, 6);
  });

  it('single mode silences the other side', () => {
    const out = render(settled(params({ mode: 'single', singleSide: 'R' })), [0.6], [0.2]);
    expect(out.L[0]).toBe(0);
    expect(out.R[0]).toBeCloseTo(0.2, 6);
  });

  it('ramps coefficients linearly over rampFrames', () => {
    const m = new RearMatrix(4);
    m.setTarget([1, 0, 0, 0]);
    const out = render(m, [0.8, 0.8, 0.8, 0.8, 0.8], [0, 0, 0, 0, 0]);
    expect(out.L.map((v) => Number(v.toFixed(4)))).toEqual([0.2, 0.4, 0.6, softClip(0.8), softClip(0.8)].map((v) => Number(v.toFixed(4))));
    expect(m.coeffs()).toEqual([1, 0, 0, 0]);
  });

  it('never exceeds full scale with hard-panned full-scale input at +6 dB', () => {
    const out = render(settled(params({ mode: 'wide', gain: dbToGain(6) })), [1, -1], [-1, 1]);
    expect(Math.max(...[...out.L, ...out.R].map(Math.abs))).toBeLessThanOrEqual(1);
  });
});
