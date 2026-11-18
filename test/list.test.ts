import assert from "node:assert/strict";
import { test } from "node:test";
import { cli, json, makeCase, normalize, postHook, withPlugins, type Case } from "./helpers/fixture.js";

interface Row {
  event: string;
  state: string;
  matcherKind: string;
  command: string;
  source: { kind: string; layer?: string; pluginId?: string; file: string; jsonPath: string };
  reason: { key: string; file?: string; layer?: string; value?: boolean };
}
interface ListJson {
  hooks: Row[];
  plugins: { id: string; kind: string; state: string; hooks: number }[];
  codes: string[];
}

const list = (c: Case, extra: string[] = []): ListJson => json(cli(c, ["list", "--json", ...extra]));

test("AC-1 resolves hook rows with sources across settings and plugins", () => {
  const c = makeCase({}, { demo: true });
  const out = list(c);

  // a disabled plugin's hook: off, and the reason names the settings file that switched it off
  const noisy = out.hooks.find((r) => r.source.pluginId === "noisy@demo-mkt" && r.event === "SessionStart");
  assert.ok(noisy);
  assert.equal(noisy.state, "off");
  assert.equal(noisy.reason.layer, "user");
  assert.ok(noisy.reason.file?.endsWith("settings.json"));
  assert.match(cli(c, ["list"]).stdout, /settings\.json \(user\)/);

  // settings layers, plugin hooks.json, plugin.json inline, skill frontmatter, orphan cache
  const where = (p: (r: Row) => boolean): Row | undefined => out.hooks.find(p);
  assert.equal(where((r) => r.source.layer === "user" && r.event === "PostToolUse")?.state, "on");
  assert.ok(where((r) => r.source.layer === "local")?.source.file.endsWith("settings.local.json"));
  assert.ok(where((r) => r.source.kind === "plugin" && r.source.file.endsWith("hooks.json")));
  const inline = where((r) => r.source.pluginId === "formatter@demo-mkt");
  assert.equal(inline?.state, "on");
  assert.equal(inline?.source.jsonPath, "hooks.PostToolUse[0].hooks[0]");
  const fm = where((r) => r.source.kind === "frontmatter");
  assert.ok(fm?.source.file.endsWith("SKILL.md"));
  assert.equal(where((r) => r.state === "orphan")?.reason.key, "orphan-marker");
  assert.equal(where((r) => r.source.layer === "user")?.matcherKind, "regex");

  // v1 and v2 install records give identical rows
  const v1 = makeCase(
    { "home/.claude/plugins/installed_plugins.json": {
      version: 1,
      plugins: { "linter@team-mkt": { installPath: "__ROOT__/home/.claude/plugins/cache/team-mkt/linter/2.0.0", version: "2.0.0" } },
    } },
    { demo: true },
  );
  const a = list(c);
  const b = list(v1);
  assert.deepEqual(normalize(a.hooks, c), normalize(b.hooks, v1));
  assert.deepEqual(normalize(a.plugins, c), normalize(b.plugins, v1));

  // an unknown installed_plugins.json format is reported, not fatal
  const unknown = makeCase({ "home/.claude/plugins/installed_plugins.json": { something: "else" } }, { demo: true });
  const r = cli(unknown, ["list", "--json"]);
  assert.equal(r.code, 0);
  assert.ok(json<ListJson>(r).codes.includes("W009"));
});

test("AC-1 reads managed settings, marketplace entry hooks and mixed plugin.json hooks", () => {
  const files = {
    "managed.json": { hooks: postHook("Write", "managed-check"), enabledPlugins: {} },
    "marketplaces/m/.claude-plugin/marketplace.json": {
      name: "m",
      plugins: [
        { name: "p", source: "./plugins/p", hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "entry-pre" }] }] } },
      ],
    },
    "marketplaces/m/plugins/p/.claude-plugin/plugin.json": {
      name: "p",
      hooks: ["./hooks/extra.json", { Stop: [{ hooks: [{ type: "command", command: "inline-stop" }] }] }],
    },
    "marketplaces/m/plugins/p/hooks/hooks.json": { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "file-pre" }] }] } },
    "marketplaces/m/plugins/p/hooks/extra.json": { hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "extra-end" }] }] } },
    "home/.claude/plugins/known_marketplaces.json": { m: { source: { source: "directory", path: "__ROOT__/marketplaces/m" } } },
  };
  const c = makeCase(files);
  const out = list(c);
  const by = (cmd: string): Row | undefined => out.hooks.find((r) => r.command === cmd);
  assert.equal(by("managed-check")?.source.layer, "managed");
  assert.equal(by("entry-pre")?.source.kind, "entry");
  assert.equal(by("entry-pre")?.state, "on");
  // strict entry hooks replace the same event from the plugin's own files
  assert.equal(by("file-pre")?.state, "replaced");
  assert.equal(by("inline-stop")?.source.jsonPath, "hooks[1].Stop[0].hooks[0]");
  assert.ok(by("extra-end")?.source.file.endsWith("extra.json"));
});

test("a bad settings file stops with exit 2 and names the file", () => {
  const c = makeCase({ "home/.claude/settings.json": "{ not json" });
  const r = cli(c, ["list"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /settings\.json/);
});

test("list filters by event and plugin, and settings identical across layers show once", () => {
  const c = makeCase(
    withPlugins(
      {
        "home/.claude/settings.json": { hooks: postHook("Write", "same") },
        "project/.claude/settings.json": { hooks: postHook("Write", "same") },
      },
      [{ id: "a@m", version: "1.0.0", hooks: { Stop: [{ hooks: [{ type: "command", command: "stop-a" }] }] } }],
    ),
  );
  const all = list(c);
  assert.deepEqual(all.hooks.filter((r) => r.command === "same").map((r) => r.state).sort(), ["dup", "on"]);
  assert.deepEqual(list(c, ["--event", "Stop"]).hooks.map((r) => r.command), ["stop-a"]);
  assert.deepEqual(list(c, ["--plugin", "a@m"]).hooks.map((r) => r.command), ["stop-a"]);
});
