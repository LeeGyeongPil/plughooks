import assert from "node:assert/strict";
import { test } from "node:test";
import { MESSAGES } from "../src/i18n/index.js";
import { cli, json, makeCase, postHook, withPlugins, type Case, type Files } from "./helpers/fixture.js";

interface W {
  code: string;
  severity: string;
  file?: string;
  data: Record<string, unknown>;
}

const warnings = (c: Case): W[] => json<{ warnings: W[] }>(cli(c, ["doctor", "--json"])).warnings;
const codes = (c: Case): string[] => warnings(c).map((w) => w.code);

const stop = (cmd: string): unknown => ({ Stop: [{ hooks: [{ type: "command", command: cmd }] }] });

const CASES: { name: string; files: Files; expect: string[] }[] = [
  {
    name: "settings-hook-into-plugin",
    files: withPlugins(
      {
        "home/.claude/settings.json": { enabledPlugins: { "linter@team-mkt": false } },
        "project/.claude/settings.local.json": {
          hooks: postHook("Edit|Write", "__ROOT__/home/.claude/plugins/cache/team-mkt/linter/1.0.0/scripts/lint.sh"),
        },
      },
      [{ id: "linter@team-mkt", version: "1.0.0", hooks: postHook("Write|Edit", "${CLAUDE_PLUGIN_ROOT}/scripts/lint.sh") }],
    ),
    expect: ["W001", "W002"],
  },
  {
    name: "orphan-cache",
    files: withPlugins({}, [
      { id: "p@m", version: "2.0.0", hooks: stop("new") },
      { id: "p@m", version: "1.0.0", hooks: stop("old"), orphan: true },
    ]),
    expect: ["W004"],
  },
  {
    name: "regex-matcher",
    files: { "home/.claude/settings.json": { hooks: postHook("Edit.*", "fmt") } },
    expect: ["W007"],
  },
  {
    name: "same-name",
    files: withPlugins({}, [
      { id: "a@m1", version: "1.0.0", manifest: { name: "dup" }, hooks: stop("a") },
      { id: "b@m2", version: "1.0.0", manifest: { name: "dup" }, hooks: stop("b") },
    ]),
    expect: ["W005"],
  },
  {
    name: "hooks-disabled",
    files: { "project/.claude/settings.json": { disableAllHooks: true } },
    expect: ["W006"],
  },
  {
    name: "permission-hook",
    files: withPlugins({}, [
      { id: "p@m", version: "1.0.0", hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "gate" }] }] } },
    ]),
    expect: ["W003"],
  },
  {
    name: "missing-wrapper",
    files: withPlugins({}, [{ id: "p@m", version: "1.0.0", hooks: stop("x"), bare: true }]),
    expect: ["W008"],
  },
  {
    name: "unknown-install-record",
    files: { "home/.claude/plugins/installed_plugins.json": { plugins: { "a@m": [{ nope: 1 }] } } },
    expect: ["W009"],
  },
  {
    name: "hooks-module-key",
    files: withPlugins({}, [{ id: "p@m", version: "1.0.0", manifest: { mods: "./mods" } }]),
    expect: ["W011"],
  },
  {
    name: "flow-style-frontmatter",
    files: withPlugins({}, [
      { id: "p@m", version: "1.0.0", files: { "skills/s/SKILL.md": "---\nname: s\nhooks: { Stop: [] }\n---\nbody\n" } },
    ]),
    expect: ["W011"],
  },
  { name: "clean", files: withPlugins({}, [{ id: "p@m", version: "1.0.0" }]), expect: [] },
];

test("AC-2 emits stable warning codes per fixture", () => {
  for (const k of CASES) {
    const c = makeCase(k.files);
    assert.deepEqual(codes(c), k.expect, k.name);
  }

  // W002 stays separate from W001 and points at the settings file that holds the hook
  const into = CASES[0];
  const w = warnings(makeCase(into.files));
  const w2 = w.find((x) => x.code === "W002");
  assert.ok(w2?.file?.endsWith("settings.local.json"));
  assert.equal(w2?.data.plugin, "linter@team-mkt");
  assert.ok(!w.some((x) => x.code === "W001" && x.file?.endsWith("settings.local.json")));

  // the wider regex lists the extra tool it also matches
  const wide = warnings(makeCase(CASES[2].files)).find((x) => x.code === "W007");
  assert.ok((wide?.data.tools as string[]).includes("NotebookEdit"));
  assert.match(cli(makeCase(CASES[2].files), ["doctor"]).stdout, /NotebookEdit/);

  // no message in either language uses the words bug / 버그
  for (const lang of ["en", "ko"] as const) {
    for (const [key, text] of Object.entries(MESSAGES[lang])) assert.doesNotMatch(text, /\bbug\b|버그/i, `${lang}:${key}`);
  }
});

test("doctor --strict exits 1 on warnings and 0 on info-only findings", () => {
  const warn = makeCase(CASES[0].files);
  assert.equal(cli(warn, ["doctor", "--strict"]).code, 1);
  assert.equal(cli(warn, ["doctor"]).code, 0);
  const info = makeCase(CASES[4].files);
  assert.equal(cli(info, ["doctor", "--strict"]).code, 0);
  assert.equal(cli(makeCase(CASES[10].files), ["doctor"]).stdout.trim(), "No warnings.");
});

test("the demo tree shows W001 and W002 side by side", () => {
  const c = makeCase({}, { demo: true });
  const out = cli(c, ["doctor"]).stdout;
  assert.ok(out.indexOf("W001") >= 0 && out.indexOf("W001") < out.indexOf("W002"));
  assert.deepEqual([...new Set(codes(c))], ["W001", "W002", "W004", "W007"]);
});

test("Q-8 wrongly shaped hooks in settings are reported, an empty file counts as {}", () => {
  const c = makeCase({ "home/.claude/settings.json": { hooks: { PreToolUse: "oops" } }, "project/.claude/settings.local.json": [1, 2] });
  const found = warnings(c).filter((w) => w.code === "W011");
  assert.equal(found.length, 2);
  assert.ok(found.some((w) => String(w.data.detail).includes("hooks.PreToolUse is not a list")));
  assert.ok(found.some((w) => String(w.data.detail).includes("not a JSON object")));

  const empty = makeCase({ "home/.claude/settings.json": "" });
  assert.equal(cli(empty, ["list"]).code, 0);
  assert.deepEqual(codes(empty), []);
});

test("Q-8 an unknown --event name gets a hint on stderr", () => {
  const c = makeCase({}, { demo: true });
  const r = cli(c, ["list", "--event", "pretooluse"]);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /not a known hook event name/);
  assert.equal(cli(c, ["list", "--event", "PreToolUse"]).stderr, "");
});
