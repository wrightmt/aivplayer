interface Sample {
  offset: number;
  rtt: number;
}

/**
 * NTP-style offset estimate between this process's clock and the hub clock.
 * hubTime = localTime + offset
 */
export class ClockSync {
  private samples: Sample[] = [];
  private _offset: number | null = null;
  private _rtt = 0;

  constructor(
    private readonly windowSize = 16,
    private readonly alpha = 0.2,
  ) {}

  /** t0 local send, t1 hub receive, t2 hub send, t3 local receive (all ms). */
  addSample(t0: number, t1: number, t2: number, t3: number): void {
    const rtt = t3 - t0 - (t2 - t1);
    const offset = (t1 - t0 + (t2 - t3)) / 2;
    this.samples.push({ offset, rtt });
    if (this.samples.length > this.windowSize) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this._rtt = best.rtt;
    this._offset = this._offset === null ? best.offset : this._offset + this.alpha * (best.offset - this._offset);
  }

  get ready(): boolean {
    return this._offset !== null;
  }

  get offset(): number {
    return this._offset ?? 0;
  }

  get rttMs(): number {
    return this._rtt;
  }

  reset(): void {
    this.samples = [];
    this._offset = null;
    this._rtt = 0;
  }
}
