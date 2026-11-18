import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { isObj, readJsonFile } from "./util.js";
import type { Ctx, Diagnostic } from "./types.js";

export interface InstallRecord {
  id: string;
  scope: "user" | "project" | "local";
  installPath: string;
  version: string | undefined;
  projectPath: string | undefined;
}

export interface InstallResult {
  /** installed_plugins.json exists. */
  present: boolean;
  /** The format was understood (v1 or v2). */
  recognized: boolean;
  records: InstallRecord[];
  diagnostics: Diagnostic[];
}

const SCOPE_RANK = { user: 0, project: 1, local: 2 } as const;

function scopeOf(v: unknown): "user" | "project" | "local" {
  return v === "project" || v === "local" ? v : "user";
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/**
 * Parse installed_plugins.json. v1: `plugins.<id>` is an object.
 * v2: `plugins.<id>` is an array of per-scope objects (with `projectPath`).
 * Both formats are taken from the public docs and issue reports (checked 2026-11-19);
 * anything else yields W009 and the scan continues from marketplaces and the cache.
 */
export function readInstalled(ctx: Ctx): InstallResult {
  const file = join(ctx.pluginsRoot, "installed_plugins.json");
  if (!existsSync(file)) return { present: false, recognized: true, records: [], diagnostics: [] };
  const unknown = (detail: string): InstallResult => ({
    present: true,
    recognized: false,
    records: [],
    diagnostics: [{ code: "W009", file, detail }],
  });
  let raw: unknown;
  try {
    raw = readJsonFile(file);
  } catch {
    return unknown("not valid JSON");
  }
  if (!isObj(raw) || !isObj(raw.plugins)) return unknown("no `plugins` object");
  const records: InstallRecord[] = [];
  for (const [id, v] of Object.entries(raw.plugins)) {
    const entries = Array.isArray(v) ? v : [v];
    for (const e of entries) {
      if (!isObj(e) || str(e.installPath) === undefined) return unknown(`entry ${id} has no installPath`);
      records.push({
        id,
        scope: scopeOf(e.scope),
        installPath: str(e.installPath) as string,
        version: str(e.version),
        projectPath: str(e.projectPath),
      });
    }
  }
  return { present: true, recognized: true, records, diagnostics: [] };
}

/** Records that apply to the current project, highest scope first per id. */
export function selectRecords(records: InstallRecord[], project: string): Map<string, InstallRecord[]> {
  const out = new Map<string, InstallRecord[]>();
  for (const r of records) {
    if (r.scope !== "user" && r.projectPath !== undefined && resolve(r.projectPath) !== resolve(project)) continue;
    const list = out.get(r.id) ?? [];
    list.push(r);
    out.set(r.id, list);
  }
  for (const list of out.values()) list.sort((a, b) => SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope]);
  return out;
}
