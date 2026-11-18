// Practice demo (mock): copies examples/demo into a temp folder and walks through
// list -> doctor -> trim --apply -> upstream edit -> sync --check -> sync --apply.
// It never reads or writes your real ~/.claude.
//
// Usage: npm run demo            (language from PLUGHOOKS_LANG / LC_ALL / LC_MESSAGES / LANG)
//        npm run demo -- --lang ko
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const cli = process.env.PLUGHOOKS_CLI ?? join(repo, "dist", "cli.js");

// Demo text in both languages (the tool output itself is translated by the CLI).
const TEXT = {
  en: {
    intro: "Practice demo (mock): a fake ~/.claude in",
    s1: "1. Where do hooks come from?",
    s2: "2. What looks suspicious? (W001 = plugin switched off but declares hooks, W002 = settings hook that runs a plugin path)",
    s3: "3. Keep noisy's skills, drop its hooks",
    s4: "4. The copy has no hooks, the original is off",
    s5: "5. Upstream updates noisy (the demo edits its skill file)",
    s6: "6. Did the source change?",
    s7: "7. Regenerate the copy",
    s8: "8. Check again",
    exit: "exit",
    removed: "Demo folder removed.",
  },
  ko: {
    intro: "연습용 데모(mock): 가짜 ~/.claude 위치:",
    s1: "1. 훅은 어디에서 오나요?",
    s2: "2. 수상한 점은? (W001 = 꺼진 플러그인인데 훅을 선언함, W002 = 설정의 훅이 플러그인 경로를 실행함)",
    s3: "3. noisy 의 스킬은 남기고 훅만 뺀다",
    s4: "4. 사본에는 훅이 없고 원본은 꺼져 있다",
    s5: "5. 원작자가 noisy 를 업데이트한다 (데모가 스킬 파일을 고친다)",
    s6: "6. 원본이 바뀌었나?",
    s7: "7. 사본을 다시 만든다",
    s8: "8. 다시 확인한다",
    exit: "종료 코드",
    removed: "데모 폴더를 지웠습니다.",
  },
};

// --lang > PLUGHOOKS_LANG > LC_ALL > LC_MESSAGES > LANG; anything not Korean is English
const argv = process.argv.slice(2);
const langIdx = argv.findIndex((a) => a === "--lang" || a.startsWith("--lang="));
const flag = langIdx < 0 ? undefined : argv[langIdx] === "--lang" ? argv[langIdx + 1] : argv[langIdx].slice("--lang=".length);
function pickLang() {
  if (flag === "en" || flag === "ko") return flag;
  const own = process.env.PLUGHOOKS_LANG;
  if (own === "en" || own === "ko") return own;
  for (const v of [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG]) {
    if (v) return v.toLowerCase().startsWith("ko") ? "ko" : "en";
  }
  return "en";
}
const lang = pickLang();
const t = TEXT[lang];

// 1. temp copy of the fixture; "__ROOT__" in the fixture files becomes the temp folder
const root = mkdtempSync(join(tmpdir(), "plughooks-demo-"));
const fill = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) fill(p);
    else {
      const text = readFileSync(p, "utf8");
      if (text.includes("__ROOT__")) writeFileSync(p, text.split("__ROOT__").join(root));
    }
  }
};

// 2. every command points at the temp folder, never at the real home
const common = [
  "--claude-dir", join(root, "home", ".claude"),
  "--project", join(root, "project"),
  "--managed-settings", join(root, "no-managed.json"),
  "--lang", lang,
];
const env = { ...process.env, HOME: root };
delete env.CLAUDE_CONFIG_DIR;
delete env.CLAUDE_CODE_PLUGIN_CACHE_DIR;

const step = (title, args) => {
  console.log(`\n=== ${title}`);
  console.log(`$ plughooks ${args.join(" ")}`);
  const r = spawnSync(process.execPath, [cli, ...args, ...common], { env, encoding: "utf8" });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  console.log(`(${t.exit} ${r.status})`);
};

try {
  cpSync(join(repo, "examples", "demo"), root, { recursive: true });
  // the fixture is stored as .fixture because global gitignores often hide settings.local.json
  renameSync(join(root, "project", ".claude", "settings.local.json.fixture"), join(root, "project", ".claude", "settings.local.json"));
  fill(root);

  console.log(t.intro, root);
  step(t.s1, ["list"]);
  step(t.s2, ["doctor"]);
  step(t.s3, ["trim", "noisy@demo-mkt", "--apply"]);
  step(t.s4, ["list", "--plugin", "noisy-nohooks@plughooks-local"]);

  // 3. the upstream author publishes an update
  appendFileSync(join(root, "marketplaces", "demo-mkt", "plugins", "noisy", "skills", "hello", "SKILL.md"), "\nAlso wave.\n");
  console.log(`\n=== ${t.s5}`);
  step(t.s6, ["sync", "--check"]);
  step(t.s7, ["sync", "--apply"]);
  step(t.s8, ["sync", "--check"]);
} finally {
  // the temp folder goes away even if a step threw
  rmSync(root, { recursive: true, force: true });
  console.log(`\n${t.removed}`);
}
