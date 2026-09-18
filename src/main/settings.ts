import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULT_BEACON_PORT, DEFAULT_HUB_PORT } from '../shared/constants';
import { initialHubState } from '../shared/reducer';
import type { HubPrefs, LocalSettings } from '../shared/types';

export function defaultSettings(): LocalSettings {
  return {
    role: null,
    hubId: randomUUID(),
    outputDeviceId: '',
    libraryFolder: null,
    beaconPort: DEFAULT_BEACON_PORT,
    hubPort: DEFAULT_HUB_PORT,
    pairedHubId: null,
    manualHubAddress: null,
  };
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = JSON.parse(await readFile(file, 'utf8'));
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Atomic write: temp file then rename, so a crash never leaves half a settings file. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await rename(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

const port = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 65536 ? v : fallback;
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function sanitizeSettings(raw: Record<string, unknown>, base: LocalSettings): LocalSettings {
  return {
    role: raw.role === 'front' || raw.role === 'rear' ? raw.role : raw.role === null ? null : base.role,
    hubId: str(raw.hubId) ?? base.hubId,
    outputDeviceId: typeof raw.outputDeviceId === 'string' ? raw.outputDeviceId : base.outputDeviceId,
    libraryFolder: 'libraryFolder' in raw ? str(raw.libraryFolder) : base.libraryFolder,
    beaconPort: port(raw.beaconPort, base.beaconPort),
    hubPort: port(raw.hubPort, base.hubPort),
    pairedHubId: 'pairedHubId' in raw ? str(raw.pairedHubId) : base.pairedHubId,
    manualHubAddress: 'manualHubAddress' in raw ? str(raw.manualHubAddress) : base.manualHubAddress,
  };
}

/** Loads settings, creating the file with defaults (and a fresh hubId) if missing or corrupt. */
export async function loadSettings(file: string): Promise<LocalSettings> {
  const raw = await readJson(file);
  const settings = raw ? sanitizeSettings(raw, defaultSettings()) : defaultSettings();
  if (!raw || raw.hubId !== settings.hubId) await writeJson(file, settings);
  return settings;
}

export async function loadHubPrefs(file: string): Promise<HubPrefs> {
  const raw = (await readJson(file)) as Partial<HubPrefs> | null;
  const s = initialHubState(raw ?? undefined);
  return { rear: s.rear, front: s.front };
}
