import { DEFAULT_PRESENTATION_DELAY_MS, SAMPLE_RATE } from './constants';
import type {
  FrontSettings,
  HubPrefs,
  HubState,
  Library,
  Peer,
  PlayerState,
  RearSettings,
  RearStats,
} from './types';

export type HubAction =
  | { type: 'playAlbum'; albumId: string; startIndex: number }
  | { type: 'playTrack'; trackId: string }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'seek'; sec: number }
  | { type: 'setRear'; patch: Partial<RearSettings> }
  | { type: 'setFront'; patch: Partial<FrontSettings> }
  | { type: 'trackEnded'; epoch: number; atHubTime: number; nextStarted: boolean }
  | { type: 'trackFailed'; epoch: number; trackId: string; reason: string }
  | { type: 'position'; epoch: number; frame: number; atHubTime: number }
  | { type: 'notice'; message: string }
  | { type: 'peerJoined'; peer: Peer }
  | { type: 'peerLeft'; id: string }
  | { type: 'peerStats'; id: string; stats: RearStats }
  | { type: 'libraryChanged' };

export interface ReduceContext {
  now: number;
  library: Library;
}

export const DEFAULT_REAR: RearSettings = { enabled: true, mode: 'difference', singleSide: 'L', gainDb: 0, delayMs: 15 };
export const DEFAULT_FRONT: FrontSettings = { volumeDb: 0, presentationDelayMs: DEFAULT_PRESENTATION_DELAY_MS };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function sanitizeRear(base: RearSettings, patch: Partial<RearSettings>): RearSettings {
  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    mode: patch.mode === 'difference' || patch.mode === 'wide' || patch.mode === 'single' ? patch.mode : base.mode,
    singleSide: patch.singleSide === 'L' || patch.singleSide === 'R' ? patch.singleSide : base.singleSide,
    gainDb: clamp(num(patch.gainDb, base.gainDb), -30, 6),
    delayMs: clamp(num(patch.delayMs, base.delayMs), 0, 50),
  };
}

export function sanitizeFront(base: FrontSettings, patch: Partial<FrontSettings>): FrontSettings {
  return {
    volumeDb: clamp(num(patch.volumeDb, base.volumeDb), -60, 0),
    presentationDelayMs: clamp(num(patch.presentationDelayMs, base.presentationDelayMs), 50, 500),
  };
}

export function initialHubState(prefs?: Partial<HubPrefs>): HubState {
  return {
    player: { queue: [], index: 0, status: 'stopped', epoch: 0, position: { frame: 0, atHubTime: null } },
    rear: sanitizeRear(DEFAULT_REAR, prefs?.rear ?? {}),
    front: sanitizeFront(DEFAULT_FRONT, prefs?.front ?? {}),
    peers: [],
    notice: null,
  };
}

/** Track frame currently being heard (estimated from the last reported position). */
export function currentFrame(p: PlayerState, now: number): number {
  if (p.status !== 'playing' || p.position.atHubTime === null) return p.position.frame;
  return p.position.frame + Math.max(0, Math.round(((now - p.position.atHubTime) * SAMPLE_RATE) / 1000));
}

function restart(p: PlayerState, patch: Partial<PlayerState> & { frame?: number }): PlayerState {
  const { frame = 0, ...rest } = patch;
  return { ...p, ...rest, epoch: p.epoch + 1, position: { frame, atHubTime: null } };
}

function stopped(p: PlayerState): PlayerState {
  return restart(p, { status: 'stopped', index: 0, queue: p.queue });
}

function withNotice(s: HubState, message: string): HubState {
  return { ...s, notice: { id: (s.notice?.id ?? 0) + 1, message } };
}

