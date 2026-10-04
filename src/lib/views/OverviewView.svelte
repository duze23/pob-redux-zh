<script lang="ts">
  import { engine, type BuildSummary, type ItemInfo, type SanityCheck, type SlotInfo, type Tooltip } from "$lib/engine.svelte";
  import { build, type ViewId } from "$lib/state/build.svelte";
  import { ui, type Jump } from "$lib/state/ui.svelte";
  import { game } from "$lib/state/game.svelte";
  import { loadTree } from "$lib/tree/load";
  import type { TreeModel } from "$lib/tree/model";
  import { stripPobText } from "$lib/pobtext";
  import ClassArt from "$lib/components/ClassArt.svelte";
  import CharacterDialog from "$lib/components/CharacterDialog.svelte";
  import EquipmentGrid from "$lib/components/EquipmentGrid.svelte";
  import PobTooltip from "$lib/components/PobTooltip.svelte";
  import { m } from "$lib/paraglide/messages";

  const FIELDS = [
    "FullDPS", "CombinedDPS", "TotalDPS", "TotalDotDPS", "AverageDamage", "AverageHit",
    "Speed", "CritChance", "CritMultiplier", "HitChance",
    "Life", "EnergyShield", "Mana", "Spirit", "TotalEHP",
    "FireResist", "ColdResist", "LightningResist", "ChaosResist",
    "PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken", "LightningMaximumHitTaken", "ChaosMaximumHitTaken",
    "Armour", "Evasion", "MeleeEvadeChance", "EffectiveBlockChance", "EffectiveSpellBlockChance", "EffectiveSpellSuppressionChance",
    "LifeRegenRecovery", "ManaRegenRecovery", "EffectiveMovementSpeedMod",
  ];

  let summary = $state<BuildSummary | null>(null);
  let sanity = $state<SanityCheck | null>(null);
  let slots = $state<SlotInfo[]>([]);
  let items = $state<ItemInfo[]>([]);
  let stats = $state<Record<string, number>>({});
  let model = $state<TreeModel | null>(null);
  let ascOpen = $state(false);
  let loadedRev = -1;

  $effect(() => {
    const rev = build.rev;
    if (!build.loaded || rev === loadedRev) return;
    loadedRev = rev;
    Promise.all([engine.buildSummary(), engine.sanityCheck(), engine.listSlots(), engine.getItems(), engine.getStats(FIELDS)])
      .then(([s, c, l, i, st]) => {
        summary = s;
        sanity = c;
        slots = l.slots;
        items = i.items;
        stats = Object.fromEntries(Object.entries(st.stats).filter(([, v]) => typeof v === "number")) as Record<string, number>;
      })
      .catch(() => {});
  });

  $effect(() => {
    const v = build.tree?.treeVersion;
    if (!v) return;
    let live = true;
    loadTree(v)
      .then((t) => live && (model = t.model))
      .catch(() => {});
    return () => {
      live = false;
    };
  });

  const info = $derived(build.info);
  const n = (k: string) => stats[k] ?? 0;
  const fmt = (v: number, digits = 0) => v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

  const headline = $derived.by(() => {
    for (const [k, label] of [["FullDPS", m.ov_dps()], ["CombinedDPS", m.ov_dps()], ["TotalDPS", m.ov_dps()], ["TotalDotDPS", m.ov_dot_dps()], ["AverageDamage", m.ov_average_damage()], ["AverageHit", m.ov_average_hit()]] as const) {
      if (n(k) > 0) return { value: n(k), label };
    }
    return { value: 0, label: m.ov_dps() };
  });

  function go(view: ViewId, jump?: Jump) {
    if (jump) ui.jump = jump;
    build.view = view;
  }

  const ORDER: Record<string, number> = { active: 0, trigger: 1, meta: 2, persistent: 3, granted: 4 };
  const supportsOf = $derived(new Map((build.skills?.socketGroups ?? []).map((g) => [g.index, g.gems.filter((x) => x.support && x.enabled !== false).map((x) => x.nameSpec ?? x.name)])));
  const skillRows = $derived(
    (summary?.skills ?? [])
      .filter((r) => r.enabled)
      .slice()
      .sort((a, b) => Number(b.main) - Number(a.main) || ORDER[a.press] - ORDER[b.press] || a.group - b.group),
  );
  const SHOWN = 9;

  const nodesBy = $derived.by(() => {
    const out = { keystones: [] as { id: number; name: string }[], asc: [] as { id: number; name: string }[], notables: 0 };
    if (!model || !build.tree) return out;
    for (const id of build.tree.allocatedNodes) {
      const node = model.nodes.get(id);
      if (!node) continue;
      if (node.kind === "keystone") out.keystones.push({ id, name: node.name });
      else if (node.kind === "notable" && node.asc) out.asc.push({ id, name: node.name });
      else if (node.kind === "notable") out.notables++;
    }
    out.notables += build.tree.dynamicNodes.filter((d) => d.allocated && d.type === "Notable").length;
    return out;
  });
  const jewels = $derived(slots.filter((s) => s.nodeId && s.itemId > 0));

  const notCounted = $derived(build.sidebar?.notCounted);
  const marked = $derived(new Set(notCounted?.items.map((x) => x.slot) ?? []));

  const AREA_VIEW: Record<string, ViewId> = {
    resistances: "items", "passive points": "tree", ascendancy: "tree", supports: "skills", spirit: "skills", reservation: "skills",
    buttons: "skills", charms: "items", flasks: "items", gear: "items", gems: "skills", movement: "items", pantheon: "config",
    requirements: "items", survivability: "calcs", "weapon sets": "tree",
  };
  const VIEW_LABEL = $derived<Record<string, string>>({
    items: m.view_items(), tree: m.view_tree(), skills: m.view_skills(), config: m.view_config(), calcs: m.view_calcs(),
  });
  const findings = $derived(sanity?.findings ?? []);
  const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const hits = $derived(
    [
      { key: "PhysicalMaximumHitTaken", label: m.ov_physical(), color: "var(--c-physical)" },
      { key: "FireMaximumHitTaken", label: m.ov_fire(), color: "var(--c-fire)" },
      { key: "ColdMaximumHitTaken", label: m.ov_cold(), color: "var(--c-cold)" },
      { key: "LightningMaximumHitTaken", label: m.ov_lightning(), color: "var(--c-lightning)" },
      { key: "ChaosMaximumHitTaken", label: m.ov_chaos(), color: "var(--c-chaos)" },
    ].map((h) => ({ ...h, value: n(h.key) })),
  );
  const weakest = $derived(hits.reduce((lo, h) => (h.value > 0 && (lo === null || h.value < lo.value) ? h : lo), null as (typeof hits)[number] | null));

  let tip = $state<{ tt: Tooltip; x: number; y: number } | null>(null);
  let tipTimer = 0;
  let tipRequest = 0;
  function showTip(e: MouseEvent | FocusEvent, fetch: () => Promise<Tooltip>) {
    clearTimeout(tipTimer);
    const request = ++tipRequest;
    const cell = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    const x = cell && cell.right + 8 + 540 <= window.innerWidth ? cell.right + 8 : Math.max(8, (cell?.left ?? 8) - 548);
    const y = Math.min(cell?.top ?? 40, Math.max(window.innerHeight - 520, 40));
    tipTimer = window.setTimeout(async () => {
      try {
        const tt = await fetch();
        if (request === tipRequest) tip = { tt, x, y };
      } catch {}
    }, 120);
  }
  function hideTip() {
    tipRequest++;
    clearTimeout(tipTimer);
    tip = null;
  }
