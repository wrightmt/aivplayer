import { describe, expect, it } from 'vitest';
import { PlayerCore, type PlayerEvent, type TrackBuffer } from '../../src/shared/dsp/playerCore';

/** Track whose left sample i = start + i (scaled), right = negative. */
function ramp(trackId: string, frames: number, start = 1): TrackBuffer {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = (start + i) / 1e6;
    right[i] = -(start + i) / 1e6;
  }
  return { trackId, left, right };
}

function runBlocks(p: PlayerCore, blocks: number, from = 0, n = 128) {
  const events: PlayerEvent[] = [];
  const L: number[] = [];
  const R: number[] = [];
  for (let b = 0; b < blocks; b++) {
    const oL = new Float32Array(n);
    const oR = new Float32Array(n);
    events.push(...p.process(from + b * n, oL, oR));
    L.push(...oL);
    R.push(...oR);
  }
  return { events, L, R };
}

const chunks = (ev: PlayerEvent[]) => ev.filter((e) => e.type === 'chunk') as Extract<PlayerEvent, { type: 'chunk' }>[];

describe('PlayerCore', () => {
  it('is silent and emits nothing before start', () => {
    const p = new PlayerCore({ delayFrames: 100 });
    const r = runBlocks(p, 4);
    expect(r.events).toEqual([]);
    expect(r.L.every((v) => v === 0)).toBe(true);
  });

  it('emits started, then 1024-frame chunks whose output frame includes the delay', () => {
    const p = new PlayerCore({ delayFrames: 100 });
    p.start(3, ramp('a', 48000), 500);
    const r = runBlocks(p, 20, 1000);
    expect(r.events[0]).toEqual({ type: 'started', epoch: 3, trackFrame: 500, outputContextFrame: 1100 });
    const cs = chunks(r.events);
    expect(cs.length).toBe(2);
    expect(cs[0]).toMatchObject({ epoch: 3, frameIndex: 0, outputContextFrame: 1100, frameCount: 1024 });
    expect(cs[1]).toMatchObject({ frameIndex: 1024, outputContextFrame: 2124 });
    // past the 20 ms (960 frame) fade-in, chunk samples are the raw track
    expect(cs[1].samples[0]).toBeCloseTo((500 + 1024 + 1) / 1e6, 9);
    expect(cs[1].samples[1]).toBeCloseTo(-(500 + 1024 + 1) / 1e6, 9);
  });

  it('plays the same samples on the front, delayed by exactly delayFrames', () => {
    const p = new PlayerCore({ delayFrames: 100 });
    p.start(1, ramp('a', 48000), 0);
    const r = runBlocks(p, 20);
    const cs = chunks(r.events);
    expect(r.L.slice(0, 100).every((v) => v === 0)).toBe(true);
    for (let i = 0; i < 1024; i++) expect(r.L[100 + 1024 + i]).toBeCloseTo(cs[1].samples[i * 2], 9);
  });

  it('fades in over 20 ms', () => {
    const p = new PlayerCore({ delayFrames: 0 });
    p.start(1, { trackId: 'dc', left: new Float32Array(4800).fill(0.5), right: new Float32Array(4800).fill(0.5) }, 0);
    const r = runBlocks(p, 10);
    expect(r.L[0]).toBeLessThan(0.001);
    expect(r.L[480]).toBeCloseTo(0.25, 2);
    expect(r.L[1000]).toBe(0.5);
  });

  it('applies volume to the front only', () => {
    const p = new PlayerCore({ delayFrames: 0 });
    p.setVolumeDb(-20);
    p.start(1, { trackId: 'dc', left: new Float32Array(4800).fill(0.5), right: new Float32Array(4800).fill(0.5) }, 0);
    const r = runBlocks(p, 20);
    expect(r.L[1500]).toBeCloseTo(0.05, 6);
    expect(chunks(r.events)[1].samples[0]).toBe(0.5);
  });

  it('switches gaplessly to next with continuous stream frames', () => {
    const p = new PlayerCore({ delayFrames: 10 });
    p.start(1, ramp('a', 1500), 0);
    p.setNext(ramp('b', 3000, 1_000_000));
    const r = runBlocks(p, 40);
    const ended = r.events.filter((e) => e.type === 'trackEnded');
    expect(ended).toEqual([
      { type: 'trackEnded', epoch: 1, outputContextFrame: 1510, nextStarted: true },
      { type: 'trackEnded', epoch: 1, outputContextFrame: 4510, nextStarted: false },
    ]);
    const cs = chunks(r.events);
    expect(cs.map((c) => [c.frameIndex, c.frameCount])).toEqual([[0, 1024], [1024, 1024], [2048, 1024], [3072, 1024], [4096, 404]]);
    // stream frame 1500 is track b's first sample
    expect(cs[1].samples[(1500 - 1024) * 2]).toBeCloseTo(1_000_000 / 1e6, 9);
    expect(cs[1].samples[(1499 - 1024) * 2]).toBeCloseTo(1500 / 1e6, 9);
  });

  it('flushes a partial chunk and reports the end of the queue', () => {
    const p = new PlayerCore({ delayFrames: 0 });
    p.start(1, ramp('a', 1500), 0);
    const r = runBlocks(p, 20);
    const cs = chunks(r.events);
    expect(cs.map((c) => c.frameCount)).toEqual([1024, 476]);
    expect(r.events.at(-1)).toEqual({ type: 'trackEnded', epoch: 1, outputContextFrame: 1500, nextStarted: false });
    expect(p.isPlaying).toBe(false);
  });

  it('stop fades out over 20 ms and stops emitting chunks', () => {
    const p = new PlayerCore({ delayFrames: 0 });
    p.start(1, { trackId: 'dc', left: new Float32Array(96000).fill(0.5), right: new Float32Array(96000).fill(0.5) }, 0);
    runBlocks(p, 10);
    p.stop();
    const r = runBlocks(p, 20, 1280);
    expect(r.L[0]).toBeGreaterThan(0.45);
    expect(r.L[1000]).toBe(0);
    expect(chunks(r.events)).toEqual([]);
  });

  it('start while playing fades out first, then starts the new epoch with the new delay', () => {
    const p = new PlayerCore({ delayFrames: 0 });
    p.start(1, ramp('a', 96000), 0);
    runBlocks(p, 10);
    p.setDelayFrames(50);
    p.start(2, ramp('b', 96000), 0);
    const r = runBlocks(p, 20, 1280);
    const started = r.events.find((e) => e.type === 'started')!;
    expect(started).toMatchObject({ epoch: 2, trackFrame: 0 });
    // fade-out takes 960 frames, rounded up to the 1024-frame quantum boundary, plus 50 delay
    expect(started.type === 'started' && started.outputContextFrame).toBe(1280 + 1024 + 50);
    expect(chunks(r.events).every((c) => c.epoch === 2)).toBe(true);
  });
});
