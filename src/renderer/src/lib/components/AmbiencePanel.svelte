<script lang="ts">
  import type { RearMode, RearSettings } from '../../../../shared/types';
  import { app } from '../app.svelte';
  import { formatDb } from '../format';
  import SyncStats from './SyncStats.svelte';

  const rear = $derived(app.hub?.rear);
  const modes: { id: RearMode; label: string; hint: string }[] = [
    { id: 'difference', label: 'Difference', hint: 'Both rear speakers play L−R' },
    { id: 'wide', label: 'Wide', hint: 'Rear left L−R, rear right R−L' },
    { id: 'single', label: 'Single', hint: "Eno's arrangement: one speaker plays L−R" },
  ];
  const set = (patch: Partial<RearSettings>) => app.send({ type: 'setRear', patch });
</script>

<h2>Ambience</h2>
{#if rear}
  <label class="toggle">
    <input type="checkbox" checked={rear.enabled} onchange={(e) => set({ enabled: e.currentTarget.checked })} />
    Rear speakers on
  </label>

  <div class="segmented" role="radiogroup" aria-label="Rear mode">
    {#each modes as m (m.id)}
      <button role="radio" aria-checked={rear.mode === m.id} class:active={rear.mode === m.id} onclick={() => set({ mode: m.id })}>
        {m.label}
      </button>
    {/each}
  </div>
  <p class="muted hint">{modes.find((m) => m.id === rear.mode)?.hint}</p>

  {#if rear.mode === 'single'}
    <div class="segmented" role="radiogroup" aria-label="Active rear speaker">
      {#each ['L', 'R'] as const as side (side)}
        <button role="radio" aria-checked={rear.singleSide === side} class:active={rear.singleSide === side} onclick={() => set({ singleSide: side })}>
          Rear {side === 'L' ? 'left' : 'right'}
        </button>
      {/each}
    </div>
  {/if}

  <label class="slider">
    <span>Rear level <span class="muted">{formatDb(rear.gainDb)}</span></span>
    <input type="range" min="-30" max="6" step="1" value={rear.gainDb} oninput={(e) => set({ gainDb: e.currentTarget.valueAsNumber })} />
  </label>

  <label class="slider">
    <span>Rear delay <span class="muted">{rear.delayMs} ms</span></span>
    <input type="range" min="0" max="50" step="1" value={rear.delayMs} oninput={(e) => set({ delayMs: e.currentTarget.valueAsNumber })} />
  </label>

  <SyncStats compact />
{:else}
  <p class="muted">Waiting for the front…</p>
{/if}

<style>
  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }

  .segmented {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    margin-bottom: 8px;
  }

  .segmented button {
    border-radius: 0;
    padding: 6px 4px;
  }

  .segmented button:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
  }

  .segmented button:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
  }

  .segmented button.active {
    background: var(--accent-dim);
    border-color: var(--accent);
  }

  .hint {
    margin: 0 0 16px;
    font-size: 12px;
  }

  .slider {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 16px 0;
  }
</style>
