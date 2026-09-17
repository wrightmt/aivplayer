import { CONTROL_INTERVAL_MS, FADE_MS, RAMP_MS, REAR_FADE_IN_MS, SAMPLE_RATE } from '../constants';
import type { AudioChunk } from '../protocol';
import { DriftController } from '../sync/driftController';
import { hubTimeAt, type TimeMap } from '../sync/timeMap';
import type { RearSettings, RearStats } from '../types';
import { hermite } from './hermite';
import { JitterBuffer } from './jitterBuffer';
import { dbToGain, RearMatrix, targetCoeffs } from './matrix';

export interface RearParams extends RearSettings {
  frontVolumeDb: number;
}

export type { TimeMap };
export type RearEngineStats = Omit<RearStats, 'rttMs' | 'timestampJitterMs'>;

const GAP_TO_PRIME_MS = 100;
const BUFFER_SECONDS = 4;

/**
 * Rear signal chain: jitter buffer → drift-corrected cubic resampler → fades → matrix.
 * Pure (no Web Audio), driven one render quantum at a time by the rear AudioWorklet.
 */
export class RearProcessor {
  private readonly sr: number;
  private readonly buf: JitterBuffer;
  private readonly matrix: RearMatrix;
  private readonly drift = new DriftController();
  private readonly fadeOutFrames: number;
  private readonly fadeInFrames: number;
  private readonly xfadeFrames: number;
  private readonly controlFrames: number;
  private readonly gapLimitFrames: number;

  private timeMap: TimeMap | null = null;
  private delayMs = 0;
  private state: RearStats['state'] = 'idle';
  private pendingEpoch: number | null = null;
  private pendingChunks: AudioChunk[] = [];

  private readPos = 0;
  private ratio = 1;
  private xfadePos = 0;
  private xfadeRemaining = 0;
  private gain = 0;
  private gainTarget = 0;
  private gainStep = 0;
  private gainRemaining = 0;
  private framesSinceControl = 0;
  private lastErrorMs = 0;
  private underruns = 0;
  private resyncs = 0;
  private gapFrames = 0;

  private preL = new Float32Array(128);
  private preR = new Float32Array(128);
  private sampleL = 0;
  private sampleR = 0;

  constructor(sampleRate = SAMPLE_RATE) {
    this.sr = sampleRate;
    const frames = (ms: number) => Math.round((ms * sampleRate) / 1000);
    this.buf = new JitterBuffer(sampleRate * BUFFER_SECONDS);
    this.matrix = new RearMatrix(frames(RAMP_MS));
    this.fadeOutFrames = frames(FADE_MS);
    this.fadeInFrames = frames(REAR_FADE_IN_MS);
    this.xfadeFrames = frames(RAMP_MS);
    this.controlFrames = frames(CONTROL_INTERVAL_MS);
    this.gapLimitFrames = frames(GAP_TO_PRIME_MS);
  }

  setTimeMap(m: TimeMap): void {
    this.timeMap = m;
  }

  setParams(p: RearParams): void {
    this.delayMs = p.delayMs;
    this.matrix.setTarget(
      targetCoeffs({ enabled: p.enabled, mode: p.mode, singleSide: p.singleSide, gain: dbToGain(p.gainDb + p.frontVolumeDb) }),
    );
  }

  setEpoch(epoch: number): void {
    if (epoch === (this.pendingEpoch ?? this.buf.epoch)) return;
    this.pendingEpoch = epoch;
    this.pendingChunks = [];
    if (this.state === 'playing') this.fadeTo(0, this.fadeOutFrames);
    else this.applyPendingEpoch();
  }

  pushChunk(c: AudioChunk): void {
    if (this.pendingEpoch !== null) {
      if (c.epoch === this.pendingEpoch) this.pendingChunks.push(c);
      return;
    }
    this.buf.push(c);
  }

  /** Current fractional read position in stream frames (NaN unless playing). */
  get position(): number {
    return this.state === 'playing' ? this.readPos : NaN;
  }

  stats(): RearEngineStats {
    const end = this.buf.endFrame ?? 0;
    const from = this.state === 'playing' ? this.readPos : (this.buf.startFrame ?? 0);
    return {
      state: this.state,
      syncErrorMs: this.lastErrorMs,
      correctionPpm: (this.ratio - 1) * 1e6,
      bufferMs: Math.max(0, ((end - from) * 1000) / this.sr),
      underruns: this.underruns,
      resyncs: this.resyncs,
    };
  }

  process(contextFrame: number, outL: Float32Array, outR: Float32Array): void {
    const n = outL.length;
    if (this.preL.length < n) {
      this.preL = new Float32Array(n);
      this.preR = new Float32Array(n);
    }
    this.preL.fill(0, 0, n);
    this.preR.fill(0, 0, n);
    if (this.state === 'priming') this.tryStart(contextFrame, n);
    if (this.state === 'playing') {
      this.control(contextFrame, n);
      this.render(n);
    }
    this.matrix.process(this.preL, this.preR, outL, outR, n);
    if (this.pendingEpoch !== null && this.gain === 0 && this.gainRemaining === 0) this.applyPendingEpoch();
  }

