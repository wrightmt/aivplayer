import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadHubPrefs, loadSettings, sanitizeSettings, writeJson, defaultSettings } from '../../src/main/settings';

const tmp = () => mkdtemp(join(tmpdir(), 'aiv-settings-'));

describe('settings', () => {
  it('creates defaults with a persistent hubId on first load', async () => {
    const file = join(await tmp(), 'settings.json');
    const a = await loadSettings(file);
    expect(a).toMatchObject({ role: null, beaconPort: 47810, hubPort: 47811, libraryFolder: null });
    expect(a.hubId).toMatch(/^[0-9a-f-]{36}$/);
    const b = await loadSettings(file);
    expect(b.hubId).toBe(a.hubId);
  });

  it('recovers from a corrupt file', async () => {
    const file = join(await tmp(), 'settings.json');
    await writeFile(file, '{not json');
    const s = await loadSettings(file);
    expect(s.role).toBeNull();
    expect(JSON.parse(await readFile(file, 'utf8')).hubId).toBe(s.hubId);
  });

  it('round-trips saved values and sanitizes bad ones', async () => {
    const file = join(await tmp(), 'nested', 'settings.json');
    const saved = { ...defaultSettings(), role: 'rear' as const, manualHubAddress: '10.0.0.5', hubPort: 5000 };
    await writeJson(file, saved);
    expect(await loadSettings(file)).toEqual(saved);
    const base = defaultSettings();
    expect(sanitizeSettings({ role: 'boss', hubPort: 70000, beaconPort: 1.5, libraryFolder: '' }, base)).toEqual({
      ...base, role: null, libraryFolder: null,
    });
  });

  it('loads hub prefs with defaults and clamping', async () => {
    const dir = await tmp();
    expect(await loadHubPrefs(join(dir, 'missing.json'))).toEqual({
      rear: { enabled: true, mode: 'difference', singleSide: 'L', gainDb: 0, delayMs: 15 },
      front: { volumeDb: 0, presentationDelayMs: 100 },
    });
    const file = join(dir, 'hub.json');
    await writeJson(file, { rear: { mode: 'single', singleSide: 'R', gainDb: -100 } });
    expect((await loadHubPrefs(file)).rear).toEqual({ enabled: true, mode: 'single', singleSide: 'R', gainDb: -30, delayMs: 15 });
  });
});
