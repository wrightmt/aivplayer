<script lang="ts">
  import { app } from '../app.svelte';
  import { formatTime } from '../format';

  let selectedId = $state<string | null>(null);
  const albums = $derived(app.library.albums);
  const selected = $derived(albums.find((a) => a.id === selectedId) ?? null);
  const current = $derived(app.currentTrack);

  async function chooseFolder() {
    const folder = await window.aiv.chooseLibraryFolder();
    if (folder) await app.saveSettings({ libraryFolder: folder });
  }
</script>

{#if albums.length === 0}
  <div class="empty">
    {#if app.role === 'front'}
      <p>No music yet.</p>
      <p class="muted">Choose the folder that holds your FLAC files.</p>
      <button class="primary" onclick={chooseFolder}>Choose folder</button>
    {:else if app.link === 'open'}
      <p>The front PC's library is empty.</p>
      <p class="muted">Choose a music folder on the front PC.</p>
    {:else}
      <p class="muted">The library appears once this PC connects to the front.</p>
    {/if}
  </div>
{:else if selected}
  <div class="album-head">
    <button onclick={() => (selectedId = null)}>← Albums</button>
    {#if selected.coverDataUrl}<img src={selected.coverDataUrl} alt="" />{/if}
    <div>
      <h1>{selected.title}</h1>
      <p class="muted">{selected.artist}</p>
      <button class="primary" onclick={() => app.send({ type: 'playAlbum', albumId: selected.id, startIndex: 0 })}>
        Play album
      </button>
    </div>
  </div>
  <ol class="tracks">
    {#each selected.trackIds as id, i (id)}
      {@const t = app.library.tracks[id]}
      <li class:playing={current?.id === id}>
        <button
          class="row"
          onclick={() => app.send({ type: 'playAlbum', albumId: selected.id, startIndex: i })}
        >
          <span class="no">{t.trackNo || i + 1}</span>
          <span class="name">{t.title}</span>
          <span class="muted">{formatTime(t.durationSec)}</span>
        </button>
      </li>
    {/each}
  </ol>
{:else}
  <div class="toolbar">
    <h2>Albums</h2>
    <button onclick={() => app.send({ type: 'rescan' })}>Rescan</button>
  </div>
  <div class="grid">
    {#each albums as album (album.id)}
      <button class="album" onclick={() => (selectedId = album.id)}>
        {#if album.coverDataUrl}
          <img src={album.coverDataUrl} alt="" />
        {:else}
          <div class="placeholder">{album.title.slice(0, 1)}</div>
        {/if}
        <span class="name">{album.title}</span>
        <span class="muted">{album.artist}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .empty {
    margin-top: 15vh;
    text-align: center;
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 18px;
  }

  .album {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0;
    background: none;
    border: none;
    text-align: left;
  }

  .album img,
  .placeholder {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: var(--radius);
    border: 1px solid var(--line);
  }

  .placeholder {
    display: grid;
    place-items: center;
    font-size: 40px;
    color: var(--muted);
    background: var(--panel-2);
  }

  .album:hover img,
  .album:hover .placeholder {
    border-color: var(--accent-dim);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .album-head {
    display: flex;
    gap: 20px;
    align-items: flex-end;
    margin-bottom: 20px;
  }

  .album-head > button {
    align-self: flex-start;
  }

  .album-head img {
    width: 160px;
    height: 160px;
    object-fit: cover;
    border-radius: var(--radius);
  }

  .album-head h1 {
    margin: 0;
    font-weight: 400;
  }

  .tracks {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .row {
    display: grid;
    grid-template-columns: 40px 1fr auto;
    width: 100%;
    background: none;
    border: none;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    padding: 10px 4px;
    text-align: left;
  }

  .row:hover {
    background: var(--panel);
  }

  .playing .row {
    color: var(--accent);
  }

  .no {
    color: var(--muted);
  }
</style>
