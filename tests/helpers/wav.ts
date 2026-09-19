/**
 * Minimal RIFF/WAVE writer for tests: fmt + data, plus a LIST/INFO chunk for tags.
 * The audio is silence — the scanner only ever reads tags, duration and sample rate.
 */
export interface WavOptions {
  sampleRate?: number;
  seconds: number;
  /** RIFF INFO ids: INAM title, IART artist, IPRD album, ITRK track number. */
  tags: Record<string, string>;
  channels?: number;
  bitsPerSample?: number;
}

/** A RIFF chunk: 4-byte id, little-endian size, payload padded to an even length. */
function chunk(id: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(id, 0, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  const pad = payload.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([header, payload, pad]);
}

export function makeWav(opts: WavOptions): Buffer {
  const sampleRate = opts.sampleRate ?? 44100;
  const channels = opts.channels ?? 2;
  const bits = opts.bitsPerSample ?? 16;
  const frames = Math.round(opts.seconds * sampleRate);
  const blockAlign = (channels * bits) / 8;

  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); // PCM
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * blockAlign, 8); // byte rate
  fmt.writeUInt16LE(blockAlign, 12);
  fmt.writeUInt16LE(bits, 14);

  const parts = [chunk('fmt ', fmt)];

  const entries = Object.entries(opts.tags);
  if (entries.length > 0) {
    // LIST/INFO holds NUL-terminated strings, each in its own sub-chunk.
    const info = entries.map(([id, value]) => chunk(id, Buffer.from(`${value}\0`, 'latin1')));
    parts.push(chunk('LIST', Buffer.concat([Buffer.from('INFO', 'ascii'), ...info])));
  }

  parts.push(chunk('data', Buffer.alloc(frames * blockAlign)));

  const body = Buffer.concat([Buffer.from('WAVE', 'ascii'), ...parts]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}
