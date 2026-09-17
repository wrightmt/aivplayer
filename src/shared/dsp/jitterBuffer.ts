import type { AudioChunk } from '../protocol';

/** Holds received chunks for one epoch, ordered by frameIndex, with random sample access. */
export class JitterBuffer {
  private chunks: AudioChunk[] = [];
  private cursor = 0;
  private _epoch = -1;
  private _ref: AudioChunk | null = null;

  constructor(private readonly maxFrames: number) {}

  get epoch(): number {
    return this._epoch;
  }

  /** Most advanced chunk received; its presentationTime anchors the rear timeline. */
  get ref(): AudioChunk | null {
    return this._ref;
  }

  get startFrame(): number | null {
    return this.chunks.length ? this.chunks[0].frameIndex : null;
  }

  get endFrame(): number | null {
    const last = this.chunks[this.chunks.length - 1];
    return last ? last.frameIndex + last.frameCount : null;
  }

  reset(epoch: number): void {
    this._epoch = epoch;
    this.chunks = [];
    this.cursor = 0;
    this._ref = null;
  }

  push(c: AudioChunk): void {
    if (c.epoch !== this._epoch || c.frameCount === 0) return;
    let i = this.chunks.length;
    while (i > 0 && this.chunks[i - 1].frameIndex > c.frameIndex) i--;
    if (i > 0 && this.chunks[i - 1].frameIndex === c.frameIndex) return; // duplicate
    this.chunks.splice(i, 0, c);
    if (!this._ref || c.frameIndex > this._ref.frameIndex) this._ref = c;
    while (this.chunks.length > 1 && this.endFrame! - this.startFrame! > this.maxFrames) this.chunks.shift();
    this.cursor = 0;
  }

  /** Sample at integer stream frame for channel 0/1 (mono chunks duplicate), or NaN if not buffered. */
  read(frame: number, ch: number): number {
    const cs = this.chunks;
    if (cs.length === 0) return NaN;
    let c = cs[this.cursor];
    if (!c || frame < c.frameIndex || frame >= c.frameIndex + c.frameCount) {
      let lo = 0;
      let hi = cs.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cs[mid].frameIndex > frame) hi = mid - 1;
        else lo = mid + 1;
      }
      this.cursor = hi;
      c = cs[hi];
      if (!c || frame >= c.frameIndex + c.frameCount) return NaN;
    }
    return c.samples[(frame - c.frameIndex) * c.channels + Math.min(ch, c.channels - 1)];
  }

  /** Drops whole chunks that end at or before `frame`. */
  dropBefore(frame: number): void {
    let n = 0;
    while (n < this.chunks.length && this.chunks[n].frameIndex + this.chunks[n].frameCount <= frame) n++;
    if (n > 0) {
      this.chunks.splice(0, n);
      this.cursor = 0;
    }
  }
}
