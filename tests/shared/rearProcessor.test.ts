import { describe, expect, it } from 'vitest';
import { SAMPLE_RATE } from '../../src/shared/constants';
import { RearSim } from '../helpers/rearSim';

const rms = (a: Float32Array): number => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

describe('RearProcessor', () => {
  it('stays idle-silent until the stream is due, then starts on the right frame', () => {
    const sim = new RearSim();
    sim.run(0.3, (o) => expect(rms(o.L)).toBe(0));
    expect(sim.rear.stats().state).toBe('priming');
    sim.run(0.3);
    expect(sim.rear.stats().state).toBe('playing');
    expect(Math.abs(sim.errorMs())).toBeLessThan(0.05);
  });

  it('outputs the scaled difference signal; mono sources are silent', () => {
    const sim = new RearSim();
    sim.run(1);
    const L: number[] = [];
    const R: number[] = [];
    sim.run(1, (o) => {
      L.push(...o.L);
      R.push(...o.R);
    });
    const level = rms(Float32Array.from(L));
    expect(level).toBeGreaterThan(0.17); // 0.25-peak sine → 0.177 rms
    expect(level).toBeLessThan(0.185);
    expect(R).toEqual(L);

    const mono = new RearSim({ signal: (n) => [Math.sin(n / 10), Math.sin(n / 10)] });
    mono.run(1.5, (o) => expect(rms(o.L) + rms(o.R)).toBeLessThan(1e-6));
  });

  it('holds sync within 2 ms for 10 minutes with +80 ppm rear, -30 ppm front and timestamp jitter', () => {
    const sim = new RearSim({ rearPpm: 80, frontPpm: -30, timeMapJitterMs: 1 });
    let worst = 0;
    let t = 0;
    sim.run(600, () => {
      t += 128 / SAMPLE_RATE;
      if (t > 1) worst = Math.max(worst, Math.abs(sim.errorMs()));
    });
    expect(worst).toBeLessThan(2);
    const s = sim.rear.stats();
    expect(s.resyncs).toBe(0);
    expect(s.underruns).toBe(0);
    // rear card fast by 80 ppm and front slow by 30 ppm → read ~110 ppm slower
    expect(s.correctionPpm).toBeGreaterThan(-160);
    expect(s.correctionPpm).toBeLessThan(-60);
  });

  it('resyncs with a crossfade when the rear delay jumps', () => {
    const sim = new RearSim();
    sim.run(2);
    sim.setParams({ delayMs: 40 });
    sim.run(2);
    expect(sim.rear.stats().resyncs).toBe(1);
    expect(Math.abs(sim.errorMs())).toBeLessThan(0.5);
  });

  it('flushes on epoch change after fading out, then re-primes', () => {
    const sim = new RearSim();
    sim.run(2);
    sim.newEpoch(150);
    const first = sim.step();
    expect(rms(first.L)).toBeGreaterThan(0); // still fading out, not cut
    sim.run(0.05);
    expect(sim.rear.stats().state).toBe('priming');
    sim.run(0.5);
    expect(sim.rear.stats().state).toBe('playing');
    expect(Math.abs(sim.errorMs())).toBeLessThan(0.05);
  });

  it('counts an underrun on a network gap, re-primes and recovers', () => {
    const sim = new RearSim();
    sim.run(2);
    const now = sim.rearTime(sim.contextFrame);
    sim.dropFrom = now;
    sim.dropTo = now + 400;
    sim.run(1);
    expect(sim.rear.stats().underruns).toBeGreaterThanOrEqual(1);
    sim.run(1);
    expect(sim.rear.stats().state).toBe('playing');
    expect(Math.abs(sim.errorMs())).toBeLessThan(0.05);
  });

  it('rear disabled is silent but stays synced', () => {
    const sim = new RearSim({ params: { enabled: false } });
    sim.run(2, (o) => expect(rms(o.L)).toBe(0));
    expect(sim.rear.stats().state).toBe('playing');
  });
});
