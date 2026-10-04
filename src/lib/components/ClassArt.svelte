<script lang="ts">
  import { loadTree } from "$lib/tree/load";
  import type { AssetStore } from "$lib/tree/assets";
  import { ascendancyPlate, plateNodes, type TreeModel } from "$lib/tree/model";

  let {
    version,
    className,
    ascendancy = null,
    size = 96,
    zoom = 1,
    allocated = null,
  }: {
    version: string;
    className: string;
    ascendancy?: string | null;
    size?: number;
    zoom?: number;
    /** Draws the ascendancy's nodes over its art, these ones lit. */
    allocated?: ReadonlySet<number> | null;
  } = $props();

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

  const plate = $derived.by(() => {
    if (!tree || !ascendancy) return undefined;
    return ascendancyPlate(tree.model, className, ascendancy);
  });

  const art = $derived.by(() => {
    if (!tree) return null;
    const cls = tree.model.classes.find((c) => c.name === className) ?? tree.model.classes.find((c) => c.ascendancies.some((a) => a.name === ascendancy));
    return plate?.bg || cls?.area?.bg || cls?.bg || null;
  });

  const subtree = $derived.by(() => {
    if (!tree || !plate || !allocated) return null;
    const nodes = plateNodes(tree.model, plate);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = tree.model.edges.filter((e) => ids.has(e.a) && ids.has(e.b));
    return { nodes, edges };
  });

  // The tree tab's "Active" connector colours.
  const GOLD = { outer: "#5d4717", inner: "#d9b256" };
  const UNTAKEN = 0.35;
  const SMALL_FILL = "#16120b";
  // Notable art is unreadable at true scale on a 136px portrait.
  const BOOST = { notable: 1.35, normal: 0.5 };
  // PoE1 notables sit closer together and overlap when enlarged.
  const BOOST_POE1 = { notable: 1, normal: 0.5 };

  function drawRound(ctx: CanvasRenderingContext2D, store: AssetStore, name: string, cx: number, cy: number, radius: number) {
    if (store.rect(name)?.round) {
      store.draw(ctx, name, cx, cy, radius, radius);
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    store.draw(ctx, name, cx, cy, radius, radius);
    ctx.restore();
  }

  let faded: HTMLCanvasElement | null = null;

  // Faded in one pass so connectors stay hidden under faded nodes.
  function drawSubtree(ctx: CanvasRenderingContext2D, store: AssetStore, r: number, dpr: number) {
    const sub = subtree;
    const p = plate;
    if (!sub || !p || !allocated || !tree) return;
    const lit = allocated;
    const M = tree.model;
    const k = (r * zoom) / p.half;
    const boost = M.poe1 ? BOOST_POE1 : BOOST;
    const tx = (x: number) => r + (x - p.x) * k;
    const ty = (y: number) => r + (y - p.y) * k;

    const layer = (c: CanvasRenderingContext2D, on: boolean) => {
      c.lineCap = "round";
      c.beginPath();
      for (const e of sub.edges) {
        if ((lit.has(e.a) && lit.has(e.b)) !== on) continue;
        const a = M.nodes.get(e.a)!;
        const b = M.nodes.get(e.b)!;
        c.moveTo(tx(a.x), ty(a.y));
        if (e.arc) c.arc(tx(e.arc.cx), ty(e.arc.cy), e.arc.r * k, e.arc.a1, e.arc.a2, e.arc.ccw);
        else c.lineTo(tx(b.x), ty(b.y));
      }
      c.strokeStyle = GOLD.outer;
      c.lineWidth = 2.6 * dpr;
      c.stroke();
      c.strokeStyle = GOLD.inner;
      c.lineWidth = 1.2 * dpr;
      c.stroke();

      const nodes = sub.nodes.filter((n) => lit.has(n.id) === on).sort((a, b) => Number(a.kind === "notable") - Number(b.kind === "notable"));
      for (const n of nodes) {
        const sx = tx(n.x);
        const sy = ty(n.y);
        if (n.kind === "ascStart") {
          store.draw(c, n.overlay?.unalloc ?? "AscendancyMiddle", sx, sy, n.size.overlay * k, n.size.overlay * k);
          continue;
        }
        const notable = n.kind === "notable";
        const half = n.size.overlay * k * (notable ? boost.notable : boost.normal);
        if (notable) {
          drawRound(c, store, n.icon, sx, sy, n.size.base * k * boost.notable);
        } else {
          // Fills the frame's hollow centre so connectors don't show through.
          c.beginPath();
          c.arc(sx, sy, half * 0.6, 0, Math.PI * 2);
          c.fillStyle = SMALL_FILL;
          c.fill();
        }
        if (n.overlay?.alloc) store.draw(c, n.overlay.alloc, sx, sy, half, half);
      }
    };

    const px = r * 2;
    faded ??= document.createElement("canvas");
    if (faded.width !== px) faded.width = faded.height = px;
    const fc = faded.getContext("2d");
    if (fc) {
      fc.clearRect(0, 0, px, px);
      layer(fc, false);
      ctx.globalAlpha = UNTAKEN;
      ctx.drawImage(faded, 0, 0);
      ctx.globalAlpha = 1;
    }
    layer(ctx, true);
  }

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
    drawSubtree(ctx, store, r, dpr);
    ctx.restore();
  }

  $effect(() => {
    art;
    size;
    zoom;
    subtree;
    allocated;
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
