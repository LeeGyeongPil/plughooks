import { basename, relative } from "node:path";
import type { Warning } from "./doctor.js";
import { translate, type MessageKey } from "./i18n/index.js";
import type { PluginInfo } from "./plugins.js";
import type { Resolved } from "./resolve.js";
import type { SyncItem } from "./sync.js";
import { lineDiff, type TrimPlan, type TrimResult } from "./trim.js";
import type { HookReason, HookRow, Lang } from "./types.js";

/** Pads columns to equal width. */
function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  return rows.map((r) => r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]))).join("  ").trimEnd());
}

export class Renderer {
  constructor(readonly lang: Lang) {}

  t(key: MessageKey, params: Record<string, string | number> = {}): string {
    return translate(this.lang, key, params);
  }

  /** `settings.json (user)` style label for a settings file. */
  where(file: string, layer: string | undefined): string {
    return layer === undefined || layer === "" ? basename(file) : `${basename(file)} (${layer})`;
  }

  reason(r: HookReason): string {
    if (r.key === "enabled-by-setting") {
      return this.t(r.value === true ? "reason.enabled-by-setting.true" : "reason.enabled-by-setting.false", {
        where: this.where(r.file ?? "", r.layer),
      });
    }
    const key = `reason.${r.key}` as MessageKey;
    return this.t(key, { where: this.where(r.file ?? "", r.layer) });
  }

  sourceLabel(row: HookRow): string {
    return row.source.kind === "settings" ? `settings:${row.source.layer}` : `plugin:${row.source.pluginId}`;
  }

  location(row: HookRow): string {
    const base = row.source.pluginDir === undefined ? basename(row.source.file) : relative(row.source.pluginDir, row.source.file);
    return `${base}#${row.source.jsonPath}`;
  }

  // ---- list ----

  listText(res: Resolved, rows: HookRow[]): string {
    const out: string[] = [];
    out.push(this.t("s.settings"));
    for (const f of res.settings.files) {
      out.push(`  ${f.layer.padEnd(8)} ${this.t(f.exists ? "list.found" : "list.missing").padEnd(8)} ${f.file}`);
    }
    out.push("", this.t("s.plugins"));
    if (res.discovery.plugins.length === 0) out.push("  -");
    else {
      const head = [this.t("h.id"), this.t("h.kind"), this.t("h.version"), this.t("h.state"), this.t("h.hooks")];
      const body = res.discovery.plugins.map((p) => [p.id, p.kind, p.version ?? "-", pluginState(p), String((res.pluginRows.get(p.dir) ?? []).length)]);
      out.push(...table([head, ...body]).map((l) => "  " + l));
    }
    out.push("", this.t("s.hooks"));
    if (rows.length === 0) out.push("  " + this.t("list.noHooks"));
    else {
      const head = [this.t("h.event"), this.t("h.matcher"), this.t("h.source"), this.t("h.state"), this.t("h.command")];
      const body = rows.map((r) => [r.event, r.matcher, this.sourceLabel(r), r.state, r.command]);
      const lines = table([head, ...body]);
      out.push("  " + lines[0]);
      rows.forEach((r, i) => {
        out.push("  " + lines[i + 1]);
        out.push(`      ${this.location(r)} - ${this.reason(r.reason)}`);
      });
    }
    const codes = [...new Set(res.diagnostics.map((d) => d.code))];
    if (codes.length > 0) {
      out.push("", this.t("s.notes"));
      for (const d of res.diagnostics) out.push(`  ${d.code} ${this.warnText({ code: d.code, name: "", severity: "warn", data: { detail: d.detail ?? "", plugin: d.pluginId ?? "" } })}`);
    }
    out.push("", this.t("list.note"));
    return out.join("\n") + "\n";
  }

  listJson(res: Resolved, rows: HookRow[]): unknown {
    return {
      settings: res.settings.files.map((f) => ({ layer: f.layer, file: f.file, exists: f.exists })),
      plugins: res.discovery.plugins.map((p) => ({
        id: p.id,
        kind: p.kind,
        version: p.version ?? null,
        enabled: p.enabled,
        state: pluginState(p),
        dir: p.dir,
        hooks: (res.pluginRows.get(p.dir) ?? []).length,
        enabledBy: p.enabledBy === undefined ? null : { layer: p.enabledBy.layer, file: p.enabledBy.file },
      })),
      hooks: rows,
      codes: [...new Set(res.diagnostics.map((d) => d.code))].sort(),
    };
  }

  // ---- doctor ----

