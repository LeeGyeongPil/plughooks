import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isObj, readJsonFile, type Obj } from "./util.js";
import { LAYERS, type Ctx, type EnabledInfo, type Layer, type Toggle } from "./types.js";

export interface SettingsFile {
  layer: Layer;
  file: string;
  exists: boolean;
  data: Obj;
}

export interface SettingsSet {
  files: SettingsFile[];
  /** enabledPlugins merged key by key; the highest layer wins. */
  enabled: Map<string, EnabledInfo>;
  disableAllHooks: Toggle | undefined;
  allowManagedHooksOnly: Toggle | undefined;
  /** Places where a settings file has the wrong JSON shape for hooks (reported by doctor as W011). */
  shapeIssues: { file: string; detail: string }[];
}

export function settingsPath(ctx: Ctx, layer: Layer): string | undefined {
  switch (layer) {
    case "user": return join(ctx.claudeDir, "settings.json");
    case "project": return join(ctx.project, ".claude", "settings.json");
    case "local": return join(ctx.project, ".claude", "settings.local.json");
    case "managed": return ctx.managedFile;
  }
}

/** Read the four settings layers (user < project < local < managed). Read-only. */
export function readSettings(ctx: Ctx): SettingsSet {
  const files: SettingsFile[] = [];
  const enabled = new Map<string, EnabledInfo>();
  let disableAllHooks: Toggle | undefined;
  let allowManagedHooksOnly: Toggle | undefined;
  const shapeIssues: { file: string; detail: string }[] = [];
  for (const layer of LAYERS) {
    const file = settingsPath(ctx, layer);
    if (file === undefined) continue;
    const exists = existsSync(file);
    // an empty (or whitespace-only) file counts as {}; anything else must parse
    const raw = exists && readFileSync(file, "utf8").trim() !== "" ? readJsonFile(file) : undefined;
    const data: Obj = isObj(raw) ? raw : {};
    if (raw !== undefined && !isObj(raw)) shapeIssues.push({ file, detail: "$ is not a JSON object" });
    if (data.hooks !== undefined && !isObj(data.hooks)) shapeIssues.push({ file, detail: "hooks is not an object" });
    else if (isObj(data.hooks)) {
      for (const [ev, groups] of Object.entries(data.hooks)) {
        if (!Array.isArray(groups)) shapeIssues.push({ file, detail: `hooks.${ev} is not a list` });
        else {
          groups.forEach((g: unknown, i: number) => {
            if (!isObj(g) || !Array.isArray(g.hooks)) shapeIssues.push({ file, detail: `hooks.${ev}[${i}].hooks is not a list` });
          });
        }
      }
    }
    files.push({ layer, file, exists, data });
    if (isObj(data.enabledPlugins)) {
      for (const [id, v] of Object.entries(data.enabledPlugins)) {
        if (typeof v === "boolean") enabled.set(id, { value: v, layer, file });
      }
    }
    if (typeof data.disableAllHooks === "boolean") disableAllHooks = { value: data.disableAllHooks, layer, file };
    if (typeof data.allowManagedHooksOnly === "boolean") {
      allowManagedHooksOnly = { value: data.allowManagedHooksOnly, layer, file };
    }
  }
  return { files, enabled, disableAllHooks, allowManagedHooksOnly, shapeIssues };
}
