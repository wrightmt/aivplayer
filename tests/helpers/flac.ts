/**
 * Minimal FLAC writer for tests and fixtures: STREAMINFO + VORBIS_COMMENT, plus optional audio
 * written as uncompressed VERBATIM subframes (16-bit stereo). Without `audio` the file has
 * metadata only, which is enough for music-metadata to read tags and duration.
 */
export interface FlacOptions {
  sampleRate?: 44100 | 48000;
  seconds: number;
  tags: Record<string, string>;
  /** Stereo sample in [-1, 1] for frame n. */
  audio?: (n: number) => [number, number];
}

const BLOCK = 4096;

function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** FLAC's UTF-8-style variable-length frame number. */
function utf8Number(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x800) return [0xc0 | (n >> 6), 0x80 | (n & 0x3f)];
  if (n < 0x10000) return [0xe0 | (n >> 12), 0x80 | ((n >> 6) & 0x3f), 0x80 | (n & 0x3f)];
  return [0xf0 | (n >> 18), 0x80 | ((n >> 12) & 0x3f), 0x80 | ((n >> 6) & 0x3f), 0x80 | (n & 0x3f)];
}

function frame(index: number, start: number, count: number, sampleRate: number, audio: (n: number) => [number, number]): Buffer {
  const header = [0xff, 0xf8, 0x70 | (sampleRate === 48000 ? 0x0a : 0x09), 0x18, ...utf8Number(index), ((count - 1) >> 8) & 255, (count - 1) & 255];
  header.push(crc8(Uint8Array.from(header)));
  const body = Buffer.alloc(2 * (1 + count * 2));
  const clip = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  let o = 0;
  for (let ch = 0; ch < 2; ch++) {
    body[o++] = 0x02; // VERBATIM subframe, no wasted bits
    for (let i = 0; i < count; i++) {
      body.writeInt16BE(clip(audio(start + i)[ch]), o);
      o += 2;
    }
  }
  const withoutCrc = Buffer.concat([Buffer.from(header), body.subarray(0, o)]);
  const footer = Buffer.alloc(2);
  footer.writeUInt16BE(crc16(withoutCrc));
  return Buffer.concat([withoutCrc, footer]);
}

export function makeFlac(opts: FlacOptions): Buffer {
  const sampleRate = opts.sampleRate ?? 48000;
  const total = Math.round(opts.seconds * sampleRate);

  const info = Buffer.alloc(34);
  info.writeUInt16BE(BLOCK, 0); // min block size
  info.writeUInt16BE(BLOCK, 2); // max block size
  // bytes 4..9: min/max frame size (0 = unknown)
  // 20 bits sample rate | 3 bits channels-1 | 5 bits bps-1 | 36 bits total samples
  let packed = BigInt(sampleRate);
  packed = (packed << 3n) | 1n;
  packed = (packed << 5n) | 15n;
  packed = (packed << 36n) | BigInt(total);
  for (let i = 0; i < 8; i++) info[10 + i] = Number((packed >> BigInt(8 * (7 - i))) & 0xffn);
  // bytes 18..33: MD5 of audio (zeros = not computed)

  const u32le = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const vendor = Buffer.from('aiv-test');
  const comments = Object.entries(opts.tags).map(([k, v]) => Buffer.from(`${k}=${v}`, 'utf8'));
  const vorbis = Buffer.concat([u32le(vendor.length), vendor, u32le(comments.length), ...comments.flatMap((c) => [u32le(c.length), c])]);

  const blockHeader = (type: number, last: boolean, length: number) =>
    Buffer.from([(last ? 0x80 : 0) | type, (length >> 16) & 255, (length >> 8) & 255, length & 255]);

  const parts: Uint8Array[] = [Buffer.from('fLaC'), blockHeader(0, false, 34), info, blockHeader(4, true, vorbis.length), vorbis];
  if (opts.audio) {
    for (let start = 0, index = 0; start < total; start += BLOCK, index++) {
      parts.push(frame(index, start, Math.min(BLOCK, total - start), sampleRate, opts.audio));
    }
  }
  return Buffer.concat(parts);
}
