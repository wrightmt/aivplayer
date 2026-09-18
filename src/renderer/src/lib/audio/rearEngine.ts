import { CONTROL_INTERVAL_MS } from '../../../../shared/constants';
import type { RearParams } from '../../../../shared/dsp/rearProcessor';
import type { AudioChunk } from '../../../../shared/protocol';
import type { HubState } from '../../../../shared/types';
import type { HubClient } from '../hubClient';
import { AudioOutput, type Notify } from './context';
import { REAR_PROCESSOR, type RearCommand, type RearMessage } from './worklets/messages';
import rearWorkletUrl from './worklets/rear.worklet.ts?worker&url';

export class RearEngine {
  private readonly out: AudioOutput;
  private node: AudioWorkletNode | null = null;
  private epoch = -1;
  private paramsKey = '';

  constructor(
    private readonly client: HubClient,
    notify: Notify,
  ) {
    this.out = new AudioOutput(notify);
  }

  async init(deviceId: string): Promise<void> {
    const { ctx } = this.out;
    await ctx.audioWorklet.addModule(rearWorkletUrl);
    this.node = new AudioWorkletNode(ctx, REAR_PROCESSOR, { numberOfInputs: 0, outputChannelCount: [2] });
    this.node.connect(ctx.destination);
    this.node.port.onmessage = (e: MessageEvent<RearMessage>) => {
      this.client.send({
        type: 'rearStats',
        stats: { ...e.data.stats, rttMs: this.client.clock.rttMs, timestampJitterMs: this.out.timestampJitterMs },
      });
    };
    await this.out.setDevice(deviceId);
    setInterval(() => this.refreshTimeMap(), CONTROL_INTERVAL_MS);
  }

  setDevice(deviceId: string): Promise<void> {
    return this.out.setDevice(deviceId);
  }

  applyState(s: HubState): void {
    const params: RearParams = { ...s.rear, frontVolumeDb: s.front.volumeDb };
    const key = JSON.stringify(params);
    if (key !== this.paramsKey) {
      this.paramsKey = key;
      this.post({ type: 'params', params });
    }
    if (s.player.epoch !== this.epoch) {
      this.epoch = s.player.epoch;
      this.post({ type: 'epoch', epoch: s.player.epoch });
    }
  }

  pushChunk(chunk: AudioChunk): void {
    this.post({ type: 'chunk', chunk }, [chunk.samples.buffer]);
  }

  private post(c: RearCommand, transfer: Transferable[] = []): void {
    this.node?.port.postMessage(c, transfer);
  }

  private refreshTimeMap(): void {
    if (!this.client.clock.ready) return;
    const map = this.out.timeMap(this.client.clock.offset);
    if (map) this.post({ type: 'timeMap', map });
  }
}
