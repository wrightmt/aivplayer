<script lang="ts">
  import { app } from '../app.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <div class="toast">{t.message}</div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 20px;
    bottom: 100px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 420px;
    z-index: 10;
  }

  .toast {
    background: var(--panel-2);
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    padding: 10px 14px;
    box-shadow: 0 4px 16px rgb(0 0 0 / 40%);
  }
</style>
