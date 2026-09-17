import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parseFile } from 'music-metadata';
import type { Album, Library, Track } from '../shared/types';

const id = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 16);

async function findFlacs(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await findFlacs(full, out);
    else if (e.isFile() && extname(e.name).toLowerCase() === '.flac') out.push(full);
  }
  return out;
}

export interface ScanResult {
  library: Library;
  errors: string[];
}

export async function scanLibrary(folder: string): Promise<ScanResult> {
  const errors: string[] = [];
  const tracks: Track[] = [];
  const covers = new Map<string, string>();
  const albumArtists = new Map<string, string>();
  let files: string[];
  try {
    files = await findFlacs(folder);
  } catch (e) {
    return { library: { albums: [], tracks: {} }, errors: [`Cannot read ${folder}: ${(e as Error).message}`] };
  }

  for (const path of files) {
    try {
      const { common, format } = await parseFile(path, { duration: true });
      const albumArtist = common.albumartist ?? common.artist ?? 'Unknown Artist';
      const album = common.album ?? 'Unknown Album';
      const albumId = id(`${albumArtist}|${album}`);
      albumArtists.set(albumId, albumArtist);
      tracks.push({
        id: id(path),
        path,
        title: common.title ?? basename(path, extname(path)),
        artist: common.artist ?? albumArtist,
        album,
        albumId,
        trackNo: common.track.no ?? 0,
        discNo: common.disk.no ?? 1,
        durationSec: format.duration ?? 0,
        sampleRate: format.sampleRate ?? 0,
      });
      const pic = common.picture?.[0];
      if (pic && !covers.has(albumId)) {
        covers.set(albumId, `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`);
      }
    } catch (e) {
      errors.push(`${path}: ${(e as Error).message}`);
    }
  }

  tracks.sort((a, b) => a.discNo - b.discNo || a.trackNo - b.trackNo || a.path.localeCompare(b.path));
  const albums = new Map<string, Album>();
  for (const t of tracks) {
    let al = albums.get(t.albumId);
    if (!al) {
      al = {
        id: t.albumId,
        title: t.album,
        artist: albumArtists.get(t.albumId) ?? t.artist,
        trackIds: [],
        coverDataUrl: covers.get(t.albumId) ?? null,
      };
      albums.set(t.albumId, al);
    }
    al.trackIds.push(t.id);
  }
  const albumList = [...albums.values()].sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
  return { library: { albums: albumList, tracks: Object.fromEntries(tracks.map((t) => [t.id, t])) }, errors };
}
