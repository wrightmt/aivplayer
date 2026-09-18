<script lang="ts">
  import { app } from '../app.svelte';

  let { compact = false }: { compact?: boolean } = $props();
  const rear = $derived(app.hub?.peers.find((p) => p.role === 'rear'));
  const s = $derived(rear?.stats);
  const syncTone = $derived(!s ? 'muted' : Math.abs(s.syncErrorMs) < 2 ? 'ok' : Math.abs(s.syncErrorMs) < 10 ? 'warn' : 'error');
</script>

{#if !rear}
  <p class="muted small">No rear PC connected.</p>
{:else if !s}
  <p class="muted small">Waiting for sync stats from {rear.pcName}…</p>
{:else if compact}
  <p class="small">
    <span class="tone-{syncTone}">sync {s.syncErrorMs.toFixed(1)} ms</span>
    <span class="muted"> · {s.correctionPpm.toFixed(0)} ppm · {s.state}</span>
  </p>
{:else}
  <table>
    <tbody>
      <tr><th>Rear PC</th><td>{rear.pcName}</td></tr>
      <tr><th>State</th><td>{s.state}</td></tr>
      <tr><th>Sync error</th><td class="tone-{syncTone}">{s.syncErrorMs.toFixed(2)} ms</td></tr>
      <tr><th>Correction</th><td>{s.correctionPpm.toFixed(1)} ppm</td></tr>
      <tr><th>Buffer</th><td>{s.bufferMs.toFixed(0)} ms</td></tr>
      <tr><th>Round trip</th><td>{s.rttMs.toFixed(2)} ms</td></tr>
      <tr><th>Timestamp jitter</th><td>{s.timestampJitterMs.toFixed(1)} ms</td></tr>
      <tr><th>Underruns</th><td>{s.underruns}</td></tr>
      <tr><th>Resyncs</th><td>{s.resyncs}</td></tr>
    </tbody>
  </table>
{/if}

<style>
  .small {
    font-size: 12px;
    margin: 20px 0 0;
  }

  table {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  th {
    text-align: left;
    font-weight: 400;
    color: var(--muted);
    padding: 3px 24px 3px 0;
  }
</style>
