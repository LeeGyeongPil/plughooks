import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PlugError } from "./errors.js";
import { FlowStyleError, stripFrontmatterHooks } from "./frontmatter.js";
import { KNOWN_EVENTS, unwrap } from "./hooks.js";
import { applyJsonPatch, detectFormat, planSetPaths, stringifyLike, type SettingsPlan } from "./jsonWrite.js";
import { MODULE_KEYS, scanPluginRows, type PluginInfo } from "./plugins.js";
import { findPlugin, type Resolved } from "./resolve.js";
import { settingsPath } from "./settings.js";
import type { DropSpec, HookRow, Layer } from "./types.js";
import { EXCLUDED, hashDir, isObj, readJsonFile, type Obj } from "./util.js";

export const MARKET_NAME = "plughooks-local";
export const LOCK_FILE = "plughooks-lock.json";
const MD_DIRS = ["skills", "agents", "commands"];

export interface LockEntry {
  copy: string;
  source: string;
  sourcePath: string;
  sourceVersion: string | null;
  sourceHash: string;
  drop: DropSpec;
}

export interface Lock {
  version: 1;
  marketplace: string;
  plugins: LockEntry[];
}

export function readLock(out: string): Lock | undefined {
  const raw = readJsonFile(join(out, LOCK_FILE));
  if (!isObj(raw) || !Array.isArray(raw.plugins)) return undefined;
  return { version: 1, marketplace: typeof raw.marketplace === "string" ? raw.marketplace : MARKET_NAME, plugins: raw.plugins as LockEntry[] };
}

export function defaultOut(res: Resolved): string {
  return join(res.ctx.claudeDir, "plughooks-marketplace");
}

function mdFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".md")) out.push(p);
    }
  };
  for (const d of MD_DIRS) walk(join(root, d));
  return out;
}

