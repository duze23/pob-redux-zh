import { engine, writeTextFile, type GameBuildExport, type PlannerMode } from "$lib/engine.svelte";
import { build } from "$lib/state/build.svelte";
import { m } from "$lib/paraglide/messages";

/** Where a PoB build's Build Planner export goes: a file, or a folder for one file per loadout. */
export interface PlannerLink {
  mode: PlannerMode;
  target: string;
}

const LINKS_KEY = "pob-redux:planner-links";
export const AUTHOR_KEY = "pob-redux:author";

const fileName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "").trim() || "build";

function loadLinks(): Record<string, PlannerLink> {
  try {
    return JSON.parse(localStorage.getItem(LINKS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

class PlannerStore {
  links = $state<Record<string, PlannerLink>>(loadLinks());

  linkFor(buildFile: string | null | undefined): PlannerLink | null {
    return buildFile ? (this.links[buildFile] ?? null) : null;
  }

  setLink(buildFile: string, link: PlannerLink | null) {
    const next = { ...this.links };
    if (link) next[buildFile] = link;
    else delete next[buildFile];
    this.links = next;
    try {
      localStorage.setItem(LINKS_KEY, JSON.stringify(next));
    } catch {}
  }

  /** Exports the open build and writes it; returns the files written. */
  async write(mode: PlannerMode, target: string): Promise<{ paths: string[]; files: GameBuildExport[] }> {
    let author = "";
    try {
      author = localStorage.getItem(AUTHOR_KEY) ?? "";
    } catch {}
    const r = await build.run(() => engine.exportGameBuild({ mode, author: author || undefined }), { sync: mode !== "current", user: false });
    if (!r) throw new Error(build.error ?? "export failed");
    const paths: string[] = [];
    for (const f of r.files) {
      const path = mode === "each" ? `${target}/${fileName(f.name)}.build` : target;
      await writeTextFile(path, f.json);
      paths.push(path);
    }
    return { paths, files: r.files };
  }

  async sync(buildFile: string) {
    const link = this.linkFor(buildFile);
    if (!link) return;
    try {
      await this.write(link.mode, link.target);
      build.say(m.import_planner_updated());
    } catch (e) {
      build.error = m.import_planner_update_failed({ error: String(e) });
    }
  }
}

export const planner = new PlannerStore();
build.onSaved((path) => planner.sync(path));
