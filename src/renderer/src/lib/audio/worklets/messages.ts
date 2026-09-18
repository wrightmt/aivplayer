import type { PlayerEvent } from '../../../../../shared/dsp/playerCore';
import type { RearEngineStats, RearParams } from '../../../../../shared/dsp/rearProcessor';
import type { AudioChunk } from '../../../../../shared/protocol';
import type { TimeMap } from '../../../../../shared/sync/timeMap';

export const PLAYER_PROCESSOR = 'aiv-player';
export const REAR_PROCESSOR = 'aiv-rear';

export type PlayerCommand =
  | { type: 'buffer'; trackId: string; left: Float32Array; right: Float32Array; evict: string | null }
  | { type: 'start'; epoch: number; trackId: string; startFrame: number }
  | { type: 'next'; trackId: string | null }
  | { type: 'stop' }
  | { type: 'volume'; db: number }
  | { type: 'delay'; frames: number };

export type PlayerMessage = PlayerEvent | { type: 'missing'; epoch: number; trackId: string };

export type RearCommand =
  | { type: 'timeMap'; map: TimeMap }
  | { type: 'params'; params: RearParams }
  | { type: 'epoch'; epoch: number }
  | { type: 'chunk'; chunk: AudioChunk };

export type RearMessage = { type: 'stats'; stats: RearEngineStats };
