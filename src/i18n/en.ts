// English messages. Every key must also exist in ko.ts (a test checks the key sets are equal).
// Wording rule: say what the files declare, never claim what Claude Code does at runtime.

export const en = {
  "help.text": `plughooks - find where Claude Code hooks are declared, and keep hook-free plugin copies

Usage:
  plughooks list   [--event EVENT] [--plugin ID] [--json]
  plughooks doctor [--strict] [--json]
  plughooks trim <name@marketplace> [--drop-all-hooks | --drop-events E1,E2]
                 [--out DIR] [--name NEW] [--scope user|local] [--no-settings] [--allow-empty] [--apply]
  plughooks sync   [--check] [--apply] [--out DIR] [--json]

Everything is read-only unless you pass --apply (trim, sync).

Options:
  --claude-dir DIR         Claude config folder (default: $CLAUDE_CONFIG_DIR or ~/.claude)
  --plugins-dir DIR        plugins folder (default: $CLAUDE_CODE_PLUGIN_CACHE_DIR or <claude-dir>/plugins)
  --project DIR            project folder (default: git root of the current folder)
  --managed-settings FILE  managed settings file to read (never written)
  --lang en|ko             output language (default: $PLUGHOOKS_LANG, then LC_ALL / LC_MESSAGES / LANG)
  --json                   machine-readable output (keys and codes do not depend on --lang)
  -h, --help               show this help
  -v, --version            show the version

Exit codes: 0 ok, 1 warnings with --strict or sync needed, 2 usage or input error, 3 refused for safety.
`,
  "err.prefix": "error",
  "err.usage": "{message}. Run plughooks --help.",
  "usage.unknownOption": "Unknown option {option}",
  "usage.missingValue": "Option {option} needs a value",
  "usage.generic": "Invalid command line",
  "err.unknownCommand": "Unknown command \"{command}\". Use list, doctor, trim or sync.",
  "err.badLang": "Unsupported language \"{value}\". Use --lang en or --lang ko.",
  "err.missingId": "trim needs a plugin id such as name@marketplace. Run plughooks list to see ids.",
  "err.conflictDrop": "Use either --drop-all-hooks or --drop-events, not both.",
  "err.badScope": "Unsupported --scope \"{value}\". Use user or local.",
  "err.badJson": "Cannot parse {file} as JSON ({message}). Fix the file; plughooks does not guess.",
  "err.unknownPlugin": "Unknown plugin \"{id}\". Known ids: {known}.",
  "err.noEvents": "--drop-events needs at least one event name, for example --drop-events SessionStart,PreToolUse.",
  "err.unknownEvent": "Unknown hook event \"{event}\". Event names are case-sensitive. Did you mean: {suggest}? Events declared by this plugin: {declared}.",
  "err.nothingToDrop": "This trim would remove 0 hooks from {id}: the copy would equal the original, while the original gets switched off. Check the event names, or add --allow-empty to go ahead anyway.",
  "err.sourceIsCopy": "{id} is itself a plughooks copy. Trim the original plugin instead, or run plughooks sync --apply to refresh the copy.",
  "warn.unknownEvent": "warning: \"{event}\" is not a known hook event name (names are case-sensitive), so nothing can match it.",
  "err.flowFrontmatter": "{file} declares hooks in flow style (hooks: {...}), which plughooks cannot edit safely. Rewrite it as block-style YAML and run again.",
  "err.unhandledLocation": "{file} has a hook-related location plughooks does not handle ({detail}). Nothing was written.",
  "err.managedForced": "Managed settings ({file}) force {id} on, so a copy cannot replace it. Nothing was written.",
  "err.hooksRemain": "The copy would still declare hooks ({file}). Nothing was written.",
  "err.badName": "\"{name}\" is not a valid copy name. Use letters, digits, dot, dash or underscore.",
  "err.outNotOurs": "{out} is not empty and was not created by plughooks. Pick another --out or an empty folder.",
  "err.copyNameTaken": "A plugin named \"{name}\" already exists in the target marketplace for another source. Use --name.",
  "err.noSettingsPath": "No settings file is available for this scope.",
  "err.badShape": "{file}: \"{key}\" is not an object. Fix it first.",
  "err.changedSincePlan": "{file} changed while plughooks was working. Nothing was written to it; run again.",
  "err.noLock": "No plughooks-lock.json in {out}. Run trim --apply first.",
  "err.unexpected": "Stopped because of an unexpected problem: {message}",

  "h.event": "EVENT",
  "h.matcher": "MATCHER",
  "h.source": "SOURCE",
  "h.state": "STATE",
  "h.command": "COMMAND",
  "h.where": "WHERE",
  "h.why": "WHY",
  "h.id": "PLUGIN",
  "h.kind": "KIND",
  "h.version": "VERSION",
  "h.hooks": "HOOKS",

  "s.settings": "Settings files",
  "s.plugins": "Plugins",
  "s.hooks": "Declared hooks",
  "s.notes": "Notes",
  "list.found": "found",
  "list.missing": "missing",
  "list.noHooks": "No hooks are declared in the settings or plugins that were read.",
  "list.note": "These are declarations read from files, not a statement about what a running session loaded.",

  "reason.enabled-by-setting.true": "enabled by {where}",
  "reason.enabled-by-setting.false": "switched off by {where}",
  "reason.default-enabled": "no enabledPlugins entry; enabled by default",
  "reason.default-disabled": "no enabledPlugins entry; disabled by default",
  "reason.orphan-marker": "cache folder is marked .orphaned_at",
  "reason.orphan-unregistered": "cache folder is not in the install records",
  "reason.replaced-by-entry": "marketplace entry declares hooks for this event (strict) and replaces these",
  "reason.all-hooks-disabled": "disableAllHooks is set in {where}",
  "reason.managed-only": "allowManagedHooksOnly is set in {where}",
  "reason.dup-of": "same handler already declared in {where}",
  "reason.settings-hook": "declared in {where}; independent of plugin on/off",

  "w.sev.info": "info",
  "w.sev.warn": "warn",
  "w.W001": "{plugin} is switched off ({by}) but its files declare hooks for {events}. A switched-off plugin should not load; if these hooks still run, check W002 and your settings files first.",
  "w.W002": "A {layer} settings hook ({event}) runs a path inside plugin {plugin} (plugin is {plugin_state}). Settings hooks run regardless of the plugin switch, so turning the plugin off does not stop this one.",
  "w.W003": "Enabled plugin {plugin} declares a {event} hook (matcher {matcher}). Hooks on this event can take part in permission decisions; review the script.",
  "w.W004": "Orphaned cache folder of {plugin} (version {version}) still declares {count} hook(s). It is not an installed version; delete it or ignore it.",
  "w.W005": "Enabled plugins share the manifest name \"{name}\": {plugins}. Only one of them registers hooks from hooks.json; rename or disable one.",
  "w.W006": "{setting} is true in {layer} settings, so hooks are reduced or off regardless of what is declared.",
  "w.W007": "Matcher \"{matcher}\" on {event} is an unanchored regex; besides the intended tool it also matches {tools}. Anchor it (^...$) if that is not wanted.",
  "w.W008": "hooks/hooks.json has no {\"hooks\": ...} wrapper. The hooks in it were read anyway; wrap them so Claude Code can load the file.",
  "w.W009": "installed_plugins.json has a format plughooks does not know ({detail}). Plugins were found from marketplaces and the cache instead.",
  "w.W010.missing": "Copy {copy} is missing: its folder was deleted (source {source}). Run plughooks sync --apply to rebuild it.",
  "w.W010": "Copy {copy} is out of date: source {source} changed ({old} -> {now}). Run plughooks sync --apply.",
  "w.W011": "A hook-related location was found that plughooks does not interpret ({detail}).",
  "w.by.default": "its default",
  "doctor.none": "No warnings.",
  "doctor.summary": "{n} finding(s).",

  "trim.plan": "Plan: copy {source} as {copy}",
  "trim.dryrun": "Dry run: nothing was written. Add --apply to do it.",
  "trim.sourceDir": "source folder",
  "trim.copyDir": "copy folder",
  "trim.rule.all": "rule: remove all hook definitions",
  "trim.rule.events": "rule: remove only these events: {events}",
  "trim.dropped": "Hooks removed from the copy ({n})",
  "trim.noneDropped": "The source declares no hooks for this rule; the copy is a plain duplicate.",
  "trim.settings": "Settings change in {where}",
  "trim.assign": "Assignments",
  "trim.diff": "Diff",
  "trim.noSettings": "Settings are left alone (--no-settings). Switch the original off and the copy on yourself.",
  "trim.override": "{file} turns the original on at a higher level than this change; edit it there too.",
  "trim.notices": "Things to know",
  "trim.n.namespace": "Command names change: /{from}:cmd becomes /{to}:cmd.",
  "trim.n.data": "${CLAUDE_PLUGIN_DATA} points to a new folder for the copy; existing plugin data is not moved.",
  "trim.n.userConfig": "userConfig values and secrets belong to a plugin id; enter them again for the copy.",
  "trim.n.reload": "Run /reload-plugins or start a new session so Claude Code reads the change.",
  "trim.wrote.copy": "wrote copy: {dir}",
  "trim.wrote.market": "wrote marketplace and lock in {dir}",
  "trim.wrote.settings": "patched {file} (backup: {backup})",
  "trim.noChange": "No change: the settings already have these values.",
  "trim.wrote.settingsUnchanged": "left {file} as is (already up to date, no backup made)",
  "trim.wrote.settingsNew": "created {file}",

  "sync.none": "No plughooks copies found (nothing to check). Create one with plughooks trim.",
  "sync.line.up-to-date": "up-to-date {copy} (source {source})",
  "sync.line.changed": "changed {source} ({old} -> {now}) copy {copy}",
  "sync.line.source-missing": "source-missing {source} for copy {copy}",
  "sync.line.copy-missing": "copy-missing {copy} (folder deleted; source {source})",
  "sync.applied": "regenerated {copy}",
  "sync.hint": "Run plughooks sync --apply to regenerate changed copies.",
} as const;

export type MessageKey = keyof typeof en;
