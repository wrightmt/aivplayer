/** Fixed stereo delay of `frames` samples (0 = passthrough). */
export class StereoDelayLine {
  private readonly bufL: Float32Array;
  private readonly bufR: Float32Array;
  private pos = 0;

  constructor(readonly frames: number) {
    this.bufL = new Float32Array(Math.max(1, frames));
    this.bufR = new Float32Array(Math.max(1, frames));
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    if (this.frames === 0) {
      if (outL !== inL) outL.set(inL.subarray(0, n));
      if (outR !== inR) outR.set(inR.subarray(0, n));
      return;
    }
    for (let i = 0; i < n; i++) {
      const l = inL[i];
      const r = inR[i];
      outL[i] = this.bufL[this.pos];
      outR[i] = this.bufR[this.pos];
      this.bufL[this.pos] = l;
      this.bufR[this.pos] = r;
      this.pos = (this.pos + 1) % this.frames;
    }
  }

  clear(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.pos = 0;
  }
}
