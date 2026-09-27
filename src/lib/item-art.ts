import { convertFileSrc } from "@tauri-apps/api/core";
import type { Tooltip } from "./engine.svelte";

type ArtItem = NonNullable<Tooltip["itemArt"]>;
type Game = ArtItem["game"];

export interface ArtMap {
  game: Game;
  version: string;
  bases: Record<string, string>;
  uniques: Record<string, string>;
  sockets: Record<string, string>;
  skills?: Record<string, string>;
  buffs?: Record<string, string>;
  buffNames?: Record<string, string>;
  buffVisuals?: Record<string, string>;
  files: Record<string, string>;
}

const lookup = (table: Record<string, string> | null | undefined, name: string | null | undefined) =>
  name && table && Object.hasOwn(table, name) ? table[name] : undefined;

export function artPath(map: ArtMap, item: ArtItem, supportGem = false): string | null {
  // PoB drops "Support" from PoE1 support gem names; some of them also name an active gem.
  const baseName = supportGem && item.game === "poe1" && item.baseName && !item.baseName.endsWith(" Support")
    ? `${item.baseName} Support`
    : item.baseName;
  const unique = item.rarity === "UNIQUE" || item.rarity === "RELIC";
  const candidates: [Record<string, string>, string | null | undefined][] = [];
  if (unique) candidates.push([map.uniques, item.name], [map.uniques, item.name?.replace(/^Foulborn\s+/, "")]);
  candidates.push([map.bases, baseName], [map.bases, baseName?.replace(/\s+\([^)]*\)$/, "")]);
  for (const [table, name] of candidates) {
    const path = lookup(table, name);
    if (path) return path;
  }
  return null;
}

/** Game inventory art is exported at 5/3 of the size PoE displays it. */
export function tooltipArtSize(naturalWidth: number, naturalHeight: number) {
  const scale = 3 / 5;
  return { width: Math.round(naturalWidth * scale), height: Math.round(naturalHeight * scale) };
}

const maps = new Map<Game, Promise<ArtMap | null>>();

function artMap(game: Game): Promise<ArtMap | null> {
  let pending = maps.get(game);
  if (!pending) {
    pending = fetch(convertFileSrc(`maps/${game}.json`, "pobart"))
      .then((res) => (res.ok ? (res.json() as Promise<ArtMap>) : null))
      .catch(() => null);
    maps.set(game, pending);
    pending.then((map) => {
      if (!map) maps.delete(game);
    });
  }
  return pending;
}

function artUrl(map: ArtMap, path: string): string | null {
  const tag = map.files[path];
  return tag ? convertFileSrc(`${map.game}/${tag}/${path}`, "pobart") : null;
}

const recipes = new Map<string, Promise<{ name: string; url: string | null }>>();

/** Tree recipes name PoE1 oils as "GoldenOil" and PoE2 emotions by the bare emotion ("Greed" is Diluted Liquid Greed). */
export function recipeArt(game: Game, word: string): Promise<{ name: string; url: string | null }> {
  const key = `${game}:${word}`;
  let pending = recipes.get(key);
  if (!pending) {
    pending = artMap(game).then((map) => {
      const bases = map?.bases ?? {};
      const emotions = Object.keys(bases).filter((k) => k === `Liquid ${word}` || k.endsWith(` Liquid ${word}`));
      const name =
        game === "poe1"
          ? word.replace(/Oil$/, " Oil")
          : (emotions.find((k) => !k.startsWith("Ancient ")) ?? emotions[0] ?? `Liquid ${word}`);
      const path = lookup(bases, name);
      if (!map) recipes.delete(key);
      return { name, url: map && path ? artUrl(map, path) : null };
    });
    recipes.set(key, pending);
  }
  return pending;
}

export async function itemArtUrl(item: ArtItem, supportGem = false): Promise<string | null> {
  const map = await artMap(item.game);
  const path = map && artPath(map, item, supportGem);
  return map && path ? artUrl(map, path) : null;
}

interface PrefetchItem {
  name: string;
  title?: string | null;
  baseName?: string | null;
  rarity?: string | null;
  runes?: string[];
}

export async function prefetchArt(game: Game, items: PrefetchItem[], gems: { name: string; support: boolean }[] = []) {
  const map = await artMap(game);
  if (!map) return;
  const urls = new Set<string>();
  const add = (item: ArtItem, supportGem = false) => {
    const path = artPath(map, item, supportGem);
    const url = path && artUrl(map, path);
    if (url) urls.add(url);
  };
  for (const item of items) {
    add({ game, name: item.title ?? item.name, baseName: item.baseName ?? null, rarity: item.rarity ?? null });
    for (const rune of item.runes ?? []) if (rune !== "None") add({ game, name: rune, baseName: rune, rarity: null });
  }
  for (const gem of gems) add({ game, name: gem.name, baseName: gem.name, rarity: null }, gem.support);
  for (const path of Object.values(map.sockets)) {
    const url = artUrl(map, path);
    if (url) urls.add(url);
  }
  await Promise.allSettled([...urls].map((url) => fetch(url)));
}

export async function socketArtUrls(game: Game): Promise<Record<string, string>> {
  const map = await artMap(game);
  if (!map) return {};
  return Object.fromEntries(
    Object.entries(map.sockets).flatMap(([key, path]) => {
      const url = artUrl(map, path);
      return url ? [[key, url]] : [];
    }),
  );
}

/** Resolve status art by name, stable id, then HUD skill art. */
export async function statusEffectArtUrls(game: Game, names: string[]): Promise<Record<string, string>> {
  const map = await artMap(game);
  if (!map) return {};
  const urls: [string, string][] = [];
  for (const name of names) {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const path = lookup(map.buffNames, name)
      ?? lookup(map.buffs, id)
      ?? lookup(map.buffVisuals, id)
      ?? lookup(map.skills, name);
    const url = path && artUrl(map, path);
    if (url) urls.push([name, url]);
  }
  return Object.fromEntries(urls);
}
