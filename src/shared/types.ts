export type Role = 'front' | 'rear';
export type RearMode = 'difference' | 'wide' | 'single';
export type Side = 'L' | 'R';
export type PlayerStatus = 'playing' | 'paused' | 'stopped';

export interface Track {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  trackNo: number;
  discNo: number;
  durationSec: number;
  sampleRate: number;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  trackIds: string[];
  coverDataUrl: string | null;
}

export interface Library {
  albums: Album[];
  tracks: Record<string, Track>;
}

export interface RearSettings {
  enabled: boolean;
  mode: RearMode;
  singleSide: Side;
  gainDb: number;
  delayMs: number;
}

export interface FrontSettings {
  volumeDb: number;
  presentationDelayMs: number;
}

export interface PlayerState {
  queue: string[];
  index: number;
  status: PlayerStatus;
  epoch: number;
  /** Track frame that was heard at atHubTime (null = not yet started). */
  position: { frame: number; atHubTime: number | null };
}

export interface RearStats {
  state: 'idle' | 'priming' | 'playing';
  syncErrorMs: number;
  correctionPpm: number;
  bufferMs: number;
  rttMs: number;
  /** RMS jitter of the rear sound card's output timestamps (before filtering). */
  timestampJitterMs: number;
  underruns: number;
  resyncs: number;
}

export interface Peer {
  id: string;
  role: Role;
  pcName: string;
  connectedAt: number;
  stats: RearStats | null;
}

export interface Notice {
  id: number;
  message: string;
}

export interface HubState {
  player: PlayerState;
  rear: RearSettings;
  front: FrontSettings;
  peers: Peer[];
  notice: Notice | null;
}

export interface LocalSettings {
  role: Role | null;
  hubId: string;
  outputDeviceId: string;
  libraryFolder: string | null;
  beaconPort: number;
  hubPort: number;
  pairedHubId: string | null;
  manualHubAddress: string | null;
}

export interface HubPrefs {
  rear: RearSettings;
  front: FrontSettings;
}
