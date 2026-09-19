<script lang="ts">
  import type { Role } from '../../../../shared/types';
  import { app } from '../app.svelte';

  let saving = $state(false);

  async function choose(role: Role) {
    saving = true;
    await app.saveSettings({ role }); // the app relaunches in its new role
  }
</script>

<div class="picker">
  <h1>aIVplayer</h1>
  <p class="muted">Which speakers is this PC connected to?</p>
  <div class="choices">
    <button disabled={saving} onclick={() => choose('front')}>
      <strong>Front</strong>
      <span>The stereo pair in front of you. This PC holds the music library and plays the normal stereo mix.</span>
    </button>
    <button disabled={saving} onclick={() => choose('rear')}>
      <strong>Rear</strong>
      <span>The speakers behind you. This PC plays the difference signal (L−R), kept in time with the front.</span>
    </button>
  </div>
</div>

<style>
  .picker {
    max-width: 640px;
    margin: 12vh auto 0;
    padding: 0 24px;
    text-align: center;
  }

  h1 {
    font-weight: 300;
    letter-spacing: 0.2em;
  }

  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 32px;
  }

  .choices button {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 24px;
    text-align: left;
  }

  strong {
    font-size: 18px;
    color: var(--accent);
  }

  span {
    color: var(--muted);
    line-height: 1.5;
  }
</style>
