import { describe, expect, it } from 'vitest';
import { ClockSync } from '../../src/shared/sync/clockSync';
import { DriftController } from '../../src/shared/sync/driftController';

/** Deterministic PRNG so tests are repeatable. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('ClockSync', () => {
  it('computes offset and rtt from a symmetric exchange', () => {
    const c = new ClockSync();
    expect(c.ready).toBe(false);
    // local 1000 -> hub receives at hub 5002 (local 1002), hub replies at 5003, local receives 1005
    c.addSample(1000, 5002, 5003, 1005);
    expect(c.ready).toBe(true);
    expect(c.offset).toBe(4000);
    expect(c.rttMs).toBe(4);
  });

  it('converges on the true offset despite asymmetric random delays', () => {
    const trueOffset = 123456.789;
    const rand = rng(42);
    const c = new ClockSync();
    let local = 0;
    for (let i = 0; i < 60; i++) {
      local += 1000;
      const up = 0.3 + rand() * (rand() < 0.2 ? 30 : 1);
      const down = 0.3 + rand() * (rand() < 0.2 ? 30 : 1);
      const t1 = local + up + trueOffset;
      const t2 = t1 + 0.05;
      c.addSample(local, t1, t2, t2 - trueOffset + down);
    }
    expect(Math.abs(c.offset - trueOffset)).toBeLessThan(0.5);
    expect(c.rttMs).toBeLessThan(2);
  });
});

describe('DriftController', () => {
  it('requests resync above the threshold and resets', () => {
    const d = new DriftController();
    expect(d.update(25, 0.5)).toEqual({ ppm: 0, resync: true });
    expect(d.update(-25, 0.5).resync).toBe(true);
    expect(d.update(1, 0.5).resync).toBe(false);
  });

  it('clamps output to ±500 ppm', () => {
    const d = new DriftController();
    expect(d.update(19, 0.5).ppm).toBe(500);
    expect(new DriftController().update(-19, 0.5).ppm).toBe(-500);
  });

  it('cancels a constant +80 ppm drift with sub-millisecond steady-state error', () => {
    // Simulated plant: error grows at (drift − u)·1e-3 ms per second.
    const d = new DriftController();
    const rand = rng(7);
    const drift = 80;
    const dt = 0.5;
    let error = 0;
    let ppm = 0;
    let worstLate = 0;
    for (let t = 0; t < 1800; t += dt) {
      error += (drift - ppm) * 1e-3 * dt;
      const measured = error + (rand() - 0.5) * 1.0; // ±0.5 ms timestamp jitter
      const out = d.update(measured, dt);
      expect(out.resync).toBe(false);
      ppm = out.ppm;
      if (t > 300) worstLate = Math.max(worstLate, Math.abs(error));
    }
    expect(worstLate).toBeLessThan(0.5);
  });

  it('pulls an initial 10 ms error to under 1 ms within 2 minutes without overshooting past -1 ms', () => {
    const d = new DriftController();
    let error = 10;
    let ppm = 0;
    let minError = Infinity;
    for (let t = 0; t < 120; t += 0.5) {
      error += (0 - ppm) * 1e-3 * 0.5;
      ppm = d.update(error, 0.5).ppm;
      minError = Math.min(minError, error);
    }
    expect(Math.abs(error)).toBeLessThan(1);
    expect(minError).toBeGreaterThan(-1);
  });
});
