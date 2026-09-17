export const APP_ID = 'aivplayer';
export const PROTOCOL_VERSION = 1;

export const SAMPLE_RATE = 48000;
export const CHUNK_FRAMES = 1024;

export const DEFAULT_BEACON_PORT = 47810;
export const DEFAULT_HUB_PORT = 47811;
export const BEACON_INTERVAL_MS = 2000;
export const BEACON_TTL_MS = 6000;
export const NO_BEACON_HINT_MS = 10000;

export const AUDIO_MAGIC = 0x41495631; // "AIV1"
export const AUDIO_HEADER_BYTES = 32;

export const FADE_MS = 20;
export const REAR_FADE_IN_MS = 50;
export const RAMP_MS = 30;
export const RESYNC_THRESHOLD_MS = 20;
export const MAX_CORRECTION_PPM = 500;
export const CONTROL_INTERVAL_MS = 500;

export const DEFAULT_PRESENTATION_DELAY_MS = 100;
export const LARGE_TRACK_SEC = 3600;
