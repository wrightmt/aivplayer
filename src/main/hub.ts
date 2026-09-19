import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { PAIRING_COOLDOWN_MS, PAIRING_TIMEOUT_MS, PROTOCOL_VERSION } from '../shared/constants';
import { parseClientMessage, type ClientMessage, type HubMessage } from '../shared/protocol';
import { initialHubState, reduce, type HubAction } from '../shared/reducer';
import type { HubPrefs, HubState, Library, PairedPeer, PairedPeers, PairingRequest, Role } from '../shared/types';

export interface HubOptions {
  port: number;
  host?: string;
  hubId: string;
  pcName: string;
  library: Library;
  prefs?: Partial<HubPrefs>;
  /** Rear PCs allowed on an earlier run, keyed by peer id. */
  paired?: PairedPeers;
  onPrefsChanged?: (prefs: HubPrefs) => void;
  onPairedChanged?: (paired: PairedPeers) => void;
  onRescan?: () => void;
  now?: () => number;
  /**
   * Whether a connection comes from this very PC, and so needs no approval and may act as the
   * front. Defaults to a loopback-address test; tests override it to simulate a remote peer.
   */
  isLocalAddress?: (address: string | undefined) => boolean;
}

interface ClientInfo {
  id: string;
  role: Role;
  pcName: string;
  /** Stable install id of the PC on the other end; '' for our own window. */
  peerId: string;
}

/** One socket, admitted or not. `info` is set only once the connection is allowed to take part. */
interface Conn {
  address: string;
  local: boolean;
  lastSeen: number;
  info: ClientInfo | null;
  pending: PairingRequest | null;
}

/** Drop audio to a rear whose socket is this far behind rather than grow latency unbounded. */
const MAX_REAR_BUFFERED_BYTES = 2 * 1024 * 1024;

/** How long a registered client may go without a message before it is considered dead. */
const LIVENESS_TIMEOUT_MS = 6000;
const LIVENESS_SWEEP_MS = 2000;

const LOOPBACK = /^(::1|::ffff:127(\.\d{1,3}){3}|127(\.\d{1,3}){3})$/;
const isLoopback = (address: string | undefined): boolean => !!address && LOOPBACK.test(address);

/**
 * Origins our own windows present. Electron sends `file://` from a packaged build and
 * `http://localhost:<port>` in dev; Node clients send no Origin at all. A web page loaded from
 * anywhere else sends its own origin and is turned away — WebSocket is not same-origin protected,
 * so without this a malicious page on the LAN could reach the hub.
 */
