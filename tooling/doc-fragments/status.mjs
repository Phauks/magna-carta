// Pure parse + render for the STATUS.md fragment model (status.d/* → STATUS.md + STATUS.json).
// No filesystem here — every function is a pure transform, unit-tested in status.test.mjs. The
// impure runner is build-status.mjs. Mirrors the split in changelog.mjs / build-changelog.mjs.
//
// A slice's status is persistent (it keeps moving across the pipeline), so unlike changelog
// fragments these are never consumed: build-status regenerates the whole file from the current
// fragment set every run. Tables are emitted width-independent (single space around each cell, no
// padding to column max-width) so one long note can never re-pad — and diff — every other row.

export const GROUPS = [
  "phase-0",
  "phase-1",
  "phase-2",
  "cross-cutting",
  "phase-3",
  "phase-4",
  "phase-5",
  "phase-6",
];
export const STAGE_KEYS = ["research", "spec", "plan", "built", "ui", "load-profile", "tested"];
export const STATES = ["done", "in-progress", "todo", "n/a"];

const COLUMN_HEADERS = [
  "Slice",
  "Research",
  "Spec",
  "Plan",
  "Built",
  "UI",
  "Load profile",
  "Tested",
  "Notes",
];
// Slice + Notes left-aligned; the seven stage markers centered (matches the historical table).
const COLUMN_RULES = ["---", ":---:", ":---:", ":---:", ":---:", ":---:", ":---:", ":---:", "---"];

const MARKER_FOR = { done: "[x]", "in-progress": "[~]", todo: "[ ]", "n/a": "[-]" };

// A stage cell: <state> [by="Model X.Y"] [awaiting] [gap]. `awaiting` is the pending-Fable-pass
// mark (↻); `gap` is work done during the Fable-access gap (a trailing escaped asterisk). Both
// clear to a plain state once Fable re-confirms. Model attribution renders verbatim after the marker.
export function parseStageToken(raw, context = "stage") {
  const token = raw.trim();
  const [state, ...rest] = token.split(/\s+/);
  if (!STATES.includes(state)) {
    throw new Error(`${context}: unknown state "${state}" (expected one of ${STATES.join(", ")})`);
  }
  const remainder = rest.join(" ");
  const byMatch = remainder.match(/by="([^"]*)"/);
  const stage = { state };
  if (byMatch) stage.by = byMatch[1];
  const flags = remainder
    .replace(/by="[^"]*"/, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (const flag of flags) {
    if (flag === "awaiting") stage.awaiting = true;
    else if (flag === "gap") stage.gap = true;
    else throw new Error(`${context}: unknown flag "${flag}" (expected awaiting or gap)`);
  }
  return stage;
}

export function renderCell(stage) {
  let cell = MARKER_FOR[stage.state];
  if (stage.by) cell += ` ${stage.by}`;
  if (stage.awaiting) cell += " ↻";
  if (stage.gap) cell += "\\*"; // escaped so Markdown never reads it as emphasis
  return cell;
}

function splitList(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFrontmatter(markdown) {
  const lines = markdown.split("\n");
  if (lines[0] !== "---") throw new Error("fragment: missing opening --- frontmatter fence");
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error("fragment: missing closing --- frontmatter fence");
  const data = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    if (colon === -1) throw new Error(`fragment: malformed frontmatter line "${line}"`);
    data[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  const body = lines
    .slice(end + 1)
    .join("\n")
    .trim();
  return { data, body };
}

export function parseFragment(markdown, name = "fragment") {
  const { data, body } = parseFrontmatter(markdown);
  for (const key of ["slice", "group", "order"]) {
    if (!data[key]) throw new Error(`${name}: missing required frontmatter key "${key}"`);
  }
  if (!GROUPS.includes(data.group)) {
    throw new Error(
      `${name}: unknown group "${data.group}" (expected one of ${GROUPS.join(", ")})`,
    );
  }
  if (!/^\d+$/.test(data.order)) {
    throw new Error(`${name}: order must be a non-negative integer, got "${data.order}"`);
  }
  const stages = {};
  for (const key of STAGE_KEYS) {
    if (!data[key]) throw new Error(`${name}: missing required stage "${key}"`);
    stages[key] = parseStageToken(data[key], `${name}.${key}`);
  }
  if (!body) throw new Error(`${name}: missing notes body`);
  return {
    slice: data.slice,
    group: data.group,
    order: Number(data.order),
    stages,
    branch: data.branch || "main",
    activeWork: data["active-work"] || null,
    next: data.next || null,
    links: {
      spec: data["link-spec"] || null,
      plan: data["link-plan"] || null,
      adrs: splitList(data.adrs),
    },
    blockedBy: splitList(data["blocked-by"]),
    notes: body,
  };
}

// Ordering + uniqueness: fragments sort by (group index, order). A duplicate (group, order) is a
// hard error — two slices claiming the same slot would render in a nondeterministic order.
export function sortFragments(fragments) {
  return [...fragments].sort(
    (a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.order - b.order,
  );
}

export function validateFragments(fragments) {
  const seen = new Map();
  for (const fragment of fragments) {
    const key = `${fragment.group}#${fragment.order}`;
    if (seen.has(key)) {
      throw new Error(
        `duplicate (group, order): "${fragment.slice}" and "${seen.get(key)}" both claim ${key}`,
      );
    }
    seen.set(key, fragment.slice);
  }
}

function renderRow(cells) {
  return `| ${cells.join(" | ")} |`;
}

export function renderTable(fragments) {
  const rows = [renderRow(COLUMN_HEADERS), renderRow(COLUMN_RULES)];
  for (const fragment of sortFragments(fragments)) {
    rows.push(
      renderRow([
        fragment.slice,
        ...STAGE_KEYS.map((key) => renderCell(fragment.stages[key])),
        fragment.notes,
      ]),
    );
  }
  return rows.join("\n");
}

// The scaffolding (_sections.md) carries every hand-authored line — title, intro, the Stages legend,
// the markers/attribution prose, phase headings + preambles, footer — with a {{table:<group>}} token
// wherever a group's table belongs. renderStatus injects the generated table at each token.
export function renderStatus(sections, fragments) {
  validateFragments(fragments);
  const byGroup = new Map(GROUPS.map((group) => [group, []]));
  for (const fragment of fragments) byGroup.get(fragment.group).push(fragment);
  return sections.replace(/\{\{table:([a-z0-9-]+)\}\}/g, (_, group) => {
    if (!byGroup.has(group)) throw new Error(`_sections.md: unknown table group "${group}"`);
    return renderTable(byGroup.get(group));
  });
}

// STATUS.json — the machine index agents read instead of parsing the table. Stages are normalized to
// objects (falsy flags omitted); dev fields (next, branch, links, blockedBy) ride alongside.
export function renderIndex(fragments) {
  validateFragments(fragments);
  const slices = sortFragments(fragments).map((fragment) => ({
    slice: fragment.slice,
    group: fragment.group,
    order: fragment.order,
    stages: fragment.stages,
    branch: fragment.branch,
    activeWork: fragment.activeWork,
    next: fragment.next,
    links: fragment.links,
    blockedBy: fragment.blockedBy,
    notes: fragment.notes,
  }));
  return `${JSON.stringify({ generatedBy: "vp run status-build", slices }, null, 2)}\n`;
}
