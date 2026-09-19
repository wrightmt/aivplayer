import type { DiscoveryStatus } from '../../../shared/beacon';
import { DEFAULT_BEACON_PORT, DEFAULT_HUB_PORT, NO_BEACON_HINT_MS } from '../../../shared/constants';
import type { AppInfo, FrontStatus } from '../../../shared/ipc';
import type { ClientMessage } from '../../../shared/protocol';
import type { HubState, Library, LocalSettings, Track } from '../../../shared/types';
import { FrontEngine } from './audio/frontEngine';
import { RearEngine } from './audio/rearEngine';
import { HubClient, type LinkStatus } from './hubClient';

/**
 * The firewall to point at, named for the platform the app is running on. Getting this wrong is
 * the most common reason two PCs see each other but never connect.
 */
function firewallHint(hubPort: number, beaconPort: number): string {
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Allow aIVplayer through Windows Firewall on Private networks';
  if (ua.includes('Mac')) return 'Allow aIVplayer through the macOS firewall';
  return `Open TCP ${hubPort} and UDP ${beaconPort} in the front PC's firewall (ufw, firewalld)`;
}

export interface Toast {
  id: number;
  message: string;
}

class AppModel {
  info = $state<AppInfo | null>(null);
  settings = $state<LocalSettings | null>(null);
  hub = $state.raw<HubState | null>(null);
  library = $state.raw<Library>({ albums: [], tracks: {} });
  link = $state<LinkStatus>('idle');
  linkReason = $state<string | null>(null);
  hubName = $state<string | null>(null);
  frontStatus = $state.raw<FrontStatus | null>(null);
  discovery = $state.raw<DiscoveryStatus | null>(null);
  toasts = $state<Toast[]>([]);
  /** Updated a few times a second so time-based UI (seek bar, hints) re-renders. */
  clockTick = $state(Date.now());

  client: HubClient | null = null;
  private engine: FrontEngine | RearEngine | null = null;
  private toastId = 0;
  private lastNoticeId: number | null | undefined = undefined;
  private connectedUrl: string | null = null;

  get role() {
    return this.settings?.role ?? null;
  }

  get currentTrack(): Track | null {
    const p = this.hub?.player;
    return (p && this.library.tracks[p.queue[p.index]]) ?? null;
  }

  get statusLine(): { text: string; tone: 'ok' | 'warn' | 'error' | 'muted' } {
    if (this.role === 'front') {
      if (this.frontStatus?.kind === 'error') return { text: this.frontStatus.message, tone: 'error' };
      const rear = this.hub?.peers.find((p) => p.role === 'rear');
      return rear ? { text: `Rear connected: ${rear.pcName}`, tone: 'ok' } : { text: 'No rear connected', tone: 'muted' };
    }
    if (this.link === 'open') return { text: `Connected to ${this.hubName ?? 'front'}`, tone: 'ok' };
    if (this.link === 'awaiting') {
      const front = this.discovery?.decision.kind === 'connect' ? this.discovery.decision.front?.pcName : null;
      return { text: `Waiting to be allowed on ${front ?? 'the front PC'} — approve it there`, tone: 'warn' };
    }
    if (this.link === 'rejected') return { text: this.linkReason ?? 'Front rejected this PC', tone: 'error' };
    const d = this.discovery?.decision;
    switch (d?.kind) {
      case 'connect':
        return { text: `Connecting to ${d.front?.pcName ?? d.url}…`, tone: 'muted' };
      case 'choose':
        return { text: 'Several fronts found. Pick one in Settings.', tone: 'warn' };
      case 'mismatch':
        return { text: `${d.front.pcName} runs a different version. Update the older PC.`, tone: 'error' };
      default: {
        const since = this.discovery?.searchingSince ?? this.clockTick;
        if (this.clockTick - since > NO_BEACON_HINT_MS) {
          return {
            text: `No front found. ${firewallHint(
              this.settings?.hubPort ?? DEFAULT_HUB_PORT,
              this.settings?.beaconPort ?? DEFAULT_BEACON_PORT,
            )}, or set the front IP in Settings.`,
            tone: 'warn',
          };
        }
        return { text: 'Searching for front…', tone: 'muted' };
      }
    }
  }

