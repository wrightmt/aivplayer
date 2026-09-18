import { CONTROL_INTERVAL_MS, LARGE_TRACK_SEC, SAMPLE_RATE } from '../../../../shared/constants';
import type { PlayerEvent } from '../../../../shared/dsp/playerCore';
import { encodeAudioChunk } from '../../../../shared/protocol';
import { hubTimeAt, type TimeMap } from '../../../../shared/sync/timeMap';
import type { FrontSettings, HubState, Library } from '../../../../shared/types';
import type { HubClient } from '../hubClient';
import { AudioOutput, type Notify } from './context';
import { PLAYER_PROCESSOR, type PlayerCommand, type PlayerMessage } from './worklets/messages';
import playerWorkletUrl from './worklets/player.worklet.ts?worker&url';

/** How many decoded tracks the worklet keeps (current, next, one spare). */
const WORKLET_CACHE = 3;

export class FrontEngine {
  private readonly out: AudioOutput;
  private node: AudioWorkletNode | null = null;
  private map: TimeMap | null = null;
  private library: Library = { albums: [], tracks: {} };
  private epoch = -1;
  private index = -1;
  private front: FrontSettings | null = null;
  private lastStart: { epoch: number; trackId: string; frame: number; nextId: string | undefined } | null = null;
  private readonly inWorklet: string[] = [];
  private readonly decoding = new Map<string, Promise<{ left: Float32Array; right: Float32Array }>>();

  constructor(
    private readonly client: HubClient,
    notify: Notify,
  ) {
    this.out = new AudioOutput(notify);
  }

  async init(deviceId: string): Promise<void> {
    const { ctx } = this.out;
    await ctx.audioWorklet.addModule(playerWorkletUrl);
    this.node = new AudioWorkletNode(ctx, PLAYER_PROCESSOR, { numberOfInputs: 0, outputChannelCount: [2] });
    this.node.connect(ctx.destination);
    this.node.port.onmessage = (e: MessageEvent<PlayerMessage>) => this.onWorklet(e.data);
    await this.out.setDevice(deviceId);
    setInterval(() => this.refreshTimeMap(), CONTROL_INTERVAL_MS);
  }

  setDevice(deviceId: string): Promise<void> {
    return this.out.setDevice(deviceId);
  }

  applyLibrary(library: Library): void {
    this.library = library;
  }

  applyState(s: HubState): void {
    if (s.front.volumeDb !== this.front?.volumeDb) this.post({ type: 'volume', db: s.front.volumeDb });
    if (s.front.presentationDelayMs !== this.front?.presentationDelayMs) {
      this.post({ type: 'delay', frames: Math.round((s.front.presentationDelayMs * SAMPLE_RATE) / 1000) });
    }
    this.front = s.front;

    const p = s.player;
    if (p.epoch !== this.epoch) {
      this.epoch = p.epoch;
      this.index = p.index;
      const trackId = p.queue[p.index];
      if (p.status === 'playing' && trackId) void this.startTrack(p.epoch, trackId, p.position.frame, p.queue[p.index + 1]);
      else this.post({ type: 'stop' });
    } else if (p.index !== this.index) {
      // Gapless advance inside the same epoch: line up the following track.
      this.index = p.index;
      void this.prepareNext(p.epoch, p.queue[p.index + 1]);
    }
  }

  private post(c: PlayerCommand, transfer: Transferable[] = []): void {
    this.node?.port.postMessage(c, transfer);
  }

  private refreshTimeMap(): TimeMap | null {
    this.map = this.out.timeMap(this.client.clock.offset) ?? this.map;
    return this.map;
  }

  private async startTrack(epoch: number, trackId: string, frame: number, nextId: string | undefined): Promise<void> {
    this.lastStart = { epoch, trackId, frame, nextId };
    try {
      await this.ensureInWorklet(trackId);
    } catch (e) {
      if (epoch === this.epoch) this.client.send({ type: 'trackFailed', epoch, trackId, reason: (e as Error).message });
      return;
    }
    if (epoch !== this.epoch) return;
    this.post({ type: 'start', epoch, trackId, startFrame: frame });
    await this.prepareNext(epoch, nextId);
  }

