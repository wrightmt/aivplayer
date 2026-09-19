export const APP_ID = 'aivplayer';
// v2 added pairing: `hello` carries peerId/token and remote rears must be approved at the front.
export const PROTOCOL_VERSION = 2;

/**
 * Extensions the library scanner picks up. Electron decodes all of these natively, so a format
 * may only be added here once Chromium can actually play it — ALAC in .m4a, for instance, cannot.
 */
export const AUDIO_EXTENSIONS = ['.flac', '.mp3', '.wav'] as const;
/** The same list as UI copy. */
export const AUDIO_FORMATS_LABEL = 'FLAC, MP3 or WAV';

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

/** How long an unapproved rear is held before the hub gives up and closes it. */
export const PAIRING_TIMEOUT_MS = 60_000;
/** Minimum gap between prompts for the same peer, so a hostile client cannot spam the front's screen. */
export const PAIRING_COOLDOWN_MS = 30_000;

export const DEFAULT_PRESENTATION_DELAY_MS = 100;
export const LARGE_TRACK_SEC = 3600;
