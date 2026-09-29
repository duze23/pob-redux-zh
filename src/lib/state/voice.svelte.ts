import { Channel, invoke } from "@tauri-apps/api/core";
import { build } from "$lib/state/build.svelte";
import { game } from "$lib/state/game.svelte";
import { m } from "$lib/paraglide/messages";

const KEY = "pob-redux:voice";

interface VoiceStatus {
  installed: boolean;
  bytes: number;
}

/** Names from the open build, so Whisper spells them the way PoB does. */
function vocabulary() {
  const names = new Set<string>();
  const info = build.info;
  if (info) {
    names.add(info.className);
    if (info.ascendClassName) names.add(info.ascendClassName);
  }
  for (const g of build.skills?.socketGroups ?? []) {
    if (g.grantedBy?.item) names.add(g.grantedBy.item);
    for (const gem of g.gems) if (gem.name) names.add(gem.name);
  }
  const text = `${game.isPoe1 ? "Path of Exile" : "Path of Exile 2"} build. ${[...names].join(", ")}.`;
  return text.length > 600 ? text.slice(0, text.lastIndexOf(",", 600)) + "." : text;
}

class VoiceStore {
  enabled = $state(false);
  status = $state<VoiceStatus | null>(null);
  phase = $state<"idle" | "recording" | "transcribing">("idle");
  level = $state(0);
  progress = $state<number | null>(null);
  error = $state<string | null>(null);
  private started = false;
  private opening: Promise<unknown> = Promise.resolve();

  get ready() {
    return this.enabled && !!this.status?.installed;
  }

  async init() {
    if (this.started) return;
    this.started = true;
    try {
      this.enabled = JSON.parse(localStorage.getItem(KEY) ?? "{}").enabled === true;
    } catch {}
    await this.refresh();
  }

  async refresh() {
    this.status = await invoke<VoiceStatus>("voice_status").catch(() => null);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, JSON.stringify({ enabled: on }));
    } catch {}
  }

  async install() {
    this.error = null;
    this.progress = 0;
    const channel = new Channel<{ done: number; total: number }>();
    channel.onmessage = (p) => (this.progress = Math.floor((p.done * 100) / p.total));
    try {
      await invoke("voice_install", { onProgress: channel });
    } catch (e) {
      this.error = String(e);
    } finally {
      this.progress = null;
      await this.refresh();
    }
  }

  async remove() {
    this.error = null;
    try {
      await invoke("voice_remove");
    } catch (e) {
      this.error = String(e);
    }
    await this.refresh();
  }

  async start() {
    if (this.phase !== "idle") return;
    this.error = null;
    this.phase = "recording";
    const channel = new Channel<number>();
    channel.onmessage = (l) => {
      if (this.phase === "recording") this.level = l;
    };
    this.opening = invoke("voice_start", { onLevel: channel }).catch((e) => {
      this.phase = "idle";
      this.error = String(e);
    });
    await this.opening;
  }

  /** Stops recording and returns the text, or "" when nothing was said. */
  async stop(): Promise<string> {
    if (this.phase !== "recording") return "";
    await this.opening;
    if (this.phase !== "recording") return "";
    this.phase = "transcribing";
    this.level = 0;
    try {
      const text = await invoke<string>("voice_stop", { prompt: vocabulary() });
      if (!text) this.error = m.chat_voice_none();
      return text;
    } catch (e) {
      this.error = String(e);
      return "";
    } finally {
      this.phase = "idle";
    }
  }

  async cancel() {
    if (this.phase !== "recording") return;
    await this.opening;
    this.phase = "idle";
    this.level = 0;
    await invoke("voice_cancel").catch(() => {});
  }
}

export const voice = new VoiceStore();
