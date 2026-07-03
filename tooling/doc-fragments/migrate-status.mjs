import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STAGE_KEYS } from "./status.mjs";

// One-time migration: parse the historical STATUS.md tables into status.d/* fragments. Kept in-tree
// as a record (like migrate-decisions.mjs) — run once, then STATUS.md is a build output. After running,
// `vp run status-build` must reproduce every table cell verbatim (the round-trip check in status.test).

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STATUS_MD = join(ROOT, "STATUS.md");
const FRAGMENT_DIR = join(ROOT, "status.d");

const GROUP_FOR_HEADING = [
  [/^## Phase 0 /, "phase-0"],
  [/^## Phase 1 /, "phase-1"],
  [/^## Phase 2 /, "phase-2"],
  [/^## Cross-cutting /, "cross-cutting"],
  [/^## Phase 3 /, "phase-3"],
];

const STATE_FOR_MARKER = { "[x]": "done", "[~]": "in-progress", "[ ]": "todo", "[-]": "n/a" };

function slugify(slice) {
  return slice
    .toLowerCase()
    .replace(/·/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Reverse of renderCell: "[x] Opus 4.8\*" → 'done by="Opus 4.8" gap'.
export function cellToToken(cell) {
  const text = cell.trim();
  const state = STATE_FOR_MARKER[text.slice(0, 3)];
  if (!state) throw new Error(`unrecognized marker in cell "${cell}"`);
  let rest = text.slice(3).trim();
  let gap = false;
  let awaiting = false;
  if (rest.endsWith("\\*")) {
    gap = true;
    rest = rest.slice(0, -2).trim();
  } else if (rest.endsWith("*")) {
    gap = true;
    rest = rest.slice(0, -1).trim();
  }
  if (rest.endsWith("↻")) {
    awaiting = true;
    rest = rest.slice(0, -1).trim();
  }
  let token = state;
  if (rest) token += ` by="${rest}"`;
  if (awaiting) token += " awaiting";
  if (gap) token += " gap";
  return token;
}

function splitRow(line) {
  const cells = line.split("|");
  return cells.slice(1, cells.length - 1).map((cell) => cell.trim());
}

const isSeparator = (cells) => cells.every((cell) => /^:?-+:?$/.test(cell));
const isHeader = (cells) => cells[0] === "Slice";

export function parseStatus(markdown) {
  const fragments = [];
  let group = null;
  let order = 0;
  for (const line of markdown.split("\n")) {
    const heading = GROUP_FOR_HEADING.find(([pattern]) => pattern.test(line));
    if (heading) {
      group = heading[1];
      order = 0;
      continue;
    }
    if (!group || !line.startsWith("|")) continue;
    const cells = splitRow(line);
    if (cells.length !== STAGE_KEYS.length + 2 || isSeparator(cells) || isHeader(cells)) continue;
    const [slice, ...rest] = cells;
    const notes = rest.pop();
    order += 1;
    fragments.push({
      slice,
      group,
      order,
      stages: Object.fromEntries(STAGE_KEYS.map((key, index) => [key, cellToToken(rest[index])])),
      notes,
    });
  }
  return fragments;
}

function serialize(fragment) {
  const lines = [
    "---",
    `slice: ${fragment.slice}`,
    `group: ${fragment.group}`,
    `order: ${fragment.order}`,
    ...STAGE_KEYS.map((key) => `${key}: ${fragment.stages[key]}`),
    "branch: main",
    "active-work:",
    "next:",
    "link-spec:",
    "link-plan:",
    "adrs:",
    "blocked-by:",
    "---",
    "",
    fragment.notes,
    "",
  ];
  return lines.join("\n");
}

export function migrate() {
  if (!existsSync(FRAGMENT_DIR)) mkdirSync(FRAGMENT_DIR, { recursive: true });
  const fragments = parseStatus(readFileSync(STATUS_MD, "utf8"));
  for (const fragment of fragments) {
    writeFileSync(join(FRAGMENT_DIR, `${slugify(fragment.slice)}.md`), serialize(fragment));
  }
  console.log(`status: migrated ${fragments.length} slice(s) into status.d/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate();
}
