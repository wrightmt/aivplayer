/**
 * Minimal MP3 writer for tests: an ID3v2.3 tag followed by constant-bitrate MPEG-1 Layer III
 * frames whose payloads are silence. The first frame carries an Info (CBR Xing) header so the
 * duration can be read from the frame count rather than by decoding.
 */
export interface Mp3Options {
  sampleRate?: 44100 | 48000 | 32000;
  seconds: number;
  /** ID3v2.3 text frame ids: TIT2 title, TPE1 artist, TALB album, TPE2 album artist, TRCK track. */
  tags: Record<string, string>;
}

const SAMPLES_PER_FRAME = 1152; // MPEG-1 Layer III
const BITRATE = 128_000;
const SAMPLE_RATE_INDEX: Record<number, number> = { 44100: 0, 48000: 1, 32000: 2 };
const BITRATE_INDEX = 9; // 128 kbps in the MPEG-1 Layer III table
/** Bytes of side information before the Xing/Info tag, for MPEG-1 stereo. */
const SIDE_INFO_BYTES = 32;

/** ID3v2 sizes are synchsafe: 7 bits per byte, so the size can never look like a frame sync. */
function synchsafe(n: number): Buffer {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

function id3(tags: Record<string, string>): Buffer {
  const frames = Object.entries(tags).map(([id, value]) => {
    const payload = Buffer.concat([Buffer.from([0x00]), Buffer.from(value, 'latin1')]); // ISO-8859-1
    const header = Buffer.alloc(10);
    header.write(id, 0, 'ascii');
    header.writeUInt32BE(payload.length, 4); // v2.3 frame sizes are plain big-endian
    return Buffer.concat([header, payload]);
  });
  const body = Buffer.concat(frames);
  const header = Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.from([0x03, 0x00, 0x00]), synchsafe(body.length)]);
  return Buffer.concat([header, body]);
}

function frameHeader(sampleRate: number): Buffer {
  return Buffer.from([
    0xff,
    0xfb, // sync, MPEG-1, Layer III, no CRC
    (BITRATE_INDEX << 4) | (SAMPLE_RATE_INDEX[sampleRate] << 2), // no padding, not private
    0x00, // stereo, no emphasis
  ]);
}

export function makeMp3(opts: Mp3Options): Buffer {
  const sampleRate = opts.sampleRate ?? 44100;
  const frameBytes = Math.floor((144 * BITRATE) / sampleRate); // 417 at 44.1 kHz
  const frameCount = Math.max(1, Math.round((opts.seconds * sampleRate) / SAMPLES_PER_FRAME));

  const header = frameHeader(sampleRate);
  const frames: Buffer[] = [];
  for (let i = 0; i < frameCount; i++) {
    const frame = Buffer.alloc(frameBytes);
    header.copy(frame, 0);
    if (i === 0) {
      // Info = the CBR spelling of the Xing header. Flags 0x03 = frame count + byte count present.
      const tag = Buffer.alloc(16);
      tag.write('Info', 0, 'ascii');
      tag.writeUInt32BE(0x03, 4);
      tag.writeUInt32BE(frameCount, 8);
      tag.writeUInt32BE(frameCount * frameBytes, 12);
      tag.copy(frame, 4 + SIDE_INFO_BYTES);
    }
    frames.push(frame);
  }
  return Buffer.concat([id3(opts.tags), ...frames]);
}
