import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDirSafe, isFileSafe, isObj, readJsonFile, splitId, type Obj } from "./util.js";
import { readInstalled, selectRecords, type InstallRecord } from "./installed.js";
import { readFrontmatterHooks, FlowStyleError } from "./frontmatter.js";
import { extractEvents, unwrap, withSource } from "./hooks.js";
import type { Ctx, Diagnostic, EnabledInfo, HookReason, HookRow } from "./types.js";
import type { SettingsSet } from "./settings.js";

export type PluginKind = "installed" | "in-place" | "orphan" | "skills-dir";

export interface PluginInfo {
  id: string;
  name: string;
  marketplace: string;
  dir: string;
  kind: PluginKind;
  version: string | undefined;
  manifest: Obj | undefined;
  manifestFile: string;
  /** Manifest name, falling back to the marketplace entry name. */
  manifestName: string;
  entry: Obj | undefined;
  entryFile: string | undefined;
  marketplaceRoot: string | undefined;
  enabled: boolean;
  enabledBy: EnabledInfo | undefined;
  orphanReason: "marker" | "unregistered" | undefined;
}

export interface Discovery {
  plugins: PluginInfo[];
  diagnostics: Diagnostic[];
  installPresent: boolean;
  installRecognized: boolean;
  /** Directory marketplaces: name -> root folder (copies made by plughooks are found here). */
  marketRoots: Map<string, string>;
}

function dirs(p: string): string[] {
  if (!existsSync(p)) return [];
  return readdirSync(p).filter((n) => isDirSafe(join(p, n))).sort();
}

function readObj(file: string): Obj | undefined {
  const v = readJsonFile(file);
  return isObj(v) ? v : undefined;
}

/** Marketplace roots that load plugins in place (source "directory"). */
function directoryMarkets(ctx: Ctx, settings: SettingsSet): Map<string, string> {
  const out = new Map<string, string>();
  const add = (key: string, source: unknown, installLocation?: unknown): void => {
    if (!isObj(source) || source.source !== "directory" || typeof source.path !== "string") return;
    const root = resolve(ctx.project, typeof installLocation === "string" ? installLocation : source.path);
    if (existsSync(join(root, ".claude-plugin", "marketplace.json"))) out.set(key, root);
  };
  const known = readJsonFile(join(ctx.pluginsRoot, "known_marketplaces.json"));
  if (isObj(known)) for (const [k, v] of Object.entries(known)) if (isObj(v)) add(k, v.source, v.installLocation);
  for (const f of settings.files) {
    if (isObj(f.data.extraKnownMarketplaces)) {
      for (const [k, v] of Object.entries(f.data.extraKnownMarketplaces)) if (isObj(v)) add(k, v.source);
    }
  }
  return out;
}

interface EntryHit {
  entry: Obj;
  file: string;
  root: string;
}

/** Find the marketplace.json entry that describes `name` in marketplace `mkt`. */
function findEntry(ctx: Ctx, roots: Map<string, string>, mkt: string, name: string): EntryHit | undefined {
  const candidates = [roots.get(mkt), join(ctx.pluginsRoot, "marketplaces", mkt)].filter((x): x is string => x !== undefined);
  for (const root of candidates) {
    const file = join(root, ".claude-plugin", "marketplace.json");
    const m = existsSync(file) ? readObj(file) : undefined;
    if (m === undefined || !Array.isArray(m.plugins)) continue;
    const entry = m.plugins.find((p) => isObj(p) && p.name === name);
    if (isObj(entry)) return { entry, file, root };
  }
  return undefined;
}

