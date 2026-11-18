import assert from "node:assert/strict";
import { chmodSync, existsSync, readdirSync, readFileSync, readlinkSync, statSync, symlinkSync } from "node:fs";
import { test } from "node:test";
import { copyTree } from "../src/util.js";
import { cli, json, makeCase, treeHash, type Case } from "./helpers/fixture.js";

const NOISY = "noisy@demo-mkt";
const COPY = "noisy-nohooks@plughooks-local";
const out = (c: Case): string => `${c.claudeDir}/plughooks-marketplace`;
const copyDir = (c: Case): string => `${out(c)}/plugins/noisy-nohooks`;
const srcDir = (c: Case): string => c.p("marketplaces/demo-mkt/plugins/noisy");

interface ListJson {
  hooks: { event: string; source: { pluginId?: string } }[];
  plugins: { id: string; state: string; hooks: number }[];
}

test("AC-3 dry-run writes nothing", () => {
  const c = makeCase({}, { demo: true });
  const before = treeHash(c.root);
  const r = cli(c, ["trim", NOISY]);
  assert.equal(r.code, 0);
  assert.equal(treeHash(c.root), before);
  for (const needle of [COPY, `"${NOISY}": false`, "CLAUDE_PLUGIN_DATA", "/noisy-nohooks:", "userConfig", "/reload-plugins", "Dry run"]) {
    assert.ok(r.stdout.includes(needle), `output should contain ${needle}`);
  }
  // the hooks that would be dropped are listed, including the skill's frontmatter hook
  assert.match(r.stdout, /Hooks removed from the copy \(3\)/);
  assert.match(r.stdout, /skills\/hello\/SKILL\.md#frontmatter/);
  // the settings diff shows additions only
  assert.match(r.stdout, /\+ .*"noisy-nohooks@plughooks-local": true/);
});

test("AC-4 apply builds a hook-free copy and patches settings", () => {
  const c = makeCase({}, { demo: true });
  const settingsBefore = c.read("home/.claude/settings.json");
  const r = cli(c, ["trim", NOISY, "--apply"]);
  assert.equal(r.code, 0, r.stderr);

  // the copy: no hook definitions anywhere, everything else byte-identical
  const d = copyDir(c);
  assert.ok(!existsSync(`${d}/hooks/hooks.json`));
  const manifest = JSON.parse(readFileSync(`${d}/.claude-plugin/plugin.json`, "utf8")) as Record<string, unknown>;
  assert.equal(manifest.name, "noisy-nohooks");
  assert.ok(!("hooks" in manifest));
  assert.match(String(manifest.description), /copy of noisy@demo-mkt/);
  const skill = readFileSync(`${d}/skills/hello/SKILL.md`, "utf8");
  assert.doesNotMatch(skill, /^hooks:/m);
  assert.match(skill, /^name: hello$/m);
  assert.match(skill, /# Hello/);
  for (const f of ["LICENSE", "scripts/inject.sh", "scripts/allow.sh"]) {
    assert.deepEqual(readFileSync(`${d}/${f}`), readFileSync(`${srcDir(c)}/${f}`), f);
  }

  // marketplace file and lock
  const mp = JSON.parse(readFileSync(`${out(c)}/.claude-plugin/marketplace.json`, "utf8")) as { name: string; owner: unknown; plugins: { name: string; source: string }[] };
  assert.equal(mp.name, "plughooks-local");
  assert.ok(mp.owner);
  assert.deepEqual(mp.plugins.map((p) => [p.name, p.source]), [["noisy-nohooks", "./plugins/noisy-nohooks"]]);
  const lock = JSON.parse(readFileSync(`${out(c)}/plughooks-lock.json`, "utf8")) as { plugins: { copy: string; source: string; sourceHash: string; drop: unknown }[] };
  assert.equal(lock.plugins[0].copy, COPY);
  assert.equal(lock.plugins[0].source, NOISY);
  assert.match(lock.plugins[0].sourceHash, /^[0-9a-f]{12}$/);
  assert.deepEqual(lock.plugins[0].drop, { mode: "all" });

  // settings: backup first, key order and untouched lines kept
  assert.equal(c.read("home/.claude/settings.json.plughooks.bak"), settingsBefore);
  const after = c.read("home/.claude/settings.json");
  assert.deepEqual(Object.keys(JSON.parse(after) as object), ["enabledPlugins", "hooks", "extraKnownMarketplaces"]);
  assert.ok(after.includes('"hooks": [{ "type": "command", "command": "npx prettier --write ." }]'), "untouched lines stay as written");
  const parsed = JSON.parse(after) as { enabledPlugins: Record<string, boolean> };
  assert.deepEqual(parsed.enabledPlugins, { [NOISY]: false, "linter@team-mkt": false, [COPY]: true });

  // list: original off, copy has 0 hooks
  const l = json<ListJson>(cli(c, ["list", "--json"]));
  assert.equal(l.plugins.find((p) => p.id === NOISY)?.state, "off");
  const copy = l.plugins.find((p) => p.id === COPY);
  assert.equal(copy?.state, "on");
  assert.equal(copy?.hooks, 0);
  assert.equal(l.hooks.filter((h) => h.source.pluginId === COPY).length, 0);

  // running it again is safe and gives the same files
  const hash = treeHash(out(c));
  assert.equal(cli(c, ["trim", NOISY, "--apply"]).code, 0);
  assert.equal(treeHash(out(c)), hash);
});

test("AC-4 drop-events keeps other events", () => {
  const c = makeCase({}, { demo: true });
  const r = cli(c, ["trim", NOISY, "--drop-events", "PreToolUse", "--apply"]);
  assert.equal(r.code, 0, r.stderr);
  const events = json<ListJson>(cli(c, ["list", "--json"])).hooks.filter((h) => h.source.pluginId === COPY).map((h) => h.event);
  assert.deepEqual([...new Set(events)], ["SessionStart"]);
  const hooksFile = JSON.parse(readFileSync(`${copyDir(c)}/hooks/hooks.json`, "utf8")) as { hooks: Record<string, unknown> };
  assert.deepEqual(Object.keys(hooksFile.hooks), ["SessionStart"]);
  // the only frontmatter event was PreToolUse, so the block is gone but the file is intact
  assert.doesNotMatch(readFileSync(`${copyDir(c)}/skills/hello/SKILL.md`, "utf8"), /hooks:/);
  const lock = JSON.parse(readFileSync(`${out(c)}/plughooks-lock.json`, "utf8")) as { plugins: { drop: unknown }[] };
  assert.deepEqual(lock.plugins[0].drop, { mode: "events", events: ["PreToolUse"] });
});

test("trim handles inline manifest hooks and --scope local settings", () => {
  const c = makeCase({}, { demo: true });
  const r = cli(c, ["trim", "formatter@demo-mkt", "--scope", "local", "--apply"]);
  assert.equal(r.code, 0, r.stderr);
  const manifest = JSON.parse(readFileSync(`${out(c)}/plugins/formatter-nohooks/.claude-plugin/plugin.json`, "utf8")) as Record<string, unknown>;
  assert.ok(!("hooks" in manifest));
  assert.ok(existsSync(c.p("project/.claude/settings.local.json.plughooks.bak")));
  const local = JSON.parse(c.read("project/.claude/settings.local.json")) as { enabledPlugins: Record<string, boolean>; hooks: unknown };
  assert.equal(local.enabledPlugins["formatter-nohooks@plughooks-local"], true);
  assert.ok(local.hooks, "existing hooks stay");
});

test("trim input errors exit 2", () => {
  const c = makeCase({}, { demo: true });
  const unknown = cli(c, ["trim", "nope@demo-mkt"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Known ids: .*noisy@demo-mkt/);
  assert.equal(cli(c, ["trim"]).code, 2);
  assert.equal(cli(c, ["trim", NOISY, "--drop-all-hooks", "--drop-events", "Stop"]).code, 2);
  assert.equal(cli(c, ["trim", NOISY, "--name", "bad name"]).code, 2);
  assert.equal(cli(c, ["trim", NOISY, "--scope", "managed"]).code, 2);
  assert.equal(cli(c, ["frobnicate"]).code, 2);
  assert.equal(cli(c, ["list", "--nope"]).code, 2);
});

test("Q-2 --drop-events rejects unknown or wrongly cased event names", () => {
  const c = makeCase({}, { demo: true });
  const before = treeHash(c.root);
  const bogus = cli(c, ["trim", "formatter@demo-mkt", "--drop-events", "Bogus", "--apply"]);
  assert.equal(bogus.code, 2);
  assert.match(bogus.stderr, /Unknown hook event "Bogus"/);
  const wrongCase = cli(c, ["trim", NOISY, "--drop-events", "pretooluse", "--apply"]);
  assert.equal(wrongCase.code, 2);
  assert.match(wrongCase.stderr, /Did you mean: PreToolUse\?/);
  assert.equal(treeHash(c.root), before, "nothing was written");
  // a valid event the plugin does not declare removes 0 hooks: refused unless --allow-empty
  const empty = cli(c, ["trim", NOISY, "--drop-events", "Stop", "--apply"]);
  assert.equal(empty.code, 2);
  assert.match(empty.stderr, /--allow-empty/);
  assert.equal(cli(c, ["trim", NOISY, "--drop-events", "Stop", "--allow-empty", "--apply"]).code, 0);
});

test("Q-7 a plughooks copy cannot be trimmed again", () => {
  const c = makeCase({}, { demo: true });
  assert.equal(cli(c, ["trim", NOISY, "--apply"]).code, 0);
  const r = cli(c, ["trim", COPY, "--apply"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /itself a plughooks copy/);
});

test("Q-6 a second trim keeps the indentation of the marketplace entry", () => {
  const c = makeCase({}, { demo: true });
  assert.equal(cli(c, ["trim", NOISY, "--apply"]).code, 0);
  assert.equal(cli(c, ["trim", "formatter@demo-mkt", "--apply"]).code, 0);
  const text = c.read("home/.claude/settings.json");
  JSON.parse(text);
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.includes('"plughooks-local": {'));
  const indent = (l: string): number => /^ */.exec(l)?.[0].length ?? 0;
  assert.equal(indent(lines[at + 1]), indent(lines[at]) + 2, "child is one level deeper than its key");
  assert.equal(indent(lines[at + 2]), indent(lines[at]) + 4);
});

test("CI-1 the copy is made file by file: modes, links and skipped names are the same on every OS", () => {
  const c = makeCase({}, { demo: true });
  const script = `${srcDir(c)}/scripts/allow.sh`;
  chmodSync(script, 0o755); // a plugin script that must stay runnable in the copy
  symlinkSync("allow.sh", `${srcDir(c)}/scripts/allow-link.sh`);
  c.write("marketplaces/demo-mkt/plugins/noisy/node_modules/x/index.js", "x\n");
  assert.equal(cli(c, ["trim", NOISY, "--apply"]).code, 0);
  assert.equal(statSync(`${copyDir(c)}/scripts/allow.sh`).mode & 0o777, 0o755);
  assert.equal(readlinkSync(`${copyDir(c)}/scripts/allow-link.sh`), "allow.sh");
  assert.ok(!existsSync(`${copyDir(c)}/node_modules`), "node_modules is not copied");
  assert.ok(!existsSync(`${out(c)}/.plughooks-tmp-noisy-nohooks`), "temp folder is gone");

  // unit level: a destination inside the source is never copied into itself
  const d = makeCase({ "src/a.txt": "a\n", "src/sub/b.txt": "b\n", "src/.orphaned_at": "1\n" });
  copyTree(d.p("src"), d.p("src/inner-copy"));
  assert.deepEqual(readdirSync(d.p("src/inner-copy")).sort(), ["a.txt", "sub"]);
  assert.equal(d.read("src/inner-copy/sub/b.txt"), "b\n");
  copyTree(d.p("src"), d.p("all"), new Set());
  assert.ok(existsSync(d.p("all/.orphaned_at")), "an empty skip set copies everything");
});

test("dangling symlink in a plugin does not stop trim (dry-run and apply)", { skip: process.platform === "win32" }, () => {
  const c = makeCase({}, { demo: true });
  const link = c.p("marketplaces/demo-mkt/plugins/noisy/dangling");
  symlinkSync("/nonexistent/target", link);
  symlinkSync("/nonexistent/skill-target", c.p("marketplaces/demo-mkt/plugins/noisy/skills/broken"));
  assert.equal(cli(c, ["list"]).code, 0);
  assert.equal(cli(c, ["trim", "noisy@demo-mkt"]).code, 0);
  assert.equal(cli(c, ["trim", "noisy@demo-mkt", "--apply"]).code, 0);
  const copy = `${c.claudeDir}/plughooks-marketplace/plugins/noisy-nohooks/dangling`;
  assert.equal(readlinkSync(copy), "/nonexistent/target");
});

test("dangling symlink named *.md under skills/ does not break list, doctor, trim, sync", { skip: process.platform === "win32" }, () => {
  const c = makeCase({}, { demo: true });
  symlinkSync("/nonexistent/broken-target", c.p("marketplaces/demo-mkt/plugins/noisy/skills/broken.md"));
  assert.equal(cli(c, ["list"]).code, 0);
  assert.equal(cli(c, ["doctor"]).code, 0);
  assert.equal(cli(c, ["trim", "noisy@demo-mkt"]).code, 0);
  assert.equal(cli(c, ["trim", "noisy@demo-mkt", "--apply"]).code, 0);
  assert.equal(cli(c, ["sync"]).code, 0);
});
