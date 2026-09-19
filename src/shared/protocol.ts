import { AUDIO_HEADER_BYTES, AUDIO_MAGIC } from './constants';
import type { FrontSettings, HubState, Library, RearSettings, RearStats, Role } from './types';

export type ClientMessage =
  | { type: 'hello'; role: Role; protocolVersion: number; pcName: string; peerId: string; token?: string }
  | { type: 'ping'; t0: number }
  | { type: 'approvePairing'; requestId: string }
  | { type: 'denyPairing'; requestId: string }
  | { type: 'forgetPeer'; peerId: string }
  | { type: 'playAlbum'; albumId: string; startIndex: number }
  | { type: 'playTrack'; trackId: string }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'seek'; sec: number }
  | { type: 'setRear'; patch: Partial<RearSettings> }
  | { type: 'setFront'; patch: Partial<FrontSettings> }
  | { type: 'rescan' }
  | { type: 'trackEnded'; epoch: number; atHubTime: number; nextStarted: boolean }
  | { type: 'trackFailed'; epoch: number; trackId: string; reason: string }
  | { type: 'position'; epoch: number; frame: number; atHubTime: number }
  | { type: 'notice'; message: string }
  | { type: 'rearStats'; stats: RearStats };

export type HubMessage =
  | { type: 'welcome'; hubId: string; pcName: string }
  | { type: 'error'; reason: string }
  | { type: 'state'; state: HubState }
  | { type: 'library'; library: Library }
  | { type: 'pong'; t0: number; t1: number; t2: number }
  /** Sent once, when the front allows this rear. The rear stores the token and reuses it forever. */
  | { type: 'paired'; token: string }
  /** Sent while a rear waits for the person at the front to decide. */
  | { type: 'awaitingApproval' };

const CLIENT_TYPES = new Set<string>([
  'hello', 'ping', 'playAlbum', 'playTrack', 'play', 'pause', 'next', 'prev', 'seek',
  'setRear', 'setFront', 'rescan', 'trackEnded', 'trackFailed', 'position', 'notice', 'rearStats',
  'approvePairing', 'denyPairing', 'forgetPeer',
]);
const HUB_TYPES = new Set<string>(['welcome', 'error', 'state', 'library', 'pong', 'paired', 'awaitingApproval']);

function parseTyped(text: string, allowed: Set<string>): { type: string } | null {
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== 'object' || v === null) return null;
    const t = (v as { type?: unknown }).type;
    return typeof t === 'string' && allowed.has(t) ? (v as { type: string }) : null;
  } catch {
    return null;
  }
}

export function parseClientMessage(text: string): ClientMessage | null {
  return parseTyped(text, CLIENT_TYPES) as ClientMessage | null;
}

export function parseHubMessage(text: string): HubMessage | null {
  return parseTyped(text, HUB_TYPES) as HubMessage | null;
}

export interface AudioChunk {
  epoch: number;
  /** Stream frame index within the epoch (monotonic across gapless track changes). */
  frameIndex: number;
  /** Hub-clock ms at which frame `frameIndex` is heard from the front speakers. */
  presentationTime: number;
  frameCount: number;
  channels: number;
  /** Interleaved samples, length frameCount * channels. */
  samples: Float32Array;
}

// Header (little-endian): u32 magic | u32 epoch | f64 frameIndex | f64 presentationTime |
// u16 frameCount | u8 channels | 5 reserved bytes. Samples follow as platform-endian Float32
// (little-endian on every Windows PC).
export function encodeAudioChunk(c: AudioChunk): ArrayBuffer {
  const buf = new ArrayBuffer(AUDIO_HEADER_BYTES + c.frameCount * c.channels * 4);
  const view = new DataView(buf);
  view.setUint32(0, AUDIO_MAGIC, true);
  view.setUint32(4, c.epoch, true);
  view.setFloat64(8, c.frameIndex, true);
  view.setFloat64(16, c.presentationTime, true);
  view.setUint16(24, c.frameCount, true);
  view.setUint8(26, c.channels);
  new Float32Array(buf, AUDIO_HEADER_BYTES).set(c.samples.subarray(0, c.frameCount * c.channels));
  return buf;
}

export function decodeAudioChunk(data: ArrayBuffer | Uint8Array): AudioChunk | null {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (u8.byteLength < AUDIO_HEADER_BYTES) return null;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (view.getUint32(0, true) !== AUDIO_MAGIC) return null;
  const frameCount = view.getUint16(24, true);
  const channels = view.getUint8(26);
  const sampleBytes = frameCount * channels * 4;
  if (channels < 1 || u8.byteLength < AUDIO_HEADER_BYTES + sampleBytes) return null;
  // slice() copies into a fresh, 4-byte-aligned ArrayBuffer.
  const samples = new Float32Array(u8.slice(AUDIO_HEADER_BYTES, AUDIO_HEADER_BYTES + sampleBytes).buffer);
  return {
    epoch: view.getUint32(4, true),
    frameIndex: view.getFloat64(8, true),
    presentationTime: view.getFloat64(16, true),
    frameCount,
    channels,
    samples,
  };
}