  /** Stream frame that should be heard at rear context frame `contextFrame`. */
  private desiredPos(contextFrame: number): number | null {
    const ref = this.buf.ref;
    const map = this.timeMap;
    if (!ref || !map) return null;
    const hubTime = hubTimeAt(map, contextFrame, this.sr);
    return ref.frameIndex + ((hubTime - this.delayMs - ref.presentationTime) * this.sr) / 1000;
  }

  private applyPendingEpoch(): void {
    this.buf.reset(this.pendingEpoch!);
    for (const c of this.pendingChunks) this.buf.push(c);
    this.pendingEpoch = null;
    this.pendingChunks = [];
    this.state = 'priming';
    this.gain = 0;
    this.gainRemaining = 0;
    this.xfadeRemaining = 0;
    this.gapFrames = 0;
    this.ratio = 1;
    this.drift.reset();
  }

  private tryStart(contextFrame: number, n: number): void {
    const d = this.desiredPos(contextFrame);
    const start = this.buf.startFrame;
    const end = this.buf.endFrame;
    if (d === null || start === null || end === null || d < start + 1) return;
    if (d + n + 3 > end) {
      this.buf.dropBefore(Math.floor(d) - 2); // late or starved: discard audio that is already past
      return;
    }
    this.state = 'playing';
    this.readPos = d;
    this.ratio = 1;
    this.drift.reset();
    this.framesSinceControl = 0;
    this.gapFrames = 0;
    this.lastErrorMs = 0;
    this.gain = 0;
    this.fadeTo(1, this.fadeInFrames);
  }

  private control(contextFrame: number, n: number): void {
    this.framesSinceControl += n;
    if (this.framesSinceControl < this.controlFrames) return;
    const dt = this.framesSinceControl / this.sr;
    this.framesSinceControl = 0;
    const d = this.desiredPos(contextFrame);
    if (d === null) return;
    const errorMs = ((d - this.readPos) * 1000) / this.sr;
    this.lastErrorMs = errorMs;
    const out = this.drift.update(errorMs, dt);
    if (out.resync) {
      this.resyncs++;
      this.xfadePos = this.readPos;
      this.xfadeRemaining = this.xfadeFrames;
      this.readPos = d;
      this.ratio = 1;
    } else {
      this.ratio = 1 + out.ppm * 1e-6;
    }
  }

  private render(n: number): void {
    for (let i = 0; i < n; i++) {
      const ok = this.readAt(this.readPos);
      let l = ok ? this.sampleL : 0;
      let r = ok ? this.sampleR : 0;
      if (this.xfadeRemaining > 0) {
        const w = this.xfadeRemaining / this.xfadeFrames;
        const okOld = this.readAt(this.xfadePos);
        l = l * (1 - w) + (okOld ? this.sampleL : 0) * w;
        r = r * (1 - w) + (okOld ? this.sampleR : 0) * w;
        this.xfadePos += this.ratio;
        this.xfadeRemaining--;
      }
      if (ok) {
        this.gapFrames = 0;
      } else {
        if (this.gapFrames === 0) this.underruns++;
        this.gapFrames++;
      }
      if (this.gainRemaining > 0) {
        this.gain = --this.gainRemaining === 0 ? this.gainTarget : this.gain + this.gainStep;
      }
      this.preL[i] = l * this.gain;
      this.preR[i] = r * this.gain;
      this.readPos += this.ratio;
    }
    if (this.gapFrames > this.gapLimitFrames) {
      this.state = 'priming';
      this.gain = 0;
      this.gainRemaining = 0;
      return;
    }
    const oldest = this.xfadeRemaining > 0 ? Math.min(this.readPos, this.xfadePos) : this.readPos;
    this.buf.dropBefore(Math.floor(oldest) - 2);
  }

  private readAt(pos: number): boolean {
    const i = Math.floor(pos);
    const t = pos - i;
    const b = this.buf;
    const l0 = b.read(i - 1, 0), l1 = b.read(i, 0), l2 = b.read(i + 1, 0), l3 = b.read(i + 2, 0);
    if (Number.isNaN(l0) || Number.isNaN(l3) || Number.isNaN(l1) || Number.isNaN(l2)) return false;
    this.sampleL = hermite(l0, l1, l2, l3, t);
    this.sampleR = hermite(b.read(i - 1, 1), b.read(i, 1), b.read(i + 1, 1), b.read(i + 2, 1), t);
    return true;
  }

  private fadeTo(target: number, frames: number): void {
    this.gainTarget = target;
    this.gainRemaining = frames;
    this.gainStep = (target - this.gain) / frames;
  }
}
