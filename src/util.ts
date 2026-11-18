import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { PlugError } from "./errors.js";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Read a JSON file; returns undefined when the file is missing, throws exit 2 when it is broken. */
export function readJsonFile(file: string): unknown {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, "utf8");
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new PlugError(2, "err.badJson", { file, message: (e as Error).message });
  }
}

/** Names never copied or hashed: bookkeeping that is not part of the plugin content. */
export const EXCLUDED = new Set([".orphaned_at", ".git", "node_modules"]);

/** Sorted relative paths of all files below dir, skipping EXCLUDED names. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      if (EXCLUDED.has(name)) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

/** 12-char content hash over sorted relative paths and file bytes. */
export function hashDir(dir: string, extra = ""): string {
  const h = createHash("sha256");
  for (const rel of listFiles(dir)) {
    h.update(rel).update("\0").update(readFileSync(join(dir, rel))).update("\0");
  }
  h.update("extra\0").update(extra);
  return h.digest("hex").slice(0, 12);
}

export function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function splitId(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf("@");
  if (at <= 0) return { name: id, marketplace: "" };
  return { name: id.slice(0, at), marketplace: id.slice(at + 1) };
}
