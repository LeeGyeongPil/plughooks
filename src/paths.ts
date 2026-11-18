import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Ctx } from "./types.js";

export interface PathOptions {
  claudeDir?: string;
  pluginsDir?: string;
  project?: string;
  managedSettings?: string;
}

/** Documented default managed-settings locations; override with --managed-settings. */
function defaultManagedFile(): string | undefined {
  if (process.platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-settings.json";
  if (process.platform === "linux") return "/etc/claude-code/managed-settings.json";
  if (process.platform === "win32") return "C:\\Program Files\\ClaudeCode\\managed-settings.json";
  return undefined;
}

function findGitRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Precedence: flag > environment (same variables Claude Code reads) > default. */
export function resolveCtx(opts: PathOptions, env: NodeJS.ProcessEnv, cwd: string): Ctx {
  const claudeDir = resolve(opts.claudeDir ?? (env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")));
  const pluginsRoot = resolve(opts.pluginsDir ?? (env.CLAUDE_CODE_PLUGIN_CACHE_DIR || join(claudeDir, "plugins")));
  const project = resolve(opts.project ?? findGitRoot(cwd) ?? cwd);
  const managedFile = opts.managedSettings !== undefined ? resolve(opts.managedSettings) : defaultManagedFile();
  return { claudeDir, pluginsRoot, project, managedFile };
}
