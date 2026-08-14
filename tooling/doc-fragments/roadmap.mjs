// Pure parse + render for the feature ledger (roadmap.d/* → docs/now.md). No filesystem here —
// every function is a pure transform, unit-tested in roadmap.test.mjs. The impure runner is
// build-register.mjs and the fitness function is tooling/lint-roadmap.mjs. Mirrors the split in
// status.mjs / build-status.mjs and changelog.mjs / build-changelog.mjs.
//
// The ledger is the one home for how complete each capability is, and docs/now.md is a rendering of
// it, never a second copy. It is the COMPLETE register: every node, at its real status, nothing
// collapsed and nothing curated. A digest of this ledger was tried and thrown away — banding nine
// statuses into five horizons put `partial` (a backend with no screen on it) and `in-build` (being
// written right now) under one heading, which is the largest loss of signal the source can suffer.
// Whatever else changes here, do not re-collapse the statuses.
//
// renderPublicRoadmap is the other rendering — user-facing, curated, banded. It is exercised by its
// tests and read by packages/product-updates, and it is deliberately NOT written to disk: there are
// no users yet, so there is no audience for it, and a document nobody reads is a document nobody
// keeps honest. The renderer, the audience/public-name/public-summary ledger keys and the artifact
// schema all stay ready for the day the product has readers.
//
// The rendered document carries no generation timestamp: it is a byte-exact function of the ledger
// so that a diff gate can hold it, and a clock in the output would break that every day. A renderer
// that wants a build time stamps its own — see packages/product-updates.

export const LEDGER_STATUSES = [
  "shipped",
  "partial",
  "in-build",
  "designed",
  "planned",
  "researching",
  "not-started",
  "deferred",
  "cut",
];

export const AUDIENCES = ["public", "internal"];

// The public horizon bands. These are the community board's own status names, adopted verbatim so a
// request card and a roadmap entry never say the same thing in two vocabularies — see
// docs/specs/2026-08-11-community-surfaces-design.md. `Beta` is theirs too and is deliberately
// absent here: no ledger status can honestly produce it until the release-channel work defines what
// beta means, and an approximated band is worse than a missing one.
export const BANDS = ["Building Now", "Planned", "Future", "Completed", "Not on the roadmap"];

const BAND_FOR_STATUS = {
  shipped: "Completed",
  "in-build": "Building Now",
  // A capability delivered in part is most often a shipped backend whose screen is not built, which
  // from the seat of somebody using the product is not yet done.
  partial: "Building Now",
  planned: "Planned",
  designed: "Planned",
  researching: "Future",
  "not-started": "Future",
  // Parked by a decision — a weaker claim than planned, but not a refusal, so not a declined band.
  deferred: "Future",
  cut: "Not on the roadmap",
};

// Ordering the bands are rendered in: what is happening first, what was dropped last.
const BAND_ORDER = ["Building Now", "Planned", "Future", "Completed", "Not on the roadmap"];

const AREA_TITLE = /^# (.+)$/;
const AREA_PUBLIC_GROUP = /^<!--\s*public-group:\s*(.+?)\s*-->$/;
const NODE_FIRST_KEY = /^- ([a-z][a-z-]*): ?(.*)$/;
const NODE_KEY = /^ {2}([a-z][a-z-]*): ?(.*)$/;

export function bandForStatus(status) {
  const band = BAND_FOR_STATUS[status];
  if (band === undefined) throw new Error(`unknown ledger status "${status}"`);
  return band;
}

