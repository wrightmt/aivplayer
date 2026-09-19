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

/** A rear PC waiting for the person at the front PC to allow or deny it. */
export interface PairingRequest {
  requestId: string;
  peerId: string;
  pcName: string;
  address: string;
  requestedAt: number;
}

/** A rear PC the front has already allowed. The token itself never leaves the front's disk. */
export interface PairedPeer {
  peerId: string;
  pcName: string;
  pairedAt: number;
}

export interface HubState {
  player: PlayerState;
  rear: RearSettings;
  front: FrontSettings;
  peers: Peer[];
  notice: Notice | null;
  /** Rear PCs awaiting approval. Shown only by the front's UI. */
  pending: PairingRequest[];
  /** Rear PCs already allowed, so the front can list and forget them. */
  paired: PairedPeer[];
}

export interface LocalSettings {
  role: Role | null;
  /** Stable per-install UUID: this PC's hub id when it is the front, its peer id when it is a rear. */
  hubId: string;
  outputDeviceId: string;
  libraryFolder: string | null;
  beaconPort: number;
  hubPort: number;
  pairedHubId: string | null;
  manualHubAddress: string | null;
  /** Rear only: the secret this PC was issued when the front allowed it. Cleared when the front changes. */
  pairToken: string | null;
}

/** Front only, persisted outside HubState so tokens are never broadcast. */
export interface PairedRecord {
  pcName: string;
  token: string;
  pairedAt: number;
}
export type PairedPeers = Record<string, PairedRecord>;

export interface HubPrefs {
  rear: RearSettings;
  front: FrontSettings;
}