function inside(dir: string, file: string): boolean {
  const rel = relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Everything that must hold before a copy can be made safely. Throws exit 3 (or 2 for bad input). */
function assertTrimmable(p: PluginInfo): void {
  for (const f of mdFiles(p.dir)) {
    try {
      stripFrontmatterHooks(readFileSync(f, "utf8"), "all");
    } catch (e) {
      if (e instanceof FlowStyleError) throw new PlugError(3, "err.flowFrontmatter", { file: f });
      throw e;
    }
  }
  if (p.manifest !== undefined) {
    for (const k of MODULE_KEYS) if (k in p.manifest) throw new PlugError(3, "err.unhandledLocation", { file: p.manifestFile, detail: k });
    const mh = p.manifest.hooks;
    const parts = Array.isArray(mh) ? mh : mh === undefined ? [] : [mh];
    for (const part of parts) {
      if (typeof part === "string" && !inside(p.dir, resolve(p.dir, part))) {
        throw new PlugError(3, "err.unhandledLocation", { file: p.manifestFile, detail: part });
      }
    }
  }
}

function filterMap(map: unknown, drop: DropSpec): Obj {
  const out: Obj = {};
  if (!isObj(map) || drop.mode === "all") return out;
  for (const [k, v] of Object.entries(map)) if (!drop.events.includes(k)) out[k] = v;
  return out;
}

function rewrite(file: string, value: unknown): void {
  const fmt = detectFormat(readFileSync(file, "utf8"));
  writeFileSync(file, stringifyLike(value, fmt));
}

/** Remove hook definitions from a copied plugin folder (all of them, or the listed events). */
function stripHooks(dir: string, drop: DropSpec): void {
  const events: string[] | "all" = drop.mode === "all" ? "all" : drop.events;

  const hj = join(dir, "hooks", "hooks.json");
  if (existsSync(hj)) {
    const rest = filterMap(unwrap(readJsonFile(hj)).map, drop);
    if (Object.keys(rest).length === 0) rmSync(hj);
    else rewrite(hj, { hooks: rest });
  }

  const mf = join(dir, ".claude-plugin", "plugin.json");
  const manifest = existsSync(mf) ? readJsonFile(mf) : undefined;
  if (isObj(manifest) && manifest.hooks !== undefined) {
    const parts = Array.isArray(manifest.hooks) ? manifest.hooks : [manifest.hooks];
    const kept: unknown[] = [];
    for (const part of parts) {
      if (typeof part === "string") {
        const f = resolve(dir, part);
        if (!existsSync(f)) continue;
        const rest = filterMap(unwrap(readJsonFile(f)).map, drop);
        if (Object.keys(rest).length === 0) {
          rmSync(f);
        } else {
          rewrite(f, { hooks: rest });
          kept.push(part);
        }
      } else if (isObj(part)) {
        const u = unwrap(part);
        const rest = filterMap(u.map, drop);
        if (Object.keys(rest).length > 0) kept.push(u.wrapped ? { hooks: rest } : rest);
      }
    }
    if (kept.length === 0) delete manifest.hooks;
    else manifest.hooks = Array.isArray(manifest.hooks) ? kept : kept[0];
    rewrite(mf, manifest);
  }

  for (const f of mdFiles(dir)) {
    const before = readFileSync(f, "utf8");
    const after = stripFrontmatterHooks(before, events);
    if (after !== before) writeFileSync(f, after);
  }
}

function describeDrop(drop: DropSpec): string {
  return drop.mode === "all" ? "with hooks removed" : `without ${drop.events.join("/")} hooks`;
}

export interface MaterializeInput {
  source: PluginInfo;
  copyName: string;
  drop: DropSpec;
  out: string;
}

/** Build the hook-free copy in a temp folder next to the target, verify it, then swap it in. */
export function materialize(inp: MaterializeInput): { copyDir: string; entry: Obj } {
  const { source, copyName, drop, out } = inp;
  const copyDir = join(out, "plugins", copyName);
  const tmp = join(out, `.plughooks-tmp-${copyName}`);
  const copyId = `${copyName}@${MARKET_NAME}`;
  mkdirSync(out, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });
  try {
    cpSync(source.dir, tmp, { recursive: true, filter: (s) => !EXCLUDED.has(basename(s)) });
    stripHooks(tmp, drop);

    // rename inside plugin.json (or create a minimal one)
    const mf = join(tmp, ".claude-plugin", "plugin.json");
    const note = `(copy of ${source.id} ${describeDrop(drop)}, made by plughooks)`;
    if (existsSync(mf)) {
      const m = readJsonFile(mf) as Obj;
      m.name = copyName;
      m.description = typeof m.description === "string" && m.description !== "" ? `${m.description} ${note}` : note;
      rewrite(mf, m);
    } else {
      mkdirSync(dirname(mf), { recursive: true });
      writeFileSync(mf, stringifyLike({ name: copyName, description: note }, { indent: "  ", eol: "\n", trailingNewline: true }));
    }

    // verify: nothing the drop rule covers may remain
    const manifest = readJsonFile(mf) as Obj;
    const left = scanPluginRows({ id: copyId, dir: tmp, manifest, manifestFile: mf, entry: undefined, entryFile: undefined });
    const remaining = left.rows.filter((r) => drop.mode === "all" || drop.events.includes(r.event));
    if (remaining.length > 0) throw new PlugError(3, "err.hooksRemain", { file: remaining[0].source.file });

    rmSync(copyDir, { recursive: true, force: true });
    mkdirSync(dirname(copyDir), { recursive: true });
    renameSync(tmp, copyDir);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }

  // marketplace entry for the copy: original fields minus hooks (kept, filtered, in events mode)
  const base: Obj = {};
  for (const [k, v] of Object.entries(source.entry ?? {})) if (k !== "name" && k !== "source" && k !== "hooks") base[k] = v;
  const entry: Obj = { name: copyName, source: `./plugins/${copyName}`, ...base };
  if (drop.mode === "events" && isObj(source.entry?.hooks)) {
    const rest = filterMap(unwrap(source.entry.hooks).map, drop);
    if (Object.keys(rest).length > 0) entry.hooks = rest;
  }
  return { copyDir, entry };
}

