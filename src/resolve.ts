import { eventRank, extractEvents, withSource } from "./hooks.js";
import { discover, scanPluginRows, stateFor, type Discovery, type PluginInfo } from "./plugins.js";
import { readSettings, type SettingsSet } from "./settings.js";
import type { Ctx, Diagnostic, HookRow } from "./types.js";
import { LAYERS } from "./types.js";

export interface Resolved {
  ctx: Ctx;
  settings: SettingsSet;
  discovery: Discovery;
  rows: HookRow[];
  diagnostics: Diagnostic[];
  /** Rows per plugin directory (key = plugin dir), for counts. */
  pluginRows: Map<string, HookRow[]>;
}

/** Read settings and plugins once and turn every declared hook into a row with source and state. */
export function resolveAll(ctx: Ctx): Resolved {
  const settings = readSettings(ctx);
  const discovery = discover(ctx, settings);
  const diagnostics: Diagnostic[] = [
    ...discovery.diagnostics,
    ...settings.shapeIssues.map((s): Diagnostic => ({ code: "W011", file: s.file, detail: s.detail })),
  ];
  const rows: HookRow[] = [];
  const disableAll = settings.disableAllHooks?.value === true;
  const managedOnly = settings.allowManagedHooksOnly?.value === true;

  // settings hooks: layers merge, identical handlers run once
  const seen = new Map<string, string>();
  for (const f of settings.files) {
    const raw = withSource(extractEvents(f.data.hooks, "hooks"), { kind: "settings", layer: f.layer, file: f.file });
    for (const r of raw) {
      const key = `${r.event}\0${r.matcher}\0${r.type}\0${r.command}`;
      const first = seen.get(key);
      if (first !== undefined) {
        rows.push({ ...r, state: "dup", reason: { key: "dup-of", file: first } });
        continue;
      }
      seen.set(key, f.file);
      if (managedOnly && f.layer !== "managed") {
        rows.push({ ...r, state: "shadowed", reason: { key: "managed-only", file: settings.allowManagedHooksOnly?.file ?? "" } });
      } else if (disableAll) {
        rows.push({ ...r, state: "shadowed", reason: { key: "all-hooks-disabled", file: settings.disableAllHooks?.file ?? "" } });
      } else {
        rows.push({ ...r, state: "on", reason: { key: "settings-hook", file: f.file, layer: f.layer } });
      }
    }
  }

  const pluginRows = new Map<string, HookRow[]>();
  for (const p of discovery.plugins) {
    const scan = scanPluginRows(p);
    diagnostics.push(...scan.diagnostics);
    const list = scan.rows.map(({ replaced, ...r }): HookRow => ({ ...r, ...stateFor(p, replaced, disableAll) }));
    pluginRows.set(p.dir, list);
    rows.push(...list);
  }

  rows.sort((a, b) => eventRank(a.event) - eventRank(b.event) || (a.event < b.event ? -1 : a.event > b.event ? 1 : 0));
  return { ctx, settings, discovery, rows, diagnostics, pluginRows };
}

export function findPlugin(res: Resolved, id: string): PluginInfo | undefined {
  const hits = res.discovery.plugins.filter((p) => p.id === id && p.kind !== "orphan");
  return hits[0];
}

export { LAYERS };
