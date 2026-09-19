import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanLibrary } from '../../src/main/library';
import { makeFlac } from '../helpers/flac';
import { makeMp3 } from '../helpers/mp3';
import { makeWav } from '../helpers/wav';

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'aiv-lib-'));
  const onLand = join(root, 'Brian Eno', 'On Land');
  await mkdir(onLand, { recursive: true });
  const tags = (title: string, n: number) => ({
    TITLE: title, ARTIST: 'Brian Eno', ALBUMARTIST: 'Brian Eno', ALBUM: 'Ambient 4: On Land', TRACKNUMBER: String(n),
  });
  // written out of order to prove sorting by track number
  await writeFile(join(onLand, 'b.flac'), makeFlac({ seconds: 300, tags: tags('The Lost Day', 2) }));
  await writeFile(join(onLand, 'a.FLAC'), makeFlac({ seconds: 90.5, sampleRate: 44100, tags: tags('Lantern Marsh', 1) }));
  // Same album, reached through two other containers.
  await writeFile(
    join(onLand, 'c.mp3'),
    makeMp3({
      seconds: 120,
      tags: { TIT2: 'Tal Coat', TPE1: 'Brian Eno', TPE2: 'Brian Eno', TALB: 'Ambient 4: On Land', TRCK: '3' },
    }),
  );
  await writeFile(
    join(onLand, 'd.WAV'),
    // WAV's INFO chunk has no album-artist field, so the scanner falls back to the artist.
    makeWav({ seconds: 42.25, tags: { INAM: 'Shadow', IART: 'Brian Eno', IPRD: 'Ambient 4: On Land', ITRK: '4' } }),
  );
  await writeFile(join(onLand, 'cover.jpg'), 'not audio');
  await writeFile(join(onLand, 'skip.m4a'), 'a format Chromium cannot decode');
  await writeFile(join(root, 'untagged.flac'), makeFlac({ seconds: 10, tags: {} }));
  await writeFile(join(root, 'broken.flac'), 'this is not a flac file');
  return root;
}

describe('scanLibrary', () => {
  it('groups FLAC, MP3 and WAV into one album sorted by track number', async () => {
    const root = await fixture();
    const { library, errors } = await scanLibrary(root);
    const onLand = library.albums.find((a) => a.title === 'Ambient 4: On Land')!;
    expect(onLand.artist).toBe('Brian Eno');
    const titles = onLand.trackIds.map((id) => library.tracks[id].title);
    expect(titles).toEqual(['Lantern Marsh', 'The Lost Day', 'Tal Coat', 'Shadow']);
    const lantern = library.tracks[onLand.trackIds[0]];
    expect(lantern).toMatchObject({ trackNo: 1, sampleRate: 44100, albumId: onLand.id });
    expect(lantern.durationSec).toBeCloseTo(90.5, 2);
    expect(lantern.path.endsWith('a.FLAC')).toBe(true);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('broken.flac');

    const byTitle = Object.fromEntries(Object.values(library.tracks).map((t) => [t.title, t]));
    expect(byTitle['Tal Coat']).toMatchObject({ trackNo: 3, sampleRate: 44100 });
    expect(byTitle['Tal Coat'].durationSec).toBeCloseTo(120, 0);
    // Uppercase extensions count, and a format we cannot decode is left out entirely.
    expect(byTitle.Shadow).toMatchObject({ trackNo: 4, sampleRate: 44100 });
    expect(byTitle.Shadow.path.endsWith('d.WAV')).toBe(true);
    expect(Object.values(library.tracks).some((t) => t.path.endsWith('.m4a'))).toBe(false);
  });

  it('falls back to filename and unknown album for untagged files', async () => {
    const { library } = await scanLibrary(await fixture());
    const unknown = library.albums.find((a) => a.title === 'Unknown Album')!;
    expect(library.tracks[unknown.trackIds[0]]).toMatchObject({ title: 'untagged', artist: 'Unknown Artist' });
  });

  it('produces stable ids across scans', async () => {
    const root = await fixture();
    const a = await scanLibrary(root);
    const b = await scanLibrary(root);
    expect(Object.keys(b.library.tracks).sort()).toEqual(Object.keys(a.library.tracks).sort());
  });

  it('reports a missing folder as an error with an empty library', async () => {
    const { library, errors } = await scanLibrary(join(tmpdir(), 'definitely-missing-aiv-folder'));
    expect(library).toEqual({ albums: [], tracks: {} });
    expect(errors[0]).toContain('Cannot read');
  });
});

describe('makeFlac audio fixture', () => {
  it('writes frames that music-metadata accepts with the right duration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiv-audio-'));
    const tone = (n: number): [number, number] => [0.5 * Math.sin(n / 20), 0];
    await writeFile(join(root, 'tone.flac'), makeFlac({ seconds: 2.5, tags: { TITLE: 'Tone', ALBUM: 'Fixtures' }, audio: tone }));
    const { library, errors } = await scanLibrary(root);
    expect(errors).toEqual([]);
    const t = Object.values(library.tracks)[0];
    expect(t.title).toBe('Tone');
    expect(t.durationSec).toBeCloseTo(2.5, 3);
  });
});
