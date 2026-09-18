<script lang="ts">
  import { onMount } from 'svelte';
  import type { Role } from '../../../../shared/types';
  import { app } from '../app.svelte';
  import { listOutputDevices } from '../audio/context';
  import SyncStats from './SyncStats.svelte';

  let devices = $state<{ id: string; label: string }[]>([]);
  let manual = $state(app.settings?.manualHubAddress ?? '');
  let hubPort = $state(app.settings?.hubPort ?? 0);
  let beaconPort = $state(app.settings?.beaconPort ?? 0);
  const settings = $derived(app.settings!);

  onMount(() => {
    const refresh = async () => (devices = await listOutputDevices());
    void refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  });

  async function changeRole(role: Role) {
    if (role !== settings.role && confirm(`Switch this PC to ${role.toUpperCase()}? aIVplayer will restart.`)) {
      await app.saveSettings({ role });
    }
  }

  async function chooseFolder() {
    const folder = await window.aiv.chooseLibraryFolder();
    if (folder) await app.saveSettings({ libraryFolder: folder });
  }

  async function savePorts() {
    if (confirm('Changing ports restarts aIVplayer. Both PCs must use the same ports.')) {
      await app.saveSettings({ hubPort, beaconPort });
    }
  }
</script>

<section>
  <h2>This PC</h2>
  <label>
    <span>Role</span>
    <select value={settings.role} onchange={(e) => changeRole(e.currentTarget.value as Role)}>
      <option value="front">Front (library, stereo)</option>
      <option value="rear">Rear (difference signal)</option>
    </select>
  </label>
  <label>
    <span>Output device</span>
    <select value={settings.outputDeviceId} onchange={(e) => app.setOutputDevice(e.currentTarget.value)}>
      {#each devices as d (d.id)}
        <option value={d.id}>{d.id === '' ? 'Windows default' : d.label}</option>
      {/each}
    </select>
  </label>
</section>

{#if settings.role === 'front'}
  <section>
    <h2>Library</h2>
    <div class="field">
      <span>Folder</span>
      <span class="path">{settings.libraryFolder ?? 'Not set'}</span>
    </div>
    <div class="actions">
      <button onclick={chooseFolder}>Choose folder…</button>
      <button disabled={!settings.libraryFolder} onclick={() => app.send({ type: 'rescan' })}>Rescan</button>
    </div>
  </section>
{:else}
  <section>
    <h2>Front PC</h2>
    {#if app.discovery && app.discovery.fronts.length > 0}
      <ul class="fronts">
        {#each app.discovery.fronts as f (f.hubId)}
          <li>
            <span>{f.pcName} <span class="muted">{f.address}</span></span>
            {#if settings.pairedHubId === f.hubId}
              <span class="tone-ok">Paired</span>
            {:else}
              <button onclick={() => app.saveSettings({ pairedHubId: f.hubId })}>Use this front</button>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">No fronts discovered on the network.</p>
    {/if}
    <label>
      <span>Manual address</span>
      <input placeholder="e.g. 192.168.1.20" bind:value={manual} />
    </label>
    <div class="actions">
      <button onclick={() => app.saveSettings({ manualHubAddress: manual.trim() || null })}>Save address</button>
      <button
        disabled={!settings.manualHubAddress}
        onclick={() => {
          manual = '';
          void app.saveSettings({ manualHubAddress: null });
        }}>Use discovery</button>
    </div>
  </section>
{/if}

<section>
  <h2>Sync</h2>
  <label>
    <span>Presentation delay</span>
    <input
      type="range"
      min="50"
      max="500"
      step="10"
      value={app.hub?.front.presentationDelayMs ?? 100}
      onchange={(e) => app.send({ type: 'setFront', patch: { presentationDelayMs: e.currentTarget.valueAsNumber } })}
    />
    <span class="muted">{app.hub?.front.presentationDelayMs ?? 100} ms (applies from the next play or seek)</span>
  </label>
  <SyncStats />
</section>

<section>
  <h2>Network</h2>
  <label><span>Hub port (TCP)</span><input type="number" min="1" max="65535" bind:value={hubPort} /></label>
  <label><span>Discovery port (UDP)</span><input type="number" min="1" max="65535" bind:value={beaconPort} /></label>
  <div class="actions">
    <button disabled={hubPort === settings.hubPort && beaconPort === settings.beaconPort} onclick={savePorts}>
      Save ports
    </button>
  </div>
</section>

<style>
  section {
    max-width: 640px;
    margin-bottom: 32px;
  }

  label,
  .field {
    display: grid;
    grid-template-columns: 180px 1fr;
    align-items: center;
    gap: 6px 12px;
    margin-bottom: 10px;
  }

  label > span:first-child,
  .field > span:first-child {
    color: var(--muted);
  }

  label > .muted {
    grid-column: 2;
    font-size: 12px;
  }

  .path {
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-left: 192px;
  }

  .fronts {
    list-style: none;
    padding: 0;
  }

  .fronts li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
  }
</style>