</script>

{#if info}
  <div class="page">
    <div class="col">
      <section class="panel">
        <div class="hero">
          <button class="portrait" title={m.ov_asc_title()} onclick={() => (ascOpen = true)}>
            {#if build.tree}<ClassArt version={build.tree.treeVersion} className={info.className} ascendancy={info.ascendClassName} size={136} />{/if}
            <span class="change">{m.char_ascendancy()}</span>
          </button>
          <div class="who">
            <span class="nm">{info.name}</span>
            <span class="cl">
              {m.ov_level()} <span class="num">{info.level}</span>
              <b>{info.ascendClassName ?? info.className}</b>{#if info.ascendClassName}<span class="dim">{` · ${info.className}`}</span>{/if}
            </span>
            <div class="dps">
              <span class="big num">{fmt(headline.value)}</span>
              <span class="dim">{headline.label}</span>
              {#if summary?.mainSkill}
                <button class="skillchip" onclick={() => go("skills", { view: "skills", group: info.mainSocketGroup })}>{stripPobText(summary.mainSkill)}</button>
              {/if}
            </div>
            <span class="sub">
              {#if n("Speed") > 0}<span class="num">{fmt(n("Speed"), 2)}</span>{m.ov_per_second()}{/if}
              {#if n("CritChance") > 0}<span class="sep">·</span><span class="num">{fmt(n("CritChance"), 1)}%</span> {m.ov_crit()}{/if}
              {#if n("CritMultiplier") > 0}<span class="sep">·</span><span class="num">{fmt(n("CritMultiplier") * 100)}%</span> {m.ov_crit_multi()}{/if}
              {#if n("HitChance") > 0}<span class="sep">·</span><span class="num">{fmt(n("HitChance"))}%</span> {m.ov_hit()}{/if}
            </span>
          </div>
        </div>
        <div class="tiles">
          <div class="tile" style:--accent="var(--c-life)"><span class="k">{m.ov_life()}</span><span class="v num">{fmt(n("Life"))}</span></div>
          {#if n("EnergyShield") > 0}<div class="tile" style:--accent="var(--c-es)"><span class="k">{m.ov_es()}</span><span class="v num">{fmt(n("EnergyShield"))}</span></div>{/if}
          <div class="tile" style:--accent="var(--fg-2)"><span class="k">{m.ov_ehp()}</span><span class="v num">{fmt(n("TotalEHP"))}</span></div>
          <div class="tile" style:--accent="var(--c-mana)"><span class="k">{m.ov_mana()}</span><span class="v num">{fmt(n("Mana"))}</span></div>
          {#if game.isPoe2 && summary}
            <div class="tile" style:--accent="var(--c-spirit)">
              <span class="k">{m.ov_spirit()}</span>
              <span class="v num">{fmt(summary.spirit)}{#if summary.spiritUnreserved < 0}<span class="neg">{` ${fmt(summary.spiritUnreserved)}`}</span>{/if}</span>
            </div>
          {/if}
        </div>
        <div class="res">
          {#each [["FireResist", m.ov_fire(), "var(--c-fire)"], ["ColdResist", m.ov_cold(), "var(--c-cold)"], ["LightningResist", m.ov_lightning(), "var(--c-lightning)"], ["ChaosResist", m.ov_chaos(), "var(--c-chaos)"]] as [k, label, color] (k)}
            <span style:color>{label}<span class="v num" class:low={n(k) < 75}>{fmt(n(k))}%</span></span>
          {/each}
        </div>
      </section>

      <section class="panel">
        <div class="ph">
          <span class="t">{m.ov_gear()}</span>
          <span class="s">{m.ov_gear_sum({ count: slots.filter((s) => s.itemId > 0 && !s.nodeId && s.shown !== false && !s.inactive).length })}{#if notCounted?.count}<span class="neg">{` · ${m.ov_gear_nc({ count: notCounted.count })}`}</span>{/if}</span>
        </div>
        <EquipmentGrid
          {slots}
          {items}
          game={game.current}
          groups={build.skills?.socketGroups ?? []}
          selectedItem={null}
          legend={false}
          {marked}
          onselect={(id) => go("items", { view: "items", item: id })}
          onitemhover={(e, id) => showTip(e, () => engine.itemTooltip({ itemId: id }))}
          ongemhover={(e, g, i) => showTip(e, () => engine.gemTooltip(g, i))}
          onleave={hideTip}
        />
      </section>

      <section class="panel">
        <div class="ph"><span class="t">{m.ov_skills()}</span><span class="s">{m.ov_skills_sum({ count: skillRows.length })}</span></div>
        <div class="skills">
          {#each skillRows.slice(0, SHOWN) as r, i (r.group + ":" + r.skill)}
            {#if r.press === "persistent" && (i === 0 || skillRows[i - 1].press !== "persistent")}
              <div class="grp">
                {m.ov_persistent()}{#if game.isPoe2 && summary}<span class:neg={summary.spiritUnreserved < 0}>{` · ${m.ov_spirit_used({ used: fmt(summary.spirit - summary.spiritUnreserved), total: fmt(summary.spirit) })}`}</span>{/if}
              </div>
            {/if}
            <button class="sk" class:main={r.main} onclick={() => go("skills", { view: "skills", group: r.group })}>
              <span class="g">{stripPobText(r.skill)}{#if r.main}<span class="tag">{m.sidebar_stats_for()}</span>{/if}</span>
              <span class="sup">{(supportsOf.get(r.group) ?? []).join(" · ")}</span>
            </button>
          {/each}
          {#if skillRows.length > SHOWN}
            <button class="sk more" onclick={() => go("skills")}>{m.ov_more_skills({ count: skillRows.length - SHOWN })}</button>
          {/if}
        </div>
      </section>
    </div>

    <div class="col">
      <section class="panel">
        <div class="ph"><span class="t">{m.ov_health()}</span><span class="s">{findings.length + (notCounted?.count ? 1 : 0) ? m.ov_health_sum({ count: findings.length + (notCounted?.count ? 1 : 0) }) : m.ov_health_ok()}</span></div>
        {#each findings as f, i (i)}
          {@const view = AREA_VIEW[f.area]}
          <div class="finding">
            <span class="dot" class:warn={f.severity === "medium"} class:bad={f.severity === "high"}></span>
            <div class="ft"><div class="msg">{sentence(stripPobText(f.message))}</div>{#if f.fix}<div class="fix">{f.fix}</div>{/if}</div>
            {#if view}<button class="golink" onclick={() => go(view)}>{VIEW_LABEL[view]} →</button>{/if}
          </div>
        {/each}
        {#if notCounted?.count}
          <div class="finding">
            <span class="dot"></span>
            <div class="ft"><div class="msg">{m.ov_nc_msg({ count: notCounted.count })}</div><div class="fix">{m.sidebar_not_counted_title()}</div></div>
            <button class="golink" onclick={() => notCounted.items[0] ? go("items", { view: "items", item: slots.find((s) => s.slot === notCounted.items[0].slot)?.itemId ?? 0 }) : go("tree")}>{m.view_items()} →</button>
          </div>
        {/if}
      </section>

      <section class="panel">
        <div class="ph"><span class="t">{m.ov_defences()}</span><span class="s">{m.ov_defences_sum()}</span></div>
        <div class="hits">
          {#each hits as h (h.key)}
            <div class="hit" class:weak={weakest?.key === h.key} style:color={h.color}>
              <span class="k">{h.label}{#if weakest?.key === h.key}<span class="lowtag">{` · ${m.ov_lowest()}`}</span>{/if}</span>
              <span class="v num">{fmt(h.value)}</span>
            </div>
          {/each}
        </div>
        <div class="kv">
          {#if n("Evasion") > 0}<span>{m.ov_evasion()}</span><span class="v num">{fmt(n("Evasion"))}{#if n("MeleeEvadeChance") > 0}{` · ${m.ov_evade_melee({ value: fmt(n("MeleeEvadeChance")) })}`}{/if}</span>{/if}
          {#if n("Armour") > 0}<span>{m.ov_armour()}</span><span class="v num">{fmt(n("Armour"))}</span>{/if}
          <span>{m.ov_block()}</span><span class="v num">{fmt(n("EffectiveBlockChance"))}% · {fmt(n("EffectiveSpellBlockChance"))}% {m.ov_spell()}</span>
          {#if n("EffectiveSpellSuppressionChance") > 0}<span>{m.ov_suppression()}</span><span class="v num">{fmt(n("EffectiveSpellSuppressionChance"))}%</span>{/if}
          <span>{m.ov_life_regen()}</span><span class="v num">{fmt(n("LifeRegenRecovery"), 1)}/s</span>
          <span>{m.ov_mana_regen()}</span><span class="v num">{fmt(n("ManaRegenRecovery"), 1)}/s</span>
          <span>{m.ov_movement()}</span><span class="v num">{n("EffectiveMovementSpeedMod") >= 1 ? "+" : ""}{fmt((n("EffectiveMovementSpeedMod") - 1) * 100, 1)}%</span>
        </div>
      </section>

      <section class="panel">
        <div class="ph">
          <span class="t">{m.ov_passives()}</span>
          <span class="s num">{info.points.used}/{info.points.max} · {info.points.ascUsed}/{info.points.ascMax} {m.tree_points_asc()}</span>
        </div>
        <div class="pass">
          {#if nodesBy.keystones.length}
            <span class="k">{m.ov_keystones()}</span>
            <span class="links">{#each nodesBy.keystones as k, i (k.id)}{#if i}<span class="sep">·</span>{/if}<button class="key" onclick={() => go("tree", { view: "tree", node: k.id, name: k.name })}>{k.name}</button>{/each}</span>
          {/if}
          {#if nodesBy.asc.length}
            <span class="k">{m.ov_ascendancy()}</span>
            <span class="links">{#each nodesBy.asc as k, i (k.id)}{#if i}<span class="sep">·</span>{/if}<button class="asc" onclick={() => go("tree", { view: "tree", node: k.id, name: k.name })}>{k.name}</button>{/each}</span>
          {/if}
          <span class="k">{m.ov_notables()}</span><span>{m.ov_notables_count({ count: nodesBy.notables })}</span>
          {#if game.isPoe2 && (info.points.weaponSet1Used || info.points.weaponSet2Used)}
            <span class="k">{m.ov_weapon_sets()}</span>
            <span class="num"><span class="s1">I</span> {info.points.weaponSet1Used}/{info.points.weaponSetMax}<span class="sep">·</span><span class="s2">II</span> {info.points.weaponSet2Used}/{info.points.weaponSetMax}</span>
          {/if}
          {#if jewels.length}
            <span class="k">{m.ov_jewels()}</span>
            <span>{m.ov_jewels_sum({ count: jewels.length })}{#if jewels.some((j) => j.itemRarity === "UNIQUE")}{` · ${m.ov_jewels_unique({ count: jewels.filter((j) => j.itemRarity === "UNIQUE").length })}`}{/if}</span>
          {/if}
        </div>
      </section>
    </div>
  </div>
  {#if ascOpen}<CharacterDialog mode="ascendancy" onclose={() => (ascOpen = false)} />{/if}
  {#if tip}
    <PobTooltip lines={tip.tt.lines} header={tip.tt.header} runic={tip.tt.runic} uniqueGem={tip.tt.uniqueGem} itemArt={tip.tt.itemArt} x={tip.x} y={tip.y} />
  {/if}
{/if}

<style>
  .page {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 14px;
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(320px, 1fr);
    gap: 14px;
    align-items: start;
    background: var(--bg-0);
  }
  @media (max-width: 1100px) {
    .page {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .panel {
    border: 1px solid var(--line-1);
    border-radius: var(--r-2);
    background: var(--bg-1);
    overflow: hidden;
  }
  .ph {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--line-1);
    background: var(--bg-3);
  }
  .ph .t {
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-0);
  }
  .ph .s {
    margin-left: auto;
    font-size: var(--fs-xs);
    color: var(--fg-3);
  }
  .neg {
    color: var(--bad);
  }
  .sep {
    margin: 0 5px;
    color: var(--fg-4);
  }
  .dim {
    color: var(--fg-2);
  }

  .hero {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 18px;
    padding: 16px;
  }
  .portrait {
    appearance: none;
    position: relative;
    display: inline-flex;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    box-shadow: 0 0 0 1px var(--line-2);
    cursor: pointer;
  }
  .portrait:hover {
    box-shadow: 0 0 0 1px var(--fg-2);
  }
  .change {
    position: absolute;
    left: 50%;
    bottom: 4px;
    transform: translateX(-50%);
    padding: 1px 8px;
    border: 1px solid var(--line-2);
    border-radius: 10px;
    background: var(--bg-2);
    color: var(--fg-1);
    font-size: var(--fs-2xs);
    white-space: nowrap;
  }
  .who {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .nm {
    font-size: 20px;
    font-weight: 600;
    color: var(--fg-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cl {
    color: var(--fg-1);
    font-size: var(--fs-sm);
  }
  .cl b {
    margin-left: 4px;
    font-weight: 500;
    color: var(--c-class);
  }
  .dps {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 10px;
    margin-top: 10px;
  }
  .big {
    font-size: 30px;
    color: var(--fg-0);
    letter-spacing: -0.02em;
  }
  .skillchip {
    appearance: none;
    padding: 1px 9px;
    border: 1px solid var(--line-2);
    border-radius: 12px;
    background: transparent;
    color: var(--c-gem);
    font: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .skillchip:hover {
    background: var(--bg-hover);
  }
  .sub {
    font-size: var(--fs-xs);
    color: var(--fg-2);
  }
  .sub .num {
    color: var(--fg-1);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    border-top: 1px solid var(--line-0);
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 9px 12px 10px;
    border-right: 1px solid var(--line-0);
    box-shadow: inset 0 -2px 0 color-mix(in oklab, var(--accent) 70%, transparent);
  }
  .tile:last-child {
    border-right: 0;
  }
  .tile .k {
    font-size: var(--fs-xs);
    color: var(--fg-2);
  }
  .tile .v {
    font-size: 17px;
    color: var(--fg-0);
  }
  .tile .neg {
    font-size: var(--fs-sm);
  }
  .res {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    padding: 8px 12px;
    border-top: 1px solid var(--line-0);
    font-size: var(--fs-sm);
  }
  .res .v {
    margin-left: 5px;
    color: var(--fg-0);
  }
  .res .v.low {
    color: var(--warn);
  }

  .skills {
    display: flex;
    flex-direction: column;
  }
  .sk {
    appearance: none;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: baseline;
    gap: 12px;
    padding: 6px 12px;
    border: 0;
    border-top: 1px solid var(--line-0);
    background: transparent;
    color: var(--fg-1);
    font: inherit;
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .sk:first-child {
    border-top: 0;
  }
  .sk:hover {
    background: var(--bg-hover);
  }
  .sk.main {
    background: color-mix(in oklab, var(--focus) 10%, transparent);
  }
  .sk .g {
    color: var(--c-gem);
    white-space: nowrap;
  }
  .sk .tag {
    margin-left: 8px;
    font-size: var(--fs-2xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--focus);
  }
  .sk .sup {
    color: var(--fg-3);
    font-size: var(--fs-xs);
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sk.more {
    display: block;
    color: var(--fg-2);
    font-size: var(--fs-xs);
  }
  .grp {
    padding: 7px 12px 3px;
    border-top: 1px solid var(--line-0);
    font-size: var(--fs-2xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .finding {
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 10px;
    padding: 8px 12px;
    border-top: 1px solid var(--line-0);
    font-size: var(--fs-sm);
  }
  .ph + .finding {
    border-top: 0;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-3);
  }
  .dot.warn {
    background: var(--warn);
  }
  .dot.bad {
    background: var(--bad);
  }
  .msg {
    color: var(--fg-0);
  }
  .fix {
    margin-top: 2px;
    font-size: var(--fs-xs);
    color: var(--fg-2);
    line-height: 1.4;
  }
  .golink {
    appearance: none;
    padding: 0;
    border: 0;
    background: none;
    color: var(--focus);
    font: inherit;
    font-size: var(--fs-xs);
    white-space: nowrap;
    cursor: pointer;
  }
  .golink:hover {
    text-decoration: underline;
  }

  .hits {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
  .hit {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border-right: 1px solid var(--line-0);
  }
  .hit:last-child {
    border-right: 0;
  }
  .hit .k {
    font-size: var(--fs-xs);
  }
  .hit .v {
    color: var(--fg-0);
    font-size: var(--fs-md, 14px);
  }
  .hit.weak .v,
  .lowtag {
    color: var(--warn);
  }
  .kv {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 12px;
    padding: 10px 12px;
    border-top: 1px solid var(--line-0);
    font-size: var(--fs-sm);
  }
  .kv .v {
    color: var(--fg-0);
    text-align: right;
  }

  .pass {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 7px 10px;
    padding: 10px 12px 12px;
    font-size: var(--fs-sm);
    align-items: baseline;
  }
  .pass .k {
    font-size: var(--fs-xs);
    color: var(--fg-3);
  }
  .links button {
    appearance: none;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
  }
  .links button:hover {
    text-decoration: underline;
  }
  .key {
    color: var(--c-unique);
  }
  .asc {
    color: var(--fg-0);
  }
  .s1 {
    color: var(--bad);
    font-weight: 600;
  }
  .s2 {
    color: var(--ok);
    font-weight: 600;
  }
</style>