  warnText(w: Warning): string {
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(w.data)) params[k] = Array.isArray(v) ? v.join(", ") : v;
    if (w.code === "W001") {
      const layer = String(w.data.layer);
      params.by = layer === "default" ? this.t("w.by.default") : this.where(String(w.data.by), layer);
    }
    if (w.code === "W010" && w.data.status === "copy-missing") return this.t("w.W010.missing", params);
    return this.t(`w.${w.code}` as MessageKey, params);
  }

  doctorText(ws: Warning[]): string {
    if (ws.length === 0) return this.t("doctor.none") + "\n";
    const out: string[] = [];
    for (const w of ws) {
      out.push(`${w.code} [${this.t(w.severity === "info" ? "w.sev.info" : "w.sev.warn")}] ${w.name}`);
      out.push(`    ${this.warnText(w)}`);
      if (w.file !== undefined) out.push(`    ${w.file}${w.jsonPath === undefined ? "" : "#" + w.jsonPath}`);
    }
    out.push("", this.t("doctor.summary", { n: ws.length }));
    return out.join("\n") + "\n";
  }

  // ---- trim ----

  trimText(plan: TrimPlan, result: TrimResult | undefined): string {
    const out: string[] = [];
    out.push(this.t("trim.plan", { source: plan.source.id, copy: plan.copyId }));
    out.push(`  ${this.t("trim.sourceDir")}: ${plan.source.dir}`);
    out.push(`  ${this.t("trim.copyDir")}: ${plan.copyDir}`);
    out.push(`  ${plan.drop.mode === "all" ? this.t("trim.rule.all") : this.t("trim.rule.events", { events: plan.drop.events.join(", ") })}`);
    out.push("", this.t("trim.dropped", { n: plan.dropped.length }));
    if (plan.dropped.length === 0) out.push("  " + this.t("trim.noneDropped"));
    for (const r of plan.dropped) out.push(`  ${r.event.padEnd(18)} ${r.matcher.padEnd(10)} ${this.location(r)}  ${r.command}`);
    out.push("");
    if (plan.settings === undefined) out.push(this.t("trim.noSettings"));
    else {
      out.push(this.t("trim.settings", { where: this.where(plan.settings.file, plan.settingsLayer) }));
      out.push(`  ${this.t("trim.assign")}:`);
      for (const a of plan.assignments) out.push(`    ${a}`);
      out.push(`  ${this.t("trim.diff")}:`);
      for (const l of lineDiff(plan.settings.before, plan.settings.after)) out.push(`    ${l}`);
      if (plan.overrideFile !== undefined) out.push("  ! " + this.t("trim.override", { file: this.where(plan.overrideFile, undefined) }));
    }
    out.push("", this.t("trim.notices"));
    out.push("  - " + this.t("trim.n.namespace", { from: plan.source.manifestName, to: plan.copyName }));
    out.push("  - " + this.t("trim.n.data"));
    out.push("  - " + this.t("trim.n.userConfig"));
    out.push("  - " + this.t("trim.n.reload"));
    out.push("");
    if (result === undefined) out.push(this.t("trim.dryrun"));
    else {
      out.push(this.t("trim.wrote.copy", { dir: result.copyDir }));
      out.push(this.t("trim.wrote.market", { dir: plan.out }));
      if (plan.settings !== undefined) {
        out.push(
          result.backup === undefined
            ? this.t("trim.wrote.settingsNew", { file: plan.settings.file })
            : this.t("trim.wrote.settings", { file: plan.settings.file, backup: result.backup }),
        );
      }
    }
    return out.join("\n") + "\n";
  }

  trimJson(plan: TrimPlan, result: TrimResult | undefined): unknown {
    return {
      source: plan.source.id,
      copy: plan.copyId,
      sourceDir: plan.source.dir,
      copyDir: plan.copyDir,
      out: plan.out,
      drop: plan.drop,
      sourceHash: plan.sourceHash,
      dropped: plan.dropped,
      settings: plan.settings === undefined ? null : { file: plan.settings.file, layer: plan.settingsLayer, assignments: plan.assignments },
      applied: result !== undefined,
      backup: result?.backup ?? null,
    };
  }

  // ---- sync ----

  syncText(items: SyncItem[], applyMode: boolean): string {
    if (items.length === 0) return this.t("sync.none") + "\n";
    const out: string[] = [];
    for (const it of items) {
      const key = `sync.line.${it.status}` as MessageKey;
      out.push(this.t(key, { copy: it.copy, source: it.source, old: it.oldHash, now: it.newHash ?? "" }));
      if (it.applied) out.push("  " + this.t("sync.applied", { copy: it.copy }));
    }
    if (!applyMode && items.some((i) => i.status === "changed" || i.status === "copy-missing")) out.push("", this.t("sync.hint"));
    return out.join("\n") + "\n";
  }

  syncJson(items: SyncItem[]): unknown {
    return { items: items.map((i) => ({ copy: i.copy, source: i.source, status: i.status, oldHash: i.oldHash, newHash: i.newHash ?? null, applied: i.applied })) };
  }
}

function pluginState(p: PluginInfo): string {
  return p.kind === "orphan" ? "orphan" : p.enabled ? "on" : "off";
}
