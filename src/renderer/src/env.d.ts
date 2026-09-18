/// <reference types="svelte" />
/// <reference types="vite/client" />
import type { AivApi } from '../../shared/ipc';

declare global {
  interface Window {
    aiv: AivApi;
  }

  // Chromium supports output-device selection on AudioContext; TypeScript's DOM lib lacks it.
  interface AudioContext {
    readonly sinkId: string;
    setSinkId(sinkId: string): Promise<void>;
  }
}
