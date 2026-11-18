import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { test } from "node:test";
import { cli, json, makeCase } from "./helpers/fixture.js";

interface SyncJson {
  items: { copy: string; source: string; status: string; oldHash: string; newHash: string | null; applied: boolean }[];
}

test("AC-5 detects drift and resyncs", () => {
  const c = makeCase({}, { demo: true });
  const skill = c.p("marketplaces/demo-mkt/plugins/noisy/skills/hello/SKILL.md");
  assert.equal(cli(c, ["trim", "noisy@demo-mkt", "--apply"]).code, 0);

  // 1. nothing changed
  const first = cli(c, ["sync", "--check", "--json"]);
  assert.equal(first.code, 0);
  assert.equal(json<SyncJson>(first).items[0].status, "up-to-date");

  // 2. source edited: exit 1, old and new hash reported
  appendFileSync(skill, "\nAlso wave.\n");
  const second = cli(c, ["sync", "--check", "--json"]);
  assert.equal(second.code, 1);
  const item = json<SyncJson>(second).items[0];
  assert.equal(item.status, "changed");
  assert.match(item.oldHash, /^[0-9a-f]{12}$/);
  assert.match(String(item.newHash), /^[0-9a-f]{12}$/);
  assert.notEqual(item.oldHash, item.newHash);
  const text = cli(c, ["sync", "--check"]);
  assert.match(text.stdout, new RegExp(`changed noisy@demo-mkt \\(${item.oldHash} -> ${item.newHash}\\)`));
  // doctor points at the stale copy
  assert.ok(json<{ warnings: { code: string }[] }>(cli(c, ["doctor", "--json"])).warnings.some((w) => w.code === "W010"));
  // --check never writes
  assert.doesNotMatch(readFileSync(`${c.claudeDir}/plughooks-marketplace/plugins/noisy-nohooks/skills/hello/SKILL.md`, "utf8"), /wave/);

  // 3. apply: the copy follows the source and still has no hooks
  const applied = cli(c, ["sync", "--apply", "--json"]);
  assert.equal(applied.code, 0);
  assert.equal(json<SyncJson>(applied).items[0].applied, true);
  const copySkill = readFileSync(`${c.claudeDir}/plughooks-marketplace/plugins/noisy-nohooks/skills/hello/SKILL.md`, "utf8");
  assert.match(copySkill, /Also wave\./);
  assert.doesNotMatch(copySkill, /^hooks:/m);
  const third = cli(c, ["sync", "--check", "--json"]);
  assert.equal(third.code, 0);
  assert.equal(json<SyncJson>(third).items[0].status, "up-to-date");

  // 4. source removed
  rmSync(c.p("marketplaces/demo-mkt/plugins/noisy"), { recursive: true });
  const fourth = cli(c, ["sync", "--check", "--json"]);
  assert.equal(fourth.code, 1);
  assert.equal(json<SyncJson>(fourth).items[0].status, "source-missing");
  assert.equal(cli(c, ["sync", "--apply"]).code, 1, "nothing to regenerate from");
});

test("sync --apply keeps the event-drop rule from the lock", () => {
  const c = makeCase({}, { demo: true });
  assert.equal(cli(c, ["trim", "noisy@demo-mkt", "--drop-events", "PreToolUse", "--apply"]).code, 0);
  c.write("marketplaces/demo-mkt/plugins/noisy/hooks/hooks.json", {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: "echo changed" }] }],
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }],
    },
  });
  assert.equal(cli(c, ["sync", "--apply"]).code, 0);
  const copy = JSON.parse(readFileSync(`${c.claudeDir}/plughooks-marketplace/plugins/noisy-nohooks/hooks/hooks.json`, "utf8")) as { hooks: Record<string, unknown> };
  assert.deepEqual(Object.keys(copy.hooks), ["SessionStart"]);
  assert.match(JSON.stringify(copy), /echo changed/);
});

test("sync with no copies says so and exits 0", () => {
  const c = makeCase({}, { demo: true });
  const r = cli(c, ["sync", "--check"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /No plughooks copies/);
  assert.equal(cli(c, ["sync", "--out", c.p("nowhere")]).code, 2);
});

test("a deleted copy folder is reported as copy-missing and sync --apply rebuilds it", () => {
  const c = makeCase({}, { demo: true });
  assert.equal(cli(c, ["trim", "noisy@demo-mkt", "--apply"]).code, 0);
  rmSync(`${c.claudeDir}/plughooks-marketplace/plugins/noisy-nohooks`, { recursive: true });
  const check = cli(c, ["sync", "--check", "--json"]);
  assert.equal(check.code, 1);
  assert.equal(json<SyncJson>(check).items[0].status, "copy-missing");
  assert.match(cli(c, ["sync", "--check"]).stdout, /copy-missing/);
  assert.equal(cli(c, ["sync", "--apply"]).code, 0);
  assert.ok(existsSync(`${c.claudeDir}/plughooks-marketplace/plugins/noisy-nohooks/skills/hello/SKILL.md`));
  assert.equal(json<SyncJson>(cli(c, ["sync", "--check", "--json"])).items[0].status, "up-to-date");
});
