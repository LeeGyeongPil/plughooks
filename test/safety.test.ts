import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { test } from "node:test";
import { cli, fileHash, makeCase, treeHash, withPlugins } from "./helpers/fixture.js";

const flowSkill = "---\nname: s\nhooks: { Stop: [] }\n---\nbody\n";

test("AC-6 refuses unsafe writes", () => {
  // 1. --out is a non-empty folder plughooks did not create -> exit 3, nothing written there
  const a = makeCase({ "stuff/keep.txt": "mine" }, { demo: true });
  const aBefore = treeHash(a.p("stuff"));
  const r1 = cli(a, ["trim", "noisy@demo-mkt", "--out", a.p("stuff"), "--apply"]);
  assert.equal(r1.code, 3);
  assert.equal(treeHash(a.p("stuff")), aBefore);

  // 2. managed settings force the original on -> exit 3, managed file untouched
  const b = makeCase({ "managed.json": { enabledPlugins: { "noisy@demo-mkt": true } } }, { demo: true });
  const managedHash = fileHash(b.managed);
  const r2 = cli(b, ["trim", "noisy@demo-mkt", "--apply"]);
  assert.equal(r2.code, 3);
  assert.equal(fileHash(b.managed), managedHash);
  assert.ok(!existsSync(`${b.claudeDir}/plughooks-marketplace`));

  // 3. flow-style frontmatter hooks cannot be edited safely -> exit 3 (also as a dry run)
  const c = makeCase(withPlugins({}, [{ id: "p@m", version: "1.0.0", files: { "skills/s/SKILL.md": flowSkill } }]));
  assert.equal(cli(c, ["trim", "p@m"]).code, 3);
  assert.equal(cli(c, ["trim", "p@m", "--apply"]).code, 3);
  assert.ok(!existsSync(`${c.claudeDir}/plughooks-marketplace`));
});

test("managed settings are read but never written", () => {
  const c = makeCase({ "managed.json": { hooks: { Stop: [{ hooks: [{ type: "command", command: "audit" }] }] } } }, { demo: true });
  const before = fileHash(c.managed);
  assert.equal(cli(c, ["trim", "noisy@demo-mkt", "--apply"]).code, 0);
  assert.equal(cli(c, ["trim", "noisy@demo-mkt", "--scope", "local", "--apply"]).code, 0);
  assert.equal(cli(c, ["sync", "--apply"]).code, 0);
  assert.equal(fileHash(c.managed), before);
});

test("an injected write failure leaves the original settings bytes unchanged", () => {
  const c = makeCase({}, { demo: true });
  const file = `${c.claudeDir}/settings.json`;
  const before = readFileSync(file);
  const r = cli(c, ["trim", "noisy@demo-mkt", "--apply"], { PLUGHOOKS_TEST_FAIL_WRITE: "1" });
  assert.equal(r.code, 3);
  assert.deepEqual(readFileSync(file), before);
  assert.ok(!readdirSync(c.claudeDir).some((n) => n.includes(".tmp-")), "temp file is cleaned up");
});

test("settings backups never overwrite each other", () => {
  const c = makeCase({}, { demo: true });
  assert.equal(cli(c, ["trim", "noisy@demo-mkt", "--apply"]).code, 0);
  assert.equal(cli(c, ["trim", "formatter@demo-mkt", "--apply"]).code, 0);
  assert.ok(existsSync(`${c.claudeDir}/settings.json.plughooks.bak`));
  assert.ok(existsSync(`${c.claudeDir}/settings.json.plughooks.bak.1`));
});

test("a second plugin copy reuses the marketplace and a taken name is refused", () => {
  const c = makeCase({}, { demo: true });
  assert.equal(cli(c, ["trim", "noisy@demo-mkt", "--apply"]).code, 0);
  assert.equal(cli(c, ["trim", "formatter@demo-mkt", "--apply"]).code, 0);
  const mp = JSON.parse(readFileSync(`${c.claudeDir}/plughooks-marketplace/.claude-plugin/marketplace.json`, "utf8")) as { plugins: { name: string }[] };
  assert.deepEqual(mp.plugins.map((p) => p.name).sort(), ["formatter-nohooks", "noisy-nohooks"]);
  const clash = cli(c, ["trim", "formatter@demo-mkt", "--name", "noisy-nohooks", "--apply"]);
  assert.equal(clash.code, 3);
});

test("Q-1 a symlinked settings file is written through and stays a link", () => {
  const c = makeCase({ "dotfiles/settings.json": '{\n  "enabledPlugins": {}\n}\n' }, { demo: true });
  const link = `${c.claudeDir}/settings.json`;
  rmSync(link);
  symlinkSync(c.p("dotfiles/settings.json"), link);
  assert.equal(cli(c, ["trim", "noisy@demo-mkt", "--apply"]).code, 0);
  assert.ok(lstatSync(link).isSymbolicLink(), "the link is still a link");
  assert.match(readFileSync(c.p("dotfiles/settings.json"), "utf8"), /noisy-nohooks@plughooks-local/);
});

test("Q-1 the settings file keeps its permissions", () => {
  const c = makeCase({}, { demo: true });
  const file = `${c.claudeDir}/settings.json`;
  chmodSync(file, 0o600);
  assert.equal(cli(c, ["trim", "noisy@demo-mkt", "--apply"]).code, 0);
  assert.equal(statSync(file).mode & 0o777, 0o600);
});
