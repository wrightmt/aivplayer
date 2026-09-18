import { DEFAULT_PRESENTATION_DELAY_MS } from '../../../../../shared/constants';
import { PlayerCore, type TrackBuffer } from '../../../../../shared/dsp/playerCore';
import { PLAYER_PROCESSOR, type PlayerCommand, type PlayerMessage } from './messages';

class PlayerProcessor extends AudioWorkletProcessor {
  private readonly core = new PlayerCore({
    delayFrames: Math.round((DEFAULT_PRESENTATION_DELAY_MS * sampleRate) / 1000),
    sampleRate,
  });
  private readonly buffers = new Map<string, TrackBuffer>();

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<PlayerCommand>) => this.onCommand(e.data);
  }

  private post(msg: PlayerMessage, transfer: Transferable[] = []): void {
    this.port.postMessage(msg, transfer);
  }

  private onCommand(c: PlayerCommand): void {
    switch (c.type) {
      case 'buffer':
        this.buffers.set(c.trackId, { trackId: c.trackId, left: c.left, right: c.right });
        if (c.evict) this.buffers.delete(c.evict);
        break;
      case 'start': {
        const track = this.buffers.get(c.trackId);
        if (track) this.core.start(c.epoch, track, c.startFrame);
        else this.post({ type: 'missing', epoch: c.epoch, trackId: c.trackId });
        break;
      }
      case 'next':
        this.core.setNext(c.trackId ? (this.buffers.get(c.trackId) ?? null) : null);
        break;
      case 'stop':
        this.core.stop();
        break;
      case 'volume':
        this.core.setVolumeDb(c.db);
        break;
      case 'delay':
        this.core.setDelayFrames(c.frames);
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length < 2) return true;
    for (const ev of this.core.process(currentFrame, out[0], out[1])) {
      if (ev.type === 'chunk') this.post(ev, [ev.samples.buffer]);
      else this.post(ev);
    }
    return true;
  }
}

registerProcessor(PLAYER_PROCESSOR, PlayerProcessor);
