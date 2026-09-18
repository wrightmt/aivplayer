import { RearProcessor } from '../../../../../shared/dsp/rearProcessor';
import { REAR_PROCESSOR, type RearCommand, type RearMessage } from './messages';

class RearWorkletProcessor extends AudioWorkletProcessor {
  private readonly rear = new RearProcessor(sampleRate);
  private framesSinceStats = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<RearCommand>) => {
      const c = e.data;
      switch (c.type) {
        case 'timeMap':
          this.rear.setTimeMap(c.map);
          break;
        case 'params':
          this.rear.setParams(c.params);
          break;
        case 'epoch':
          this.rear.setEpoch(c.epoch);
          break;
        case 'chunk':
          this.rear.pushChunk(c.chunk);
          break;
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length < 2) return true;
    this.rear.process(currentFrame, out[0], out[1]);
    this.framesSinceStats += out[0].length;
    if (this.framesSinceStats >= sampleRate) {
      this.framesSinceStats = 0;
      const msg: RearMessage = { type: 'stats', stats: this.rear.stats() };
      this.port.postMessage(msg);
    }
    return true;
  }
}

registerProcessor(REAR_PROCESSOR, RearWorkletProcessor);
