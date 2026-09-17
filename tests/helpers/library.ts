import type { Library, Track } from '../../src/shared/types';

export function makeTrack(id: string, albumId: string, trackNo: number, durationSec = 300): Track {
  return {
    id,
    path: `C:\\Music\\${albumId}\\${id}.flac`,
    title: `Title ${id}`,
    artist: 'Brian Eno',
    album: `Album ${albumId}`,
    albumId,
    trackNo,
    discNo: 1,
    durationSec,
    sampleRate: 44100,
  };
}

/** Album "onland" with tracks t1..t3, album "other" with track o1. */
export function makeLibrary(): Library {
  const tracks = [
    makeTrack('t1', 'onland', 1),
    makeTrack('t2', 'onland', 2),
    makeTrack('t3', 'onland', 3),
    makeTrack('o1', 'other', 1),
  ];
  return {
    albums: [
      { id: 'onland', title: 'Ambient 4: On Land', artist: 'Brian Eno', trackIds: ['t1', 't2', 't3'], coverDataUrl: null },
      { id: 'other', title: 'Other', artist: 'Someone', trackIds: ['o1'], coverDataUrl: null },
    ],
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
  };
}
