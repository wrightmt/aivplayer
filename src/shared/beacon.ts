import { APP_ID, BEACON_TTL_MS, PROTOCOL_VERSION } from './constants';

export interface Beacon {
  app: typeof APP_ID;
  protocolVersion: number;
  hubId: string;
  pcName: string;
  wsPort: number;
}

export interface SeenFront {
  hubId: string;
  pcName: string;
  address: string;
  wsPort: number;
  protocolVersion: number;
  lastSeen: number;
}

export type FrontDecision =
  | { kind: 'searching' }
  | { kind: 'connect'; url: string; front: SeenFront | null }
  | { kind: 'choose' }
  | { kind: 'mismatch'; front: SeenFront };

export interface DiscoveryStatus {
  decision: FrontDecision;
  fronts: SeenFront[];
  /** Hub-independent local ms timestamp since when nothing has been found, or null. */
  searchingSince: number | null;
}

export interface NetIface {
  family: string | number;
  address: string;
  netmask: string;
  internal: boolean;
}

export function encodeBeacon(b: Omit<Beacon, 'app'>): string {
  return JSON.stringify({ app: APP_ID, ...b });
}

export function parseBeacon(text: string): Beacon | null {
  try {
    const v = JSON.parse(text) as Partial<Beacon>;
    if (
      v?.app !== APP_ID ||
      typeof v.protocolVersion !== 'number' ||
      typeof v.hubId !== 'string' ||
      typeof v.pcName !== 'string' ||
      typeof v.wsPort !== 'number'
    ) {
      return null;
    }
    return v as Beacon;
  } catch {
    return null;
  }
}

const ipToInt = (ip: string): number =>
  ip.split('.').reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);
const intToIp = (n: number): string =>
  [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

/** Directed broadcast address for every external IPv4 interface. */
export function broadcastAddresses(ifaces: Record<string, NetIface[] | undefined>): string[] {
  const out = new Set<string>();
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      const v4 = i.family === 'IPv4' || i.family === 4;
      if (!v4 || i.internal) continue;
      out.add(intToIp((ipToInt(i.address) | (~ipToInt(i.netmask) >>> 0)) >>> 0));
    }
  }
  return out.size > 0 ? [...out] : ['255.255.255.255'];
}

export class FrontsTracker {
  private fronts = new Map<string, SeenFront>();

  see(b: Beacon, address: string, now: number): void {
    this.fronts.set(b.hubId, {
      hubId: b.hubId,
      pcName: b.pcName,
      address,
      wsPort: b.wsPort,
      protocolVersion: b.protocolVersion,
      lastSeen: now,
    });
  }

  list(now: number): SeenFront[] {
    for (const [id, f] of this.fronts) {
      if (now - f.lastSeen > BEACON_TTL_MS) this.fronts.delete(id);
    }
    return [...this.fronts.values()].sort((a, b) => a.pcName.localeCompare(b.pcName));
  }
}

export function frontUrl(f: SeenFront): string {
  return `ws://${f.address}:${f.wsPort}`;
}

export function chooseFront(
  fronts: SeenFront[],
  pairedHubId: string | null,
  manualAddress: string | null,
  defaultHubPort: number,
): FrontDecision {
  if (manualAddress) {
    const hostPort = manualAddress.includes(':') ? manualAddress : `${manualAddress}:${defaultHubPort}`;
    return { kind: 'connect', url: `ws://${hostPort}`, front: null };
  }
  const pick = (f: SeenFront): FrontDecision =>
    f.protocolVersion === PROTOCOL_VERSION
      ? { kind: 'connect', url: frontUrl(f), front: f }
      : { kind: 'mismatch', front: f };
  const paired = fronts.find((f) => f.hubId === pairedHubId);
  if (paired) return pick(paired);
  if (fronts.length === 1) return pick(fronts[0]);
  if (fronts.length > 1) return { kind: 'choose' };
  return { kind: 'searching' };
}
