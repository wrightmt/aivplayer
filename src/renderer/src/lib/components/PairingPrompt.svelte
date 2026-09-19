<script lang="ts">
  import { app } from '../app.svelte';

  // Only ever shown on the front: the hub ignores approvals sent from anywhere else.
  const request = $derived(app.role === 'front' ? (app.hub?.pending[0] ?? null) : null);
</script>

{#if request}
  <div class="backdrop">
    <div class="dialog" role="alertdialog" aria-labelledby="pair-title" aria-describedby="pair-body">
      <h2 id="pair-title">Allow this PC to connect?</h2>
      <p id="pair-body">
        <strong>{request.pcName}</strong> wants to play the rear channel from this PC.
      </p>
      <p class="muted address">{request.address}</p>
      <p class="muted">
        Allow it only if this is your own rear PC. Once allowed it reconnects on its own and you will not be
        asked again.
      </p>
      <div class="actions">
        <button onclick={() => app.send({ type: 'denyPairing', requestId: request.requestId })}>Deny</button>
        <button class="primary" onclick={() => app.send({ type: 'approvePairing', requestId: request.requestId })}>
          Allow
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 55%);
    z-index: 20;
  }

  .dialog {
    background: var(--panel);
    border: 1px solid var(--accent-dim);
    border-radius: var(--radius);
    padding: 20px 24px;
    max-width: 420px;
    box-shadow: 0 8px 32px rgb(0 0 0 / 50%);
  }

  p {
    margin: 0 0 10px;
  }

  .address {
    font-size: 12px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
</style>
