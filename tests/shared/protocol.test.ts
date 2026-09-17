import { describe, expect, it } from 'vitest';
import {
  decodeAudioChunk,
  encodeAudioChunk,
  parseClientMessage,
  parseHubMessage,
} from '../../src/shared/protocol';

describe('audio chunk codec', () => {
  it('round-trips header and samples', () => {
    const samples = new Float32Array([0.1, -0.1, 0.5, -0.5, 1, -1]);
    const buf = encodeAudioChunk({
      epoch: 7,
      frameIndex: 123456789,
      presentationTime: 1726570000123.25,
      frameCount: 3,
      channels: 2,
      samples,
    });
    expect(buf.byteLength).toBe(32 + 6 * 4);
    const c = decodeAudioChunk(buf)!;
    expect(c.epoch).toBe(7);
    expect(c.frameIndex).toBe(123456789);
    expect(c.presentationTime).toBe(1726570000123.25);
    expect(c.frameCount).toBe(3);
    expect(c.channels).toBe(2);
    expect(Array.from(c.samples)).toEqual(Array.from(samples));
  });

  it('decodes from a misaligned Uint8Array view (Node Buffer pooling)', () => {
    const buf = encodeAudioChunk({
      epoch: 1, frameIndex: 0, presentationTime: 5, frameCount: 1, channels: 2,
      samples: new Float32Array([0.25, -0.75]),
    });
    const padded = new Uint8Array(buf.byteLength + 3);
    padded.set(new Uint8Array(buf), 3);
    const c = decodeAudioChunk(padded.subarray(3))!;
    expect(Array.from(c.samples)).toEqual([0.25, -0.75]);
  });

  it('rejects bad magic and truncated data', () => {
    expect(decodeAudioChunk(new ArrayBuffer(10))).toBeNull();
    expect(decodeAudioChunk(new ArrayBuffer(40))).toBeNull();
    const buf = encodeAudioChunk({
      epoch: 1, frameIndex: 0, presentationTime: 0, frameCount: 4, channels: 2,
      samples: new Float32Array(8),
    });
    expect(decodeAudioChunk(buf.slice(0, 40))).toBeNull();
  });
});

describe('JSON message parsing', () => {
  it('accepts known client messages', () => {
    expect(parseClientMessage('{"type":"play"}')).toEqual({ type: 'play' });
    expect(parseClientMessage('{"type":"seek","sec":12}')).toEqual({ type: 'seek', sec: 12 });
  });

  it('rejects unknown types, non-objects and bad JSON', () => {
    expect(parseClientMessage('{"type":"explode"}')).toBeNull();
    expect(parseClientMessage('42')).toBeNull();
    expect(parseClientMessage('null')).toBeNull();
    expect(parseClientMessage('{nope')).toBeNull();
  });

  it('keeps client and hub message sets separate', () => {
    expect(parseHubMessage('{"type":"pong","t0":1,"t1":2,"t2":3}')).toEqual({ type: 'pong', t0: 1, t1: 2, t2: 3 });
    expect(parseHubMessage('{"type":"play"}')).toBeNull();
    expect(parseClientMessage('{"type":"pong"}')).toBeNull();
  });
});
