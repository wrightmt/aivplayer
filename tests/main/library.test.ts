import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanLibrary } from '../../src/main/library';
import { makeFlac } from '../helpers/flac';

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
  await writeFile(join(onLand, 'cover.jpg'), 'not audio');
  await writeFile(join(root, 'untagged.flac'), makeFlac({ seconds: 10, tags: {} }));
  await writeFile(join(root, 'broken.flac'), 'this is not a flac file');
  return root;
}

describe('scanLibrary', () => {
  it('groups tagged FLACs into albums sorted by track number', async () => {
    const root = await fixture();
    const { library, errors } = await scanLibrary(root);
    const onLand = library.albums.find((a) => a.title === 'Ambient 4: On Land')!;
    expect(onLand.artist).toBe('Brian Eno');
    const titles = onLand.trackIds.map((id) => library.tracks[id].title);
    expect(titles).toEqual(['Lantern Marsh', 'The Lost Day']);
    const lantern = library.tracks[onLand.trackIds[0]];
    expect(lantern).toMatchObject({ trackNo: 1, sampleRate: 44100, albumId: onLand.id });
    expect(lantern.durationSec).toBeCloseTo(90.5, 2);
    expect(lantern.path.endsWith('a.FLAC')).toBe(true);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('broken.flac');
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