export function reduce(s: HubState, a: HubAction, ctx: ReduceContext): HubState {
  const p = s.player;
  switch (a.type) {
    case 'playAlbum': {
      const album = ctx.library.albums.find((al) => al.id === a.albumId);
      if (!album || a.startIndex < 0 || a.startIndex >= album.trackIds.length) return s;
      return { ...s, player: restart(p, { queue: [...album.trackIds], index: a.startIndex, status: 'playing' }) };
    }
    case 'playTrack': {
      const track = ctx.library.tracks[a.trackId];
      const album = track && ctx.library.albums.find((al) => al.id === track.albumId);
      if (!album) return s;
      return {
        ...s,
        player: restart(p, { queue: [...album.trackIds], index: album.trackIds.indexOf(a.trackId), status: 'playing' }),
      };
    }
    case 'play':
      if (p.status === 'playing' || p.queue.length === 0) return s;
      return { ...s, player: restart(p, { status: 'playing', frame: p.position.frame }) };
    case 'pause':
      if (p.status !== 'playing') return s;
      return { ...s, player: restart(p, { status: 'paused', frame: currentFrame(p, ctx.now) }) };
    case 'next':
      if (p.index + 1 >= p.queue.length) return s;
      return { ...s, player: restart(p, { index: p.index + 1, status: p.status === 'paused' ? 'paused' : 'playing' }) };
    case 'prev': {
      if (p.queue.length === 0) return s;
      const pastStart = currentFrame(p, ctx.now) > 3 * SAMPLE_RATE;
      const index = pastStart || p.index === 0 ? p.index : p.index - 1;
      return { ...s, player: restart(p, { index, status: p.status === 'paused' ? 'paused' : 'playing' }) };
    }
    case 'seek': {
      const track = ctx.library.tracks[p.queue[p.index]];
      if (!track) return s;
      const frame = clamp(Math.round(num(a.sec, 0) * SAMPLE_RATE), 0, Math.floor(track.durationSec * SAMPLE_RATE));
      return { ...s, player: restart(p, { frame, status: p.status === 'playing' ? 'playing' : 'paused' }) };
    }
    case 'setRear':
      return { ...s, rear: sanitizeRear(s.rear, a.patch) };
    case 'setFront':
      return { ...s, front: sanitizeFront(s.front, a.patch) };
    case 'trackEnded':
      if (a.epoch !== p.epoch) return s;
      if (p.index + 1 >= p.queue.length) return { ...s, player: stopped(p) };
      if (a.nextStarted) {
        // Gapless advance: the front engine already switched buffers, so the epoch is unchanged.
        return { ...s, player: { ...p, index: p.index + 1, position: { frame: 0, atHubTime: a.atHubTime } } };
      }
      // The next track was not ready in time (still decoding): start it as a new epoch.
      return { ...s, player: restart(p, { index: p.index + 1, status: 'playing' }) };
    case 'trackFailed': {
      if (a.epoch !== p.epoch) return s;
      const title = ctx.library.tracks[a.trackId]?.title ?? a.trackId;
      const next = withNotice(s, `Skipped "${title}": ${a.reason}`);
      if (p.index + 1 < p.queue.length) {
        return { ...next, player: restart(p, { index: p.index + 1, status: 'playing' }) };
      }
      return { ...next, player: stopped(p) };
    }
    case 'position':
      if (a.epoch !== p.epoch) return s;
      return { ...s, player: { ...p, position: { frame: a.frame, atHubTime: a.atHubTime } } };
    case 'notice':
      return withNotice(s, a.message);
    case 'peerJoined':
      return { ...s, peers: [...s.peers.filter((x) => x.id !== a.peer.id), a.peer] };
    case 'peerLeft':
      return { ...s, peers: s.peers.filter((x) => x.id !== a.id) };
    case 'peerStats':
      return { ...s, peers: s.peers.map((x) => (x.id === a.id ? { ...x, stats: a.stats } : x)) };
    case 'libraryChanged':
      if (p.queue.every((id) => ctx.library.tracks[id])) return s;
      return { ...s, player: restart(p, { queue: [], index: 0, status: 'stopped' }) };
  }
}
