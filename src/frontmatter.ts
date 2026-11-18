// Line-based handling of the `hooks:` block in SKILL.md / agent / command frontmatter.
// Only block-style YAML is supported. Flow style (`hooks: {...}`) is detected and reported,
// because editing it line by line would be guesswork.

export class FlowStyleError extends Error {
  constructor() {
    super("flow-style hooks in frontmatter");
  }
}

interface Item {
  indent: number;
  text: string;
}

function toItems(lines: string[]): Item[] {
  return lines
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"))
    .map((l) => ({ indent: l.length - l.trimStart().length, text: l.trim() }));
}

function scalar(raw: string): unknown {
  let s = raw.trim();
  if (s.startsWith("[") || s.startsWith("{")) throw new FlowStyleError();
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.startsWith("'")) return s.slice(1, s.lastIndexOf("'")).replace(/''/g, "'");
  s = s.replace(/\s+#.*$/, "");
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~" || s === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

const isSeq = (t: string): boolean => t === "-" || t.startsWith("- ");

/** Parse a small YAML subset: nested block maps, block sequences, scalars. */
export function parseYamlBlock(lines: string[]): unknown {
  const items = toItems(lines);
  let i = 0;

  const parseNode = (): unknown => {
    const it = items[i];
    if (it === undefined) return null;
    return isSeq(it.text) ? parseSeq(it.indent) : parseMap(it.indent);
  };

  const parseSeq = (indent: number): unknown[] => {
    const out: unknown[] = [];
    while (i < items.length && items[i].indent === indent && isSeq(items[i].text)) {
      const text = items[i].text;
      const rest = text.slice(1).trim();
      if (rest === "") {
        i++;
        out.push(items[i] !== undefined && items[i].indent > indent ? parseNode() : null);
      } else if (/^[^\s"'\[{][^:]*:(\s|$)/.test(rest) || /^["'][^"']*["']:(\s|$)/.test(rest)) {
        // "- key: value" starts a map whose keys line up with `rest`.
        items[i] = { indent: indent + (text.length - rest.length), text: rest };
        out.push(parseMap(items[i].indent));
      } else {
        out.push(scalar(rest));
        i++;
      }
    }
    return out;
  };

  const parseMap = (indent: number): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    while (i < items.length && items[i].indent === indent && !isSeq(items[i].text)) {
      const m = /^("[^"]*"|'[^']*'|[^:]+?):(?:\s+(.*))?$/.exec(items[i].text);
      if (m === null) {
        i++;
        continue;
      }
      const key = m[1].replace(/^["']|["']$/g, "");
      const rest = m[2] ?? "";
      i++;
      if (rest === "") {
        const next = items[i];
        if (next !== undefined && (next.indent > indent || (next.indent === indent && isSeq(next.text)))) {
          out[key] = next.indent === indent ? parseSeq(indent) : parseNode();
        } else out[key] = null;
      } else out[key] = scalar(rest);
    }
    return out;
  };

  return parseNode();
}

export interface HooksBlock {
  /** Index of the frontmatter's opening `---` (always 0) and closing `---`. */
  fmEnd: number;
  /** Line index of `hooks:` and the exclusive end of its block. */
  start: number;
  end: number;
}

/** Locate the top-level `hooks:` block inside the frontmatter, if any. Throws FlowStyleError for `hooks: {...}`. */
export function findHooksBlock(lines: string[]): HooksBlock | undefined {
  if (lines.length === 0 || lines[0].replace(/\r$/, "") !== "---") return undefined;
  let fmEnd = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, "") === "---") {
      fmEnd = i;
      break;
    }
  }
  if (fmEnd < 0) return undefined;
  for (let i = 1; i < fmEnd; i++) {
    const m = /^hooks:\s*(.*?)\s*$/.exec(lines[i].replace(/\r$/, ""));
    if (m === null) continue;
    if (m[1] !== "" && !m[1].startsWith("#")) throw new FlowStyleError();
    let end = i + 1;
    while (end < fmEnd) {
      const l = lines[end].replace(/\r$/, "");
      if (l.trim() === "" || /^[ \t]/.test(l) || l.startsWith("#")) end++;
      else break;
    }
    return { fmEnd, start: i, end };
  }
  return undefined;
}

export interface ParsedFrontmatterHooks {
  events: Record<string, unknown>;
}

/** Return the hooks event map declared in frontmatter, or undefined. */
export function readFrontmatterHooks(text: string): ParsedFrontmatterHooks | undefined {
  const lines = text.split("\n");
  const block = findHooksBlock(lines);
  if (block === undefined) return undefined;
  const parsed = parseYamlBlock(lines.slice(block.start + 1, block.end));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { events: {} };
  return { events: parsed as Record<string, unknown> };
}

/**
 * Remove hooks from frontmatter: all of them, or only the listed events.
 * Everything outside the removed lines stays byte-identical.
 */
export function stripFrontmatterHooks(text: string, events: string[] | "all"): string {
  const lines = text.split("\n");
  const block = findHooksBlock(lines);
  if (block === undefined) return text;
  const inner = lines.slice(block.start + 1, block.end);
  const first = inner.find((l) => l.trim() !== "" && !l.trim().startsWith("#"));
  if (first === undefined) return events === "all" ? lines.filter((_, i) => i < block.start || i >= block.end).join("\n") : text;
  const indent = first.length - first.trimStart().length;
  // Walk the event keys at `indent`, collecting the line ranges to drop.
  const drop = new Set<number>();
  let remaining = 0;
  for (let k = 0; k < inner.length; k++) {
    const raw = inner[k].replace(/\r$/, "");
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const ind = raw.length - raw.trimStart().length;
    if (ind !== indent) continue;
    const m = /^([A-Za-z]+):\s*(.*)$/.exec(raw.trim());
    if (m === null) continue;
    if (m[2] !== "" && !m[2].startsWith("#")) throw new FlowStyleError();
    let e = k + 1;
    while (e < inner.length) {
      const r = inner[e].replace(/\r$/, "");
      if (r.trim() === "" || r.trim().startsWith("#") || r.length - r.trimStart().length > indent) e++;
      else break;
    }
    if (events === "all" || events.includes(m[1])) for (let j = k; j < e; j++) drop.add(block.start + 1 + j);
    else remaining++;
  }
  if (events === "all" || remaining === 0) {
    return lines.filter((_, i) => i < block.start || i >= block.end).join("\n");
  }
  return lines.filter((_, i) => !drop.has(i)).join("\n");
}
