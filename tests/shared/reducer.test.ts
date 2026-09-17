import { describe, expect, it } from 'vitest';
import { currentFrame, initialHubState, reduce, type HubAction } from '../../src/shared/reducer';
import type { HubState } from '../../src/shared/types';
import { makeLibrary } from '../helpers/library';

const library = makeLibrary();
const run = (s: HubState, a: HubAction, now = 1000): HubState => reduce(s, a, { now, library });
const playing = (): HubState => run(initialHubState(), { type: 'playAlbum', albumId: 'onland', startIndex: 0 });

describe('initialHubState', () => {
  it('uses defaults and sanitizes saved prefs', () => {
    const s = initialHubState({ rear: { enabled: false, mode: 'wide', singleSide: 'R', gainDb: 99, delayMs: -5 } });
    expect(s.player).toEqual({ queue: [], index: 0, status: 'stopped', epoch: 0, position: { frame: 0, atHubTime: null } });
    expect(s.rear).toEqual({ enabled: false, mode: 'wide', singleSide: 'R', gainDb: 6, delayMs: 0 });
    expect(s.front).toEqual({ volumeDb: 0, presentationDelayMs: 100 });
  });
});

describe('playback commands', () => {
  it('playAlbum queues the album and starts a new epoch', () => {
    const s = run(initialHubState(), { type: 'playAlbum', albumId: 'onland', startIndex: 1 });
    expect(s.player).toMatchObject({ queue: ['t1', 't2', 't3'], index: 1, status: 'playing', epoch: 1 });
    expect(run(s, { type: 'playAlbum', albumId: 'nope', startIndex: 0 })).toBe(s);
    expect(run(s, { type: 'playAlbum', albumId: 'onland', startIndex: 3 })).toBe(s);
  });

  it('playTrack queues the containing album at that track', () => {
    const s = run(initialHubState(), { type: 'playTrack', trackId: 't3' });
    expect(s.player).toMatchObject({ queue: ['t1', 't2', 't3'], index: 2, status: 'playing', epoch: 1 });
  });

  it('pause captures the heard position; play resumes from it', () => {
    let s = playing();
    s = run(s, { type: 'position', epoch: 1, frame: 48000, atHubTime: 1000 });
    s = run(s, { type: 'pause' }, 3000);
    expect(s.player).toMatchObject({ status: 'paused', epoch: 2, position: { frame: 48000 * 3, atHubTime: null } });
    expect(run(s, { type: 'pause' })).toBe(s);
    s = run(s, { type: 'play' });
    expect(s.player).toMatchObject({ status: 'playing', epoch: 3, position: { frame: 48000 * 3, atHubTime: null } });
    expect(run(s, { type: 'play' })).toBe(s);
  });

  it('play does nothing with an empty queue', () => {
    const s = initialHubState();
    expect(run(s, { type: 'play' })).toBe(s);
  });

  it('next/prev move within the queue', () => {
    let s = playing();
    s = run(s, { type: 'next' });
    expect(s.player).toMatchObject({ index: 1, epoch: 2, status: 'playing' });
    s = run(run(s, { type: 'next' }), { type: 'next' });
    expect(s.player.index).toBe(2);
    s = run(s, { type: 'prev' });
    expect(s.player).toMatchObject({ index: 1, position: { frame: 0 } });
  });

  it('prev restarts the current track when more than 3 s in', () => {
    let s = run(playing(), { type: 'next' });
    s = run(s, { type: 'position', epoch: s.player.epoch, frame: 5 * 48000, atHubTime: 1000 });
    s = run(s, { type: 'prev' });
    expect(s.player).toMatchObject({ index: 1, position: { frame: 0 } });
  });

  it('seek clamps to the track and keeps playing/paused, stopped becomes paused', () => {
    let s = run(playing(), { type: 'seek', sec: 10 });
    expect(s.player).toMatchObject({ epoch: 2, status: 'playing', position: { frame: 480000 } });
    s = run(s, { type: 'seek', sec: 99999 });
    expect(s.player.position.frame).toBe(300 * 48000);
    s = run(s, { type: 'pause' });
    expect(run(s, { type: 'seek', sec: 1 }).player.status).toBe('paused');
    expect(run(initialHubState(), { type: 'seek', sec: 1 }).player.epoch).toBe(0);
  });
});

