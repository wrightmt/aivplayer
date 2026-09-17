import { randomUUID } from 'node:crypto';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants';
import { parseClientMessage, type HubMessage } from '../shared/protocol';
import { initialHubState, reduce, type HubAction } from '../shared/reducer';
import type { HubPrefs, HubState, Library, Role } from '../shared/types';

export interface HubOptions {
  port: number;
  host?: string;
  hubId: string;
  pcName: string;
  library: Library;
  prefs?: Partial<HubPrefs>;
  onPrefsChanged?: (prefs: HubPrefs) => void;
  onRescan?: () => void;
  now?: () => number;
}

interface ClientInfo {
  id: string;
  role: Role;
  pcName: string;
}

/** Drop audio to a rear whose socket is this far behind rather than grow latency unbounded. */
const MAX_REAR_BUFFERED_BYTES = 2 * 1024 * 1024;

export class Hub {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<WebSocket, ClientInfo | null>();
  private state: HubState;
  private library: Library;
  private readonly now: () => number;

  constructor(private readonly opts: HubOptions) {
    this.library = opts.library;
    this.state = initialHubState(opts.prefs);
    this.now = opts.now ?? (() => performance.timeOrigin + performance.now());
  }

  getState(): HubState {
    return this.state;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port: this.opts.port, host: this.opts.host, perMessageDeflate: false });
      wss.once('error', reject);
      wss.once('listening', () => {
        wss.off('error', reject);
        const addr = wss.address();
        resolve(typeof addr === 'object' && addr ? addr.port : this.opts.port);
      });
      wss.on('connection', (ws) => this.onConnection(ws));
      this.wss = wss;
    });
  }

  async stop(): Promise<void> {
    for (const ws of this.clients.keys()) ws.terminate();
    this.clients.clear();
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
    this.wss = null;
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

  private onConnection(ws: WebSocket): void {
    this.clients.set(ws, null);
    ws.on('message', (data, isBinary) => this.onMessage(ws, data, isBinary));
    ws.on('close', () => {
      const info = this.clients.get(ws);
      this.clients.delete(ws);
      if (info) this.dispatch({ type: 'peerLeft', id: info.id });
    });
    ws.on('error', () => ws.terminate());
  }

  private onMessage(ws: WebSocket, data: RawData, isBinary: boolean): void {
    const t1 = this.now();
    const info = this.clients.get(ws);
    if (isBinary) {
      if (info?.role !== 'front') return;
      for (const [peer, peerInfo] of this.clients) {
        if (peerInfo?.role === 'rear' && peer.bufferedAmount < MAX_REAR_BUFFERED_BYTES) peer.send(data, { binary: true });
      }
      return;
    }
    const msg = parseClientMessage(data.toString());
    if (!msg) return;
    if (!info) {
      if (msg.type !== 'hello') return;
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        this.send(ws, {
          type: 'error',
          reason: `Front is protocol v${PROTOCOL_VERSION} but this PC is v${msg.protocolVersion} — update the older PC`,
        });
        ws.close(4001, 'protocol mismatch');
        return;
      }
      const client: ClientInfo = { id: randomUUID(), role: msg.role, pcName: msg.pcName };
      this.clients.set(ws, client);
      this.send(ws, { type: 'welcome', hubId: this.opts.hubId, pcName: this.opts.pcName });
      this.send(ws, { type: 'library', library: this.library });
      this.dispatch({ type: 'peerJoined', peer: { ...client, connectedAt: this.now(), stats: null } });
      this.send(ws, { type: 'state', state: this.state }); // in case the join changed nothing
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
      default:
        this.dispatch(msg);
    }
  }

  private send(ws: WebSocket, msg: HubMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: HubMessage): void {
    const text = JSON.stringify(msg);
    for (const [ws, info] of this.clients) {
      if (info && ws.readyState === ws.OPEN) ws.send(text);
    }
  }
}
