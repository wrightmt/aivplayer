import { MAX_CORRECTION_PPM, RESYNC_THRESHOLD_MS } from '../constants';

export interface DriftGains {
  /** ppm per ms of error */
  kp: number;
  /** ppm per (ms·s) of accumulated error */
  ki: number;
  /** EMA smoothing of the error measurement (0..1, 1 = none) */
  alpha: number;
  maxPpm: number;
  resyncMs: number;
}

// Plant: dE/dt = (drift − u)·1e-3 ms/s. With these gains the loop is critically damped with
// ωn ≈ 0.05 rad/s (≈20 s time constant): slow enough to ignore timestamp jitter, fast enough
// to absorb sound-card drift long before it is audible.
export const DEFAULT_GAINS: DriftGains = {
  kp: 100,
  ki: 2.5,
  alpha: 0.3,
  maxPpm: MAX_CORRECTION_PPM,
  resyncMs: RESYNC_THRESHOLD_MS,
};

export interface DriftOutput {
  /** Playback-rate correction; ratio = 1 + ppm·1e-6. */
  ppm: number;
  /** Error too large to slew: jump to the target position. */
  resync: boolean;
}

const clamp = (v: number, m: number): number => Math.max(-m, Math.min(m, v));

export class DriftController {
  private integral = 0;
  private filtered: number | null = null;

  constructor(private readonly g: DriftGains = DEFAULT_GAINS) {}

  /** errorMs = desired − actual playback position (positive: rear is late, speed up). */
  update(errorMs: number, dtSec: number): DriftOutput {
    if (Math.abs(errorMs) > this.g.resyncMs) {
      this.reset();
      return { ppm: 0, resync: true };
    }
    this.filtered = this.filtered === null ? errorMs : this.filtered + this.g.alpha * (errorMs - this.filtered);
    const p = this.g.kp * this.filtered;
    const nextIntegral = this.integral + this.g.ki * this.filtered * dtSec;
    const unclamped = p + nextIntegral;
    // Anti-windup: stop integrating while saturated in the direction the error is pushing.
    const saturated = Math.abs(unclamped) > this.g.maxPpm && Math.sign(unclamped) === Math.sign(this.filtered);
    if (!saturated) this.integral = clamp(nextIntegral, this.g.maxPpm);
    return { ppm: clamp(p + this.integral, this.g.maxPpm), resync: false };
  }

  reset(): void {
    this.integral = 0;
    this.filtered = null;
  }
}