  async init(): Promise<void> {
    setInterval(() => (this.clockTick = Date.now()), 250);
    const [info, settings] = await Promise.all([window.aiv.getInfo(), window.aiv.getSettings()]);
    this.info = info;
    this.settings = settings;
    const role = settings.role;
    if (!role) return;

    const client = new HubClient({ role, pcName: info.pcName, peerId: settings.hubId, token: settings.pairToken }, {
      onState: (s) => this.onState(s),
      onLibrary: (l) => {
        this.library = l;
        if (this.engine instanceof FrontEngine) this.engine.applyLibrary(l);
      },
      onAudio: (c) => {
        if (this.engine instanceof RearEngine) this.engine.pushChunk(c);
      },
      onWelcome: (h) => (this.hubName = h.pcName),
      onPaired: (token) => void this.saveSettings({ pairToken: token }),
      onStatus: (s, reason) => {
        this.link = s;
        this.linkReason = reason ?? null;
        if (s === 'open') this.lastNoticeId = undefined;
        else this.hub = null; // hub state is unknown while disconnected; don't show stale playback or stats
      },
    });
    this.client = client;
    const notify = (m: string) => this.toast(m);

    if (role === 'front') {
      this.frontStatus = await window.aiv.getFrontStatus();
      window.aiv.onFrontStatus((s) => (this.frontStatus = s));
      const engine = new FrontEngine(client, notify);
      this.engine = engine;
      await engine.init(settings.outputDeviceId);
      client.start(() => (this.frontStatus?.kind === 'ready' ? this.frontStatus.hubUrl : null));
    } else {
      this.discovery = await window.aiv.getDiscovery();
      window.aiv.onDiscovery((d) => this.onDiscovery(d));
      const engine = new RearEngine(client, notify);
      this.engine = engine;
      await engine.init(settings.outputDeviceId);
      client.start(() => (this.connectedUrl = this.targetUrl()));
    }
  }

  send(msg: ClientMessage): void {
    this.client?.send(msg);
  }

  /** Rear: ask the front again after a refusal or a timeout. */
  retryConnection(): void {
    if (!this.client) return;
    this.client.stop();
    this.linkReason = null;
    this.client.start(() => (this.connectedUrl = this.targetUrl()));
  }

  /** Front: stop trusting a rear, so it has to be allowed again next time. */
  forgetPeer(peerId: string): void {
    this.send({ type: 'forgetPeer', peerId });
  }

  async saveSettings(patch: Partial<LocalSettings>): Promise<void> {
    this.settings = await window.aiv.saveSettings(patch);
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    await this.saveSettings({ outputDeviceId: deviceId });
    await this.engine?.setDevice(deviceId);
  }

  toast(message: string): void {
    const id = ++this.toastId;
    this.toasts = [...this.toasts, { id, message }];
    setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), 8000);
  }

  private targetUrl(): string | null {
    const d = this.discovery?.decision;
    return d?.kind === 'connect' ? d.url : null;
  }

  private onDiscovery(d: DiscoveryStatus): void {
    this.discovery = d;
    const url = this.targetUrl();
    // A different front was chosen (manual IP or picked from the list): reconnect to it.
    if (url && this.connectedUrl && url !== this.connectedUrl && this.client) {
      this.client.stop();
      this.client.start(() => (this.connectedUrl = this.targetUrl()));
    }
  }

  private onState(s: HubState): void {
    const noticeId = s.notice?.id ?? null;
    if (this.lastNoticeId !== undefined && s.notice && noticeId !== this.lastNoticeId) this.toast(s.notice.message);
    this.lastNoticeId = noticeId;
    this.hub = s;
    this.engine?.applyState(s);
  }
}

export const app = new AppModel();
