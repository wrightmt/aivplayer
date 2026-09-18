import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { chooseFront, type DiscoveryStatus, type SeenFront } from '../shared/beacon';
import { PROTOCOL_VERSION } from '../shared/constants';
import { IPC, type FrontStatus } from '../shared/ipc';
import type { Library, LocalSettings } from '../shared/types';
import { BeaconBroadcaster, DiscoveryListener } from './discovery';
import { Hub } from './hub';
import { scanLibrary } from './library';
import { loadHubPrefs, loadSettings, sanitizeSettings, writeJson } from './settings';

const pcName = hostname().toUpperCase();
let settingsFile = '';
let hubPrefsFile = '';

let settings: LocalSettings;
let win: BrowserWindow | null = null;
let hub: Hub | null = null;
let library: Library = { albums: [], tracks: {} };
let broadcaster: BeaconBroadcaster | null = null;
let listener: DiscoveryListener | null = null;
let frontStatus: FrontStatus = { kind: 'starting' };
let discovery: DiscoveryStatus = { decision: { kind: 'searching' }, fronts: [], searchingSince: Date.now() };

function setFrontStatus(s: FrontStatus): void {
  frontStatus = s;
  win?.webContents.send(IPC.frontStatusChanged, s);
}

async function rescan(): Promise<void> {
  if (!hub) return;
  if (!settings.libraryFolder) {
    library = { albums: [], tracks: {} };
    hub.setLibrary(library);
    return;
  }
  const result = await scanLibrary(settings.libraryFolder);
  library = result.library;
  hub.setLibrary(library);
  if (result.errors.length > 0) {
    hub.dispatch({
      type: 'notice',
      message: `${result.errors.length} file(s) could not be read. First: ${result.errors[0]}`,
    });
  }
}

async function startFront(): Promise<void> {
  const prefs = await loadHubPrefs(hubPrefsFile);
  hub = new Hub({
    port: settings.hubPort,
    hubId: settings.hubId,
    pcName,
    library,
    prefs,
    onPrefsChanged: (p) => void writeJson(hubPrefsFile, p),
    onRescan: () => void rescan(),
  });
  try {
    const port = await hub.start();
    setFrontStatus({ kind: 'ready', hubUrl: `ws://127.0.0.1:${port}` });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    setFrontStatus({
      kind: 'error',
      message:
        err.code === 'EADDRINUSE'
          ? `Port ${settings.hubPort} is already in use. Change the hub port in Settings.`
          : `Hub failed to start: ${err.message}`,
    });
    hub = null;
    return;
  }
  broadcaster = new BeaconBroadcaster({
    port: settings.beaconPort,
    beacon: { protocolVersion: PROTOCOL_VERSION, hubId: settings.hubId, pcName, wsPort: settings.hubPort },
  });
  try {
    await broadcaster.start();
  } catch (e) {
    // The hub still works; only auto-discovery is lost, so tell the user instead of failing startup.
    broadcaster = null;
    hub.dispatch({
      type: 'notice',
      message: `Discovery beacon could not start on UDP ${settings.beaconPort}: ${(e as Error).message}. Set this PC's address manually on the rear PC.`,
    });
  }
  await rescan();
}

function updateDiscovery(fronts: SeenFront[]): void {
  const decision = chooseFront(fronts, settings.pairedHubId, settings.manualHubAddress, settings.hubPort);
  if (decision.kind === 'connect' && decision.front && decision.front.hubId !== settings.pairedHubId) {
    void saveSettings({ pairedHubId: decision.front.hubId });
  }
  const searchingSince = decision.kind === 'searching' ? (discovery.searchingSince ?? Date.now()) : null;
  discovery = { decision, fronts, searchingSince };
  win?.webContents.send(IPC.discoveryChanged, discovery);
}

async function startRear(): Promise<void> {
  listener = new DiscoveryListener(settings.beaconPort);
  listener.on('change', (fronts) => updateDiscovery(fronts));
  try {
    await listener.start();
  } catch (e) {
    console.error(`Discovery listener failed on UDP ${settings.beaconPort}:`, e);
  }
  updateDiscovery([]);
}

const RELAUNCH_KEYS: (keyof LocalSettings)[] = ['role', 'hubPort', 'beaconPort'];

async function saveSettings(patch: Partial<LocalSettings>): Promise<LocalSettings> {
  const prev = settings;
  settings = sanitizeSettings({ ...prev, ...patch }, prev);
  await writeJson(settingsFile, settings);
  if (RELAUNCH_KEYS.some((k) => prev[k] !== settings[k])) {
    app.relaunch();
    app.exit(0);
    return settings;
  }
  if (settings.role === 'front' && prev.libraryFolder !== settings.libraryFolder) void rescan();
  if (settings.role === 'rear' && (prev.manualHubAddress !== settings.manualHubAddress || prev.pairedHubId !== settings.pairedHubId)) {
    updateDiscovery(listener?.fronts() ?? []);
  }
  return settings;
}

function registerIpc(): void {
  ipcMain.handle(IPC.getInfo, () => ({ pcName, version: app.getVersion() }));
  ipcMain.handle(IPC.getSettings, () => settings);
  ipcMain.handle(IPC.saveSettings, (_e, patch: Partial<LocalSettings>) => saveSettings(patch));
  ipcMain.handle(IPC.chooseLibraryFolder, async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: 'Choose your FLAC library folder' });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC.readTrack, async (_e, trackId: string) => {
    const track = library.tracks[trackId];
    if (!track) throw new Error('Track is not in the library');
    const buf = await readFile(track.path);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });
  ipcMain.handle(IPC.getFrontStatus, () => frontStatus);
  ipcMain.handle(IPC.getDiscovery, () => discovery);
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 760,
    minHeight: 540,
    title: 'aIVplayer',
    backgroundColor: '#11120f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      autoplayPolicy: 'no-user-gesture-required',
      // Audio timing runs on renderer timers; never throttle them when minimised.
      backgroundThrottling: false,
    },
  });
  win.on('closed', () => (win = null));
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    broadcaster?.stop();
    listener?.stop();
    void hub?.stop();
  });
  void app.whenReady().then(async () => {
    settingsFile = join(app.getPath('userData'), 'settings.json');
    hubPrefsFile = join(app.getPath('userData'), 'hub-prefs.json');
    settings = await loadSettings(settingsFile);
    registerIpc();
    createWindow();
    if (settings.role === 'front') await startFront();
    else if (settings.role === 'rear') await startRear();
  });
}