/** Add or replace the copy in the marketplace file and the lock. */
export function writeMarketplace(out: string, entry: Obj, lockEntry: LockEntry): void {
  const mpFile = join(out, ".claude-plugin", "marketplace.json");
  const existing = existsSync(mpFile) ? readJsonFile(mpFile) : undefined;
  const mp: Obj = isObj(existing)
    ? existing
    : { name: MARKET_NAME, owner: { name: "plughooks" }, metadata: { description: "Hook-free plugin copies made by plughooks" }, plugins: [] };
  const plugins = (Array.isArray(mp.plugins) ? mp.plugins : []).filter((p) => !(isObj(p) && p.name === entry.name));
  plugins.push(entry);
  mp.plugins = plugins;
  mkdirSync(dirname(mpFile), { recursive: true });
  writeFileSync(mpFile, stringifyLike(mp, { indent: "  ", eol: "\n", trailingNewline: true }));

  const lock = readLock(out) ?? { version: 1 as const, marketplace: MARKET_NAME, plugins: [] };
  lock.plugins = lock.plugins.filter((p) => p.copy !== lockEntry.copy);
  lock.plugins.push(lockEntry);
  lock.plugins.sort((a, b) => (a.copy < b.copy ? -1 : 1));
  writeFileSync(join(out, LOCK_FILE), stringifyLike(lock, { indent: "  ", eol: "\n", trailingNewline: true }));
}

export function sourceHashOf(p: PluginInfo): string {
  return hashDir(p.dir, JSON.stringify(p.entry ?? null));
}

export interface TrimOptions {
  id: string;
  drop: DropSpec;
  out: string | undefined;
  name: string | undefined;
  scope: "user" | "local";
  noSettings: boolean;
  /** Allow a trim that removes no hook at all (default: refused when applying). */
  allowEmpty?: boolean;
  /** Set when the plan will be applied; only then is an empty trim refused. */
  apply?: boolean;
}

export interface TrimPlan {
  source: PluginInfo;
  copyName: string;
  copyId: string;
  out: string;
  copyDir: string;
  drop: DropSpec;
  sourceHash: string;
  dropped: HookRow[];
  settings: SettingsPlan | undefined;
  settingsLayer: Layer;
  /** The `enabledPlugins` / `extraKnownMarketplaces` assignments, as text lines. */
  assignments: string[];
  overrideFile: string | undefined;
}

const LAYER_RANK: Record<Layer, number> = { user: 0, project: 1, local: 2, managed: 3 };