// Parse one area file. Strict: a line that is neither blank, the title, an HTML comment, nor a
// `key: value` at one of the two recognised indents is an error rather than something skipped. The
// failure being guarded is silent omission — a node that does not parse would drop a capability out
// of the published roadmap with nothing raised.
export function parseArea(markdown, name = "area") {
  const lines = markdown.split("\n");
  const problems = [];
  const nodes = [];
  let title = null;
  let publicGroup = null;
  let node = null;

  const openNode = (key, value, at) => {
    if (key !== "id") problems.push(`line ${at}: a node block must open with "id", not "${key}"`);
    node = { fields: { [key]: value }, line: at, area: name };
    nodes.push(node);
  };

  for (const [index, line] of lines.entries()) {
    const at = index + 1;
    if (line.trim() === "") continue;

    const heading = AREA_TITLE.exec(line);
    if (heading !== null) {
      if (title !== null) problems.push(`line ${at}: a second area title`);
      title = (heading[1] ?? "").trim();
      continue;
    }

    const group = AREA_PUBLIC_GROUP.exec(line.trim());
    if (group !== null) {
      publicGroup = group[1] ?? null;
      continue;
    }
    if (line.trim().startsWith("<!--")) continue;

    const first = NODE_FIRST_KEY.exec(line);
    if (first !== null) {
      openNode(first[1] ?? "", (first[2] ?? "").trim(), at);
      continue;
    }

    const key = NODE_KEY.exec(line);
    if (key !== null) {
      if (node === null) {
        problems.push(`line ${at}: "${(key[1] ?? "").trim()}" sits above the first node`);
        continue;
      }
      const field = key[1] ?? "";
      if (field in node.fields) problems.push(`line ${at}: "${field}" is set twice on one node`);
      node.fields[field] = (key[2] ?? "").trim();
      continue;
    }

    problems.push(`line ${at}: "${line.trim()}" is neither a node field nor an area heading`);
  }

  if (title === null) problems.push("the file has no `# Area title` heading");
  if (problems.length > 0) throw new RoadmapParseError(name, problems);

  return {
    name,
    title,
    // The heading users see for this area. The internal title is builder vocabulary often enough
    // ("Core Domain — Directory, Matters & Locations") to be worth overriding, and once per area is
    // the right place: repeating it on every node would be the same fact in many homes.
    publicGroup: publicGroup ?? title,
    nodes: nodes.map((entry) => finishNode(entry, name)),
  };
}

export class RoadmapParseError extends Error {
  constructor(area, problems) {
    super(`roadmap.d/${area} is malformed:\n${problems.map((line) => `  ${line}`).join("\n")}`);
    this.name = "RoadmapParseError";
    this.area = area;
    this.problems = problems;
  }
}

function finishNode({ fields, line, area }, name) {
  const problems = [];
  for (const key of ["id", "name", "scope", "status"]) {
    if (!fields[key]) problems.push(`line ${line}: node is missing required key "${key}"`);
  }
  if (fields.status && !LEDGER_STATUSES.includes(fields.status)) {
    problems.push(
      `line ${line}: "${fields.id}" has unknown status "${fields.status}" (expected one of ${LEDGER_STATUSES.join(", ")})`,
    );
  }
  if (fields.audience && !AUDIENCES.includes(fields.audience)) {
    problems.push(
      `line ${line}: "${fields.id}" has unknown audience "${fields.audience}" (expected ${AUDIENCES.join(" or ")})`,
    );
  }
  if (problems.length > 0) throw new RoadmapParseError(name, problems);
  return {
    id: fields.id,
    name: fields.name,
    scope: fields.scope,
    status: fields.status,
    area,
    line,
    audience: fields.audience ?? "internal",
    publicName: fields["public-name"] ?? fields.name,
    publicSummary: fields["public-summary"] ?? null,
    awaitingOwner: fields["awaiting-owner"] ?? null,
    slices: splitList(fields.slices),
    notes: fields.notes ?? null,
  };
}

