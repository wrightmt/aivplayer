import { describe, expect, it } from 'vitest';
import { JitterBuffer } from '../../src/shared/dsp/jitterBuffer';
import type { AudioChunk } from '../../src/shared/protocol';

/** Stereo chunk whose left sample = frame index, right = -frame index. */
const chunk = (frameIndex: number, frameCount = 4, epoch = 1): AudioChunk => {
  const samples = new Float32Array(frameCount * 2);
  for (let i = 0; i < frameCount; i++) {
    samples[i * 2] = frameIndex + i;
    samples[i * 2 + 1] = -(frameIndex + i);
  }
  return { epoch, frameIndex, presentationTime: frameIndex, frameCount, channels: 2, samples };
};

describe('JitterBuffer', () => {
  it('reads samples across chunks and reports range', () => {
    const b = new JitterBuffer(1000);
    b.reset(1);
    b.push(chunk(0));
    b.push(chunk(4));
    expect([b.startFrame, b.endFrame]).toEqual([0, 8]);
    expect(b.read(0, 0)).toBe(0);
    expect(b.read(5, 0)).toBe(5);
    expect(b.read(5, 1)).toBe(-5);
    expect(b.read(3, 1)).toBe(-3);
    expect(b.read(8, 0)).toBeNaN();
    expect(b.read(-1, 0)).toBeNaN();
  });

  it('orders out-of-order chunks, ignores duplicates and other epochs', () => {
    const b = new JitterBuffer(1000);
    b.reset(1);
    b.push(chunk(8));
    b.push(chunk(0));
    b.push(chunk(4));
    b.push(chunk(4));
    b.push(chunk(12, 4, 2));
    expect([b.startFrame, b.endFrame]).toEqual([0, 12]);
    expect([0, 3, 4, 7, 8, 11].map((f) => b.read(f, 0))).toEqual([0, 3, 4, 7, 8, 11]);
    expect(b.ref?.frameIndex).toBe(8);
  });

  it('returns NaN inside a gap', () => {
    const b = new JitterBuffer(1000);
    b.reset(1);
    b.push(chunk(0));
    b.push(chunk(8));
    expect(b.read(5, 0)).toBeNaN();
    expect(b.read(9, 0)).toBe(9);
  });

  it('duplicates mono chunks to both channels', () => {
    const b = new JitterBuffer(1000);
    b.reset(1);
    b.push({ epoch: 1, frameIndex: 0, presentationTime: 0, frameCount: 2, channels: 1, samples: Float32Array.from([0.1, 0.2]) });
    expect(b.read(1, 1)).toBeCloseTo(0.2, 6);
  });

  it('dropBefore removes finished chunks; reset flushes and changes epoch', () => {
    const b = new JitterBuffer(1000);
    b.reset(1);
    b.push(chunk(0));
    b.push(chunk(4));
    b.dropBefore(5);
    expect(b.startFrame).toBe(4);
    b.dropBefore(8);
    expect(b.startFrame).toBeNull();
    b.reset(2);
    b.push(chunk(0, 4, 1));
    expect(b.startFrame).toBeNull();
    b.push(chunk(0, 4, 2));
    expect(b.epoch).toBe(2);
    expect(b.startFrame).toBe(0);
  });

  it('trims the oldest chunk when over capacity', () => {
    const b = new JitterBuffer(8);
    b.reset(1);
    b.push(chunk(0));
    b.push(chunk(4));
    b.push(chunk(8));
    expect([b.startFrame, b.endFrame]).toEqual([4, 12]);
  });
});