describe('engine reports', () => {
  it('trackEnded advances gaplessly without a new epoch', () => {
    const s = run(playing(), { type: 'trackEnded', epoch: 1, atHubTime: 5000, nextStarted: true });
    expect(s.player).toMatchObject({ index: 1, epoch: 1, position: { frame: 0, atHubTime: 5000 } });
  });

  it('trackEnded without a started next track restarts on the next track as a new epoch', () => {
    const s = run(playing(), { type: 'trackEnded', epoch: 1, atHubTime: 5000, nextStarted: false });
    expect(s.player).toMatchObject({ index: 1, epoch: 2, status: 'playing', position: { frame: 0, atHubTime: null } });
  });

  it('trackEnded on the last track stops with a new epoch', () => {
    let s = run(initialHubState(), { type: 'playAlbum', albumId: 'onland', startIndex: 2 });
    s = run(s, { type: 'trackEnded', epoch: 1, atHubTime: 5000, nextStarted: false });
    expect(s.player).toMatchObject({ status: 'stopped', index: 0, epoch: 2 });
  });

  it('ignores reports from a stale epoch', () => {
    const s = run(playing(), { type: 'next' });
    expect(run(s, { type: 'trackEnded', epoch: 1, atHubTime: 1, nextStarted: true })).toBe(s);
    expect(run(s, { type: 'position', epoch: 1, frame: 1, atHubTime: 1 })).toBe(s);
    expect(run(s, { type: 'trackFailed', epoch: 1, trackId: 't1', reason: 'x' })).toBe(s);
  });

  it('trackFailed skips to the next track with a notice', () => {
    const s = run(playing(), { type: 'trackFailed', epoch: 1, trackId: 't1', reason: 'decode error' });
    expect(s.player).toMatchObject({ index: 1, epoch: 2, status: 'playing' });
    expect(s.notice).toEqual({ id: 1, message: 'Skipped "Title t1": decode error' });
  });

  it('currentFrame extrapolates only while playing with a known start time', () => {
    let s = playing();
    expect(currentFrame(s.player, 9999)).toBe(0);
    s = run(s, { type: 'position', epoch: 1, frame: 100, atHubTime: 1000 });
    expect(currentFrame(s.player, 1500)).toBe(100 + 24000);
    expect(currentFrame(s.player, 500)).toBe(100);
  });
});

describe('settings, peers, notices, library', () => {
  it('setRear/setFront merge and clamp', () => {
    let s = run(initialHubState(), { type: 'setRear', patch: { mode: 'single', singleSide: 'R', delayMs: 80 } });
    expect(s.rear).toEqual({ enabled: true, mode: 'single', singleSide: 'R', gainDb: 0, delayMs: 50 });
    s = run(s, { type: 'setRear', patch: { mode: 'bogus' as never } });
    expect(s.rear.mode).toBe('single');
    s = run(s, { type: 'setFront', patch: { volumeDb: 5, presentationDelayMs: 10 } });
    expect(s.front).toEqual({ volumeDb: 0, presentationDelayMs: 50 });
  });

  it('tracks peers and their stats', () => {
    const peer = { id: 'p1', role: 'rear' as const, pcName: 'LOUNGE', connectedAt: 1, stats: null };
    let s = run(initialHubState(), { type: 'peerJoined', peer });
    const stats = { state: 'playing' as const, syncErrorMs: 0.2, correctionPpm: 40, bufferMs: 90, rttMs: 1, timestampJitterMs: 0.5, underruns: 0, resyncs: 0 };
    s = run(s, { type: 'peerStats', id: 'p1', stats });
    expect(s.peers).toEqual([{ ...peer, stats }]);
    expect(run(s, { type: 'peerLeft', id: 'p1' }).peers).toEqual([]);
  });

  it('notices get increasing ids', () => {
    const s = run(run(initialHubState(), { type: 'notice', message: 'a' }), { type: 'notice', message: 'b' });
    expect(s.notice).toEqual({ id: 2, message: 'b' });
  });

  it('libraryChanged stops playback when a queued track disappears', () => {
    const s = playing();
    expect(run(s, { type: 'libraryChanged' })).toBe(s);
    const smaller = { ...library, tracks: { t1: library.tracks.t1 } };
    const after = reduce(s, { type: 'libraryChanged' }, { now: 0, library: smaller });
    expect(after.player).toMatchObject({ queue: [], status: 'stopped', epoch: 2 });
  });
});
