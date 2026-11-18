import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PlugError } from "./errors.js";
import { sha256 } from "./util.js";

export interface JsonFormat {
  indent: string;
  eol: string;
  trailingNewline: boolean;
}

/** Detect indentation, line ending and final newline so a patched file keeps its look. */
export function detectFormat(text: string): JsonFormat {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const m = /\n([ \t]+)\S/.exec(text);
  const indent = m === null ? "  " : m[1].startsWith("\t") ? "\t" : m[1];
  return { indent, eol, trailingNewline: text.endsWith("\n") || text === "" };
}

export function stringifyLike(value: unknown, fmt: JsonFormat): string {
  let s = JSON.stringify(value, null, fmt.indent);
  if (fmt.eol !== "\n") s = s.replace(/\n/g, fmt.eol);
  return fmt.trailingNewline ? s + fmt.eol : s;
}

/**
 * Write via a temp file in the same folder, then rename (atomic on one filesystem).
 * A symlinked target is written through to the real file (the link stays a link), and the
 * original file mode is kept, because settings files can hold secrets in `env`.
 */
export function atomicWrite(file: string, text: string): void {
  let target = file;
  let mode: number | undefined;
  try {
    if (lstatSync(file).isSymbolicLink()) target = realpathSync(file);
    mode = statSync(target).mode & 0o777;
  } catch {
    // the file does not exist yet: default mode
  }
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.plughooks.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  try {
    if (mode !== undefined) chmodSync(tmp, mode);
    // Test hook: simulates a crash after the temp file is written.
    if (process.env.PLUGHOOKS_TEST_FAIL_WRITE === "1") throw new Error("injected write failure");
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

// ---- surgical text patching: only the touched lines change ----

interface Member {
  key: string;
  keyStart: number;
  valStart: number;
  valEnd: number;
}

const WS = /\s/;

function skipWs(t: string, i: number): number {
  while (i < t.length && WS.test(t[i])) i++;
  return i;
}

/** End index (exclusive) of the JSON value starting at i. */
function valueEnd(t: string, i: number): number {
  const c = t[i];
  if (c === '"') {
    let j = i + 1;
    while (j < t.length && t[j] !== '"') j += t[j] === "\\" ? 2 : 1;
    return j + 1;
  }
  if (c === "{" || c === "[") {
    let depth = 0;
    let j = i;
    while (j < t.length) {
      const ch = t[j];
      if (ch === '"') {
        j = valueEnd(t, j);
        continue;
      }
      if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) return j + 1;
      }
      j++;
    }
    throw new Error("unterminated value");
  }
  let j = i;
  while (j < t.length && !/[,}\]\s]/.test(t[j])) j++;
  return j;
}

function parseMembers(t: string, open: number): { members: Member[]; close: number } {
  const members: Member[] = [];
  let i = open + 1;
  for (;;) {
    i = skipWs(t, i);
    if (t[i] === "}") return { members, close: i };
    if (t[i] !== '"') throw new Error("expected key");
    const kEnd = valueEnd(t, i);
    const key = JSON.parse(t.slice(i, kEnd)) as string;
    const keyStart = i;
    i = skipWs(t, kEnd);
    if (t[i] !== ":") throw new Error("expected colon");
    const valStart = skipWs(t, i + 1);
    const valEnd = valueEnd(t, valStart);
    members.push({ key, keyStart, valStart, valEnd });
    i = skipWs(t, valEnd);
    if (t[i] === ",") i++;
  }
}

function nested(path: string[], value: unknown): unknown {
  return path.reduceRight<unknown>((acc, k) => ({ [k]: acc }), value);
}