/** Compute everything a trim would do. Reads only; throws exit 2 / 3 for unsafe or invalid requests. */
export function planTrim(res: Resolved, o: TrimOptions): TrimPlan {
  const source = findPlugin(res, o.id);
  if (source === undefined) {
    const known = res.discovery.plugins.filter((p) => p.kind !== "orphan").map((p) => p.id).join(", ");
    throw new PlugError(2, "err.unknownPlugin", { id: o.id, known: known === "" ? "-" : known });
  }
  if (source.id.endsWith(`@${MARKET_NAME}`)) throw new PlugError(2, "err.sourceIsCopy", { id: source.id });
  if (o.drop.mode === "events" && o.drop.events.length === 0) throw new PlugError(2, "err.noEvents");
  if (o.drop.mode === "events") {
    const declared = [...new Set((res.pluginRows.get(source.dir) ?? []).map((r) => r.event))];
    for (const ev of o.drop.events) {
      if (KNOWN_EVENTS.has(ev) || declared.includes(ev)) continue;
      const near = [...KNOWN_EVENTS, ...declared].find((k) => k.toLowerCase() === ev.toLowerCase());
      throw new PlugError(2, "err.unknownEvent", {
        event: ev,
        suggest: near ?? (declared.length > 0 ? declared.join(", ") : "-"),
        declared: declared.length > 0 ? declared.join(", ") : "-",
      });
    }
  }
  const forced = res.settings.enabled.get(source.id);
  if (forced !== undefined && forced.layer === "managed" && forced.value === true) {
    throw new PlugError(3, "err.managedForced", { id: source.id, file: forced.file });
  }
  assertTrimmable(source);

  const copyName = o.name ?? `${source.manifestName}-nohooks`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(copyName)) throw new PlugError(2, "err.badName", { name: copyName });
  const copyId = `${copyName}@${MARKET_NAME}`;
  const out = resolve(o.out ?? defaultOut(res));
  const copyDir = join(out, "plugins", copyName);
  if (existsSync(out)) {
    if (!statSync(out).isDirectory() || (readdirSync(out).length > 0 && !existsSync(join(out, LOCK_FILE)))) {
      throw new PlugError(3, "err.outNotOurs", { out });
    }
    const lock = readLock(out);
    const mine = lock?.plugins.find((p) => p.copy === copyId);
    if ((existsSync(copyDir) && mine === undefined) || (mine !== undefined && mine.source !== source.id)) {
      throw new PlugError(3, "err.copyNameTaken", { name: copyName });
    }
  }

  const all = res.pluginRows.get(source.dir) ?? [];
  const dropped = all.filter((r) => o.drop.mode === "all" || o.drop.events.includes(r.event));
  if (o.apply === true && o.allowEmpty !== true && dropped.length === 0) throw new PlugError(2, "err.nothingToDrop", { id: source.id });

  let settings: SettingsPlan | undefined;
  let overrideFile: string | undefined;
  const assignments = [`"${source.id}": false`, `"${copyId}": true`];
  if (!o.noSettings) {
    const file = settingsPath(res.ctx, o.scope);
    if (file === undefined) throw new PlugError(2, "err.noSettingsPath");
    settings = planSetPaths(file, [
      { path: ["enabledPlugins", source.id], value: false },
      { path: ["enabledPlugins", copyId], value: true },
      { path: ["extraKnownMarketplaces", MARKET_NAME], value: { source: { source: "directory", path: out } } },
    ]);
    assignments.push(`extraKnownMarketplaces.${MARKET_NAME}.source = {"source":"directory","path":"${out}"}`);
    const by = res.settings.enabled.get(source.id);
    if (by !== undefined && by.value && LAYER_RANK[by.layer] > LAYER_RANK[o.scope]) overrideFile = by.file;
  }

  return {
    source, copyName, copyId, out, copyDir, drop: o.drop, sourceHash: sourceHashOf(source),
    dropped, settings, settingsLayer: o.scope, assignments, overrideFile,
  };
}

export interface TrimResult {
  copyDir: string;
  backup: string | undefined;
}

/** Write the copy, marketplace file, lock, and (last) the settings patch. */
export function applyTrim(plan: TrimPlan): TrimResult {
  const { copyDir, entry } = materialize({ source: plan.source, copyName: plan.copyName, drop: plan.drop, out: plan.out });
  writeMarketplace(plan.out, entry, {
    copy: plan.copyId,
    source: plan.source.id,
    sourcePath: plan.source.dir,
    sourceVersion: plan.source.version ?? null,
    sourceHash: plan.sourceHash,
    drop: plan.drop,
  });
  const backup = plan.settings === undefined ? undefined : applyJsonPatch(plan.settings);
  return { copyDir, backup };
}

/** Minimal line diff (LCS) with one line of context, for the settings change preview. */
export function lineDiff(before: string, after: string): string[] {
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const b = after.replace(/\n$/, "").split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const all: { t: " " | "+" | "-"; s: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { all.push({ t: " ", s: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) all.push({ t: "-", s: a[i++] });
    else all.push({ t: "+", s: b[j++] });
  }
  while (i < n) all.push({ t: "-", s: a[i++] });
  while (j < m) all.push({ t: "+", s: b[j++] });
  const keep = all.map((l, k) => l.t !== " " || all[k - 1]?.t !== undefined && all[k - 1].t !== " " || all[k + 1]?.t !== undefined && all[k + 1].t !== " ");
  return all.filter((_, k) => keep[k]).map((l) => `${l.t} ${l.s}`);
}
