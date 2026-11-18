import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { runDoctor } from "./doctor.js";
import { KNOWN_EVENTS } from "./hooks.js";
import { PlugError } from "./errors.js";
import { pickLang, translate, type MessageKey } from "./i18n/index.js";
import { resolveCtx } from "./paths.js";
import { Renderer } from "./render.js";
import { resolveAll } from "./resolve.js";
import { applySync, checkSync, syncExit } from "./sync.js";
import { applyTrim, planTrim } from "./trim.js";
import type { DropSpec, Lang } from "./types.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const OPTIONS = {
  "claude-dir": { type: "string" },
  "plugins-dir": { type: "string" },
  project: { type: "string" },
  "managed-settings": { type: "string" },
  lang: { type: "string" },
  json: { type: "boolean" },
  event: { type: "string" },
  plugin: { type: "string" },
  strict: { type: "boolean" },
  "drop-all-hooks": { type: "boolean" },
  "drop-events": { type: "string" },
  out: { type: "string" },
  name: { type: "string" },
  scope: { type: "string" },
  "no-settings": { type: "boolean" },
  "allow-empty": { type: "boolean" },
  apply: { type: "boolean" },
  check: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

/** Find package.json by walking up from this file (works from dist/ and dist-test/). */
export function packageVersion(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 5; i++) {
    const f = join(dir, "package.json");
    if (existsSync(f)) {
      const pkg = JSON.parse(readFileSync(f, "utf8")) as { name?: string; version?: string };
      if (pkg.name === "plughooks" && pkg.version !== undefined) return pkg.version;
    }
    dir = dirname(dir);
  }
  return "0.0.0";
}

/** Value of `--lang X` / `--lang=X` in raw arguments (last one wins), without full parsing. */
function scanLangFlag(argv: string[]): string | undefined {
  let found: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--lang") found = argv[i + 1];
    else if (argv[i].startsWith("--lang=")) found = argv[i].slice("--lang=".length);
  }
  return found;
}

/** Run one CLI invocation. Pure with respect to the process: returns text and an exit code. */
export function run(argv: string[], env: NodeJS.ProcessEnv, cwd: string): RunResult {
  // an explicit --lang must also shape errors raised while parsing the other arguments
  let lang: Lang = pickLang(scanLangFlag(argv), env);
  const say = (key: MessageKey, params: Record<string, string | number> = {}): string => translate(lang, key, params);
  const fail = (e: PlugError): RunResult => ({ code: e.exit, stdout: "", stderr: `${say("err.prefix")}: ${say(e.key as MessageKey, e.params)}\n` });

  try {
    let parsed;
    try {
      parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    } catch (e) {
      const err = e as Error & { code?: string };
      const option = /'(--?[\w-]+)/.exec(err.message)?.[1] ?? "";
      const message =
        err.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" && option !== ""
          ? say("usage.unknownOption", { option })
          : err.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" && option !== ""
            ? say("usage.missingValue", { option })
            : say("usage.generic");
      throw new PlugError(2, "err.usage", { message });
    }
    const { values: v, positionals } = parsed;
    const flagLang = v.lang;
    if (flagLang !== undefined && flagLang !== "en" && flagLang !== "ko") throw new PlugError(2, "err.badLang", { value: flagLang });
    lang = pickLang(flagLang, env);
    const r = new Renderer(lang);

    if (v.version === true) return { code: 0, stdout: packageVersion() + "\n", stderr: "" };
    const command = positionals[0];
    if (v.help === true || command === undefined || command === "help") return { code: 0, stdout: say("help.text"), stderr: "" };

    const ctx = resolveCtx(
      { claudeDir: v["claude-dir"], pluginsDir: v["plugins-dir"], project: v.project, managedSettings: v["managed-settings"] },
      env,
      cwd,
    );
    const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";

    switch (command) {
      case "list": {
        const res = resolveAll(ctx);
        const rows = res.rows.filter(
          (row) => (v.event === undefined || row.event === v.event) && (v.plugin === undefined || row.source.pluginId === v.plugin),
        );
        const note = v.event !== undefined && !KNOWN_EVENTS.has(v.event) && rows.length === 0 ? say("warn.unknownEvent", { event: v.event }) + "\n" : "";
        return { code: 0, stdout: v.json === true ? json(r.listJson(res, rows)) : r.listText(res, rows), stderr: note };
      }
      case "doctor": {
        const res = resolveAll(ctx);
        const ws = runDoctor(res, v.out);
        const code = v.strict === true && ws.some((w) => w.severity === "warn") ? 1 : 0;
        return { code, stdout: v.json === true ? json({ warnings: ws }) : r.doctorText(ws), stderr: "" };
      }
      case "trim": {
        const id = positionals[1];
        if (id === undefined) throw new PlugError(2, "err.missingId");
        if (v["drop-all-hooks"] === true && v["drop-events"] !== undefined) throw new PlugError(2, "err.conflictDrop");
        const scope = v.scope ?? "user";
        if (scope !== "user" && scope !== "local") throw new PlugError(2, "err.badScope", { value: scope });
        const drop: DropSpec =
          v["drop-events"] === undefined
            ? { mode: "all" }
            : { mode: "events", events: v["drop-events"].split(",").map((s) => s.trim()).filter((s) => s !== "") };
        const res = resolveAll(ctx);
        const plan = planTrim(res, { id, drop, out: v.out, name: v.name, scope, noSettings: v["no-settings"] === true, allowEmpty: v["allow-empty"] === true, apply: v.apply === true });
        const result = v.apply === true ? applyTrim(plan) : undefined;
        return { code: 0, stdout: v.json === true ? json(r.trimJson(plan, result)) : r.trimText(plan, result), stderr: "" };
      }
      case "sync": {
        const res = resolveAll(ctx);
        let items = checkSync(res, v.out);
        const apply = v.apply === true;
        if (apply) items = applySync(res, items);
        return { code: syncExit(items), stdout: v.json === true ? json(r.syncJson(items)) : r.syncText(items, apply), stderr: "" };
      }
      default:
        throw new PlugError(2, "err.unknownCommand", { command });
    }
  } catch (e) {
    if (e instanceof PlugError) return fail(e);
    return { code: 3, stdout: "", stderr: `${say("err.prefix")}: ${say("err.unexpected", { message: (e as Error).message })}\n` };
  }
}
