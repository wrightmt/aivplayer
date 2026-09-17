import { afterEach, describe, expect, it } from 'vitest';
import { Hub } from '../../src/main/hub';
import { SAMPLE_RATE } from '../../src/shared/constants';
import { PlayerCore } from '../../src/shared/dsp/playerCore';
import { RearProcessor } from '../../src/shared/dsp/rearProcessor';
import { encodeAudioChunk } from '../../src/shared/protocol';
import type { HubState, Library } from '../../src/shared/types';
import { HubClient } from '../../src/renderer/src/lib/hubClient';
import { makeTrack } from '../helpers/library';
import { leftTone } from '../helpers/rearSim';
import { waitFor } from '../helpers/wait';

const FRONT_PPM = -30;
const REAR_PPM = 80;
const REAR_LOCAL_CLOCK_OFFSET_MS = 3000; // rear PC's wall clock is 3 s ahead of the hub
const D_MS = 100;
const REAR_DELAY_MS = 15;
const TRACK_SEC = 90;

let hub: Hub | null = null;
const clients: HubClient[] = [];
afterEach(async () => {
  clients.forEach((c) => c.stop());
  clients.length = 0;
  await hub?.stop();
});

describe('front → hub → rear sync over real WebSockets', () => {
  it('keeps the rear within 2 ms of the front across 60 s, including a seek', async () => {
    const trueStart = 1_000_000;
    let simNow = trueStart; // hub clock == true time
    const frontTime = (cf: number) => trueStart + (cf * 1000) / (SAMPLE_RATE * (1 + FRONT_PPM * 1e-6));
    const rearStart = trueStart + 7;
    const rearTime = (rc: number) => rearStart + (rc * 1000) / (SAMPLE_RATE * (1 + REAR_PPM * 1e-6));

    const track = makeTrack('t', 'a', 1, TRACK_SEC);
    const library: Library = {
      albums: [{ id: 'a', title: 'A', artist: 'X', trackIds: ['t'], coverDataUrl: null }],
      tracks: { t: track },
    };
    hub = new Hub({ port: 0, host: '127.0.0.1', hubId: 'h', pcName: 'FRONT', library, now: () => simNow });
    const url = `ws://127.0.0.1:${await hub.start()}`;

    const frames = TRACK_SEC * SAMPLE_RATE;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let n = 0; n < frames; n++) [left[n], right[n]] = leftTone(n);
    const buffer = { trackId: 't', left, right };

    // ---- front: PlayerCore driven by hub state
    const core = new PlayerCore({ delayFrames: (D_MS * SAMPLE_RATE) / 1000 });
    let frontEpoch = 0;
    let streamStartTrue = 0; // true ms at which stream frame 0 of the current epoch is heard
    const front = new HubClient({ role: 'front', pcName: 'FRONT' }, {
      onState: (s: HubState) => {
        if (s.player.epoch !== frontEpoch && s.player.status === 'playing') {
          frontEpoch = s.player.epoch;
          core.start(frontEpoch, buffer, s.player.position.frame);
        }
      },
    }, () => simNow);

    // ---- rear: RearProcessor driven by hub state and audio
    const rear = new RearProcessor();
    rear.setParams({ enabled: true, mode: 'difference', singleSide: 'L', gainDb: 0, delayMs: REAR_DELAY_MS, frontVolumeDb: 0 });
    let received = 0;
    const rearClient = new HubClient({ role: 'rear', pcName: 'REAR' }, {
      onState: (s) => rear.setEpoch(s.player.epoch),
      onAudio: (c) => {
        received++;
        rear.pushChunk(c);
      },
    }, () => simNow + REAR_LOCAL_CLOCK_OFFSET_MS);
    clients.push(front, rearClient);
    front.start(() => url);
    rearClient.start(() => url);
    await waitFor(() => front.status === 'open' && rearClient.status === 'open' && hub!.getState().peers.length === 2);

    // Clock sync while simulated time is frozen (zero simulated RTT).
    for (let i = 0; i < 4; i++) {
      rearClient.ping();
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(rearClient.clock.offset).toBeCloseTo(-REAR_LOCAL_CLOCK_OFFSET_MS, 3);

    front.send({ type: 'playAlbum', albumId: 'a', startIndex: 0 });
    await waitFor(() => frontEpoch === 1);

    let sent = 0;
    let cf = 0;
    let rc = 0;
    let worstMs = 0;
    let checkedBlocks = 0;
    let lastStartTrue = -Infinity;
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);
    const fL = new Float32Array(128);
    const fR = new Float32Array(128);

    const runUntil = async (trueEnd: number) => {
      while (rearTime(rc) < trueEnd) {
        simNow = rearTime(rc);
        while (frontTime(cf) <= simNow) {
          for (const ev of core.process(cf, fL, fR)) {
            if (ev.type === 'chunk') {
              front.sendBinary(encodeAudioChunk({
                epoch: ev.epoch, frameIndex: ev.frameIndex, presentationTime: frontTime(ev.outputContextFrame),
                frameCount: ev.frameCount, channels: 2, samples: ev.samples,
              }));
              sent++;
            } else if (ev.type === 'started') {
              streamStartTrue = frontTime(ev.outputContextFrame);
              lastStartTrue = streamStartTrue;
            }
          }
          cf += 128;
        }
        if (received < sent) await waitFor(() => received === sent);
        if (rc % 24000 < 128) {
          rear.setTimeMap({ contextFrame: rc, hubTimeMs: simNow + REAR_LOCAL_CLOCK_OFFSET_MS + rearClient.clock.offset });
        }
        rear.process(rc, outL, outR);
        if (simNow > lastStartTrue + REAR_DELAY_MS + 1000 && !Number.isNaN(rear.position)) {
          // rear.position is now the read position at the END of this block (context frame rc + 128)
          const endTrue = rearTime(rc + 128);
          const ideal = ((endTrue - REAR_DELAY_MS - streamStartTrue) * SAMPLE_RATE * (1 + FRONT_PPM * 1e-6)) / 1000;
          worstMs = Math.max(worstMs, (Math.abs(ideal - rear.position) * 1000) / SAMPLE_RATE);
          checkedBlocks++;
        }
        rc += 128;
      }
    };

    await runUntil(trueStart + 30_000);
    front.send({ type: 'seek', sec: 40 });
    await waitFor(() => frontEpoch === 2);
    await runUntil(trueStart + 60_000);

    expect(checkedBlocks).toBeGreaterThan(15000);
    expect(worstMs).toBeLessThan(2);
    expect(rear.stats()).toMatchObject({ state: 'playing', resyncs: 0 });
    expect(hub.getState().player).toMatchObject({ epoch: 2, status: 'playing' });
  });
});
