import { CHUNK_FRAMES, FADE_MS, SAMPLE_RATE } from '../constants';
import { StereoDelayLine } from './delayLine';
import { dbToGain } from './matrix';

export interface TrackBuffer {
  trackId: string;
  left: Float32Array;
  right: Float32Array;
}

export type PlayerEvent =
  | {
      type: 'chunk';
      epoch: number;
      frameIndex: number;
      /** Front AudioContext frame at which the chunk's first sample is heard. */
      outputContextFrame: number;
      frameCount: number;
      samples: Float32Array;
    }
  | { type: 'started'; epoch: number; trackFrame: number; outputContextFrame: number }
  | { type: 'trackEnded'; epoch: number; outputContextFrame: number; nextStarted: boolean };

interface PendingStart {
  epoch: number;
  track: TrackBuffer;
  startFrame: number;
}

/**
 * Front playback: reads the current track (gapless into `next`), emits undelayed stream
 * chunks for the rear, and plays the same audio through a D-frame delay on the front.
 * Pure (no Web Audio), driven one render quantum at a time by the player AudioWorklet.
 */
export class PlayerCore {
  private readonly sr: number;
  private readonly fadeFrames: number;
  private delay: StereoDelayLine;
  private pendingDelayFrames: number | null = null;

  private epoch = -1;
  private current: TrackBuffer | null = null;
  private next: TrackBuffer | null = null;
  private playing = false;
  private stopping = false;
  private playhead = 0;
  private streamFrame = 0;
  private startedPending = false;
  private inGain = 1;
  private inRemaining = 0;

  private outGain = 1;
  private outRemaining = 0;
  private volume = 1;
  private pendingStart: PendingStart | null = null;

  private chunk: Float32Array;
  private chunkFill = 0;
  private chunkFrameIndex = 0;
  private chunkOutputFrame = 0;
  private scratchL = new Float32Array(128);
  private scratchR = new Float32Array(128);

  constructor(opts: { delayFrames: number; sampleRate?: number; chunkFrames?: number }) {
    this.sr = opts.sampleRate ?? SAMPLE_RATE;
    this.fadeFrames = Math.round((FADE_MS * this.sr) / 1000);
    this.delay = new StereoDelayLine(opts.delayFrames);
    this.chunk = new Float32Array((opts.chunkFrames ?? CHUNK_FRAMES) * 2);
  }

  get isPlaying(): boolean {
    return this.playing && !this.stopping;
  }

  setVolumeDb(db: number): void {
    this.volume = dbToGain(db);
  }

  /** Takes effect at the next start(). */
  setDelayFrames(frames: number): void {
    this.pendingDelayFrames = frames;
  }

  start(epoch: number, track: TrackBuffer, startFrame: number): void {
    if (this.playing) {
      // Fade the old audio out first; the start is applied when the fade completes.
      this.pendingStart = { epoch, track, startFrame };
      this.beginFadeOut();
      return;
    }
    this.applyStart({ epoch, track, startFrame });
  }

  setNext(track: TrackBuffer | null): void {
    this.next = track;
  }

  stop(): void {
    this.pendingStart = null;
    if (this.playing) this.beginFadeOut();
  }

  process(contextFrame: number, outL: Float32Array, outR: Float32Array): PlayerEvent[] {
    const n = outL.length;
    const events: PlayerEvent[] = [];
    if (this.scratchL.length < n) {
      this.scratchL = new Float32Array(n);
      this.scratchR = new Float32Array(n);
    }
    const inL = this.scratchL;
    const inR = this.scratchR;
    const delayFrames = this.delay.frames;

    for (let i = 0; i < n; i++) {
      let l = 0;
      let r = 0;
      if (this.playing && this.current) {
        const heardAt = contextFrame + i + delayFrames;
        const report = !this.stopping;
        if (this.playhead >= this.current.left.length) {
          if (this.next) {
            this.current = this.next;
            this.next = null;
            this.playhead = 0;
            if (report) events.push({ type: 'trackEnded', epoch: this.epoch, outputContextFrame: heardAt, nextStarted: true });
          } else {
            this.playing = false;
            if (report) {
              this.flushChunk(events);
              events.push({ type: 'trackEnded', epoch: this.epoch, outputContextFrame: heardAt, nextStarted: false });
            }
          }
        }
        if (this.playing) {
          if (this.startedPending && report) {
            this.startedPending = false;
            events.push({ type: 'started', epoch: this.epoch, trackFrame: this.playhead, outputContextFrame: heardAt });
          }
          if (this.inRemaining > 0) this.inGain = 1 - --this.inRemaining / this.fadeFrames;
          l = this.current.left[this.playhead] * this.inGain;
          r = this.current.right[this.playhead] * this.inGain;
          this.playhead++;
          // While fading out for a stop, keep feeding the front but stop streaming to the rear.
          if (!report) {
            inL[i] = l;
            inR[i] = r;
            continue;
          }
          if (this.chunkFill === 0) {
            this.chunkFrameIndex = this.streamFrame;
            this.chunkOutputFrame = heardAt;
          }
          this.chunk[this.chunkFill * 2] = l;
          this.chunk[this.chunkFill * 2 + 1] = r;
          this.streamFrame++;
          if (++this.chunkFill * 2 === this.chunk.length) this.flushChunk(events);
        }
      }
      inL[i] = l;
      inR[i] = r;
    }

    this.delay.process(inL, inR, outL, outR, n);
    for (let i = 0; i < n; i++) {
      if (this.outRemaining > 0) this.outGain = --this.outRemaining / this.fadeFrames;
      const g = this.outGain * this.volume;
      outL[i] *= g;
      outR[i] *= g;
    }
    if (this.outRemaining === 0 && this.outGain === 0) {
      this.playing = false;
      this.stopping = false;
      this.delay.clear();
      this.outGain = 1;
      const pending = this.pendingStart;
      this.pendingStart = null;
      if (pending) this.applyStart(pending);
    }
    return events;
  }

  private beginFadeOut(): void {
    if (this.stopping) return;
    this.stopping = true;
    this.chunkFill = 0; // the rear flushes this epoch anyway
    this.outRemaining = this.fadeFrames;
  }

  private applyStart(s: PendingStart): void {
    if (this.pendingDelayFrames !== null && this.pendingDelayFrames !== this.delay.frames) {
      this.delay = new StereoDelayLine(this.pendingDelayFrames);
    }
    this.pendingDelayFrames = null;
    this.delay.clear();
    this.epoch = s.epoch;
    this.current = s.track;
    this.playhead = Math.max(0, Math.min(s.startFrame, s.track.left.length));
    this.streamFrame = 0;
    this.chunkFill = 0;
    this.playing = true;
    this.stopping = false;
    this.startedPending = true;
    this.inGain = 0;
    this.inRemaining = this.fadeFrames;
    this.outGain = 1;
    this.outRemaining = 0;
  }

  private flushChunk(events: PlayerEvent[]): void {
    if (this.chunkFill === 0) return;
    events.push({
      type: 'chunk',
      epoch: this.epoch,
      frameIndex: this.chunkFrameIndex,
      outputContextFrame: this.chunkOutputFrame,
      frameCount: this.chunkFill,
      samples: this.chunk.slice(0, this.chunkFill * 2),
    });
    this.chunkFill = 0;
  }
}
