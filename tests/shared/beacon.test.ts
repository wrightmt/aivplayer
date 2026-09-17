import { describe, expect, it } from 'vitest';
import {
  broadcastAddresses,
  chooseFront,
  encodeBeacon,
  FrontsTracker,
  parseBeacon,
  type SeenFront,
} from '../../src/shared/beacon';
import { PROTOCOL_VERSION } from '../../src/shared/constants';

const front = (over: Partial<SeenFront> = {}): SeenFront => ({
  hubId: 'hub-a',
  pcName: 'STUDY-PC',
  address: '192.168.1.20',
  wsPort: 47811,
  protocolVersion: PROTOCOL_VERSION,
  lastSeen: 0,
  ...over,
});

describe('beacon encoding', () => {
  it('round-trips', () => {
    const text = encodeBeacon({ protocolVersion: 1, hubId: 'h', pcName: 'PC', wsPort: 47811 });
    expect(parseBeacon(text)).toEqual({ app: 'aivplayer', protocolVersion: 1, hubId: 'h', pcName: 'PC', wsPort: 47811 });
  });

  it('rejects foreign or malformed datagrams', () => {
    expect(parseBeacon('{"app":"other","protocolVersion":1,"hubId":"h","pcName":"P","wsPort":1}')).toBeNull();
    expect(parseBeacon('{"app":"aivplayer","protocolVersion":"1","hubId":"h","pcName":"P","wsPort":1}')).toBeNull();
    expect(parseBeacon('garbage')).toBeNull();
    expect(parseBeacon('null')).toBeNull();
  });
});

describe('broadcastAddresses', () => {
  it('computes directed broadcast per external IPv4 interface', () => {
    const addrs = broadcastAddresses({
      Ethernet: [
        { family: 'IPv4', address: '192.168.1.20', netmask: '255.255.255.0', internal: false },
        { family: 'IPv6', address: 'fe80::1', netmask: 'ffff::', internal: false },
      ],
      'vEthernet (WSL)': [{ family: 'IPv4', address: '172.28.64.1', netmask: '255.255.240.0', internal: false }],
      Loopback: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
    });
    expect(addrs.sort()).toEqual(['172.28.79.255', '192.168.1.255']);
  });

  it('accepts numeric family (older Node) and falls back to limited broadcast', () => {
    expect(broadcastAddresses({ e: [{ family: 4, address: '10.0.0.5', netmask: '255.0.0.0', internal: false }] })).toEqual(['10.255.255.255']);
    expect(broadcastAddresses({})).toEqual(['255.255.255.255']);
  });
});

describe('FrontsTracker', () => {
  it('lists fronts seen within the TTL, sorted by name, keyed by hubId', () => {
    const t = new FrontsTracker();
    const b = { app: 'aivplayer' as const, protocolVersion: 1, wsPort: 47811 };
    t.see({ ...b, hubId: 'z', pcName: 'ZED' }, '10.0.0.2', 0);
    t.see({ ...b, hubId: 'a', pcName: 'ALPHA' }, '10.0.0.3', 1000);
    t.see({ ...b, hubId: 'a', pcName: 'ALPHA' }, '10.0.0.9', 2000);
    expect(t.list(2000).map((f) => [f.pcName, f.address])).toEqual([['ALPHA', '10.0.0.9'], ['ZED', '10.0.0.2']]);
    expect(t.list(6500).map((f) => f.hubId)).toEqual(['a']);
  });
});

describe('chooseFront', () => {
  it('uses manual address first, adding the default port when missing', () => {
    expect(chooseFront([front()], 'hub-a', '10.1.1.1', 47811)).toEqual({ kind: 'connect', url: 'ws://10.1.1.1:47811', front: null });
    expect(chooseFront([], null, '10.1.1.1:5000', 47811)).toEqual({ kind: 'connect', url: 'ws://10.1.1.1:5000', front: null });
  });

  it('prefers the paired hub even when several fronts are visible', () => {
    const d = chooseFront([front({ hubId: 'x', pcName: 'A' }), front({ hubId: 'hub-a', address: '10.0.0.7' })], 'hub-a', null, 47811);
    expect(d).toMatchObject({ kind: 'connect', url: 'ws://10.0.0.7:47811' });
  });

  it('auto-connects to a single front, asks when several, searches when none', () => {
    expect(chooseFront([front()], null, null, 47811)).toMatchObject({ kind: 'connect', url: 'ws://192.168.1.20:47811' });
    expect(chooseFront([front({ hubId: 'x' }), front({ hubId: 'y' })], null, null, 47811)).toEqual({ kind: 'choose' });
    expect(chooseFront([], null, null, 47811)).toEqual({ kind: 'searching' });
  });

  it('reports protocol mismatch instead of connecting', () => {
    expect(chooseFront([front({ protocolVersion: 99 })], null, null, 47811)).toMatchObject({ kind: 'mismatch' });
  });
});
