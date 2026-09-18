import { createSocket, type Socket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import { networkInterfaces } from 'node:os';
import {
  broadcastAddresses,
  encodeBeacon,
  FrontsTracker,
  parseBeacon,
  type Beacon,
  type NetIface,
  type SeenFront,
} from '../shared/beacon';
import { BEACON_INTERVAL_MS } from '../shared/constants';

export interface BroadcasterOptions {
  port: number;
  beacon: Omit<Beacon, 'app'>;
  intervalMs?: number;
  /** Destination addresses; defaults to every interface's directed broadcast address. */
  targets?: () => string[];
}

export class BeaconBroadcaster {
  private socket: Socket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: BroadcasterOptions) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createSocket({ type: 'udp4', reuseAddr: true });
      this.socket = socket;
      socket.once('error', reject);
      socket.bind(0, () => {
        socket.off('error', reject);
        // Transient send errors (e.g. an adapter going down) must not be fatal.
        socket.on('error', () => undefined);
        socket.setBroadcast(true);
        this.send();
        this.timer = setInterval(() => this.send(), this.opts.intervalMs ?? BEACON_INTERVAL_MS);
        resolve();
      });
    });
  }

  private send(): void {
    const socket = this.socket;
    if (!socket) return;
    const msg = Buffer.from(encodeBeacon(this.opts.beacon));
    const targets =
      this.opts.targets?.() ?? broadcastAddresses(networkInterfaces() as Record<string, NetIface[] | undefined>);
    for (const addr of targets) socket.send(msg, this.opts.port, addr);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
  }
}

export interface DiscoveryListenerEvents {
  change: [fronts: SeenFront[]];
}

/** Listens for front beacons; emits 'change' on each beacon and when entries expire. */
export class DiscoveryListener extends EventEmitter<DiscoveryListenerEvents> {
  private socket: Socket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly tracker = new FrontsTracker();

  constructor(
    private readonly port: number,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createSocket({ type: 'udp4', reuseAddr: true });
      this.socket = socket;
      socket.once('error', reject);
      socket.on('message', (msg, rinfo) => {
        const beacon = parseBeacon(msg.toString('utf8'));
        if (!beacon) return;
        this.tracker.see(beacon, rinfo.address, this.now());
        this.emit('change', this.fronts());
      });
      socket.bind(this.port, () => {
        socket.off('error', reject);
        socket.on('error', () => undefined);
        this.timer = setInterval(() => this.emit('change', this.fronts()), 1000);
        resolve();
      });
    });
  }

  fronts(): SeenFront[] {
    return this.tracker.list(this.now());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
  }
}
