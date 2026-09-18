import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DiscoveryStatus } from '../shared/beacon';
import { IPC, type AivApi, type FrontStatus } from '../shared/ipc';

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const api: AivApi = {
  getInfo: () => ipcRenderer.invoke(IPC.getInfo),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (patch) => ipcRenderer.invoke(IPC.saveSettings, patch),
  chooseLibraryFolder: () => ipcRenderer.invoke(IPC.chooseLibraryFolder),
  readTrack: (trackId) => ipcRenderer.invoke(IPC.readTrack, trackId),
  getFrontStatus: () => ipcRenderer.invoke(IPC.getFrontStatus),
  onFrontStatus: (cb) => subscribe<FrontStatus>(IPC.frontStatusChanged, cb),
  getDiscovery: () => ipcRenderer.invoke(IPC.getDiscovery),
  onDiscovery: (cb) => subscribe<DiscoveryStatus>(IPC.discoveryChanged, cb),
};

contextBridge.exposeInMainWorld('aiv', api);
