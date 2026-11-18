// Test helpers. Every test works in a temp folder; the real ~/.claude is never read.
// Fixtures are written from plain objects (instead of checked-in folders) so each case
// shows exactly which files make it interesting. The practice demo tree is the base for
// the "realistic" cases.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { copyTree } from "../../src/util.js";

/** Repository root (this file runs from dist-test/test/helpers). */
export const REPO = resolve(import.meta.dirname, "../../..");
export const CLI = join(REPO, "dist-test", "src", "cli.js");

const roots: string[] = [];
process.on("exit", () => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

export type Files = Record<string, unknown>;

export interface Case {
  root: string;
  claudeDir: string;
  project: string;
  managed: string;
  p(rel: string): string;
  write(rel: string, content: unknown): void;
  read(rel: string): string;
}

function fillRoot(dir: string, root: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) fillRoot(p, root);
    else {
      const text = readFileSync(p, "utf8");
      if (text.includes("__ROOT__")) writeFileSync(p, text.split("__ROOT__").join(root));
    }
  }
}

/** Create a case folder. `demo: true` starts from examples/demo; `files` are written on top. */
export function makeCase(files: Files = {}, opts: { demo?: boolean } = {}): Case {
  const root = mkdtempSync(join(tmpdir(), "plughooks-test-"));
  roots.push(root);
  if (opts.demo === true) {
    // plain copy (same on every OS and Node version); nothing skipped, the fixture needs .orphaned_at
    copyTree(join(REPO, "examples", "demo"), root, new Set());
    // global gitignores often hide settings.local.json, so the fixture ships under another name
    renameSync(join(root, "project", ".claude", "settings.local.json.fixture"), join(root, "project", ".claude", "settings.local.json"));
    fillRoot(root, root);
  }
  const c: Case = {
    root,
    claudeDir: join(root, "home", ".claude"),
    project: join(root, "project"),
    managed: join(root, "managed.json"),
    p: (rel) => join(root, rel),
    write(rel, content) {
      const f = join(root, rel);
      mkdirSync(dirname(f), { recursive: true });
      const text = typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n";
      writeFileSync(f, text.split("__ROOT__").join(root));
    },
    read: (rel) => readFileSync(join(root, rel), "utf8"),
  };
  for (const [rel, content] of Object.entries(files)) c.write(rel, content);
  mkdirSync(c.project, { recursive: true });
  return c;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the built CLI in a child process with an empty HOME and a clean environment.
 * Locale defaults to C so output is English unless a test says otherwise.
 */
export function cli(c: Case, args: string[], env: Record<string, string> = {}, common = true): CliResult {
  const full = common
    ? [...args, "--claude-dir", c.claudeDir, "--project", c.project, "--managed-settings", c.managed]
    : args;
  const home = join(c.root, "empty-home");
  mkdirSync(home, { recursive: true });
  const r = spawnSync(process.execPath, [CLI, ...full], {
    encoding: "utf8",
    cwd: c.root,
    env: { PATH: process.env.PATH ?? "", HOME: home, LANG: "C", ...env },
  });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

export function json<T = any>(r: CliResult): T {
  return JSON.parse(r.stdout) as T;
}

/** Hash of every file (path and bytes) below dir, including hidden files. */
export function treeHash(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(p).update("\0").update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest("hex");
}

export function fileHash(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Replace the case root in a JSON string so two cases can be compared. */
export function normalize(value: unknown, c: Case): unknown {
  return JSON.parse(JSON.stringify(value).split(c.root).join("<ROOT>"));
}

export interface PluginSpec {
  /** name@marketplace */
  id: string;
  version: string;
  /** Event map written to hooks/hooks.json (wrapped unless `bare`). */
  hooks?: unknown;
  bare?: boolean;
  /** Extra plugin.json fields. */
  manifest?: Record<string, unknown>;
  /** Extra files below the plugin folder. */
  files?: Files;
  /** Add `.orphaned_at`. */
  orphan?: boolean;
  /** Leave out of installed_plugins.json (default: registered unless orphan). */
  unregistered?: boolean;
}

/** Add plugins to the cache and a v2 installed_plugins.json. */
export function withPlugins(files: Files, specs: PluginSpec[]): Files {
  const out: Files = { ...files };
  const installed: Record<string, unknown[]> = {};
  for (const s of specs) {
    const at = s.id.lastIndexOf("@");
    const name = s.id.slice(0, at);
    const mkt = s.id.slice(at + 1);
    const rel = `home/.claude/plugins/cache/${mkt}/${name}/${s.version}`;
    out[`${rel}/.claude-plugin/plugin.json`] = { name, version: s.version, ...(s.manifest ?? {}) };
    if (s.hooks !== undefined) out[`${rel}/hooks/hooks.json`] = s.bare === true ? s.hooks : { hooks: s.hooks };
    for (const [f, content] of Object.entries(s.files ?? {})) out[`${rel}/${f}`] = content;
    if (s.orphan === true) out[`${rel}/.orphaned_at`] = "1700000000000\n";
    else if (s.unregistered !== true) {
      (installed[s.id] ??= []).push({ scope: "user", installPath: `__ROOT__/${rel}`, version: s.version });
    }
  }
  out["home/.claude/plugins/installed_plugins.json"] = { version: 2, plugins: installed };
  return out;
}

export const postHook = (matcher: string, command: string): unknown => ({
  PostToolUse: [{ matcher, hooks: [{ type: "command", command }] }],
});
