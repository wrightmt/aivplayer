import { afterEach, describe, expect, it } from 'vitest';
import { Hub } from '../../src/main/hub';
import { PAIRING_TIMEOUT_MS } from '../../src/shared/constants';
import { encodeAudioChunk, type AudioChunk } from '../../src/shared/protocol';
import type { HubPrefs, HubState, Library, PairedPeers } from '../../src/shared/types';
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

function connect(url: string, role: 'front' | 'rear', pcName = role.toUpperCase(), hello: { peerId?: string; token?: string } = {}) {
  const seen: {
    state: HubState | null; library: Library | null; audio: AudioChunk[]; status: LinkStatus[];
    reason?: string; token?: string;
  } = { state: null, library: null, audio: [], status: [] };
  const c = new HubClient({ role, pcName, peerId: hello.peerId ?? `peer-${pcName}`, token: hello.token }, {
    onPaired: (t) => (seen.token = t),
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
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role: 'rear', pcName: 'OLD', peerId: 'p', protocolVersion: 99 }));
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

describe('Hub pairing', () => {
  /** Starts a hub that treats every connection as if it came from another PC on the LAN. */
  const startRemoteHub = (extra: Partial<ConstructorParameters<typeof Hub>[0]> = {}) =>
    startHub({ isLocalAddress: () => false, ...extra });

  it('holds an unknown rear until the front allows it, then issues a token', async () => {
    const saved: PairedPeers[] = [];
    const url = await startRemoteHub({ onPairedChanged: (p) => saved.push(p) });
    const rear = connect(url, 'rear', 'LEFTY', { peerId: 'peer-1' });
    await waitFor(() => rear.c.status === 'awaiting');
    // Nothing is handed over before approval.
    expect(rear.seen.library).toBeNull();
    expect(rear.seen.state).toBeNull();
    expect(hub!.getState().peers).toEqual([]);
    const request = hub!.getState().pending[0];
    expect(request).toMatchObject({ peerId: 'peer-1', pcName: 'LEFTY' });

    hub!['approvePairing'](request.requestId);
    await waitFor(() => rear.c.status === 'open' && rear.seen.library !== null);
    expect(rear.seen.token).toMatch(/^[0-9a-f]{64}$/);
    expect(hub!.getState().pending).toEqual([]);
    expect(hub!.getState().paired).toEqual([{ peerId: 'peer-1', pcName: 'LEFTY', pairedAt: expect.any(Number) }]);
    expect(saved.at(-1)!['peer-1'].token).toBe(rear.seen.token);
  });

  it('lets a rear back in silently once it holds the token', async () => {
    const paired = { 'peer-1': { pcName: 'LEFTY', token: 'a'.repeat(64), pairedAt: 1 } };
    const url = await startRemoteHub({ paired });
    const rear = connect(url, 'rear', 'LEFTY', { peerId: 'peer-1', token: 'a'.repeat(64) });
    await waitFor(() => rear.c.status === 'open' && rear.seen.library !== null);
    expect(hub!.getState().pending).toEqual([]);
    expect(rear.seen.token).toBeUndefined();
  });

  it('prompts again when the token is wrong', async () => {
    const paired = { 'peer-1': { pcName: 'LEFTY', token: 'a'.repeat(64), pairedAt: 1 } };
    const url = await startRemoteHub({ paired });
    const rear = connect(url, 'rear', 'LEFTY', { peerId: 'peer-1', token: 'b'.repeat(64) });
    await waitFor(() => hub!.getState().pending.length === 1);
    expect(rear.c.status).toBe('awaiting');
  });

  it('refuses a denied rear for a cooldown, and stops it reconnecting', async () => {
    const url = await startRemoteHub();
    const rear = connect(url, 'rear', 'LEFTY', { peerId: 'peer-1' });
    await waitFor(() => hub!.getState().pending.length === 1);
    hub!['denyPairing'](hub!.getState().pending[0].requestId);
    await waitFor(() => rear.c.status === 'rejected');
    expect(rear.seen.reason).toContain('declined');
    expect(hub!.getState().pending).toEqual([]);

    // A second attempt inside the cooldown is turned away without bothering the front again.
    const again = connect(url, 'rear', 'LEFTY', { peerId: 'peer-1' });
    await waitFor(() => again.c.status === 'rejected');
    expect(hub!.getState().pending).toEqual([]);
  });

  it('will not let a remote PC claim to be the front', async () => {
    const url = await startRemoteHub();
    const impostor = connect(url, 'front', 'EVIL', { peerId: 'peer-evil' });
    await waitFor(() => impostor.c.status === 'rejected');
    expect(impostor.seen.reason).toContain('Only this PC can be the front');
    expect(hub!.getState().peers).toEqual([]);
    expect(hub!.getState().pending).toEqual([]);
  });

  it('ignores approvals sent by a remote PC', async () => {
    const paired = { 'peer-1': { pcName: 'LEFTY', token: 'a'.repeat(64), pairedAt: 1 } };
    const url = await startRemoteHub({ paired });
    const rear = connect(url, 'rear', 'LEFTY', { peerId: 'peer-1', token: 'a'.repeat(64) });
    await waitFor(() => rear.c.status === 'open');
    const intruder = connect(url, 'rear', 'EVIL', { peerId: 'peer-evil' });
    await waitFor(() => hub!.getState().pending.length === 1);
    const requestId = hub!.getState().pending[0].requestId;

    rear.c.send({ type: 'approvePairing', requestId });
    await new Promise((r) => setTimeout(r, 80));
    expect(hub!.getState().pending).toHaveLength(1);
    expect(intruder.seen.library).toBeNull();
  });

  it('forgets a peer and drops its live connection', async () => {
    const paired = { 'peer-1': { pcName: 'LEFTY', token: 'a'.repeat(64), pairedAt: 1 } };
    const url = await startHub({ isLocalAddress: (a) => a === 'never', paired });
    const rear = connect(url, 'rear', 'LEFTY', { peerId: 'peer-1', token: 'a'.repeat(64) });
    await waitFor(() => rear.c.status === 'open');
    hub!['forgetPeer']('peer-1');
    await waitFor(() => rear.c.status === 'rejected');
    expect(hub!.getState().paired).toEqual([]);
  });

  it('turns away a browser page from another origin', async () => {
    const url = await startRemoteHub();
    const ws = new WebSocket(url, { headers: { origin: 'https://evil.example' } } as never);
    let closeCode = 0;
    ws.onclose = (e) => (closeCode = e.code);
    await waitFor(() => closeCode !== 0);
    expect(closeCode).toBe(4003);
  });

  it('gives up on a request nobody answers', async () => {
    let clock = 1_000_000;
    const url = await startRemoteHub({ now: () => clock });
    const rear = connect(url, 'rear', 'LEFTY', { peerId: 'peer-1' });
    await waitFor(() => hub!.getState().pending.length === 1);
    clock += PAIRING_TIMEOUT_MS + 1;
    await waitFor(() => rear.c.status === 'rejected', 5000);
    expect(hub!.getState().pending).toEqual([]);
    expect(rear.seen.reason).toContain('No answer');
  });
});
