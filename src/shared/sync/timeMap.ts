/** Hub-clock ms at which AudioContext frame `contextFrame` is heard from the speakers. */
export interface TimeMap {
  contextFrame: number;
  hubTimeMs: number;
}

export function hubTimeAt(map: TimeMap, contextFrame: number, sampleRate: number): number {
  return map.hubTimeMs + ((contextFrame - map.contextFrame) * 1000) / sampleRate;
}

/**
 * Builds a time map from AudioContext.getOutputTimestamp(): `performanceTime` is when the frame at
 * `contextTime` reaches the speakers, in this renderer's performance clock. Returns null until the
 * context is actually rendering.
 */
export function timeMapFromTimestamp(
  ts: { contextTime?: number; performanceTime?: number },
  timeOrigin: number,
  hubOffsetMs: number,
  sampleRate: number,
): TimeMap | null {
  if (!ts.contextTime || !ts.performanceTime) return null;
  return {
    contextFrame: Math.round(ts.contextTime * sampleRate),
    hubTimeMs: timeOrigin + ts.performanceTime + hubOffsetMs,
  };
}

const MAX_SLOPE_ERROR = 1e-3; // sound cards are within ~±100 ppm; 1000 ppm bounds a bad fit
const MIN_FIT_SAMPLES = 8;

/**
 * Smooths noisy output timestamps with a least-squares line (hub ms vs context frame) over a
 * sliding window. Timestamps jitter by milliseconds (far more on some drivers) while the true
 * relationship is a straight line with a slope within a few hundred ppm of nominal.
 * Three consecutive samples far off the line (device change, context restart) reset the fit.
 */
export class TimeMapFilter {
  private samples: TimeMap[] = [];
  private misses = 0;

  constructor(
    private readonly sampleRate: number,
    /** 60 samples at the 500 ms update rate = 30 s of history. */
    private readonly windowSize = 60,
    private readonly resetMs = 50,
  ) {}

  add(m: TimeMap): TimeMap {
    if (this.samples.length >= MIN_FIT_SAMPLES) {
      const predicted = this.predict(m.contextFrame);
      if (Math.abs(m.hubTimeMs - predicted) > this.resetMs) {
        if (++this.misses < 3) return { contextFrame: m.contextFrame, hubTimeMs: predicted };
        this.samples = [];
      }
      this.misses = 0;
    }
    this.samples.push(m);
    if (this.samples.length > this.windowSize) this.samples.shift();
    return { contextFrame: m.contextFrame, hubTimeMs: this.predict(m.contextFrame) };
  }

  /** RMS distance of the raw samples from the fitted line, in ms. */
  get jitterMs(): number {
    if (this.samples.length < 2) return 0;
    const sq = this.samples.reduce((acc, s) => acc + (s.hubTimeMs - this.predict(s.contextFrame)) ** 2, 0);
    return Math.sqrt(sq / this.samples.length);
  }

  reset(): void {
    this.samples = [];
    this.misses = 0;
  }

  private predict(frame: number): number {
    const s = this.samples;
    const ref = s[s.length - 1];
    // Work relative to the newest sample: x in nominal ms, y in ms, both small numbers.
    const xs = s.map((p) => ((p.contextFrame - ref.contextFrame) * 1000) / this.sampleRate);
    const ys = s.map((p) => p.hubTimeMs - ref.hubTimeMs);
    const n = s.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let slope = 1;
    if (n >= MIN_FIT_SAMPLES) {
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < n; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
      }
      if (sxx > 0) slope = Math.min(1 + MAX_SLOPE_ERROR, Math.max(1 - MAX_SLOPE_ERROR, sxy / sxx));
    }
    const x = ((frame - ref.contextFrame) * 1000) / this.sampleRate;
    return ref.hubTimeMs + my + slope * (x - mx);
  }
}
