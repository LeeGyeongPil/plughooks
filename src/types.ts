// Shared types. Nothing here touches the disk.

export type Layer = "user" | "project" | "local" | "managed";
export const LAYERS: Layer[] = ["user", "project", "local", "managed"];

export type Lang = "en" | "ko";

/** Resolved locations. Tests always pass explicit values, never the real home. */
export interface Ctx {
  claudeDir: string;
  pluginsRoot: string;
  project: string;
  managedFile: string | undefined;
}

export type HookState = "on" | "off" | "orphan" | "shadowed" | "replaced" | "dup";

export interface HookReason {
  /** Language-neutral key, rendered by render.ts. */
  key: string;
  file?: string;
  layer?: Layer;
  value?: boolean;
}

export interface HookSource {
  kind: "settings" | "plugin" | "entry" | "frontmatter";
  layer?: Layer;
  pluginId?: string;
  /** Folder of the plugin that declares the hook (plugin rows only). */
  pluginDir?: string;
  /** Absolute path of the file that declares the hook. */
  file: string;
  /** Location inside that file, e.g. `hooks.PreToolUse[0].hooks[0]`. */
  jsonPath: string;
}

export interface HookRow {
  event: string;
  matcher: string;
  matcherKind: "all" | "exact" | "regex";
  type: string;
  command: string;
  source: HookSource;
  state: HookState;
  reason: HookReason;
}

export type DiagCode = "W008" | "W009" | "W011";

/** Parse-level findings collected while reading; doctor turns them into warnings. */
export interface Diagnostic {
  code: DiagCode;
  file?: string;
  pluginId?: string;
  detail?: string;
}

export interface EnabledInfo {
  value: boolean;
  layer: Layer;
  file: string;
}

export interface Toggle {
  value: boolean;
  layer: Layer;
  file: string;
}

export type DropSpec = { mode: "all" } | { mode: "events"; events: string[] };