function splitList(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// Every node across every area, in a stable order: areas as given (the caller reads the directory
// sorted), nodes in the order they are written in their file.
export function allNodes(areas) {
  return areas.flatMap((area) => area.nodes);
}

export function publicEntries(areas) {
  const entries = [];
  for (const area of areas) {
    for (const node of area.nodes) {
      if (node.audience !== "public") continue;
      entries.push({
        id: node.id,
        name: node.publicName,
        summary: node.publicSummary,
        group: area.publicGroup,
        band: bandForStatus(node.status),
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------
// The public rendering — what users would see. DORMANT: no build script calls this today, because
// the product has no users and a roadmap written for them was answering nobody. Kept whole, and
// kept tested, so reviving it is wiring a renderer back to a build script rather than writing one.

const PUBLIC_PREAMBLE = `# Magna Carta roadmap

What we are building, and roughly where each piece has got to. It is written for the people who use
Magna Carta rather than the people who build it, and it is a companion to the
[changelog](public-changelog.md): the changelog says what has arrived, this says what is coming.

Magna Carta is being built and is not yet generally available, so most of what follows is on its
way rather than in your hands. The bands say how far along each piece is.

**There are no dates here, and there will not be.** Work is grouped into bands — Building Now,
Planned, Future and Completed, with anything we have decided against at the end — and nothing
carries a target quarter or a delivery date. A date on a page like this is a promise made before the
work is understood, and a missed one costs more than it ever bought. What you can rely on instead is
that the bands are true on the day you read them: each is derived from the state of the work itself,
not maintained by hand.

**Things move backwards sometimes.** A capability can go from Planned to Future when something more
urgent lands in front of it, or when the design turns out to be wrong. When that happens it moves on
this page too, rather than sitting in a band it has left.

This file is **assembled, never hand-edited.** It is rendered from the feature ledger the build runs
on, so an entry cannot describe a state the work is not actually in.`;

const PUBLIC_BAND_BLURB = {
  "Building Now": "Being worked on right now.",
  Planned: "Decided and designed. Queued to be built.",
  Future: "Intended, and not scheduled. Some of these are still being researched.",
  Completed:
    "Delivered and in use. See the [changelog](public-changelog.md) for what each one does and when it arrived.",
  "Not on the roadmap":
    "Things we said we would build and have decided not to. Kept here rather than quietly deleted.",
};

export function renderPublicRoadmap(areas) {
  const entries = publicEntries(areas);
  const sections = [PUBLIC_PREAMBLE];

  for (const band of BAND_ORDER) {
    const inBand = entries.filter((entry) => entry.band === band);
    if (inBand.length === 0) continue;
    sections.push(`## ${band}\n\n${PUBLIC_BAND_BLURB[band]}`);
    for (const group of orderedGroups(inBand)) {
      const lines = [`### ${group}`, ""];
      for (const entry of inBand.filter((candidate) => candidate.group === group)) {
        // Completed entries are names only. The changelog owns what a shipped thing does and when it
        // landed; repeating the sentence here would be a second account of the same fact with no way
        // to keep the two agreeing. They stay listed so a reader who saw an entry under Building Now
        // last month can tell that it shipped rather than that it was dropped.
        lines.push(
          band === "Completed" ? `- ${entry.name}` : `- **${entry.name}** — ${entry.summary}`,
        );
      }
      sections.push(lines.join("\n"));
    }
  }

  return `${sections.join("\n\n")}\n`;
}

function orderedGroups(entries) {
  const groups = [];
  for (const entry of entries) if (!groups.includes(entry.group)) groups.push(entry.group);
  return groups;
}

// ---------------------------------------------------------------------------------------------
// docs/now.md — the complete build register.

// The four ways a capability can stand, each a group of ledger statuses. Coarser than `status` and
// deliberately so: four numbers are the ones you reason about, nine are the ones you audit against,
// and the document prints both rather than choosing. Every ledger status belongs to exactly one
// roll-up — asserted in roadmap.test.mjs, because a status quietly missing from this table would
// make a percentage column wrong rather than make it fail.
export const ROLL_UPS = [
  { name: "Done", statuses: ["shipped"] },
  { name: "Part-built", statuses: ["partial", "in-build"] },
  { name: "Ahead", statuses: ["designed", "planned", "researching", "not-started"] },
  { name: "Parked", statuses: ["deferred", "cut"] },
];

const REGISTER_PREAMBLE = (nodeCount, areaCount) => `# Now — the build register

Every capability in the program, with its real status, and the arithmetic over the whole set. This
is the complete register rather than a digest: all ${nodeCount} nodes of the feature ledger in
[\`roadmap.d/\`](../roadmap.d/) are listed below, at the status the ledger actually holds, with
nothing collapsed and nothing curated away.

**Assembled, never hand-edited.** Run \`vp run register-build\` after changing a ledger node.

**This is where we are, not where we were.** The ledger records only each capability's current
status — it keeps no history at all, so no trend line can be drawn from it without inventing one,
and none is drawn here. [\`CHANGELOG.md\`](../CHANGELOG.md) is the dated record of what shipped and
when; it is the only place a real "where we have been" can be read today. Slice-by-slice build
stages live in [\`STATUS.md\`](../STATUS.md), the narrative of what each stream is doing lives in
[\`ROADMAP.md\`](../ROADMAP.md), and what each of the nine statuses means lives in
[\`roadmap.d/README.md\`](../roadmap.d/README.md).`;

export function renderBuildRegister(areas) {
  const nodes = allNodes(areas);
  const sections = [REGISTER_PREAMBLE(nodes.length, areas.length)];

  sections.push(section("Where the program stands", renderStanding(areas, nodes)));
  sections.push(section("Waiting on you", renderAwaiting(nodes)));
  sections.push(section("Being built now", renderStatusList(nodes, ["in-build"])));
  sections.push(section("Next up", renderStatusList(nodes, ["planned", "designed"])));
  sections.push(section("The register", renderLedger(areas)));

  return `${sections.join("\n\n")}\n`;
}

function section(heading, body) {
  return `## ${heading}\n\n${body}`;
}

// --- the counts -------------------------------------------------------------------------------

function renderStanding(areas, nodes) {
  const counts = countByStatus(nodes);
  const shipped = counts.get("shipped");
  const partial = counts.get("partial");
  const delivered = shipped + partial;

  return [
    wrap(
      `**${nodes.length} capabilities across ${areas.length} areas.** Every one of them is listed` +
        " in [the register](#the-register) below; these are the totals over that list.",
    ),
    "",
    "### The roll-up",
    "",
    renderRollUpTable(nodes, counts),
    "",
    "### Every status",
    "",
    renderStatusTable(nodes, counts),
    "",
    "### What `partial` hides",
    "",
    wrap(
      `**Shipped alone is ${shipped} of ${nodes.length} (${share(shipped, nodes.length)}).` +
        ` Shipped plus partial is ${delivered} (${share(delivered, nodes.length)}).**`,
    ),
    "",
    wrap(
      `The ${partial} nodes between those two numbers are the most decision-relevant fact in this` +
        " document. A `partial` capability is most often a backend that works with nothing on" +
        ` screen to reach it, so the distance from ${share(shipped, nodes.length)} to` +
        ` ${share(delivered, nodes.length)} is approximately the program's interface debt: work` +
        " that is engineered and paid for, and that nobody can use. Reading the larger number as" +
        " how much of the product exists overstates what a user can do; reading the smaller one" +
        " understates what has been built. Both are true and neither is the answer on its own.",
    ),
    "",
    "### By area",
    "",
    renderAreaMatrix(areas),
  ].join("\n");
}

// Hard-wrap a paragraph at the width the rest of the documentation is written to. Counts are
// interpolated into this prose, so wrapping has to be computed rather than typed: a three-digit
// total becoming four digits would otherwise reflow one line by hand and leave the rest ragged.
// Safe on inline code spans because every token here is whitespace-free.
function wrap(text, width = 100) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines.join("\n");
}

function countByStatus(nodes) {
  const counts = new Map(LEDGER_STATUSES.map((status) => [status, 0]));
  for (const node of nodes) counts.set(node.status, counts.get(node.status) + 1);
  return counts;
}

function renderRollUpTable(nodes, counts) {
  const totals = ROLL_UPS.map((rollUp) =>
    rollUp.statuses.reduce((sum, status) => sum + counts.get(status), 0),
  );
  const shares = wholePercentages(totals, nodes.length);
  const rows = [
    "| Where it stands | Statuses counted | Nodes | Share |",
    "| --- | --- | ---: | ---: |",
  ];
  for (const [index, rollUp] of ROLL_UPS.entries()) {
    rows.push(
      `| ${rollUp.name} | ${rollUp.statuses.join(", ")} | ${totals[index]} | ${shares[index]}% |`,
    );
  }
  rows.push(`| **All capabilities** | | **${nodes.length}** | **100%** |`);
  return rows.join("\n");
}

function renderStatusTable(nodes, counts) {
  // Lifecycle order, not descending by count: this table is read beside a diff, and rows that
  // reorder themselves every time a node is flipped turn a one-line change into a whole-table one.
  const values = LEDGER_STATUSES.map((status) => counts.get(status));
  const shares = wholePercentages(values, nodes.length);
  const rows = ["| Status | Nodes | Share |", "| --- | ---: | ---: |"];
  for (const [index, status] of LEDGER_STATUSES.entries()) {
    rows.push(`| \`${status}\` | ${values[index]} | ${shares[index]}% |`);
  }
  rows.push(`| **All statuses** | **${nodes.length}** | **100%** |`);
  return rows.join("\n");
}

// The per-area matrix, one column per ledger status — never per band. Emitted width-independent
// (one space around each cell) so one long area name cannot re-pad every row of the diff.
function renderAreaMatrix(areas) {
  const rows = [
    `| Area | ${LEDGER_STATUSES.map((status) => `\`${status}\``).join(" | ")} | Total | Shipped |`,
    `| --- | ${LEDGER_STATUSES.map(() => "---:").join(" | ")} | ---: | ---: |`,
  ];
  const totals = new Map(LEDGER_STATUSES.map((status) => [status, 0]));
  let grandTotal = 0;

  for (const area of areas) {
    const counts = countByStatus(area.nodes);
    for (const status of LEDGER_STATUSES) {
      totals.set(status, totals.get(status) + counts.get(status));
    }
    grandTotal += area.nodes.length;
    const cells = LEDGER_STATUSES.map((status) => counts.get(status)).join(" | ");
    rows.push(
      `| ${area.title} | ${cells} | ${area.nodes.length} | ${share(counts.get("shipped"), area.nodes.length)} |`,
    );
  }

  const totalCells = LEDGER_STATUSES.map((status) => `**${totals.get(status)}**`).join(" | ");
  rows.push(
    `| **All areas** | ${totalCells} | **${grandTotal}** | **${share(totals.get("shipped"), grandTotal)}** |`,
  );
  return rows.join("\n");
}

function share(value, total) {
  return `${total === 0 ? 0 : Math.round((value * 100) / total)}%`;
}

// Whole percentages that sum to exactly 100 (largest remainder). Rounding nine shares independently
// lands on 99 or 101 often enough to matter, and a percentage column printed beside a count column
// is read as arithmetic: one that does not add up costs the reader's trust in every other number.
export function wholePercentages(values, total) {
  if (total === 0) return values.map(() => 0);
  const exact = values.map((value) => (value * 100) / total);
  const result = exact.map((value) => Math.floor(value));
  let remaining = 100 - result.reduce((sum, value) => sum + value, 0);
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .toSorted((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const { index } of byFraction) {
    if (remaining <= 0) break;
    result[index] += 1;
    remaining -= 1;
  }
  return result;
}

// --- the short lists --------------------------------------------------------------------------

// This section answers "what is blocked on me?" only for decisions about a CAPABILITY, because the
// ledger holds capabilities and nothing else. Account-side work — a dashboard step, a billing
// budget, a repository setting — blocks real work just as hard and has no node to hang from, so the
// section names its own boundary and points at that list. A "waiting on you" that silently omits
// half of what is waiting is worse than no list at all: it is trusted, and it is wrong.
function renderAwaiting(nodes) {
  const awaiting = nodes.filter((node) => node.awaitingOwner !== null);
  return [
    awaiting.length === 0
      ? "_No capability is blocked on an owner decision._"
      : awaiting
          .map((node) => `- **${node.name}** (\`${node.id}\`) — ${node.awaitingOwner}`)
          .join("\n"),
    "",
    "Decisions about a capability only. Account-side steps that no session can perform — a" +
      " Cloudflare dashboard action, a billing budget, a repository setting — are listed in" +
      " [`docs/deploy-queue.md`](deploy-queue.md), which is their one home.",
  ].join("\n");
}

// Every matching node, parents and children alike. An earlier version kept only the shallowest node
// of each subtree, on the theory that a parent plus nine children is nine lines saying what one line
// said. It is not: a parent's status is a roll-up and its children are the actual units of work, so
// collapsing them hid exactly the detail this document exists to show.
function renderStatusList(nodes, statuses) {
  const matching = nodes.filter((node) => statuses.includes(node.status));
  if (matching.length === 0) {
    return `_No capability is marked ${statuses.map((status) => `\`${status}\``).join(" or ")}._`;
  }
  return matching.map((node) => `- \`${node.id}\` · **${node.name}** — ${node.scope}`).join("\n");
}

// --- the register -----------------------------------------------------------------------------

const LEDGER_INTRO = `Every node in the ledger, by area, in the order the area file writes them.
Indentation follows the dotted id, so a child sits under its parent and a parent's status is a
roll-up of what is beneath it. Nothing is collapsed, nothing is summarised, and nothing is left out:
to change a line here, edit the node in its area file and re-run the build.`;

function renderLedger(areas) {
  const sections = [LEDGER_INTRO];
  for (const area of areas) {
    const counts = countByStatus(area.nodes);
    const shippedCount = counts.get("shipped");
    const rollUpCounts = ROLL_UPS.map(
      (rollUp) =>
        `${rollUp.statuses.reduce((sum, status) => sum + counts.get(status), 0)} ${rollUp.name.toLowerCase()}`,
    ).join(", ");
    sections.push(
      [
        `### ${area.title}`,
        "",
        `[\`roadmap.d/${area.name}\`](../roadmap.d/${area.name}) — ${area.nodes.length} nodes,` +
          ` ${share(shippedCount, area.nodes.length)} shipped. ${capitalise(rollUpCounts)}.`,
        "",
        area.nodes.map((node) => renderLedgerNode(node)).join("\n"),
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

// Two spaces of indent per level of the dotted id, which is what Markdown reads as a nested list.
// The ledger has no orphan nodes (a child never appears without its parent above it), and the lint
// would surface one as a hierarchy that jumps a level rather than as a broken document.
function renderLedgerNode(node) {
  const indent = "  ".repeat(node.id.split(".").length - 1);
  const note = node.notes === null ? "" : ` _Note: ${node.notes}_`;
  return `${indent}- \`${node.id}\` · \`${node.status}\` · **${node.name}** — ${node.scope}${note}`;
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
