import { CHUNK_FRAMES, SAMPLE_RATE } from '../../src/shared/constants';
import { RearProcessor, type RearParams } from '../../src/shared/dsp/rearProcessor';
import type { AudioChunk } from '../../src/shared/protocol';

export interface RearSimOptions {
  /** Front sound-card clock error in ppm. */
  frontPpm?: number;
  /** Rear sound-card clock error in ppm. */
  rearPpm?: number;
  /** Front presentation delay D in ms. */
  presentationDelayMs?: number;
  netLatencyMs?: number;
  /** Peak-to-peak random jitter added to each rear time-map update. */
  timeMapJitterMs?: number;
  params?: Partial<RearParams>;
  /** Stereo source sample for stream frame n. */
  signal?: (n: number) => [number, number];
  seed?: number;
}

export const DEFAULT_REAR_PARAMS: RearParams = {
  enabled: true, mode: 'difference', singleSide: 'L', gainDb: 0, delayMs: 0, frontVolumeDb: 0,
};

/** Left-only 220 Hz tone: the rear difference signal is 0.25·sin. */
export const leftTone = (n: number): [number, number] => [0.5 * Math.sin((2 * Math.PI * 220 * n) / SAMPLE_RATE), 0];

/**
 * Simulates a front stream and a rear AudioContext on independent clocks, all in "true" ms,
 * with the hub clock taken as true time.
 */
export class RearSim {
  readonly rear = new RearProcessor();
  readonly o: Required<Omit<RearSimOptions, 'params'>>;
  params: RearParams;
  contextFrame = 0;
  epoch = 1;
  /** Deliveries whose true delivery time falls in [dropFrom, dropTo) are lost. */
  dropFrom = Infinity;
  dropTo = -Infinity;
  private nextChunkFrame = 0;
  private streamStartMs = 1_000_000;
  private readonly rearStartMs = 1_000_000 - 500;
  private rand: () => number;

  constructor(opts: RearSimOptions = {}) {
    this.o = {
      frontPpm: 0, rearPpm: 0, presentationDelayMs: 100, netLatencyMs: 1, timeMapJitterMs: 0,
      signal: leftTone, seed: 1, ...opts,
    };
    let s = this.o.seed >>> 0;
    this.rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    this.params = { ...DEFAULT_REAR_PARAMS, ...opts.params };
    this.rear.setParams(this.params);
    this.rear.setEpoch(this.epoch);
  }

  /** True ms at which stream frame n is heard from the front. */
  presentationTime(n: number): number {
    return this.streamStartMs + (n * 1000) / (SAMPLE_RATE * (1 + this.o.frontPpm * 1e-6));
  }

  /** True ms at which rear context frame c is heard. */
  rearTime(c: number): number {
    return this.rearStartMs + (c * 1000) / (SAMPLE_RATE * (1 + this.o.rearPpm * 1e-6));
  }

  /** Stream frame that should be heard at rear context frame c. */
  idealPos(c: number): number {
    return ((this.rearTime(c) - this.params.delayMs - this.streamStartMs) * SAMPLE_RATE * (1 + this.o.frontPpm * 1e-6)) / 1000;
  }

  /** Position error in ms (positive = rear late). NaN when not playing. */
  errorMs(): number {
    return ((this.idealPos(this.contextFrame) - this.rear.position) * 1000) / SAMPLE_RATE;
  }

  setParams(p: Partial<RearParams>): void {
    this.params = { ...this.params, ...p };
    this.rear.setParams(this.params);
  }

  /** Starts a new epoch whose stream frame 0 is heard `inMs` from now. */
  newEpoch(inMs: number): void {
    this.epoch++;
    this.nextChunkFrame = 0;
    this.streamStartMs = this.rearTime(this.contextFrame) + inMs;
    this.rear.setEpoch(this.epoch);
  }

  step(n = 128): { L: Float32Array; R: Float32Array } {
    const now = this.rearTime(this.contextFrame);
    for (;;) {
      const f = this.nextChunkFrame;
      const deliverAt = this.presentationTime(f) - this.o.presentationDelayMs + this.o.netLatencyMs;
      if (deliverAt > now) break;
      if (!(deliverAt >= this.dropFrom && deliverAt < this.dropTo)) this.rear.pushChunk(this.makeChunk(f));
      this.nextChunkFrame += CHUNK_FRAMES;
    }
    if (this.contextFrame % 24000 < n) {
      const jitter = (this.rand() - 0.5) * this.o.timeMapJitterMs;
      this.rear.setTimeMap({ contextFrame: this.contextFrame, hubTimeMs: now + jitter });
    }
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    this.rear.process(this.contextFrame, L, R);
    this.contextFrame += n;
    return { L, R };
  }

  run(seconds: number, each?: (out: { L: Float32Array; R: Float32Array }) => void): void {
    const blocks = Math.ceil((seconds * SAMPLE_RATE) / 128);
    for (let b = 0; b < blocks; b++) {
      const out = this.step();
      each?.(out);
    }
  }

  private makeChunk(frameIndex: number): AudioChunk {
    const samples = new Float32Array(CHUNK_FRAMES * 2);
    for (let i = 0; i < CHUNK_FRAMES; i++) {
      const [l, r] = this.o.signal(frameIndex + i);
      samples[i * 2] = l;
      samples[i * 2 + 1] = r;
    }
    return {
      epoch: this.epoch, frameIndex, presentationTime: this.presentationTime(frameIndex),
      frameCount: CHUNK_FRAMES, channels: 2, samples,
    };
  }
}
