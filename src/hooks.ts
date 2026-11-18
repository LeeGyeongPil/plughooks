import { isObj, type Obj } from "./util.js";
import type { HookRow, HookSource } from "./types.js";

/** Tool names used to explain how wide a regex matcher is (W007). */
export const KNOWN_TOOLS = [
  "Bash", "Edit", "MultiEdit", "Write", "Read", "Glob", "Grep", "NotebookEdit", "NotebookRead",
  "WebFetch", "WebSearch", "Task", "TodoWrite",
];

/** Events whose matcher is compared with a tool name. */
export const TOOL_EVENTS = new Set([
  "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PermissionDenied",
]);

/** Hook event names Claude Code documents (case-sensitive). Used to catch typos in --drop-events / --event. */
export const KNOWN_EVENTS = new Set([
  "SessionStart", "Setup", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PermissionDenied", "PostToolUse",
  "PostToolUseFailure", "Notification", "SubagentStart", "SubagentStop", "Stop", "StopFailure", "TeammateIdle",
  "TaskCreated", "TaskCompleted", "PreCompact", "PostCompact", "SessionEnd", "InstructionsLoaded", "ConfigChange",
  "CwdChanged", "FileChanged", "WorktreeCreate", "WorktreeRemove", "Elicitation", "ElicitationResult",
]);

const EVENT_ORDER = [
  "SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse",
  "PostToolUseFailure", "Notification", "SubagentStart", "SubagentStop", "Stop", "PreCompact", "SessionEnd",
];

export function eventRank(event: string): number {
  const i = EVENT_ORDER.indexOf(event);
  return i < 0 ? EVENT_ORDER.length : i;
}

export function classifyMatcher(matcher: string | undefined): "all" | "exact" | "regex" {
  if (matcher === undefined || matcher === "" || matcher === "*") return "all";
  return /^[A-Za-z0-9_\-,| ]+$/.test(matcher) ? "exact" : "regex";
}

export type RawRow = Omit<HookRow, "state" | "reason" | "source"> & { jsonPath: string };

/**
 * Flatten an event map `{ Event: [ { matcher?, hooks: [ handler ] } ] }` into raw rows.
 * `prefix` is the JSON path of the map itself, e.g. `hooks`.
 */
export function extractEvents(map: unknown, prefix: string): RawRow[] {
  const rows: RawRow[] = [];
  if (!isObj(map)) return rows;
  for (const [event, groups] of Object.entries(map)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((g: unknown, gi: number) => {
      if (!isObj(g) || !Array.isArray(g.hooks)) return;
      const matcher = typeof g.matcher === "string" ? g.matcher : undefined;
      g.hooks.forEach((h: unknown, hi: number) => {
        if (!isObj(h)) return;
        rows.push({
          event,
          matcher: matcher ?? "*",
          matcherKind: classifyMatcher(matcher),
          type: typeof h.type === "string" ? h.type : "command",
          command: handlerText(h),
          jsonPath: `${prefix === "" ? "" : prefix + "."}${event}[${gi}].hooks[${hi}]`,
        });
      });
    });
  }
  return rows;
}

function handlerText(h: Obj): string {
  for (const k of ["command", "url", "prompt", "tool"]) {
    const v = h[k];
    if (typeof v === "string") return v;
  }
  return typeof h.type === "string" ? h.type : "";
}

export function withSource(rows: RawRow[], source: Omit<HookSource, "jsonPath">): Omit<HookRow, "state" | "reason">[] {
  return rows.map(({ jsonPath, ...rest }) => ({ ...rest, source: { ...source, jsonPath } }));
}

/** Wrapper handling: `{ "hooks": {...} }` (required for hooks.json) or a bare event map. */
export function unwrap(v: unknown): { map: unknown; prefix: string; wrapped: boolean } {
  if (isObj(v) && isObj(v.hooks)) return { map: v.hooks, prefix: "hooks", wrapped: true };
  return { map: v, prefix: "", wrapped: false };
}