  private async prepareNext(epoch: number, nextId: string | undefined): Promise<void> {
    if (!nextId) {
      this.post({ type: 'next', trackId: null });
      return;
    }
    try {
      await this.ensureInWorklet(nextId);
    } catch {
      // Not ready: when the current track ends the hub starts it as a new epoch and reports failures then.
      this.post({ type: 'next', trackId: null });
      return;
    }
    if (epoch === this.epoch) this.post({ type: 'next', trackId: nextId });
  }

  private async ensureInWorklet(trackId: string): Promise<void> {
    const at = this.inWorklet.indexOf(trackId);
    if (at >= 0) {
      this.inWorklet.splice(at, 1);
      this.inWorklet.push(trackId); // most recently used last
      return;
    }
    let pending = this.decoding.get(trackId);
    if (!pending) {
      pending = this.decode(trackId).finally(() => this.decoding.delete(trackId));
      this.decoding.set(trackId, pending);
    }
    const { left, right } = await pending;
    if (this.inWorklet.includes(trackId)) return;
    this.inWorklet.push(trackId);
    const evict = this.inWorklet.length > WORKLET_CACHE ? this.inWorklet.shift()! : null;
    this.post({ type: 'buffer', trackId, left, right, evict }, [left.buffer, right.buffer]);
  }

  private async decode(trackId: string): Promise<{ left: Float32Array; right: Float32Array }> {
    const track = this.library.tracks[trackId];
    if (track && track.durationSec > LARGE_TRACK_SEC) {
      const mb = Math.round((track.durationSec * SAMPLE_RATE * 2 * 4) / 1e6);
      this.client.send({ type: 'notice', message: `"${track.title}" is over an hour long; decoding uses about ${mb} MB of memory` });
    }
    const bytes = await window.aiv.readTrack(trackId);
    const audio = await this.out.ctx.decodeAudioData(bytes);
    const left = audio.getChannelData(0).slice();
    const right = (audio.numberOfChannels > 1 ? audio.getChannelData(1) : audio.getChannelData(0)).slice();
    return { left, right };
  }

  private onWorklet(msg: PlayerMessage): void {
    if (msg.type === 'missing') {
      // The worklet evicted the buffer before the start arrived: resend it and retry once.
      const i = this.inWorklet.indexOf(msg.trackId);
      if (i >= 0) this.inWorklet.splice(i, 1);
      const s = this.lastStart;
      if (s && s.epoch === msg.epoch && s.epoch === this.epoch) void this.startTrack(s.epoch, s.trackId, s.frame, s.nextId);
      return;
    }
    const map = this.map ?? this.refreshTimeMap();
    // Without a time map we can't timestamp a chunk, but it's replaceable — drop it silently.
    // started/trackEnded are not replaceable, so they still go out below with a best-effort timestamp.
    if (!map && msg.type === 'chunk') return;
    this.handlePlayerEvent(msg, map);
  }

  private handlePlayerEvent(ev: PlayerEvent, map: TimeMap | null): void {
    const at = (frame: number) => (map ? hubTimeAt(map, frame, SAMPLE_RATE) : this.client.hubNow());
    switch (ev.type) {
      case 'chunk':
        this.client.sendBinary(
          encodeAudioChunk({
            epoch: ev.epoch,
            frameIndex: ev.frameIndex,
            presentationTime: at(ev.outputContextFrame),
            frameCount: ev.frameCount,
            channels: 2,
            samples: ev.samples,
          }),
        );
        break;
      case 'started':
        this.client.send({ type: 'position', epoch: ev.epoch, frame: ev.trackFrame, atHubTime: at(ev.outputContextFrame) });
        break;
      case 'trackEnded':
        this.client.send({ type: 'trackEnded', epoch: ev.epoch, atHubTime: at(ev.outputContextFrame), nextStarted: ev.nextStarted });
        break;
    }
  }
}
