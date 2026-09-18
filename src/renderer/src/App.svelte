<script lang="ts">
  import { onMount } from 'svelte';
  import AmbiencePanel from './lib/components/AmbiencePanel.svelte';
  import LibraryView from './lib/components/LibraryView.svelte';
  import NowPlaying from './lib/components/NowPlaying.svelte';
  import RolePicker from './lib/components/RolePicker.svelte';
  import SettingsView from './lib/components/SettingsView.svelte';
  import Toasts from './lib/components/Toasts.svelte';
  import TopBar from './lib/components/TopBar.svelte';
  import { app } from './lib/app.svelte';

  let view = $state<'library' | 'settings'>('library');

  onMount(() => {
    app.init().catch((e: Error) => app.toast(`Startup failed: ${e.message}`));
  });
</script>

{#if !app.settings}
  <div class="splash">aIVplayer</div>
{:else if !app.settings.role}
  <RolePicker />
{:else}
  <div class="shell">
    <TopBar bind:view />
    <main>
      {#if view === 'library'}
        <LibraryView />
      {:else}
        <SettingsView />
      {/if}
    </main>
    <aside><AmbiencePanel /></aside>
    <footer><NowPlaying /></footer>
  </div>
{/if}
<Toasts />

<style>
  .splash {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--muted);
    letter-spacing: 0.2em;
  }

  .shell {
    display: grid;
    grid-template-columns: 1fr 300px;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      'top top'
      'main aside'
      'foot foot';
    height: 100%;
  }

  main {
    grid-area: main;
    overflow: auto;
    padding: 20px 24px;
  }

  aside {
    grid-area: aside;
    overflow: auto;
    border-left: 1px solid var(--line);
    background: var(--panel);
    padding: 20px;
  }

  footer {
    grid-area: foot;
    border-top: 1px solid var(--line);
    background: var(--panel);
  }

  @media (max-width: 900px) {
    .shell {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr auto auto;
      grid-template-areas: 'top' 'main' 'aside' 'foot';
    }

    aside {
      border-left: none;
      border-top: 1px solid var(--line);
    }
  }
</style>
