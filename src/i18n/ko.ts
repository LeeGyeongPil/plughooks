// 한국어 메시지. 키는 en.ts 와 정확히 같아야 한다(타입과 테스트가 확인).
// 표현 원칙: 파일에 선언된 내용만 말하고 실행 중인 Claude Code 의 동작을 단정하지 않는다.
import type { MessageKey } from "./en.js";

export const ko: Record<MessageKey, string> = {
  "help.text": `plughooks - Claude Code 훅이 어디에 선언돼 있는지 찾고, 훅을 뺀 플러그인 사본을 관리합니다

사용법:
  plughooks list   [--event 이벤트] [--plugin ID] [--json]
  plughooks doctor [--strict] [--json]
  plughooks trim <이름@마켓> [--drop-all-hooks | --drop-events E1,E2]
                 [--out 폴더] [--name 새이름] [--scope user|local] [--no-settings] [--allow-empty] [--apply]
  plughooks sync   [--check] [--apply] [--out 폴더] [--json]

--apply 를 주지 않으면 (trim, sync 포함) 아무것도 쓰지 않습니다.

옵션:
  --claude-dir 폴더         Claude 설정 폴더 (기본: $CLAUDE_CONFIG_DIR 또는 ~/.claude)
  --plugins-dir 폴더        plugins 폴더 (기본: $CLAUDE_CODE_PLUGIN_CACHE_DIR 또는 <claude-dir>/plugins)
  --project 폴더            프로젝트 폴더 (기본: 현재 폴더의 git 루트)
  --managed-settings 파일   읽을 managed 설정 파일 (절대 쓰지 않음)
  --lang en|ko              출력 언어 (기본: $PLUGHOOKS_LANG, 그다음 LC_ALL / LC_MESSAGES / LANG)
  --json                    기계 판독 출력 (키와 코드는 --lang 과 무관)
  -h, --help                도움말
  -v, --version             버전

종료 코드: 0 정상, 1 --strict 경고 있음 또는 sync 필요, 2 사용법·입력 오류, 3 안전상 거부.
`,
  "err.prefix": "오류",
  "err.usage": "{message}. plughooks --help 를 실행해 보세요.",
  "usage.unknownOption": "알 수 없는 옵션 {option}",
  "usage.missingValue": "옵션 {option} 에 값이 필요합니다",
  "usage.generic": "명령줄이 올바르지 않습니다",
  "err.unknownCommand": "알 수 없는 명령 \"{command}\" 입니다. list, doctor, trim, sync 중 하나를 쓰세요.",
  "err.badLang": "지원하지 않는 언어 \"{value}\" 입니다. --lang en 또는 --lang ko 를 쓰세요.",
  "err.missingId": "trim 에는 name@marketplace 형태의 플러그인 id 가 필요합니다. plughooks list 로 id 를 확인하세요.",
  "err.conflictDrop": "--drop-all-hooks 와 --drop-events 는 함께 쓸 수 없습니다.",
  "err.badScope": "지원하지 않는 --scope \"{value}\" 입니다. user 또는 local 을 쓰세요.",
  "err.badJson": "{file} 을(를) JSON 으로 읽을 수 없습니다 ({message}). 파일을 고쳐 주세요. plughooks 는 추측하지 않습니다.",
  "err.unknownPlugin": "알 수 없는 플러그인 \"{id}\" 입니다. 알려진 id: {known}.",
  "err.noEvents": "--drop-events 에는 이벤트 이름이 하나 이상 필요합니다. 예: --drop-events SessionStart,PreToolUse.",
  "err.unknownEvent": "알 수 없는 훅 이벤트 \"{event}\" 입니다. 이벤트 이름은 대소문자를 구분합니다. 혹시 이것인가요: {suggest}? 이 플러그인이 선언한 이벤트: {declared}.",
  "err.nothingToDrop": "이 trim 은 {id} 에서 훅을 0개 제거합니다. 사본이 원본과 같은데 원본만 꺼지게 됩니다. 이벤트 이름을 확인하거나, 그래도 진행하려면 --allow-empty 를 붙이세요.",
  "err.sourceIsCopy": "{id} 는 plughooks 가 만든 사본입니다. 원본 플러그인을 trim 하거나, 사본을 갱신하려면 plughooks sync --apply 를 실행하세요.",
  "warn.unknownEvent": "경고: \"{event}\" 는 알려진 훅 이벤트 이름이 아니라서(대소문자 구분) 어떤 훅과도 일치하지 않습니다.",
  "err.flowFrontmatter": "{file} 이(가) 훅을 흐름 스타일(hooks: {...})로 선언해 plughooks 가 안전하게 고칠 수 없습니다. 블록 스타일 YAML 로 바꾼 뒤 다시 실행하세요.",
  "err.unhandledLocation": "{file} 에 plughooks 가 처리하지 않는 훅 관련 위치가 있습니다 ({detail}). 아무것도 쓰지 않았습니다.",
  "err.managedForced": "managed 설정({file})이 {id} 을(를) 강제로 켜므로 사본으로 바꿀 수 없습니다. 아무것도 쓰지 않았습니다.",
  "err.hooksRemain": "사본에 훅 선언이 남게 됩니다 ({file}). 아무것도 쓰지 않았습니다.",
  "err.badName": "\"{name}\" 은(는) 사본 이름으로 쓸 수 없습니다. 영문자·숫자·점·대시·밑줄만 쓰세요.",
  "err.outNotOurs": "{out} 은(는) 비어 있지 않고 plughooks 가 만든 폴더도 아닙니다. 다른 --out 이나 빈 폴더를 고르세요.",
  "err.copyNameTaken": "대상 마켓에 다른 원본의 \"{name}\" 플러그인이 이미 있습니다. --name 으로 이름을 바꾸세요.",
  "err.noSettingsPath": "이 범위에는 쓸 수 있는 settings 파일이 없습니다.",
  "err.badShape": "{file}: \"{key}\" 가 객체가 아닙니다. 먼저 고쳐 주세요.",
  "err.changedSincePlan": "plughooks 가 작업하는 동안 {file} 이(가) 바뀌었습니다. 쓰지 않았으니 다시 실행하세요.",
  "err.noLock": "{out} 에 plughooks-lock.json 이 없습니다. 먼저 trim --apply 를 실행하세요.",
  "err.unexpected": "예상하지 못한 문제로 중단했습니다: {message}",

  "h.event": "이벤트",
  "h.matcher": "매처",
  "h.source": "출처",
  "h.state": "상태",
  "h.command": "명령",
  "h.where": "위치",
  "h.why": "근거",
  "h.id": "플러그인",
  "h.kind": "종류",
  "h.version": "버전",
  "h.hooks": "훅",

  "s.settings": "설정 파일",
  "s.plugins": "플러그인",
  "s.hooks": "선언된 훅",
  "s.notes": "참고",
  "list.found": "있음",
  "list.missing": "없음",
  "list.noHooks": "읽은 설정과 플러그인에 선언된 훅이 없습니다.",
  "list.note": "파일에서 읽은 선언이며, 실행 중인 세션이 실제로 무엇을 불러왔는지를 말하는 것은 아닙니다.",

  "reason.enabled-by-setting.true": "{where} 에서 켜짐",
  "reason.enabled-by-setting.false": "{where} 에서 꺼짐",
  "reason.default-enabled": "enabledPlugins 항목 없음; 기본값은 켜짐",
  "reason.default-disabled": "enabledPlugins 항목 없음; 기본값은 꺼짐",
  "reason.orphan-marker": "캐시 폴더에 .orphaned_at 표식이 있음",
  "reason.orphan-unregistered": "캐시 폴더가 설치 기록에 없음",
  "reason.replaced-by-entry": "마켓 항목이 이 이벤트의 훅을 선언해(strict) 이 훅들을 대체함",
  "reason.all-hooks-disabled": "{where} 에 disableAllHooks 가 설정됨",
  "reason.managed-only": "{where} 에 allowManagedHooksOnly 가 설정됨",
  "reason.dup-of": "같은 핸들러가 {where} 에 이미 선언됨",
  "reason.settings-hook": "{where} 에 선언됨; 플러그인 켜기/끄기와 무관",

  "w.sev.info": "정보",
  "w.sev.warn": "경고",
  "w.W001": "{plugin} 은(는) 꺼져 있지만({by}) 파일에 {events} 훅이 선언돼 있습니다. 꺼진 플러그인은 로드되지 않아야 합니다. 이 훅이 그래도 실행된다면 W002 와 settings 파일을 먼저 확인하세요.",
  "w.W002": "{layer} settings 훅({event})이 플러그인 {plugin} 안의 경로를 실행합니다(플러그인은 {plugin_state}). settings 훅은 플러그인 스위치와 무관하게 실행되므로 플러그인을 꺼도 이 훅은 멈추지 않습니다.",
  "w.W003": "켜진 플러그인 {plugin} 이(가) {event} 훅(매처 {matcher})을 선언합니다. 이 이벤트의 훅은 권한 결정에 관여할 수 있으니 스크립트를 검토하세요.",
  "w.W004": "{plugin} 의 고아 캐시 폴더(버전 {version})에 훅 {count}개가 선언돼 있습니다. 설치된 버전이 아니므로 지우거나 무시하세요.",
  "w.W005": "켜진 플러그인들이 같은 manifest 이름 \"{name}\" 을 씁니다: {plugins}. hooks.json 훅은 한쪽만 등록됩니다. 한쪽 이름을 바꾸거나 끄세요.",
  "w.W006": "{layer} settings 에서 {setting} 이(가) true 라서, 무엇이 선언돼 있든 훅이 줄거나 꺼집니다.",
  "w.W007": "{event} 의 매처 \"{matcher}\" 는 고정되지 않은 정규식이라 의도한 도구 외에 {tools} 에도 일치합니다. 원치 않으면 ^...$ 로 고정하세요.",
  "w.W008": "hooks/hooks.json 에 {\"hooks\": ...} 래퍼가 없습니다. 내용은 그대로 읽었지만 Claude Code 가 로드하려면 래퍼로 감싸야 합니다.",
  "w.W009": "installed_plugins.json 이 plughooks 가 모르는 형식입니다({detail}). 대신 마켓과 캐시에서 플러그인을 찾았습니다.",
  "w.W010.missing": "사본 {copy} 의 폴더가 지워졌습니다(원본 {source}). plughooks sync --apply 로 다시 만드세요.",
  "w.W010": "사본 {copy} 이(가) 오래됐습니다: 원본 {source} 이(가) 바뀌었습니다({old} -> {now}). plughooks sync --apply 를 실행하세요.",
  "w.W011": "plughooks 가 해석하지 않는 훅 관련 위치를 발견했습니다({detail}).",
  "w.by.default": "기본값",
  "doctor.none": "경고가 없습니다.",
  "doctor.summary": "{n}건.",

  "trim.plan": "계획: {source} 을(를) {copy} 로 복사",
  "trim.dryrun": "미리보기: 아무것도 쓰지 않았습니다. 실제로 하려면 --apply 를 붙이세요.",
  "trim.sourceDir": "원본 폴더",
  "trim.copyDir": "사본 폴더",
  "trim.rule.all": "규칙: 모든 훅 정의 제거",
  "trim.rule.events": "규칙: 이 이벤트만 제거: {events}",
  "trim.dropped": "사본에서 빠지는 훅 ({n})",
  "trim.noneDropped": "이 규칙에 해당하는 훅이 원본에 없습니다. 사본은 단순 복제입니다.",
  "trim.settings": "{where} 의 변경",
  "trim.assign": "지정 값",
  "trim.diff": "차이",
  "trim.noSettings": "settings 는 건드리지 않습니다(--no-settings). 원본을 끄고 사본을 켜는 일은 직접 하세요.",
  "trim.override": "{file} 이(가) 이 변경보다 높은 단계에서 원본을 켜 둡니다. 거기도 고쳐야 합니다.",
  "trim.notices": "알아 둘 것",
  "trim.n.namespace": "명령 이름이 바뀝니다: /{from}:cmd 가 /{to}:cmd 가 됩니다.",
  "trim.n.data": "${CLAUDE_PLUGIN_DATA} 가 사본용 새 폴더를 가리킵니다. 기존 플러그인 데이터는 옮겨지지 않습니다.",
  "trim.n.userConfig": "userConfig 값과 비밀값은 플러그인 id 에 묶여 있으니 사본에 다시 입력하세요.",
  "trim.n.reload": "Claude Code 가 변경을 읽도록 /reload-plugins 를 실행하거나 새 세션을 시작하세요.",
  "trim.wrote.copy": "사본 작성: {dir}",
  "trim.wrote.market": "마켓과 lock 작성: {dir}",
  "trim.wrote.settings": "{file} 수정 (백업: {backup})",
  "trim.noChange": "변경 없음: 설정에 이미 이 값들이 있습니다.",
  "trim.wrote.settingsUnchanged": "{file} 은(는) 이미 최신이라 그대로 둠(백업 만들지 않음)",
  "trim.wrote.settingsNew": "{file} 생성",

  "sync.none": "plughooks 사본이 없습니다(확인할 것 없음). plughooks trim 으로 만드세요.",
  "sync.line.up-to-date": "up-to-date {copy} (원본 {source})",
  "sync.line.changed": "changed {source} ({old} -> {now}) 사본 {copy}",
  "sync.line.source-missing": "source-missing {source} (사본 {copy})",
  "sync.line.copy-missing": "copy-missing {copy} (사본 폴더가 지워짐, 원본 {source})",
  "sync.applied": "{copy} 다시 생성함",
  "sync.hint": "바뀐 사본을 다시 만들려면 plughooks sync --apply 를 실행하세요.",
};