/** Set `path` (creating missing objects) in the object that opens at `open`. */
function setNested(t: string, open: number, path: string[], value: unknown, fmt: JsonFormat): string {
  const { members, close } = parseMembers(t, open);
  const [head, ...rest] = path;
  const hit = members.find((m) => m.key === head);
  const lineStart = t.lastIndexOf("\n", open) + 1;
  const baseIndent = /^[ \t]*/.exec(t.slice(lineStart))?.[0] ?? "";
  const render = (v: unknown, indent: string): string => JSON.stringify(v, null, fmt.indent).split("\n").join(fmt.eol + indent);

  if (hit !== undefined && rest.length > 0 && t[hit.valStart] === "{") return setNested(t, hit.valStart, rest, value, fmt);
  if (hit !== undefined && rest.length > 0) throw new Error("not an object");

  const newValue = rest.length === 0 ? value : nested(rest, value);
  if (hit !== undefined) {
    // re-indent relative to the line the key is on (not the line the parent object opens on)
    const keyLine = t.lastIndexOf("\n", hit.keyStart) + 1;
    const before = t.slice(keyLine, hit.keyStart);
    const keyIndent = before.trim() === "" ? before : baseIndent;
    return t.slice(0, hit.valStart) + render(newValue, keyIndent) + t.slice(hit.valEnd);
  }

  const keyText = JSON.stringify(head);
  if (members.length === 0) {
    const indent = baseIndent + fmt.indent;
    return `${t.slice(0, open + 1)}${fmt.eol}${indent}${keyText}: ${render(newValue, indent)}${fmt.eol}${baseIndent}${t.slice(close)}`;
  }
  const first = members[0];
  const last = members[members.length - 1];
  const multiline = t.slice(open + 1, first.keyStart).includes("\n");
  if (!multiline) return `${t.slice(0, last.valEnd)}, ${keyText}: ${JSON.stringify(newValue)}${t.slice(last.valEnd)}`;
  const indent = /^[ \t]*/.exec(t.slice(t.lastIndexOf("\n", first.keyStart) + 1))?.[0] ?? "";
  return `${t.slice(0, last.valEnd)},${fmt.eol}${indent}${keyText}: ${render(newValue, indent)}${t.slice(last.valEnd)}`;
}

export interface SetEdit {
  /** Property path; every part but the last is created as an object when missing. */
  path: string[];
  value: unknown;
}

function applyToObject(obj: Record<string, unknown>, edit: SetEdit, file: string): void {
  let cur = obj;
  edit.path.slice(0, -1).forEach((k) => {
    const next = cur[k] === undefined ? {} : cur[k];
    if (typeof next !== "object" || next === null || Array.isArray(next)) throw new PlugError(2, "err.badShape", { file, key: k });
    cur[k] = next;
    cur = next as Record<string, unknown>;
  });
  cur[edit.path[edit.path.length - 1]] = edit.value;
}

export interface SettingsPlan {
  file: string;
  exists: boolean;
  /** SHA-256 of the file when it was planned; checked again right before writing. */
  baseHash: string | undefined;
  before: string;
  after: string;
}

/**
 * Plan setting some properties of a JSON object file. The new text edits only the touched
 * places (key order, indentation and untouched lines stay as they are); if that cannot be
 * done safely it falls back to re-serialising with the detected indentation. Nothing is written.
 */
export function planSetPaths(file: string, edits: SetEdit[]): SettingsPlan {
  const exists = existsSync(file);
  const before = exists ? readFileSync(file, "utf8") : "";
  let obj: Record<string, unknown> = {};
  if (exists && before.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(before);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      obj = parsed as Record<string, unknown>;
    } catch (e) {
      throw new PlugError(2, "err.badJson", { file, message: (e as Error).message });
    }
  }
  const expected = structuredClone(obj);
  for (const e of edits) applyToObject(expected, e, file);

  const fmt = exists ? detectFormat(before) : { indent: "  ", eol: "\n", trailingNewline: true };
  let after: string | undefined;
  if (exists && before.trim() !== "") {
    try {
      let text = before;
      for (const e of edits) text = setNested(text, text.indexOf("{"), e.path, e.value, fmt);
      if (isDeepStrictEqual(JSON.parse(text), expected)) after = text;
    } catch {
      after = undefined;
    }
  }
  after ??= stringifyLike(expected, fmt);
  return { file, exists, baseHash: exists ? sha256(before) : undefined, before, after };
}

/** Back up, then replace atomically. Refuses if the file changed since planning. */
export function applyJsonPatch(plan: SettingsPlan): string | undefined {
  const now = existsSync(plan.file) ? sha256(readFileSync(plan.file, "utf8")) : undefined;
  if (now !== plan.baseHash) throw new PlugError(3, "err.changedSincePlan", { file: plan.file });
  let backup: string | undefined;
  if (plan.exists) {
    backup = `${plan.file}.plughooks.bak`;
    for (let i = 1; existsSync(backup); i++) backup = `${plan.file}.plughooks.bak.${i}`;
    copyFileSync(plan.file, backup);
  }
  atomicWrite(plan.file, plan.after);
  return backup;
}
