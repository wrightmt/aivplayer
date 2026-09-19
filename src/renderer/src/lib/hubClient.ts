import { PROTOCOL_VERSION } from '../../../shared/constants';
import { decodeAudioChunk, parseHubMessage, type AudioChunk, type ClientMessage } from '../../../shared/protocol';
import { ClockSync } from '../../../shared/sync/clockSync';
import type { HubState, Library, Role } from '../../../shared/types';

export type LinkStatus = 'idle' | 'connecting' | 'awaiting' | 'open' | 'closed' | 'rejected';

export interface HubClientEvents {
  onState?: (s: HubState) => void;
  onLibrary?: (l: Library) => void;
  onAudio?: (c: AudioChunk) => void;
  onWelcome?: (hub: { hubId: string; pcName: string }) => void;
  onStatus?: (status: LinkStatus, reason?: string) => void;
  /** The front allowed this PC; persist the token so later launches connect silently. */
  onPaired?: (token: string) => void;
}

const PING_MS = 1000;
const RECONNECT_MS = 1000;
const WATCHDOG_MS = 2000;
const LIVENESS_TIMEOUT_MS = 6000;

/** WebSocket client for the hub; works in the renderer and in Node 22+ (global WebSocket). */
export class HubClient {
  readonly clock = new ClockSync();
  status: LinkStatus = 'idle';
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastReceived = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private getUrl: (() => string | null) | null = null;
  private rejected = false;

  constructor(
    private readonly hello: { role: Role; pcName: string; peerId: string; token?: string | null },
    readonly events: HubClientEvents = {},
    private readonly localNow: () => number = () => performance.timeOrigin + performance.now(),
  ) {}

  /** Replaces the pairing token used by this and every later connection. */
  setToken(token: string | null): void {
    this.hello.token = token;
  }

  /** Connects to whatever URL getUrl returns, reconnecting every second after a drop. */
  start(getUrl: () => string | null): void {
    this.getUrl = getUrl;
    this.rejected = false;
    this.tryConnect();
  }

  stop(): void {
    this.getUrl = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
    this.ws?.close();
    this.ws = null;
  }

  /** Current hub-clock time in ms. */
  hubNow(): number {
    return this.localNow() + this.clock.offset;
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendBinary(data: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  private setStatus(s: LinkStatus, reason?: string): void {
    this.status = s;
    this.events.onStatus?.(s, reason);
  }

  private tryConnect(): void {
    this.reconnectTimer = null;
    const url = this.getUrl?.();
    if (!url) {
      this.scheduleReconnect();
      return;
    }
    this.setStatus('connecting');
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          role: this.hello.role,
          pcName: this.hello.pcName,
          peerId: this.hello.peerId,
          ...(this.hello.token ? { token: this.hello.token } : {}),
          protocolVersion: PROTOCOL_VERSION,
        }),
      );
      this.clock.reset();
      this.lastReceived = this.localNow();
      this.ping();
      this.pingTimer = setInterval(() => this.ping(), PING_MS);
      this.watchdogTimer = setInterval(() => {
        if (this.ws === ws && this.localNow() - this.lastReceived > LIVENESS_TIMEOUT_MS) ws.close();
      }, WATCHDOG_MS);
      // 'open' is deliberately not set here: the hub may still hold us for pairing approval.
      // It is set on `welcome`, which is the hub saying we are admitted.
    };
    ws.onmessage = (ev: MessageEvent) => {
      this.lastReceived = this.localNow();
      if (typeof ev.data !== 'string') {
        const chunk = decodeAudioChunk(ev.data as ArrayBuffer);
        if (chunk) this.events.onAudio?.(chunk);
        return;
      }
      const msg = parseHubMessage(ev.data);
      if (!msg) return;
      switch (msg.type) {
        case 'pong':
          this.clock.addSample(msg.t0, msg.t1, msg.t2, this.localNow());
          break;
        case 'state':
          this.events.onState?.(msg.state);
          break;
        case 'library':
          this.events.onLibrary?.(msg.library);
          break;
        case 'welcome':
          this.events.onWelcome?.({ hubId: msg.hubId, pcName: msg.pcName });
          this.setStatus('open');
          break;
        case 'awaitingApproval':
          this.setStatus('awaiting');
          break;
        case 'paired':
          this.setToken(msg.token);
          this.events.onPaired?.(msg.token);
          break;
        case 'error':
          this.rejected = true;
          this.setStatus('rejected', msg.reason);
          break;
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.watchdogTimer) clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
      this.ws = null;
      if (!this.rejected) this.setStatus('closed');
      if (this.getUrl && !this.rejected) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    if (!this.reconnectTimer && this.getUrl) this.reconnectTimer = setTimeout(() => this.tryConnect(), RECONNECT_MS);
  }

  /** Sends a clock-sync ping now (also sent automatically every second). */
  ping(): void {
    this.send({ type: 'ping', t0: this.localNow() });
  }
}
