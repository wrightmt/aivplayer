<script lang="ts">
  import { SAMPLE_RATE } from '../../../../shared/constants';
  import { currentFrame } from '../../../../shared/reducer';
  import { app } from '../app.svelte';
  import { formatDb, formatTime } from '../format';

  const player = $derived(app.hub?.player);
  const track = $derived(app.currentTrack);
  const album = $derived(track ? app.library.albums.find((a) => a.id === track.albumId) : undefined);
  const positionSec = $derived.by(() => {
    void app.clockTick;
    if (!player || !app.client) return 0;
    return Math.min(track?.durationSec ?? 0, currentFrame(player, app.client.hubNow()) / SAMPLE_RATE);
  });
  let dragging = $state<number | null>(null);
</script>

<div class="bar">
  <div class="track">
    {#if album?.coverDataUrl}<img src={album.coverDataUrl} alt="" />{/if}
    <div>
      <div class="title">{track?.title ?? 'Nothing playing'}</div>
      <div class="muted">{track ? `${track.artist} — ${track.album}` : ''}</div>
    </div>
  </div>

  <div class="transport">
    <div class="buttons">
      <button disabled={!track} onclick={() => app.send({ type: 'prev' })} aria-label="Previous">⏮</button>
      {#if player?.status === 'playing'}
        <button class="primary" onclick={() => app.send({ type: 'pause' })} aria-label="Pause">⏸</button>
      {:else}
        <button class="primary" disabled={!track} onclick={() => app.send({ type: 'play' })} aria-label="Play">▶</button>
      {/if}
      <button
        disabled={!player || player.index + 1 >= player.queue.length}
        onclick={() => app.send({ type: 'next' })}
        aria-label="Next">⏭</button>
    </div>
    <div class="seek">
      <span class="muted">{formatTime(dragging ?? positionSec)}</span>
      <input
        type="range"
        min="0"
        max={track?.durationSec ?? 0}
        step="0.5"
        disabled={!track}
        value={dragging ?? positionSec}
        oninput={(e) => (dragging = e.currentTarget.valueAsNumber)}
        onchange={(e) => {
          app.send({ type: 'seek', sec: e.currentTarget.valueAsNumber });
          dragging = null;
        }}
      />
      <span class="muted">{formatTime(track?.durationSec ?? 0)}</span>
    </div>
  </div>

  <label class="volume">
    <span class="muted">Front {formatDb(app.hub?.front.volumeDb ?? 0)}</span>
    <input
      type="range"
      min="-60"
      max="0"
      step="1"
      value={app.hub?.front.volumeDb ?? 0}
      oninput={(e) => app.send({ type: 'setFront', patch: { volumeDb: e.currentTarget.valueAsNumber } })}
    />
  </label>
</div>

<style>
  .bar {
    display: grid;
    grid-template-columns: 1fr 2fr 1fr;
    align-items: center;
    gap: 20px;
    padding: 12px 20px;
  }

  .track {
    display: flex;
    gap: 12px;
    align-items: center;
    min-width: 0;
  }

  .track img {
    width: 48px;
    height: 48px;
    border-radius: 4px;
    object-fit: cover;
  }

  .title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .transport {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .buttons {
    display: flex;
    justify-content: center;
    gap: 8px;
  }

  .seek {
    display: grid;
    grid-template-columns: 44px 1fr 44px;
    align-items: center;
    gap: 8px;
    font-variant-numeric: tabular-nums;
  }

  .seek span:last-child {
    text-align: right;
  }

  .volume {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
</style>
