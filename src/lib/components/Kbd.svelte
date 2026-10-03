<script lang="ts">
  import { keycaps } from "$lib/keys";

  let { keys, hint = false }: { keys: string; hint?: boolean } = $props();
</script>

<span class="kbd" class:hint aria-hidden="true">
  {#each keycaps(keys) as k}<kbd>{k}</kbd>{/each}
</span>

<style>
  .kbd {
    display: inline-flex;
    gap: 2px;
    flex: none;
    pointer-events: none;
  }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border: 1px solid var(--line-1);
    border-radius: 3px;
    background: var(--bg-1);
    color: var(--fg-3);
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1;
  }
  .hint {
    position: absolute;
    top: 50%;
    right: 6px;
    transform: translateY(-50%);
  }
  :global(:focus-within) > .hint {
    display: none;
  }
</style>
