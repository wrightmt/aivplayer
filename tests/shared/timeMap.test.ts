import { describe, expect, it } from 'vitest';
import { hubTimeAt, TimeMapFilter, timeMapFromTimestamp } from '../../src/shared/sync/timeMap';

describe('timeMap', () => {
  it('converts an output timestamp into hub time for any context frame', () => {
    const map = timeMapFromTimestamp({ contextTime: 2, performanceTime: 1500 }, 1_700_000_000_000, -250, 48000)!;
    expect(map).toEqual({ contextFrame: 96000, hubTimeMs: 1_700_000_000_000 + 1500 - 250 });
    expect(hubTimeAt(map, 96000 + 4800, 48000)).toBe(map.hubTimeMs + 100);
    expect(hubTimeAt(map, 96000 - 480, 48000)).toBe(map.hubTimeMs - 10);
  });

  it('returns null before the context renders', () => {
    expect(timeMapFromTimestamp({ contextTime: 0, performanceTime: 0 }, 0, 0, 48000)).toBeNull();
    expect(timeMapFromTimestamp({}, 0, 0, 48000)).toBeNull();
  });
});

describe('TimeMapFilter', () => {
  const SR = 48000;
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }
  /** Gaussian-ish noise from the sum of uniforms. */
  const noise = (rand: () => number, sd: number) => ((rand() + rand() + rand() + rand() - 2) / Math.sqrt(4 / 12)) * sd;
  const truth = (frame: number) => 1_700_000_000_000 + (frame * 1000) / (SR * (1 + 80e-6));

  it('reduces timestamp jitter several-fold while tracking an 80 ppm slope', () => {
    const f = new TimeMapFilter(SR);
    const rand = rng(3);
    let rawSq = 0;
    let filteredSq = 0;
    let n = 0;
    for (let i = 0; i < 1200; i++) {
      const frame = 1_000_000 + i * 24000;
      const raw = truth(frame) + noise(rand, 3);
      const out = f.add({ contextFrame: frame, hubTimeMs: raw });
      if (i >= 60) {
        rawSq += (raw - truth(frame)) ** 2;
        filteredSq += (out.hubTimeMs - truth(frame)) ** 2;
        n++;
      }
    }
    const rawRms = Math.sqrt(rawSq / n);
    const filteredRms = Math.sqrt(filteredSq / n);
    expect(rawRms).toBeGreaterThan(2.5);
    expect(filteredRms).toBeLessThan(rawRms / 3);
    expect(f.jitterMs).toBeGreaterThan(2);
    expect(f.jitterMs).toBeLessThan(4);
  });

  it('holds its prediction through isolated outliers and re-anchors after a real jump', () => {
    const f = new TimeMapFilter(SR);
    let frame = 0;
    for (let i = 0; i < 60; i++, frame += 24000) f.add({ contextFrame: frame, hubTimeMs: truth(frame) });
    const spike = f.add({ contextFrame: frame, hubTimeMs: truth(frame) + 400 });
    expect(Math.abs(spike.hubTimeMs - truth(frame))).toBeLessThan(0.1);
    frame += 24000;
    // device change: every later timestamp is 250 ms later
    let out = { contextFrame: 0, hubTimeMs: 0 };
    for (let i = 0; i < 4; i++, frame += 24000) out = f.add({ contextFrame: frame, hubTimeMs: truth(frame) + 250 });
    expect(Math.abs(out.hubTimeMs - (truth(frame - 24000) + 250))).toBeLessThan(0.1);
  });
});
