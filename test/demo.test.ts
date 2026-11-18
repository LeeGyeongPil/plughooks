import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CLI, REPO } from "./helpers/fixture.js";

test("AC-8 practice demo runs the whole story in a temp copy", () => {
  const started = Date.now();
  const r = spawnSync(process.execPath, [join(REPO, "scripts", "demo.mjs"), "--lang", "en"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", PLUGHOOKS_CLI: CLI, LANG: "C" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Date.now() - started < 10_000, "demo should finish within 10 s");
  let pos = -1;
  for (const token of ["W001", "W002", "noisy-nohooks", "changed", "up-to-date"]) {
    const at = r.stdout.indexOf(token, pos + 1);
    assert.ok(at > pos, `${token} should appear after the previous token`);
    pos = at;
  }
  assert.match(r.stdout, /Practice demo \(mock\)/);
  // the temp folder is removed at the end and the real home is never named
  const folder = /a fake ~\/\.claude in (\S+)/.exec(r.stdout)?.[1];
  assert.ok(folder !== undefined && !existsSync(folder));
  assert.ok(!r.stdout.includes(process.env.HOME ?? "\0no-home\0") || (process.env.HOME ?? "") === "");
});

test("AC-9 package shape: bin, files, no runtime dependencies", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as Record<string, unknown>;
  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(pkg.bin, { plughooks: "dist/cli.js" });
  assert.equal(pkg.license, "MIT");
  assert.deepEqual(pkg.engines, { node: ">=22" });
  const files = pkg.files as string[];
  for (const f of ["dist", "README.md", "README.ko.md", "LICENSE"]) assert.ok(files.includes(f), f);
  assert.ok(!files.some((f) => f.startsWith("test") || f.includes("fixtures")));
  const v = spawnSync(process.execPath, [CLI, "--version"], { encoding: "utf8" });
  assert.equal(v.stdout.trim(), pkg.version);
});
