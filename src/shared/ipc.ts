import type { DiscoveryStatus } from './beacon';
import type { LocalSettings } from './types';

export const IPC = {
  getInfo: 'aiv:getInfo',
  getSettings: 'aiv:getSettings',
  saveSettings: 'aiv:saveSettings',
  chooseLibraryFolder: 'aiv:chooseLibraryFolder',
  readTrack: 'aiv:readTrack',
  getFrontStatus: 'aiv:getFrontStatus',
  frontStatusChanged: 'aiv:frontStatusChanged',
  getDiscovery: 'aiv:getDiscovery',
  discoveryChanged: 'aiv:discoveryChanged',
} as const;

export type FrontStatus =
  | { kind: 'starting' }
  | { kind: 'ready'; hubUrl: string }
  | { kind: 'error'; message: string };

export interface AppInfo {
  pcName: string;
  version: string;
}

/** API exposed to the renderer as `window.aiv` by the preload script. */
export interface AivApi {
  getInfo(): Promise<AppInfo>;
  getSettings(): Promise<LocalSettings>;
  /** Saves and returns merged settings. Changing role or ports relaunches the app. */
  saveSettings(patch: Partial<LocalSettings>): Promise<LocalSettings>;
  chooseLibraryFolder(): Promise<string | null>;
  /** Front only: raw FLAC bytes for a library track. */
  readTrack(trackId: string): Promise<ArrayBuffer>;
  getFrontStatus(): Promise<FrontStatus>;
  onFrontStatus(cb: (s: FrontStatus) => void): () => void;
  getDiscovery(): Promise<DiscoveryStatus>;
  onDiscovery(cb: (d: DiscoveryStatus) => void): () => void;
}