const ALLOWED_ORIGIN = /^(null|file:\/\/|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

/** Constant-time token comparison, safe on differing lengths. */
function tokenMatches(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export class Hub {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<WebSocket, Conn>();
  private state: HubState;
  private library: Library;
  private readonly now: () => number;
  private readonly isLocalAddress: (address: string | undefined) => boolean;
  private paired: PairedPeers;
  /** peerId → when the person at the front last said no, so a refused peer cannot spam the screen. */
  private readonly deniedAt = new Map<string, number>();
  private livenessTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: HubOptions) {
    this.library = opts.library;
    this.now = opts.now ?? (() => performance.timeOrigin + performance.now());
    this.isLocalAddress = opts.isLocalAddress ?? isLoopback;
    this.paired = { ...(opts.paired ?? {}) };
    this.state = { ...initialHubState(opts.prefs), paired: this.pairedList() };
  }

  getState(): HubState {
    return this.state;
  }

  private pairedList(): PairedPeer[] {
    return Object.entries(this.paired)
      .map(([peerId, r]) => ({ peerId, pcName: r.pcName, pairedAt: r.pairedAt }))
      .sort((a, b) => a.pairedAt - b.pairedAt);
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port: this.opts.port, host: this.opts.host, perMessageDeflate: false });
      wss.once('error', reject);
      wss.once('listening', () => {
        wss.off('error', reject);
        this.livenessTimer = setInterval(() => this.sweep(), LIVENESS_SWEEP_MS);
        const addr = wss.address();
        resolve(typeof addr === 'object' && addr ? addr.port : this.opts.port);
      });
      wss.on('connection', (ws, req) => this.onConnection(ws, req));
      this.wss = wss;
    });
  }

  async stop(): Promise<void> {
    if (this.livenessTimer) clearInterval(this.livenessTimer);
    this.livenessTimer = null;
    for (const ws of this.clients.keys()) ws.terminate();
    this.clients.clear();
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
    this.wss = null;
  }

  private sweep(): void {
    const now = this.now();
    for (const [ws, conn] of this.clients) {
      if (conn.info && conn.lastSeen < now - LIVENESS_TIMEOUT_MS) {
        ws.terminate();
      } else if (conn.pending && conn.pending.requestedAt < now - PAIRING_TIMEOUT_MS) {
        this.resolvePending(ws, conn, `No answer at ${this.opts.pcName}. Ask again when someone is at that PC.`);
      }
    }
  }

  setLibrary(library: Library): void {
    this.library = library;
    this.broadcast({ type: 'library', library });
    this.dispatch({ type: 'libraryChanged' });
  }

  dispatch(action: HubAction): void {
    const prev = this.state;
    this.state = reduce(prev, action, { now: this.now(), library: this.library });
    if (this.state === prev) return;
    if (this.state.rear !== prev.rear || this.state.front !== prev.front) {
      this.opts.onPrefsChanged?.({ rear: this.state.rear, front: this.state.front });
    }
    this.broadcast({ type: 'state', state: this.state });
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const address = req.socket.remoteAddress ?? '';
    const local = this.isLocalAddress(address);
    const origin = req.headers.origin;
    // Only remote connections are origin-checked: our own window is trusted by address already.
    if (!local && origin !== undefined && !ALLOWED_ORIGIN.test(origin)) {
      this.send(ws, { type: 'error', reason: 'This kind of client cannot connect to aIVplayer.' });
      ws.close(4003, 'origin not allowed');
      return;
    }
    this.clients.set(ws, { address, local, lastSeen: this.now(), info: null, pending: null });
    ws.on('message', (data, isBinary) => this.onMessage(ws, data, isBinary));
    ws.on('close', () => {
      const conn = this.clients.get(ws);
      this.clients.delete(ws);
      if (conn?.pending) this.dispatch({ type: 'pairingResolved', requestId: conn.pending.requestId });
      if (conn?.info) this.dispatch({ type: 'peerLeft', id: conn.info.id });
    });
    ws.on('error', () => ws.terminate());
  }

  private onMessage(ws: WebSocket, data: RawData, isBinary: boolean): void {
    const t1 = this.now();
    const conn = this.clients.get(ws);
    if (!conn) return;
    conn.lastSeen = t1;
    const info = conn.info;
    if (isBinary) {
      // Only this PC's own engine may push audio; unadmitted sockets have no info and are ignored.
      if (info?.role !== 'front') return;
      for (const [peer, peerConn] of this.clients) {
        if (peerConn.info?.role === 'rear' && peer.bufferedAmount < MAX_REAR_BUFFERED_BYTES) {
          peer.send(data, { binary: true });
        }
      }
      return;
    }
    const msg = parseClientMessage(data.toString());
    if (!msg) return;
    if (!info) {
      if (msg.type === 'hello') this.onHello(ws, conn, msg, t1);
      return;
    }
    switch (msg.type) {
      case 'hello':
        return;
      case 'ping':
        this.send(ws, { type: 'pong', t0: msg.t0, t1, t2: this.now() });
        return;
      case 'rescan':
        this.opts.onRescan?.();
        return;
      case 'rearStats':
        this.dispatch({ type: 'peerStats', id: info.id, stats: msg.stats });
        return;
      // Pairing is decided at the front PC itself, never by the PC asking to be let in.
      case 'approvePairing':
        if (conn.local) this.approvePairing(msg.requestId);
        return;
      case 'denyPairing':
        if (conn.local) this.denyPairing(msg.requestId);
        return;
      case 'forgetPeer':
        if (conn.local) this.forgetPeer(msg.peerId);
        return;
      case 'trackEnded':
      case 'trackFailed':
      case 'position':
        if (info.role !== 'front') return;
        this.dispatch(msg);
        return;
      default:
        this.dispatch(msg);
    }
  }

  private onHello(ws: WebSocket, conn: Conn, msg: Extract<ClientMessage, { type: 'hello' }>, now: number): void {
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      this.reject(ws, `Front is protocol v${PROTOCOL_VERSION} but this PC is v${msg.protocolVersion} — update the older PC`, 4001);
      return;
    }
    if (conn.local) {
      this.admit(ws, conn, msg.role, msg.pcName, '');
      return;
    }
    // A remote PC is always a rear: the front is whichever PC runs the hub.
    if (msg.role === 'front') {
      this.reject(ws, 'Only this PC can be the front. Set the other PC to Rear in its settings.', 4002);
      return;
    }
    const peerId = typeof msg.peerId === 'string' ? msg.peerId : '';
    if (!peerId) {
      this.reject(ws, 'That PC sent no identity and cannot be paired.', 4002);
      return;
    }
    const record = this.paired[peerId];
    if (record && typeof msg.token === 'string' && tokenMatches(record.token, msg.token)) {
      if (record.pcName !== msg.pcName) {
        this.paired = { ...this.paired, [peerId]: { ...record, pcName: msg.pcName } };
        this.persistPaired();
      }
      this.admit(ws, conn, 'rear', msg.pcName, peerId);
      return;
    }
    const deniedAt = this.deniedAt.get(peerId);
    if (deniedAt !== undefined && now - deniedAt < PAIRING_COOLDOWN_MS) {
      this.reject(ws, `${this.opts.pcName} declined this PC. Try again in a moment.`, 4004);
      return;
    }
    conn.pending = {
      requestId: randomUUID(),
      peerId,
      pcName: msg.pcName,
      address: conn.address,
      requestedAt: now,
    };
    this.send(ws, { type: 'awaitingApproval' });
    this.dispatch({ type: 'pairingRequested', request: conn.pending });
  }

  private admit(ws: WebSocket, conn: Conn, role: Role, pcName: string, peerId: string): void {
    conn.info = { id: randomUUID(), role, pcName, peerId };
    this.send(ws, { type: 'welcome', hubId: this.opts.hubId, pcName: this.opts.pcName });
    this.send(ws, { type: 'library', library: this.library });
    this.dispatch({
      type: 'peerJoined',
      peer: { id: conn.info.id, role, pcName, connectedAt: this.now(), stats: null },
    });
    this.send(ws, { type: 'state', state: this.state }); // in case the join changed nothing
  }

  private reject(ws: WebSocket, reason: string, code: number): void {
    this.send(ws, { type: 'error', reason });
    ws.close(code, 'rejected');
  }

  private findPending(requestId: string): [WebSocket, Conn] | null {
    for (const entry of this.clients) {
      if (entry[1].pending?.requestId === requestId) return entry;
    }
    return null;
  }

  /** Clears a pending request and turns the socket away with `reason`. */
  private resolvePending(ws: WebSocket, conn: Conn, reason: string): void {
    const request = conn.pending;
    conn.pending = null;
    if (request) this.dispatch({ type: 'pairingResolved', requestId: request.requestId });
    this.reject(ws, reason, 4004);
  }

  private approvePairing(requestId: string): void {
    const found = this.findPending(requestId);
    if (!found) return;
    const [ws, conn] = found;
    const request = conn.pending!;
    conn.pending = null;
    const token = randomBytes(32).toString('hex');
    this.paired = {
      ...this.paired,
      [request.peerId]: { pcName: request.pcName, token, pairedAt: this.now() },
    };
    this.deniedAt.delete(request.peerId);
    this.persistPaired();
    this.send(ws, { type: 'paired', token });
    this.dispatch({ type: 'pairingResolved', requestId });
    this.dispatch({ type: 'pairedChanged', paired: this.pairedList() });
    this.admit(ws, conn, 'rear', request.pcName, request.peerId);
  }

  private denyPairing(requestId: string): void {
    const found = this.findPending(requestId);
    if (!found) return;
    const [ws, conn] = found;
    this.deniedAt.set(conn.pending!.peerId, this.now());
    this.resolvePending(ws, conn, `${this.opts.pcName} declined this connection.`);
  }

  private forgetPeer(peerId: string): void {
    if (!this.paired[peerId]) return;
    const { [peerId]: _removed, ...rest } = this.paired;
    this.paired = rest;
    this.persistPaired();
    this.dispatch({ type: 'pairedChanged', paired: this.pairedList() });
    // Drop it now, so a forgotten PC has to ask again rather than keep the session it already has.
    for (const [ws, conn] of this.clients) {
      if (conn.info?.peerId === peerId) this.reject(ws, `${this.opts.pcName} removed this PC.`, 4004);
    }
  }

  private persistPaired(): void {
    this.opts.onPairedChanged?.({ ...this.paired });
  }

  private send(ws: WebSocket, msg: HubMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: HubMessage): void {
    const text = JSON.stringify(msg);
    for (const [ws, conn] of this.clients) {
      if (conn.info && ws.readyState === ws.OPEN) ws.send(text);
    }
  }
}
