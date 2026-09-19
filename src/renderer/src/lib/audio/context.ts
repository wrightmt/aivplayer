import { SAMPLE_RATE } from '../../../../shared/constants';
import { TimeMapFilter, timeMapFromTimestamp, type TimeMap } from '../../../../shared/sync/timeMap';

export type Notify = (message: string) => void;

export async function listOutputDevices(): Promise<{ id: string; label: string }[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audiooutput')
    .map((d) => ({ id: d.deviceId === 'default' ? '' : d.deviceId, label: d.label || 'Output device' }));
}

/**
 * Owns the AudioContext for one engine: fixed 48 kHz, chosen output device with fallback to the
 * system default when the device disappears, and the context-frame → hub-time map.
 */
export class AudioOutput {
  readonly ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'playback' });
  private readonly filter = new TimeMapFilter(SAMPLE_RATE);
  private deviceId = '';

  constructor(private readonly notify: Notify) {
    navigator.mediaDevices.addEventListener('devicechange', () => void this.checkDevice());
  }

  async setDevice(deviceId: string): Promise<void> {
    this.deviceId = deviceId;
    this.filter.reset();
    try {
      await this.ctx.setSinkId(deviceId);
    } catch {
      this.deviceId = '';
      await this.ctx.setSinkId('');
      this.notify('Saved output device not found; using the system default device');
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /** Smoothed context-frame → hub-time map; call at a steady rate (every CONTROL_INTERVAL_MS). */
  timeMap(hubOffsetMs: number): TimeMap | null {
    const raw = timeMapFromTimestamp(this.ctx.getOutputTimestamp(), performance.timeOrigin, hubOffsetMs, SAMPLE_RATE);
    return raw ? this.filter.add(raw) : null;
  }

  /** How noisy this driver's output timestamps are (RMS ms around the fitted line). */
  get timestampJitterMs(): number {
    return this.filter.jitterMs;
  }

  private async checkDevice(): Promise<void> {
    if (!this.deviceId) return;
    const devices = await listOutputDevices();
    if (!devices.some((d) => d.id === this.deviceId)) {
      this.deviceId = '';
      this.filter.reset();
      await this.ctx.setSinkId('');
      this.notify('Output device was removed; switched to the system default device');
    }
  }
}