export function discover(ctx: Ctx, settings: SettingsSet): Discovery {
  const inst = readInstalled(ctx);
  const diagnostics = [...inst.diagnostics];
  const roots = directoryMarkets(ctx, settings);
  const selected = selectRecords(inst.records, ctx.project);
  const registeredDirs = new Set(inst.records.map((r) => resolve(ctx.pluginsRoot, r.installPath)));
  const plugins: PluginInfo[] = [];

  const make = (
    id: string,
    dir: string,
    kind: PluginKind,
    version: string | undefined,
    entryHit?: EntryHit,
    orphanReason?: "marker" | "unregistered",
  ): PluginInfo => {
    const { name, marketplace } = splitId(id);
    const manifestFile = join(dir, ".claude-plugin", "plugin.json");
    const manifest = existsSync(manifestFile) ? readObj(manifestFile) : undefined;
    const hit = entryHit ?? findEntry(ctx, roots, marketplace, name);
    const enabledBy = settings.enabled.get(id);
    const dflt = manifest?.defaultEnabled ?? hit?.entry.defaultEnabled;
    const enabled = enabledBy !== undefined ? enabledBy.value : typeof dflt === "boolean" ? dflt : true;
    return {
      id, name, marketplace, dir, kind,
      version: version ?? (typeof manifest?.version === "string" ? manifest.version : undefined),
      manifest, manifestFile,
      manifestName: typeof manifest?.name === "string" ? manifest.name : name,
      entry: hit?.entry, entryFile: hit?.file, marketplaceRoot: hit?.root,
      enabled, enabledBy, orphanReason,
    };
  };

  // 1. installed plugins (cache or wherever installPath points)
  const seen = new Set<string>();
  for (const [id, list] of selected) {
    const rec: InstallRecord = list[0];
    const dir = resolve(ctx.pluginsRoot, rec.installPath);
    if (!existsSync(dir)) continue;
    plugins.push(make(id, dir, "installed", rec.version));
    seen.add(id);
  }

  // 2. plugins that directory marketplaces load in place
  for (const [mktKey, root] of roots) {
    const file = join(root, ".claude-plugin", "marketplace.json");
    const m = readObj(file);
    if (m === undefined || !Array.isArray(m.plugins)) continue;
    const mktName = typeof m.name === "string" ? m.name : mktKey;
    for (const entry of m.plugins) {
      if (!isObj(entry) || typeof entry.name !== "string" || typeof entry.source !== "string") continue;
      const id = `${entry.name}@${mktName}`;
      const dir = resolve(root, entry.source);
      if (seen.has(id) || !existsSync(dir)) continue;
      const version = typeof entry.version === "string" ? entry.version : undefined;
      plugins.push(make(id, dir, "in-place", version, { entry, file, root }));
      seen.add(id);
    }
  }

  // 3. cache scan: versions nobody references (or marked) are orphans
  const cache = join(ctx.pluginsRoot, "cache");
  for (const mkt of dirs(cache)) {
    for (const plugin of dirs(join(cache, mkt))) {
      for (const ver of dirs(join(cache, mkt, plugin))) {
        const dir = join(cache, mkt, plugin, ver);
        const id = `${plugin}@${mkt}`;
        const marker = existsSync(join(dir, ".orphaned_at"));
        if (!marker && registeredDirs.has(resolve(dir))) continue;
        // Unknown install format: we cannot tell, so unmarked versions count as installed.
        if (!marker && inst.present && !inst.recognized) {
          plugins.push(make(id, dir, "installed", ver));
          continue;
        }
        plugins.push(make(id, dir, "orphan", ver, undefined, marker ? "marker" : "unregistered"));
      }
    }
  }

  // 4. skills-dir plugins
  for (const base of [join(ctx.claudeDir, "skills"), join(ctx.project, ".claude", "skills")]) {
    for (const d of dirs(base)) {
      const dir = join(base, d);
      const mf = join(dir, ".claude-plugin", "plugin.json");
      if (!existsSync(mf)) continue;
      const m = readObj(mf);
      const name = typeof m?.name === "string" ? m.name : d;
      plugins.push(make(`${name}@skills-dir`, dir, "skills-dir", undefined));
    }
  }
  return { plugins, diagnostics, installPresent: inst.present, installRecognized: inst.recognized, marketRoots: roots };
}

export type ScanRow = Omit<HookRow, "state" | "reason"> & { replaced: boolean };

const MD_DIRS = ["skills", "agents", "commands"];

function markdownFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (isDirSafe(p)) walk(p);
      else if (n.endsWith(".md") && isFileSafe(p)) out.push(p);
    }
  };
  for (const d of MD_DIRS) walk(join(root, d));
  return out;
}

/** Key names that look like a hooks module; they are not interpreted (W011). */
export const MODULE_KEYS = ["mods", "hookModules", "hooksModule", "hooks_module"];

export interface PluginScan {
  rows: ScanRow[];
  diagnostics: Diagnostic[];
}

type ScanTarget = Pick<PluginInfo, "id" | "dir" | "manifest" | "manifestFile" | "entry" | "entryFile">;

