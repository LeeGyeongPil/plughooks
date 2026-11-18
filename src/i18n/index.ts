import { en, type MessageKey } from "./en.js";
import { ko } from "./ko.js";
import type { Lang } from "../types.js";

export type { MessageKey };

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { en, ko };

/** Language from the first source that gives a usable value: flag > PLUGHOOKS_LANG > LC_ALL > LC_MESSAGES > LANG. */
export function pickLang(flag: string | undefined, env: NodeJS.ProcessEnv): Lang {
  if (flag === "en" || flag === "ko") return flag;
  const own = env.PLUGHOOKS_LANG;
  if (own === "en" || own === "ko") return own;
  for (const v of [env.LC_ALL, env.LC_MESSAGES, env.LANG]) {
    if (v !== undefined && v !== "") return v.toLowerCase().startsWith("ko") ? "ko" : "en";
  }
  return "en";
}

export type Params = Record<string, string | number>;

/** Fill {name} placeholders; unknown placeholders (such as ${CLAUDE_PLUGIN_DATA}) stay as written. */
export function translate(lang: Lang, key: MessageKey, params: Params = {}): string {
  return MESSAGES[lang][key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
