import { createSocket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { BeaconBroadcaster, DiscoveryListener } from '../../src/main/discovery';
import type { SeenFront } from '../../src/shared/beacon';
import { waitFor } from '../helpers/wait';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

async function freeUdpPort(): Promise<number> {
  const s = createSocket('udp4');
  await new Promise<void>((r) => s.bind(0, '127.0.0.1', () => r()));
  const { port } = s.address();
  s.close();
  return port;
}

describe('discovery', () => {
  it('listener sees beacons from the broadcaster', async () => {
    const port = await freeUdpPort();
    const listener = new DiscoveryListener(port);
    await listener.start();
    cleanups.push(() => listener.stop());
    let latest: SeenFront[] = [];
    listener.on('change', (f) => (latest = f));

    const b = new BeaconBroadcaster({
      port,
      intervalMs: 50,
      targets: () => ['127.0.0.1'],
      beacon: { protocolVersion: 1, hubId: 'hub-x', pcName: 'STUDY-PC', wsPort: 47811 },
    });
    await b.start();
    cleanups.push(() => b.stop());

    await waitFor(() => latest.length === 1);
    expect(latest[0]).toMatchObject({ hubId: 'hub-x', pcName: 'STUDY-PC', address: '127.0.0.1', wsPort: 47811 });
  });

  it('ignores foreign datagrams and expires silent fronts', async () => {
    const port = await freeUdpPort();
    let now = 0;
    const listener = new DiscoveryListener(port, () => now);
    await listener.start();
    cleanups.push(() => listener.stop());
    let changes = 0;
    listener.on('change', () => changes++);

    const s = createSocket('udp4');
    cleanups.push(() => s.close());
    s.send('hello world', port, '127.0.0.1');
    s.send(JSON.stringify({ app: 'aivplayer', protocolVersion: 1, hubId: 'h', pcName: 'P', wsPort: 1 }), port, '127.0.0.1');
    await waitFor(() => listener.fronts().length === 1);
    expect(changes).toBe(1);
    now = 7000;
    expect(listener.fronts()).toEqual([]);
  });
});
