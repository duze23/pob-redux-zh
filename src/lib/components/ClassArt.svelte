<script lang="ts">
  import { loadTree } from "$lib/tree/load";
  import type { AssetStore } from "$lib/tree/assets";
  import type { TreeModel } from "$lib/tree/model";

  let {
    version,
    className,
    ascendancy = null,
    size = 96,
    zoom = 1,
  }: { version: string; className: string; ascendancy?: string | null; size?: number; zoom?: number } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let tree = $state<{ model: TreeModel; assets: AssetStore | null } | null>(null);
  let missing = $state(false);

  $effect(() => {
    const v = version;
    let live = true;
    loadTree(v)
      .then((t) => live && (tree = t))
      .catch(() => live && (missing = true));
    return () => {
      live = false;
    };
  });

  const art = $derived.by(() => {
    if (!tree) return null;
    const cls = tree.model.classes.find((c) => c.name === className) ?? tree.model.classes.find((c) => c.ascendancies.some((a) => a.name === ascendancy));
    const asc = ascendancy ? (cls?.ascendancies.find((a) => a.name === ascendancy) ?? tree.model.classes.flatMap((c) => c.ascendancies).find((a) => a.name === ascendancy)) : undefined;
    return asc?.bg || cls?.area?.bg || cls?.bg || null;
  });

  function draw() {
    const store = tree?.assets;
    const name = art;
    if (!canvas || !store || !name || !store.has(name)) {
      missing = !!tree && (!store || !name || !store.has(name));
      return;
    }
    missing = false;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(size * dpr);
    if (canvas.width !== px) canvas.width = canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const r = px / 2;
    ctx.clearRect(0, 0, px, px);
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.clip();
    store.draw(ctx, name, r, r, r * zoom, r * zoom);
    ctx.restore();
  }

  $effect(() => {
    art;
    size;
    zoom;
    draw();
    return tree?.assets?.subscribe(draw);
  });
</script>

<span class="art" style:width="{size}px" style:height="{size}px">
  <canvas bind:this={canvas} style:width="{size}px" style:height="{size}px"></canvas>
  {#if missing}<span class="initial" style:font-size="{Math.round(size * 0.3)}px">{(ascendancy ?? className).slice(0, 2)}</span>{/if}
</span>

<style>
  .art {
    position: relative;
    display: inline-block;
    flex: none;
    border-radius: 50%;
    background: var(--bg-3);
    overflow: hidden;
  }
  canvas {
    display: block;
  }
  .initial {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    color: var(--fg-3);
  }
</style>
