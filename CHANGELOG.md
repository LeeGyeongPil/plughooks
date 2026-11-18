# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.3] - 2026-11-19

### Fixed
- `doctor` W010 now says a copy folder was deleted (with the `sync --apply` fix) instead of showing an identical hash pair as if the source changed.

## [0.1.2] - 2026-11-19

### Fixed
- `trim` and `sync` no longer fail with ENOENT when a plugin folder contains a dangling symlink; links are kept as links and hashed by their target string.

## [0.1.1] - 2026-11-19

### Fixed
- Copying plugin folders no longer depends on `fs.cpSync` (own `copyTree`), which failed on some CI Node versions.
- CI workflow hardened; `.gitattributes` keeps line endings stable; added a regression test for the copy path.

## [0.1.0] - 2026-11-19

First release.

### Added
- `list`: every declared hook with source file, JSON path, state and reason, from settings (user, project, local, managed) and plugins (hooks.json, plugin.json path/inline/array, marketplace entry inline hooks, skill/agent/command frontmatter), including switched-off and orphaned plugins. `--event` filters by event name and warns about unknown names.
- `doctor`: stable warning codes W001-W011 (`--strict`, `--json`). W010 reports a copy whose source changed or whose folder was deleted; W011 reports hook-related places plughooks does not interpret, including wrongly shaped hooks in settings files.
- `trim`: hook-free copy of a plugin in a local directory marketplace, dry-run by default, `--drop-all-hooks` / `--drop-events` (names checked, case-sensitive), `--allow-empty`, settings patch with numbered backups and atomic write that keeps symlinks and file mode. A plughooks copy cannot be trimmed again. Safety refusals (hooks module key, missing hooks file, flow-style frontmatter) exit 3 and write nothing; input errors exit 2.
- `sync`: detect upstream changes by content hash (`--check`), regenerate copies (`--apply`), and report `copy-missing` when a copy folder was deleted (`--apply` rebuilds it).
- English and Korean output (`--lang`, `PLUGHOOKS_LANG`, locale variables), also for command-line parse errors; `--json` output is language neutral.
- Practice demo (`npm run demo`, `--lang ko` supported) on a mock tree in a temp folder that is always removed.
