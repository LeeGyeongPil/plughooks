import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { PlugError } from "./errors.js";
import { LOCK_FILE, defaultOut, materialize, readLock, sourceHashOf, writeMarketplace, type LockEntry } from "./trim.js";
import { findPlugin, type Resolved } from "./resolve.js";
import { splitId } from "./util.js";

export type SyncStatus = "up-to-date" | "changed" | "source-missing" | "copy-missing";

export interface SyncItem {
  copy: string;
  source: string;
  status: SyncStatus;
  oldHash: string;
  newHash: string | undefined;
  out: string;
  applied: boolean;
}

/** Folders that may hold a plughooks lock: --out, or the default plus every directory marketplace. */
export function lockFolders(res: Resolved, out: string | undefined): string[] {
  if (out !== undefined) return [resolve(out)];
  const set = new Set<string>([defaultOut(res), ...res.discovery.marketRoots.values()]);
  return [...set].filter((d) => existsSync(join(d, LOCK_FILE)));
}

/** Compare every lock entry's recorded source hash with the source as it is now. Read-only. */
export function checkSync(res: Resolved, out: string | undefined): SyncItem[] {
  const items: SyncItem[] = [];
  for (const folder of lockFolders(res, out)) {
    const lock = readLock(folder);
    if (lock === undefined) {
      if (out !== undefined) throw new PlugError(2, "err.noLock", { out: folder });
      continue;
    }
    for (const e of lock.plugins) {
      const src = findPlugin(res, e.source);
      const now = src === undefined ? undefined : sourceHashOf(src);
      // the copy folder itself may have been deleted while the lock entry stayed
      const copyGone = !existsSync(join(folder, "plugins", splitId(e.copy).name));
      const status: SyncStatus =
        now === undefined ? "source-missing" : now !== e.sourceHash ? "changed" : copyGone ? "copy-missing" : "up-to-date";
      items.push({ copy: e.copy, source: e.source, status, oldHash: e.sourceHash, newHash: now, out: folder, applied: false });
    }
  }
  return items;
}

/** Rebuild the copies whose source changed, using the drop rule stored in the lock. */
export function applySync(res: Resolved, items: SyncItem[]): SyncItem[] {
  return items.map((it) => {
    if (it.status !== "changed" && it.status !== "copy-missing") return it;
    const src = findPlugin(res, it.source);
    const lock = readLock(it.out);
    const entry = lock?.plugins.find((p) => p.copy === it.copy);
    if (src === undefined || entry === undefined) return it;
    const made = materialize({ source: src, copyName: splitId(it.copy).name, drop: entry.drop, out: it.out });
    const next: LockEntry = { ...entry, sourcePath: src.dir, sourceVersion: src.version ?? null, sourceHash: sourceHashOf(src) };
    writeMarketplace(it.out, made.entry, next);
    return { ...it, applied: true };
  });
}

export function syncExit(items: SyncItem[]): 0 | 1 {
  const bad = items.some((i) => i.status === "source-missing" || ((i.status === "changed" || i.status === "copy-missing") && !i.applied));
  return bad ? 1 : 0;
}
