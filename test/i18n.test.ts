import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { MESSAGES, pickLang, translate } from "../src/i18n/index.js";
import { CLI, REPO, cli, json, makeCase } from "./helpers/fixture.js";

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("AC-7 language selection and key parity", () => {
  const c = makeCase({}, { demo: true });

  // --help and doctor in each language
  const helpEn = cli(c, ["--help", "--lang", "en"], {}, false).stdout;
  const helpKo = cli(c, ["--help", "--lang", "ko"], {}, false).stdout;
  assert.match(helpEn, /Usage:/);
  assert.match(helpKo, /사용법:/);
  assert.match(cli(c, ["doctor", "--lang", "en"]).stdout, /\[warn\]/);
  assert.match(cli(c, ["doctor", "--lang", "ko"]).stdout, /\[경고\]/);

  // precedence: --lang > PLUGHOOKS_LANG > LC_ALL / LC_MESSAGES / LANG; not Korean -> English
  const korean = /경고/;
  assert.match(cli(c, ["doctor"], { LANG: "ko_KR.UTF-8" }).stdout, korean);
  assert.doesNotMatch(cli(c, ["doctor"], { PLUGHOOKS_LANG: "en", LANG: "ko_KR.UTF-8" }).stdout, korean);
  assert.match(cli(c, ["doctor"], { PLUGHOOKS_LANG: "ko", LANG: "en_US.UTF-8" }).stdout, korean);
  assert.doesNotMatch(cli(c, ["doctor", "--lang", "en"], { PLUGHOOKS_LANG: "ko" }).stdout, korean);
  assert.match(cli(c, ["doctor", "--lang", "ko"], { PLUGHOOKS_LANG: "en" }).stdout, korean);
  assert.doesNotMatch(cli(c, ["doctor"], { LC_ALL: "en_US.UTF-8", LANG: "ko_KR.UTF-8" }).stdout, korean);
  assert.match(cli(c, ["doctor"], { LC_MESSAGES: "ko_KR.UTF-8", LANG: "en_US.UTF-8" }).stdout, korean);
  assert.doesNotMatch(cli(c, ["doctor"], { LANG: "fr_FR.UTF-8" }).stdout, korean);
  assert.doesNotMatch(cli(c, ["doctor"], {}).stdout, korean);
  assert.equal(pickLang("xx", { LANG: "ko_KR" }), "ko");

  // an unsupported --lang value is a usage error
  assert.equal(cli(c, ["doctor", "--lang", "fr"]).code, 2);

  // key sets and placeholders are identical in both languages
  const enKeys = Object.keys(MESSAGES.en).sort();
  const koKeys = Object.keys(MESSAGES.ko).sort();
  assert.deepEqual(enKeys.filter((k) => !koKeys.includes(k)), []);
  assert.deepEqual(koKeys.filter((k) => !enKeys.includes(k)), []);
  for (const k of enKeys) {
    assert.deepEqual(placeholders(MESSAGES.ko[k as keyof typeof MESSAGES.en]), placeholders(MESSAGES.en[k as keyof typeof MESSAGES.en]), k);
  }

  // --json output does not depend on the language
  for (const cmd of [["doctor"], ["list"], ["trim", "noisy@demo-mkt"], ["sync"]]) {
    const en = cli(c, [...cmd, "--json", "--lang", "en"]).stdout;
    const ko = cli(c, [...cmd, "--json", "--lang", "ko"]).stdout;
    assert.equal(en, ko, cmd.join(" "));
    assert.ok(json({ code: 0, stdout: en, stderr: "" }));
  }
});

test("errors are printed in the selected language", () => {
  const c = makeCase({}, { demo: true });
  assert.match(cli(c, ["trim", "nope@x", "--lang", "en"]).stderr, /Unknown plugin/);
  assert.match(cli(c, ["trim", "nope@x", "--lang", "ko"]).stderr, /알 수 없는 플러그인/);
});

test("unknown placeholders such as CLAUDE_PLUGIN_DATA stay as written", () => {
  assert.match(translate("en", "trim.n.data"), /\$\{CLAUDE_PLUGIN_DATA\}/);
  assert.match(translate("ko", "trim.n.data"), /\$\{CLAUDE_PLUGIN_DATA\}/);
});

test("Q-4 --lang is honoured when other arguments fail to parse", () => {
  const c = makeCase({}, { demo: true });
  const en = cli(c, ["list", "--frobnicate", "--lang", "en"], { LANG: "ko_KR.UTF-8" }).stderr;
  assert.match(en, /Unknown option --frobnicate\. Run plughooks --help\./);
  assert.doesNotMatch(en, /[가-힣]/);
  const ko = cli(c, ["list", "--frobnicate", "--lang=ko"], { LANG: "C" }).stderr;
  assert.match(ko, /알 수 없는 옵션 --frobnicate/);
  assert.doesNotMatch(ko, /Unknown option|To specify/);
  assert.match(cli(c, ["list", "--out"], { LANG: "C" }).stderr, /Option --out needs a value/);
});

test("Q-3 the practice demo is fully Korean with --lang ko", () => {
  const r = spawnSync(process.execPath, [join(REPO, "scripts", "demo.mjs"), "--lang", "ko"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", PLUGHOOKS_CLI: CLI, LANG: "C" },
  });
  assert.equal(r.status, 0, r.stderr);
  for (const line of r.stdout.split("\n").filter((l) => l.startsWith("==="))) assert.match(line, /[가-힣]/, line);
  assert.match(r.stdout, /연습용 데모\(mock\)/);
  assert.match(r.stdout, /데모 폴더를 지웠습니다/);
  assert.doesNotMatch(r.stdout, /Demo folder removed|Practice demo/);
  // the language can also come from the environment
  const env = spawnSync(process.execPath, [join(REPO, "scripts", "demo.mjs")], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", PLUGHOOKS_CLI: CLI, PLUGHOOKS_LANG: "ko" },
  });
  assert.match(env.stdout, /데모 폴더를 지웠습니다/);
});
