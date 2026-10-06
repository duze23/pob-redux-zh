import {
  baseLocale,
  locales,
  isLocale,
  overwriteGetLocale,
  getTextDirection,
  localStorageKey,
  type Locale,
} from "$lib/paraglide/runtime";

export type LocalePreference = "system" | Locale;

export const LOCALES = locales as readonly Locale[];

/** Each language in its own name, which is what a language picker should show. */
export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  ja: "日本語",
  ko: "한국어",
  "pt-BR": "Português (Brasil)",
  ru: "Русский",
  th: "ไทย",
  "zh-CN": "简体中文",
};

/** Tags the OS may report that no shipped locale matches exactly. */
const ALIASES: Record<string, Locale> = { pt: "pt-BR", "pt-pt": "pt-BR" };

/** Traditional-Chinese tags must not fall through to Simplified via the base match below. */
const OTHER_CHINESE = new Set(["zh-tw", "zh-hk", "zh-mo", "zh-hant"]);

function match(tag: string): Locale | undefined {
  const lower = tag.toLowerCase();
  if (OTHER_CHINESE.has(lower)) return undefined;
  const exact = LOCALES.find((l) => l.toLowerCase() === lower);
  if (exact) return exact;
  if (ALIASES[lower]) return ALIASES[lower];
  const base = lower.split("-")[0];
  return LOCALES.find((l) => l.toLowerCase().split("-")[0] === base) ?? ALIASES[base];
}

function detectSystem(): Locale {
  for (const tag of navigator?.languages ?? []) {
    const hit = match(tag);
    if (hit) return hit;
  }
  return baseLocale as Locale;
}

/** `getLocale()` reads `current`, so every message re-runs on a change and the app switches without a reload. */
class LocaleStore {
  preference = $state<LocalePreference>("system");
  system = $state<Locale>(baseLocale as Locale);
  current = $state<Locale>(baseLocale as Locale);

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(localStorageKey);
    } catch {}
    this.system = detectSystem();
    this.preference = isLocale(saved) ? saved : "system";
    this.current = this.preference === "system" ? this.system : this.preference;
    overwriteGetLocale(() => this.current);
    this.applyDocument();
  }

  set(preference: LocalePreference) {
    this.preference = preference;
    this.current = preference === "system" ? this.system : preference;
    try {
      if (preference === "system") localStorage.removeItem(localStorageKey);
      else localStorage.setItem(localStorageKey, preference);
    } catch {}
    this.applyDocument();
  }

  private applyDocument() {
    document.documentElement.lang = this.current;
    document.documentElement.dir = getTextDirection(this.current);
  }
}

export const locale = new LocaleStore();