/** Collect every declared hook of one plugin directory from the four documented places. */
export function scanPluginRows(p: ScanTarget): PluginScan {
  const rows: ScanRow[] = [];
  const diagnostics: Diagnostic[] = [];
  const src = (file: string, kind: "plugin" | "entry" | "frontmatter") => ({ kind, pluginId: p.id, pluginDir: p.dir, file });
  const add = (list: ReturnType<typeof withSource>): void => {
    for (const r of list) rows.push({ ...r, replaced: false });
  };

  // hooks/hooks.json (the {"hooks": ...} wrapper is required)
  const hj = join(p.dir, "hooks", "hooks.json");
  if (existsSync(hj)) {
    const raw = readJsonFile(hj);
    const u = unwrap(raw);
    if (!u.wrapped && isObj(raw) && Object.keys(raw).length > 0) diagnostics.push({ code: "W008", file: hj, pluginId: p.id });
    add(withSource(extractEvents(u.map, u.prefix), src(hj, "plugin")));
  }

  // plugin.json "hooks": path, inline object, or an array mixing both
  const mh = p.manifest?.hooks;
  const parts: { value: unknown; jsonPath: string }[] = Array.isArray(mh)
    ? mh.map((v, i) => ({ value: v, jsonPath: `hooks[${i}]` }))
    : mh === undefined ? [] : [{ value: mh, jsonPath: "hooks" }];
  for (const part of parts) {
    if (typeof part.value === "string") {
      const f = resolve(p.dir, part.value);
      if (!existsSync(f)) {
        diagnostics.push({ code: "W011", file: p.manifestFile, pluginId: p.id, detail: `missing hooks file ${part.value}` });
        continue;
      }
      const u = unwrap(readJsonFile(f));
      add(withSource(extractEvents(u.map, u.prefix), src(f, "plugin")));
    } else if (isObj(part.value)) {
      const u = unwrap(part.value);
      add(withSource(extractEvents(u.map, u.wrapped ? `${part.jsonPath}.hooks` : part.jsonPath), src(p.manifestFile, "plugin")));
    }
  }
  if (p.manifest !== undefined) {
    for (const k of MODULE_KEYS) {
      if (k in p.manifest) diagnostics.push({ code: "W011", file: p.manifestFile, pluginId: p.id, detail: `key ${k}` });
    }
  }

  // marketplace entry inline hooks; in strict mode they replace the manifest's hooks per event
  const eh = p.entry?.hooks;
  const entryRows: ReturnType<typeof withSource> = [];
  if (p.entry !== undefined && p.entryFile !== undefined && eh !== undefined) {
    if (isObj(eh)) {
      const u = unwrap(eh);
      entryRows.push(...withSource(extractEvents(u.map, u.wrapped ? "hooks.hooks" : "hooks"), src(p.entryFile, "entry")));
    } else {
      diagnostics.push({ code: "W011", file: p.entryFile, pluginId: p.id, detail: "entry hooks is not an inline object" });
    }
  }
  if (p.entry?.strict !== false && p.manifest !== undefined) {
    const events = new Set(entryRows.map((r) => r.event));
    for (const r of rows) if (events.has(r.event)) r.replaced = true;
  }
  add(entryRows);

  // frontmatter in skills, agents and commands
  for (const f of markdownFiles(p.dir)) {
    try {
      const fm = readFrontmatterHooks(readFileSync(f, "utf8"));
      if (fm !== undefined) add(withSource(extractEvents(fm.events, "frontmatter.hooks"), src(f, "frontmatter")));
    } catch (e) {
      if (!(e instanceof FlowStyleError)) throw e;
      diagnostics.push({ code: "W011", file: f, pluginId: p.id, detail: "flow-style frontmatter hooks" });
    }
  }
  return { rows, diagnostics };
}

export function stateFor(p: PluginInfo, replaced: boolean, disableAll: boolean): { state: HookRow["state"]; reason: HookReason } {
  if (p.kind === "orphan") {
    return { state: "orphan", reason: { key: p.orphanReason === "marker" ? "orphan-marker" : "orphan-unregistered" } };
  }
  if (!p.enabled) {
    return {
      state: "off",
      reason: p.enabledBy
        ? { key: "enabled-by-setting", file: p.enabledBy.file, layer: p.enabledBy.layer, value: false }
        : { key: "default-disabled" },
    };
  }
  if (replaced) return { state: "replaced", reason: { key: "replaced-by-entry" } };
  if (disableAll) return { state: "shadowed", reason: { key: "all-hooks-disabled" } };
  return {
    state: "on",
    reason: p.enabledBy
      ? { key: "enabled-by-setting", file: p.enabledBy.file, layer: p.enabledBy.layer, value: true }
      : { key: "default-enabled" },
  };
}
