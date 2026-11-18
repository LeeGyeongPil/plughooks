import { join } from "node:path";
import { KNOWN_TOOLS, TOOL_EVENTS } from "./hooks.js";
import type { PluginInfo } from "./plugins.js";
import type { Resolved } from "./resolve.js";
import { checkSync } from "./sync.js";
import type { HookRow } from "./types.js";

export type WarnCode = "W001" | "W002" | "W003" | "W004" | "W005" | "W006" | "W007" | "W008" | "W009" | "W010" | "W011";

export interface Warning {
  code: WarnCode;
  /** Short stable name, e.g. disabled-plugin-has-hooks. */
  name: string;
  severity: "warn" | "info";
  pluginId?: string;
  /** Declaring file (absolute) and location, when there is one. */
  file?: string;
  jsonPath?: string;
  /** Language-neutral facts; render.ts turns them into a sentence. */
  data: Record<string, string | number | string[]>;
}

export const WARN_NAMES: Record<WarnCode, string> = {
  W001: "disabled-plugin-has-hooks",
  W002: "settings-hook-points-into-plugin",
  W003: "plugin-permission-hook",
  W004: "orphan-cache-hooks",
  W005: "same-name-plugins",
  W006: "hooks-globally-disabled",
  W007: "regex-matcher-wider",
  W008: "hooks-json-missing-wrapper",
  W009: "install-record-unrecognized",
  W010: "trimmed-copy-stale",
  W011: "unhandled-hook-location",
};

function mk(code: WarnCode, extra: Omit<Warning, "code" | "name" | "severity">, severity: "warn" | "info" = "warn"): Warning {
  return { code, name: WARN_NAMES[code], severity, ...extra };
}

/** Which plugin does a settings-hook command run? Matches known plugin folders and cache paths. */
function pluginForCommand(res: Resolved, command: string): { id: string; plugin: PluginInfo | undefined } | undefined {
  let best: PluginInfo | undefined;
  for (const p of res.discovery.plugins) {
    if (command.includes(p.dir) && (best === undefined || p.dir.length > best.dir.length)) best = p;
  }
  if (best !== undefined) return { id: best.id, plugin: best };
  const cache = join(res.ctx.pluginsRoot, "cache");
  const m = /[\\/]plugins[\\/]cache[\\/]([^\\/]+)[\\/]([^\\/\s"']+)/.exec(command);
  if (command.includes(cache) || m !== null) {
    const id = m === null ? "?" : m[2] + "@" + m[1];
    return { id, plugin: undefined };
  }
  return undefined;
}

/** Known tools a regex matcher also hits somewhere other than the start of the name. */
function widerTools(matcher: string): string[] {
  let re: RegExp;
  try {
    re = new RegExp(matcher);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const t of KNOWN_TOOLS) {
    const m = re.exec(t);
    if (m !== null && m.index > 0) out.push(t);
  }
  return out;
}

/** All warnings, in stable order (by code, then source). Read-only. */
export function runDoctor(res: Resolved, out?: string): Warning[] {
  const w: Warning[] = [];
  const rowsOf = (p: PluginInfo): HookRow[] => res.pluginRows.get(p.dir) ?? [];

  for (const p of res.discovery.plugins) {
    const rows = rowsOf(p);
    if (rows.length === 0) continue;
    if (p.kind === "orphan") {
      w.push(mk("W004", { pluginId: p.id, file: p.dir, data: { plugin: p.id, version: p.version ?? "?", count: rows.length } }));
      continue;
    }
    if (!p.enabled) {
      w.push(mk("W001", {
        pluginId: p.id, file: rows[0].source.file, jsonPath: rows[0].source.jsonPath,
        data: { plugin: p.id, events: [...new Set(rows.map((r) => r.event))], by: p.enabledBy?.file ?? "", layer: p.enabledBy?.layer ?? "default" },
      }));
      continue;
    }
    for (const r of rows) {
      if (r.event === "PreToolUse" || r.event === "PermissionRequest") {
        w.push(mk("W003", { pluginId: p.id, file: r.source.file, jsonPath: r.source.jsonPath, data: { plugin: p.id, event: r.event, matcher: r.matcher } }));
      }
    }
  }

  for (const r of res.rows) {
    if (r.source.kind !== "settings" || r.state === "dup") continue;
    const hit = pluginForCommand(res, r.command);
    if (hit === undefined) continue;
    const enabled = hit.plugin === undefined ? "unknown" : hit.plugin.enabled ? "on" : "off";
    w.push(mk("W002", {
      pluginId: hit.id, file: r.source.file, jsonPath: r.source.jsonPath,
      data: { plugin: hit.id, event: r.event, layer: r.source.layer ?? "", plugin_state: enabled },
    }));
  }

  const byName = new Map<string, PluginInfo[]>();
  for (const p of res.discovery.plugins) {
    if (p.kind === "orphan" || !p.enabled) continue;
    byName.set(p.manifestName, [...(byName.get(p.manifestName) ?? []), p]);
  }
  for (const [name, list] of byName) {
    if (list.length > 1) w.push(mk("W005", { data: { name, plugins: list.map((p) => p.id) } }));
  }

  const g = res.settings.disableAllHooks;
  const m = res.settings.allowManagedHooksOnly;
  if (g?.value === true) w.push(mk("W006", { file: g.file, data: { setting: "disableAllHooks", layer: g.layer } }, "info"));
  if (m?.value === true) w.push(mk("W006", { file: m.file, data: { setting: "allowManagedHooksOnly", layer: m.layer } }, "info"));

  for (const r of res.rows) {
    if (r.matcherKind !== "regex" || !TOOL_EVENTS.has(r.event)) continue;
    const tools = widerTools(r.matcher);
    if (tools.length > 0) {
      w.push(mk("W007", { file: r.source.file, jsonPath: r.source.jsonPath, data: { matcher: r.matcher, tools, event: r.event } }));
    }
  }

  for (const d of res.diagnostics) {
    const data: Record<string, string> = { detail: d.detail ?? "" };
    if (d.pluginId !== undefined) data.plugin = d.pluginId;
    w.push(mk(d.code, { pluginId: d.pluginId, file: d.file, data }));
  }

  for (const it of checkSync(res, out)) {
    if (it.status === "changed" || it.status === "copy-missing") {
      w.push(mk("W010", { pluginId: it.copy, data: { status: it.status, copy: it.copy, source: it.source, old: it.oldHash, now: it.newHash ?? "" } }));
    }
  }

  const key = (x: Warning): string => `${x.code}\0${x.file ?? ""}\0${x.jsonPath ?? ""}\0${x.pluginId ?? ""}`;
  return w.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
