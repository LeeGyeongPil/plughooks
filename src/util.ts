import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, statSync, symlinkSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
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

/**
 * Copy a folder tree file by file, skipping `skip` names (default: EXCLUDED).
 *
 * fs.cpSync is not used on purpose: since Node 22 it has a native fast path whose behaviour
 * differs between Node versions and operating systems (open Node issues about aborts, EACCES
 * and subdirectory checks). Plain readdir + mkdir + copyFileSync behaves the same everywhere.
 * Files keep their mode (copyFileSync copies it), symlinks are recreated as links, and the
 * destination is skipped if it happens to lie inside the source.
 */
export function copyTree(src: string, dest: string, skip: ReadonlySet<string> = EXCLUDED): void {
  const destRoot = resolve(dest);
  const walk = (from: string, to: string): void => {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from).sort()) {
      if (skip.has(name)) continue;
      const s = join(from, name);
      const d = join(to, name);
      if (resolve(s) === destRoot) continue; // never copy the copy into itself
      const st = lstatSync(s);
      if (st.isSymbolicLink()) symlinkSync(readlinkSync(s), d);
      else if (st.isDirectory()) walk(s, d);
      else if (st.isFile()) copyFileSync(s, d);
      // sockets, fifos and devices are not plugin content: skipped
    }
  };
  walk(src, dest);
}

/** True for a real directory or a link to one; false for files and dangling links. */
export function isDirSafe(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Sorted relative paths of all files below dir, skipping EXCLUDED names. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      if (EXCLUDED.has(name)) continue;
      const p = join(d, name);
      if (lstatSync(p).isDirectory()) walk(p); // symlinks are entries, never followed
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
    const full = join(dir, rel);
    // a link contributes its target string, so a dangling link still hashes deterministically
    const body = lstatSync(full).isSymbolicLink() ? "link:" + readlinkSync(full) : readFileSync(full);
    h.update(rel).update("\0").update(body).update("\0");
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

/** True for a regular file or a link to one; false for dangling links and everything else. */
export function isFileSafe(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
