import { afterEach, describe, expect, it } from 'vitest';
import { Hub } from '../../src/main/hub';
import { encodeAudioChunk, type AudioChunk } from '../../src/shared/protocol';
import type { HubPrefs, HubState, Library } from '../../src/shared/types';
import { HubClient, type LinkStatus } from '../../src/renderer/src/lib/hubClient';
import { makeLibrary } from '../helpers/library';
import { waitFor } from '../helpers/wait';

let hub: Hub | null = null;
const clients: HubClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.stop();
  await hub?.stop();
  hub = null;
});

async function startHub(extra: Partial<ConstructorParameters<typeof Hub>[0]> = {}): Promise<string> {
  hub = new Hub({ port: 0, host: '127.0.0.1', hubId: 'hub-1', pcName: 'STUDY-PC', library: makeLibrary(), ...extra });
  const port = await hub.start();
  return `ws://127.0.0.1:${port}`;
}

function connect(url: string, role: 'front' | 'rear', pcName = role.toUpperCase()) {
  const seen: { state: HubState | null; library: Library | null; audio: AudioChunk[]; status: LinkStatus[]; reason?: string } = {
    state: null, library: null, audio: [], status: [],
  };
  const c = new HubClient({ role, pcName }, {
    onState: (s) => (seen.state = s),
    onLibrary: (l) => (seen.library = l),
    onAudio: (a) => seen.audio.push(a),
    onStatus: (s, reason) => {
      seen.status.push(s);
      if (reason) seen.reason = reason;
    },
  });
  c.start(() => url);
  clients.push(c);
  return { c, seen };
}

describe('Hub', () => {
  it('welcomes clients with library and state, and lists peers', async () => {
    const url = await startHub();
    const front = connect(url, 'front', 'STUDY-PC');
    const rear = connect(url, 'rear', 'LOUNGE-PC');
    await waitFor(() => front.seen.state?.peers.length === 2 && rear.seen.library !== null);
    expect(front.seen.state!.peers.map((p) => [p.role, p.pcName]).sort()).toEqual([['front', 'STUDY-PC'], ['rear', 'LOUNGE-PC']]);
    expect(rear.seen.library!.albums[0].title).toBe('Ambient 4: On Land');
    rear.c.stop();
    await waitFor(() => front.seen.state?.peers.length === 1);
  });

  it('applies commands from any client and broadcasts state', async () => {
    const url = await startHub();
    const front = connect(url, 'front');
    const rear = connect(url, 'rear');
    await waitFor(() => front.seen.state?.peers.length === 2);
    rear.c.send({ type: 'playAlbum', albumId: 'onland', startIndex: 1 });
    await waitFor(() => front.seen.state?.player.status === 'playing');
    expect(front.seen.state!.player).toMatchObject({ index: 1, epoch: 1 });
  });

  it('rejects a protocol mismatch without reconnecting', async () => {
    const url = await startHub();
    const ws = new WebSocket(url);
    const msgs: string[] = [];
    let closeCode = 0;
    ws.onmessage = (e) => msgs.push(String(e.data));
    ws.onclose = (e) => (closeCode = e.code);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role: 'rear', pcName: 'OLD', protocolVersion: 99 }));
    await waitFor(() => closeCode !== 0);
    expect(closeCode).toBe(4001);
    expect(JSON.parse(msgs[0])).toMatchObject({ type: 'error' });
    expect(hub!.getState().peers).toEqual([]);
  });

  it('ignores commands before hello', async () => {
    const url = await startHub();
    const ws = new WebSocket(url);
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ type: 'playAlbum', albumId: 'onland', startIndex: 0 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(hub!.getState().player.status).toBe('stopped');
    ws.close();
  });

  it('answers pings so clients estimate the clock offset', async () => {
    let hubClockOffset = 5000;
    const url = await startHub({ now: () => performance.timeOrigin + performance.now() + hubClockOffset });
    const rear = connect(url, 'rear');
    await waitFor(() => rear.c.clock.ready);
    expect(Math.abs(rear.c.clock.offset - 5000)).toBeLessThan(20);
    expect(rear.c.clock.rttMs).toBeLessThan(50);
    hubClockOffset = 0;
  });

  it('relays binary audio from the front to rears only', async () => {
    const url = await startHub();
    const front = connect(url, 'front');
    const rear = connect(url, 'rear');
    const otherFront = connect(url, 'front', 'X');
    await waitFor(() => front.seen.state?.peers.length === 3);
    const chunk = { epoch: 1, frameIndex: 0, presentationTime: 123, frameCount: 2, channels: 2, samples: Float32Array.from([1, 2, 3, 4]) };
    front.c.sendBinary(encodeAudioChunk(chunk));
    rear.c.sendBinary(encodeAudioChunk({ ...chunk, frameIndex: 99 })); // rears may not inject audio
    await waitFor(() => rear.seen.audio.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(rear.seen.audio.map((a) => a.frameIndex)).toEqual([0]);
    expect(Array.from(rear.seen.audio[0].samples)).toEqual([1, 2, 3, 4]);
    expect(front.seen.audio).toEqual([]);
    expect(otherFront.seen.audio).toEqual([]);
  });

  it('records rear stats and reports prefs changes', async () => {
    const saved: HubPrefs[] = [];
    const url = await startHub({ onPrefsChanged: (p) => saved.push(p) });
    const front = connect(url, 'front');
    const rear = connect(url, 'rear');
    await waitFor(() => front.seen.state?.peers.length === 2);
    const stats = { state: 'playing' as const, syncErrorMs: 0.3, correctionPpm: -80, bufferMs: 95, rttMs: 0.4, timestampJitterMs: 0.8, underruns: 0, resyncs: 0 };
    rear.c.send({ type: 'rearStats', stats });
    rear.c.send({ type: 'setRear', patch: { mode: 'wide' } });
    await waitFor(() => front.seen.state?.rear.mode === 'wide');
    expect(front.seen.state!.peers.find((p) => p.role === 'rear')!.stats).toEqual(stats);
    expect(saved.at(-1)!.rear.mode).toBe('wide');
  });

  it('pushes a new library and stops playback of removed tracks', async () => {
    let rescans = 0;
    const url = await startHub({ onRescan: () => rescans++ });
    const front = connect(url, 'front');
    await waitFor(() => front.seen.state !== null);
    front.c.send({ type: 'playAlbum', albumId: 'onland', startIndex: 0 });
    front.c.send({ type: 'rescan' });
    await waitFor(() => rescans === 1 && front.seen.state?.player.status === 'playing');
    hub!.setLibrary({ albums: [], tracks: {} });
    await waitFor(() => front.seen.library?.albums.length === 0 && front.seen.state?.player.status === 'stopped');
  });

  it('rejects start() when the port is in use', async () => {
    const url = await startHub();
    const port = Number(new URL(url).port);
    const second = new Hub({ port, host: '127.0.0.1', hubId: 'h2', pcName: 'P', library: makeLibrary() });
    await expect(second.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});

describe('HubClient', () => {
  it('reconnects after the hub restarts', async () => {
    const url = await startHub();
    const port = Number(new URL(url).port);
    const rear = connect(url, 'rear');
    await waitFor(() => rear.c.status === 'open');
    await hub!.stop();
    await waitFor(() => rear.c.status !== 'open');
    hub = new Hub({ port, host: '127.0.0.1', hubId: 'hub-1', pcName: 'STUDY-PC', library: makeLibrary() });
    await hub.start();
    await waitFor(() => rear.c.status === 'open', 5000);
  });
});
