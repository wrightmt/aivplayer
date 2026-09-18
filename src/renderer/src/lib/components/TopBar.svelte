<script lang="ts">
  import { app } from '../app.svelte';

  let { view = $bindable() }: { view: 'library' | 'settings' } = $props();
  const status = $derived(app.statusLine);
</script>

<header>
  <span class="title">aIVplayer</span>
  <span class="role">{app.role === 'front' ? 'FRONT' : 'REAR'} · {app.info?.pcName}</span>
  <span class="status tone-{status.tone}">{status.text}</span>
  <nav>
    <button class:active={view === 'library'} onclick={() => (view = 'library')}>Library</button>
    <button class:active={view === 'settings'} onclick={() => (view = 'settings')}>Settings</button>
  </nav>
</header>

<style>
  header {
    grid-area: top;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }

  .title {
    font-weight: 300;
    letter-spacing: 0.2em;
  }

  .role {
    font-size: 11px;
    letter-spacing: 0.1em;
    padding: 2px 8px;
    border: 1px solid var(--accent-dim);
    border-radius: 999px;
    color: var(--accent);
  }

  .status {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  nav {
    display: flex;
    gap: 6px;
  }

  nav button.active {
    border-color: var(--accent);
  }
</style>
