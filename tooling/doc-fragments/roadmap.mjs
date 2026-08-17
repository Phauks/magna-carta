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

import { short, summariseHistory } from "./register-history.mjs";

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

// Whether a person can reach this capability, which `status` cannot say and never could: `shipped`
// covers both a screen somebody uses and a backend nobody can get to, and reading the two as one
// number is what makes a register overstate the product. It is a second key rather than something
// derived because it is genuinely a second fact — measured before it was added, prose in `notes`
// carried a usable signal on 63 nodes of 754, and an `evidence` path naming a screen on 14 of the
// 359 built leaves. Deriving it would have invented the other 302.
//
//   screen          a person can open this in the application today
//   awaiting-screen the capability works and the interface is the only thing missing
//   internal        it has no user surface by nature — a port, a table, a queue, a fitness function
//
// Unset means unclassified, and every rendering says so in those words rather than assuming one.
export const SURFACES = ["screen", "awaiting-screen", "internal"];

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
      const value = (key[2] ?? "").trim();
      // A key with nothing after it is always a mistake, and this is the only place that can see
      // it. Everything downstream reads absent and blank as the same thing, deliberately, so that a
      // blank value cannot satisfy a rule testing for presence — which means nothing downstream can
      // report one either. A blank `awaiting-owner:` would otherwise be a question that disappears.
      if (value === "") {
        problems.push(
          `line ${at}: "${field}" is written with no value — give it one, or drop the key; a blank key reads as absent everywhere below this line`,
        );
      }
      node.fields[field] = value;
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
  if (fields.surface && !SURFACES.includes(fields.surface)) {
    problems.push(
      `line ${line}: "${fields.id}" has unknown surface "${fields.surface}" (expected one of ${SURFACES.join(", ")})`,
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
    // `||`, not `??`, on every optional key: a node written `surface:` with nothing after it
    // parses to the empty string, and `??` would keep it. An empty value then slips past every
    // rule that tests for presence — the vocabulary check skips it as falsy, the lint requiring a
    // surface on a built leaf sees one, and the reach table counts the node in no column at all.
    // Absent and blank are the same statement, so they parse to the same value.
    audience: fields.audience || "internal",
    surface: fields.surface || null,
    publicName: fields["public-name"] || fields.name,
    publicSummary: fields["public-summary"] || null,
    awaitingOwner: fields["awaiting-owner"] || null,
    slices: splitList(fields.slices),
    notes: fields.notes || null,
    // Carried but never rendered. The register prints name/scope/status/notes; these three are the
    // node's claims ABOUT the repository — the artifact that justifies the status, the design it was
    // written from, the decisions behind it — and they are what tooling/lint-ledger-staleness checks
    // the tree against. Dropping them here is what made the ledger uncheckable in that direction.
    evidence: fields.evidence || null,
    spec: fields.spec || null,
    adrs: splitList(fields.adrs),
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

// The ids of nodes that some other node sits beneath. Hierarchy is encoded in the dotted id and
// nowhere else, so this is read off the id set rather than stored — there is no second copy to drift.
export function rollUpIds(nodes) {
  const present = new Set(nodes.map((node) => node.id));
  const parents = new Set();
  for (const node of nodes) {
    const segments = node.id.split(".");
    for (let depth = 1; depth < segments.length; depth += 1) {
      const ancestor = segments.slice(0, depth).join(".");
      if (present.has(ancestor)) parents.add(ancestor);
    }
  }
  return parents;
}

// A roll-up parent is not a unit of work, and counting it as one skews every share in the register.
// The distortion is not small and it is not evenly spread: it lands almost entirely on `partial`,
// because `partial` is what a parent is defined to be the moment its children stop agreeing. So the
// document says how much of the product exists using workUnits, and reports the roll-up count beside
// it rather than silently dropping the parents — a parent's status is a real claim about a subtree,
// it is just not a claim about one more thing having been built.
export function workUnits(nodes) {
  const parents = rollUpIds(nodes);
  return nodes.filter((node) => !parents.has(node.id));
}

export function rollUps(nodes) {
  const parents = rollUpIds(nodes);
  return nodes.filter((node) => parents.has(node.id));
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

const REGISTER_PREAMBLE = (nodeCount, areaCount, summary) => `# Now — the build register

Every capability in the program, with its real status, and the arithmetic over the whole set. This
is the complete register rather than a digest: all ${nodeCount} nodes of the feature ledger in
[\`roadmap.d/\`](../roadmap.d/) are listed below, at the status the ledger actually holds, with
nothing collapsed and nothing curated away.

**Assembled, never hand-edited.** Run \`vp run register-build\` after changing a ledger node.

${summary === null ? PREAMBLE_WITHOUT_HISTORY : PREAMBLE_WITH_HISTORY}
Slice-by-slice build stages live in [\`STATUS.md\`](../STATUS.md), the narrative of what each stream
is doing lives in [\`ROADMAP.md\`](../ROADMAP.md), and what each of the nine statuses means lives in
[\`roadmap.d/README.md\`](../roadmap.d/README.md).`;

// The ledger holds one status per node and forgets the last one, so for a year this document said
// that no trend line could be drawn from it without inventing one. That was true of the ledger and
// false of the repository: roadmap.d/ is version controlled, and the ledger at any past commit
// parses under the same parser this document is rendered with. The limits named here are the ones
// that survive the reconstruction, and they are real.
const PREAMBLE_WITH_HISTORY = `**Where we are, and where we have been.** The ledger records only each capability's current status,
but it is version controlled, so its counts at every past commit are read back in
[Where we have been](#where-we-have-been) below rather than estimated. Three limits hold: a snapshot
shows when a node's **status** changed and never when the work happened; a capability added to
the ledger late arrives as a jump in the total rather than as work done; and **the series counts
every node, roll-up parents included**, where the standing above counts only units of work — so its
totals are the larger pair of numbers and are not comparable to them.
[\`CHANGELOG.md\`](../CHANGELOG.md) is still the dated record of what shipped and when.`;

const PREAMBLE_WITHOUT_HISTORY = `**This is where we are, not where we were.** The reconstruction of the ledger's past —
[\`docs/register-history.json\`](register-history.json) — is missing from this copy, so no trend is
drawn below; run \`vp run register-build\` to rebuild it. Nothing here is estimated in its absence.
[\`CHANGELOG.md\`](../CHANGELOG.md) is the dated record of what shipped and when.`;

export function renderBuildRegister(areas, history = null) {
  const nodes = allNodes(areas);
  const summary = history === null ? null : summariseHistory(history);
  const sections = [REGISTER_PREAMBLE(nodes.length, areas.length, summary)];

  sections.push(section("Where the program stands", renderStanding(areas, nodes)));
  if (summary !== null) sections.push(section("Where we have been", renderHistory(summary, areas)));
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
  const units = workUnits(nodes);
  const parents = rollUps(nodes);
  const counts = countByStatus(units);
  const parentCounts = countByStatus(parents);
  const shipped = counts.get("shipped");
  const partial = counts.get("partial");
  const delivered = shipped + partial;

  return [
    wrap(
      `**${nodes.length} capabilities across ${areas.length} areas.** Every one of them is listed` +
        ` in [the register](#the-register) below. ${parents.length} of them are roll-up parents —` +
        " a node another node sits beneath — and the totals here count the" +
        ` **${units.length} that are units of work**, for the reason set out under` +
        " [What a roll-up is not](#what-a-roll-up-is-not).",
    ),
    "",
    "### The roll-up",
    "",
    renderRollUpTable(units, counts),
    "",
    "### Every status",
    "",
    renderStatusTable(units, counts),
    "",
    "### What a roll-up is not",
    "",
    wrap(
      `**${parents.length} of the ${nodes.length} nodes are parents, and ${parentCounts.get("partial")}` +
        " of those parents are `partial`.** A parent's status is a summary of its children, so a" +
        " parent goes `partial` the moment its children stop agreeing — which means counting" +
        " parents beside leaves does not add work, it adds the same work a second time under a" +
        " status nobody chose. The distortion is not spread evenly either: it lands almost" +
        " entirely on `partial`, the one status the reader is most likely to mistake for progress." +
        " So every share above is taken over units of work. The parents are still in the register" +
        " and still carry their status; they are not counted as one more thing built.",
    ),
    "",
    "### What `partial` hides",
    "",
    wrap(
      `**Shipped alone is ${shipped} of ${units.length} (${share(shipped, units.length)}).` +
        ` Shipped plus partial is ${delivered} (${share(delivered, units.length)}).**`,
    ),
    "",
    wrap(
      `The ${partial} units between those two numbers are work that is engineered and paid for and` +
        " is not finished. Reading the larger number as how much of the product exists overstates" +
        " it; reading the smaller one understates what has been built. Both are true and neither" +
        " is the answer on its own. Which of the two a reader wants is usually really a question" +
        " about reach — whether anybody can get to the thing — and that is" +
        " [Built, and can anybody reach it](#built-and-can-anybody-reach-it) below, which reads a" +
        " fact the status field does not hold.",
    ),
    "",
    "### Built, and can anybody reach it",
    "",
    renderSurfaceStanding(units),
    "",
    "### By area",
    "",
    renderAreaMatrix(areas),
  ].join("\n");
}

const SURFACE_LABEL = {
  screen: "A person can open it today",
  "awaiting-screen": "Built — the screen is the only thing missing",
  internal: "No user surface by nature",
};

// The delineation `status` cannot make. Written as a table with the unclassified row always present
// rather than omitted when empty: a reader who cannot see how much of this is unanswered will read
// the answered part as the whole.
function renderSurfaceStanding(units) {
  const built = units.filter((unit) => STATUSES_WITH_SOMETHING_BUILT.includes(unit.status));
  const tally = new Map(SURFACES.map((surface) => [surface, 0]));
  let unclassified = 0;
  for (const unit of built) {
    if (unit.surface === null) unclassified += 1;
    else tally.set(unit.surface, tally.get(unit.surface) + 1);
  }

  const values = [...SURFACES.map((surface) => tally.get(surface)), unclassified];
  const shares = wholePercentages(values, built.length);
  const rows = ["| Reach | Units | Share of what is built |", "| --- | ---: | ---: |"];
  for (const [index, surface] of SURFACES.entries()) {
    rows.push(
      `| ${SURFACE_LABEL[surface]} (\`${surface}\`) | ${values[index]} | ${shares[index]}% |`,
    );
  }
  rows.push(`| Not yet classified | ${unclassified} | ${shares[SURFACES.length]}% |`);
  rows.push(`| **Everything with something built** | **${built.length}** | **100%** |`);

  return [
    wrap(
      `**${built.length} units of work have something built behind them** — \`shipped\`,` +
        " `partial` or `in-build`. Whether a person can reach any of them is a different fact" +
        " from how complete it is, and `status` has never held it: a backend nobody can open and" +
        " a screen somebody uses every day are both `shipped`. The ledger records it separately," +
        " in `surface:`.",
    ),
    "",
    rows.join("\n"),
    "",
    wrap(
      "`awaiting-screen` is the program's interface debt stated directly rather than inferred" +
        " from `partial`: capabilities that work, that are paid for, and that nobody can get to." +
        " `internal` is not debt — a port, a table or a fitness function is finished without a" +
        " screen and will never have one.",
    ),
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

// Exported because register-artifact.mjs — the other rendering of this same ledger — counts with it.
// Two renderings of one source that each did their own arithmetic could disagree, and a disagreement
// between them is unresolvable: neither is more authoritative than the other.
export function countByStatus(nodes) {
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
  rows.push(`| **All units of work** | | **${nodes.length}** | **100%** |`);
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
// Counts units of work, matching the tables above it: a matrix whose rows summed to a different
// total than the document's own totals would be read as one of the two being wrong.
function renderAreaMatrix(areas) {
  const parents = rollUpIds(allNodes(areas));
  const rows = [
    `| Area | ${LEDGER_STATUSES.map((status) => `\`${status}\``).join(" | ")} | Total | Shipped |`,
    `| --- | ${LEDGER_STATUSES.map(() => "---:").join(" | ")} | ---: | ---: |`,
  ];
  const totals = new Map(LEDGER_STATUSES.map((status) => [status, 0]));
  let grandTotal = 0;

  for (const area of areas) {
    const units = area.nodes.filter((node) => !parents.has(node.id));
    const counts = countByStatus(units);
    for (const status of LEDGER_STATUSES) {
      totals.set(status, totals.get(status) + counts.get(status));
    }
    grandTotal += units.length;
    const cells = LEDGER_STATUSES.map((status) => counts.get(status)).join(" | ");
    rows.push(
      `| ${area.title} | ${cells} | ${units.length} | ${share(counts.get("shipped"), units.length)} |`,
    );
  }

  const totalCells = LEDGER_STATUSES.map((status) => `**${totals.get(status)}**`).join(" | ");
  rows.push(
    `| **All areas** | ${totalCells} | **${grandTotal}** | **${share(totals.get("shipped"), grandTotal)}** |`,
  );
  return rows.join("\n");
}

// Shared with register-artifact.mjs for the same reason countByStatus is: a percentage that differs
// between two renderings of one ledger is a defect neither of them can be blamed for.
export function share(value, total) {
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

// --- where we have been -------------------------------------------------------------------------

// The reconstructed series, rendered the way the rest of this document renders: counts first, one
// row per commit that was read, and the commits that could not be read listed as themselves rather
// than smoothed over. The arithmetic is in register-history.mjs; everything here is presentation.
//
// Deliberately absent: a projected completion date. The ledger puts no size or effort on a node, so
// a date extrapolated from node counts would be arithmetic over units that are not comparable — a
// jurisdiction research corpus and a second authentication factor are one node each. Rates are
// printed as rates and left as rates.
function renderHistory(summary, areas) {
  const total = summary.rows.length + summary.unread.length;
  const parts = [
    wrap(
      `**${summary.rows.length} of ${total} commits read, ${summary.first.date} to` +
        ` ${summary.last.date} — ${summary.spanDays} days.** The ledger keeps no history of its own,` +
        " so this series is reconstructed: for every commit on the trunk that touched" +
        " [`roadmap.d/`](../roadmap.d/), the ledger as it stood at that commit is parsed by the same" +
        " parser that renders the counts above, and the result is kept in" +
        " [`docs/register-history.json`](register-history.json).",
    ),
    "",
    "### What has moved",
    "",
    renderMovement(summary),
    "",
    "### Every snapshot",
    "",
    renderSnapshotTable(summary),
  ];

  if (summary.unread.length > 0) {
    parts.push("", "### The gaps", "", renderGaps(summary, total));
  }

  parts.push("", "### Movement by area", "", renderAreaMovement(summary, areas));
  return parts.join("\n");
}

function renderMovement(summary) {
  const lines = [
    wrap(
      "Every figure in this section counts **every node**, parents and children alike, because that" +
        " is what the committed reconstruction holds — it was written before the register began" +
        " counting units of work, and recomputing it means re-parsing the ledger at every past" +
        " commit, which happens on the trunk. Read the trend, not the level: the direction and the" +
        " rate are unaffected, and the totals are the ones that differ from" +
        " [Where the program stands](#where-the-program-stands).",
    ),
    "",
    wrap(
      `**${signed(summary.shippedChange)} shipped since the ledger began** —` +
        ` ${summary.shippedFirst} on ${summary.first.date}, ${summary.shippedLast} on` +
        ` ${summary.last.date}, across ${summary.spanDays} days. The ledger itself grew by` +
        ` ${signed(summary.totalChange)} nodes over the same period (${summary.totalFirst} to` +
        ` ${summary.totalLast}), so the share shipped went from` +
        ` ${share(summary.shippedFirst, summary.totalFirst)} to` +
        ` ${share(summary.shippedLast, summary.totalLast)} against a denominator that was moving too.`,
    ),
    "",
  ];

  const rates = [
    summary.ratePerWeek === null
      ? null
      : `**${summary.ratePerWeek.toFixed(1)} capabilities shipped a week** across the whole series`,
    summary.sinceLastGap === null || summary.sinceLastGap.ratePerWeek === null
      ? null
      : `**${summary.sinceLastGap.ratePerWeek.toFixed(1)} a week** over the ${summary.sinceLastGap.snapshots} snapshots` +
        ` since the last gap (${summary.sinceLastGap.from.date} to ${summary.sinceLastGap.to.date},` +
        ` ${signed(summary.sinceLastGap.shippedChange)} shipped in ${summary.sinceLastGap.days} days)`,
  ].filter((rate) => rate !== null);

  lines.push(
    wrap(
      rates.length === 0
        ? "The series spans less than a day, so there is no rate to state yet."
        : `That is ${rates.join(", and ")}.`,
    ),
    "",
    wrap(
      "**No completion date is derived from any of this, and none can be.** The ledger puts no size" +
        " or effort on a node, so a date extrapolated from these counts would treat a jurisdiction" +
        " research corpus and a second authentication factor as the same amount of work. A rate is" +
        " a rate.",
    ),
  );
  return lines.join("\n");
}

// One row per commit that was read, oldest first. `Unread before` is how many commits sat between
// this row and the one above it without being read — the column that stops a change of +27 from
// looking like one commit's work when nineteen commits are missing from the middle of it.
function renderSnapshotTable(summary) {
  const rows = [
    `| Date | Commit | ${LEDGER_STATUSES.map((status) => `\`${status}\``).join(" | ")} | Total | Nodes added | Shipped added | Unread before |`,
    `| --- | --- | ${LEDGER_STATUSES.map(() => "---:").join(" | ")} | ---: | ---: | ---: | ---: |`,
  ];
  for (const row of summary.rows) {
    const counts = LEDGER_STATUSES.map((status) => row.statuses[status] ?? 0).join(" | ");
    rows.push(
      `| ${row.date} | \`${short(row.commit)}\` | ${counts} | ${row.total} |` +
        ` ${row.totalChange === null ? "—" : signed(row.totalChange)} |` +
        ` ${row.shippedChange === null ? "—" : signed(row.shippedChange)} | ${row.unreadBefore} |`,
    );
  }
  return rows.join("\n");
}

// Every unread commit, grouped under the reason it could not be read. The reasons are what a later
// reader uses to decide whether the parser has since caught up — re-run the reconstruction with
// --rebuild and a commit that has become readable joins the series — so every distinct reason is
// printed in full. It is printed ONCE per group rather than once per commit: a run of commits that
// all failed on the same character is one fact about the ledger's schema, and repeating its sentence
// down a column buries that fact under its own restatement instead of stating it.
function renderGaps(summary, total) {
  const byReason = new Map();
  for (const snapshot of summary.unread) {
    const group = byReason.get(snapshot.reason);
    if (group === undefined) byReason.set(snapshot.reason, [snapshot]);
    else group.push(snapshot);
  }
  const dates = summary.unread.map((snapshot) => snapshot.date);
  const parts = [
    wrap(
      `**${summary.unread.length} of the ${total} commits do not parse under today's ledger schema**` +
        ` — they run from ${dates[0]} to ${dates.at(-1)}, and` +
        ` ${byReason.size === 1 ? "every one of them fails for the same reason" : `they fail for ${byReason.size} distinct reasons`}.` +
        " They are recorded as holes: their counts are absent from the table above, no line is drawn" +
        " through them, and the changes on either side of a hole are stated across it rather than" +
        " apportioned to it. Re-run the reconstruction with `--rebuild` after a parser change to pick" +
        " up any that have since become readable.",
    ),
  ];
  for (const [reason, snapshots] of byReason) {
    const commits = snapshots
      .map((snapshot) => `\`${short(snapshot.commit)}\` (${snapshot.date})`)
      .join(", ");
    parts.push(
      "",
      wrap(
        `**${snapshots.length} commit${snapshots.length === 1 ? "" : "s"}, ${snapshots[0].date} to` +
          ` ${snapshots.at(-1).date}** — ${asSentenceFragment(reason)}`,
      ),
      "",
      wrap(commits),
    );
  }
  return parts.join("\n");
}

// Area movement between the first and the last read snapshot, in the ledger's own area order. Not
// sorted by how much moved: this table is read beside the per-area matrix above, and two tables of
// the same areas in two orders is a reconciliation the reader should not have to do.
function renderAreaMovement(summary, areas) {
  const titles = new Map(areas.map((area) => [area.name, area.title]));
  const rows = [
    "| Area | Nodes then | Nodes now | Shipped then | Shipped now | Shipped added |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const area of summary.areas) {
    rows.push(
      `| ${titles.get(area.name) ?? area.name} | ${area.thenTotal ?? "—"} | ${area.nowTotal ?? "—"} |` +
        ` ${area.thenShipped ?? "—"} | ${area.nowShipped ?? "—"} |` +
        ` ${area.shippedChange === null ? "—" : signed(area.shippedChange)} |`,
    );
  }

  const moved = summary.areas
    .filter((area) => (area.shippedChange ?? 0) > 0)
    .toSorted((left, right) => right.shippedChange - left.shippedChange);
  const still = summary.areas.filter((area) => (area.shippedChange ?? 0) === 0);
  const name = (area) => `${titles.get(area.name) ?? area.name} (${signed(area.shippedChange)})`;

  return [
    rows.join("\n"),
    "",
    wrap(
      moved.length === 0
        ? "No area has shipped a capability since the first snapshot."
        : `**Fastest since the first snapshot:** ${moved.slice(0, 3).map(name).join(", ")}.` +
            ` **${still.length} of ${summary.areas.length} areas have shipped nothing in that time**` +
            `${still.length === 0 ? "" : `: ${still.map((area) => titles.get(area.name) ?? area.name).join(", ")}`}.` +
            " An area standing still here has not necessarily been idle — a node moves in this table" +
            " only when it reaches `shipped`, so work that went from nothing to `partial` shows up in" +
            " the nodes columns and not in this one.",
    ),
  ].join("\n");
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

// A parser's message is the one string rendered here that was not written to be rendered: it can
// carry newlines, which would end the sentence it is quoted inside partway through.
function asSentenceFragment(text) {
  return text.replaceAll("\n", " ").trim();
}

// --- the short lists --------------------------------------------------------------------------

// This section answers "what is blocked on me?" only for decisions about a CAPABILITY, because the
// ledger holds capabilities and nothing else. Account-side work — a dashboard step, a billing
// budget, a repository setting — blocks real work just as hard and has no node to hang from, so the
// section names its own boundary and points at that list. A "waiting on you" that silently omits
// half of what is waiting is worse than no list at all: it is trusted, and it is wrong.
//
// SPLIT BY WHAT THE ANSWER COSTS, and derived rather than declared. A question on a capability with
// no code yet is holding a build still: nothing can start until it is answered, and answering it
// late is answering it after somebody has waited. A question on a capability that already runs is
// refining something that works — it deserves an answer and it is not blocking anybody. Those are
// different asks and a flat list makes them look alike, which is how "whether to add a field to a
// person" ends up sitting between two decisions that each gate an unbuilt subsystem.
//
// The split reads the node's own status, so it needs no second key that could disagree with the
// first: a status with no artifact behind it yet (not-started, researching, designed, planned) is
// holding a build, and anything else is refining one. Deliberately not a `blocking: true` field —
// that would be a fact about the node recorded twice, and the two copies would drift. Exported so
// register-artifact.mjs splits its own list on exactly this set rather than on a restatement of it.
// The complement of STATUSES_WITH_NOTHING_BUILT on the built side: statuses that mean something
// exists to be reached, so the reach question is worth asking. Exported for the same reason its
// sibling is — the register, the page, the desk and the lint all split on this set, and four copies
// of one list is four chances for them to disagree about what "built" means. Not derived from the
// sibling by subtraction: `deferred` and `cut` are in neither, because parked work may or may not
// have code behind it and the status does not say.
export const STATUSES_WITH_SOMETHING_BUILT = ["shipped", "partial", "in-build"];

export const STATUSES_WITH_NOTHING_BUILT = new Set([
  "not-started",
  "researching",
  "designed",
  "planned",
]);

function renderAwaiting(nodes) {
  const parents = rollUpIds(nodes);
  const awaiting = nodes.filter((node) => node.awaitingOwner !== null);
  if (awaiting.length === 0) {
    return ["_No capability is blocked on an owner decision._", "", AWAITING_BOUNDARY].join("\n");
  }

  const line = (node) =>
    `- **${node.name}** (\`${node.id}\`) — ${reachTag(node, parents)}${node.awaitingOwner}`;
  const holdingABuild = awaiting.filter((node) => holdsUpABuild(node, parents.has(node.id)));
  const refining = awaiting.filter((node) => !holdsUpABuild(node, parents.has(node.id)));

  const parts = [];
  if (holdingABuild.length > 0) {
    parts.push(
      `**${holdingABuild.length} answer${holdingABuild.length === 1 ? "" : "s"} would let work start.** Nothing is built behind these yet, and nothing can be until they land.`,
      "",
      holdingABuild.map(line).join("\n"),
    );
  }
  if (refining.length > 0) {
    if (parts.length > 0) parts.push("");
    parts.push(
      `**${refining.length} are not holding a build still.** Nobody is waiting on these to start` +
        " writing something: most have code behind them already, and the parked ones are set aside" +
        " by an earlier decision that an answer would revisit.",
      "",
      refining.map(line).join("\n"),
    );
  }
  parts.push("", AWAITING_BOUNDARY);
  return parts.join("\n");
}

// What a reader most wants to know about an open question, after the question itself: is there
// working code behind it. The two answers cost very different things to be wrong about — a decision
// that unblocks a build is a schedule; a decision about something already running is a change to
// something people may already depend on. Exported so the decision desk labels its cards from this
// one function rather than restating the mapping.
export function reachOf(node, isRollUp = false) {
  // The parent test comes first, before status. A parent carries no `surface:` — the lint refuses
  // one, because its reach is its children's — and its status is itself a roll-up of theirs, so a
  // parent sitting at `not-started` over children that are built would otherwise be labelled "no
  // code exists behind this yet" about a subtree that has some.
  if (isRollUp) return "roll-up";
  if (STATUSES_WITH_NOTHING_BUILT.has(node.status)) return "not-built";
  if (node.status === "deferred" || node.status === "cut") return "parked";
  if (node.surface === "awaiting-screen") return "awaiting-screen";
  if (node.surface === "screen") return "screen";
  if (node.surface === "internal") return "internal";
  return "built";
}

// One label per reach, exported so both renderings of the ledger prefix the same words. The Markdown
// emphasises it and the page colours it; neither writes the words themselves, because a question that
// read "not built" in one document and "built" in the other would be a contradiction no reader could
// settle.
// Whether leaving this question open is stopping something from being written. Derived from reachOf
// rather than from status directly, so a roll-up parent — whose status is a summary of its children
// and whose reach is theirs — is never filed under "nothing is built behind these" while its own
// chip says it is a group. Exported so the desk and the register split on one answer.
export function holdsUpABuild(node, isRollUp = false) {
  return reachOf(node, isRollUp) === "not-built";
}

export const REACH_LABEL = {
  "not-built": "Not built.",
  parked: "Parked.",
  "roll-up": "A group of capabilities.",
  "awaiting-screen": "Built; no screen yet.",
  screen: "Built and reachable.",
  internal: "Built; no screen by nature.",
  built: "Built.",
};

function reachTag(node, parents) {
  return `**${REACH_LABEL[reachOf(node, parents.has(node.id))]}** `;
}

// Exported so the page states this boundary in these words rather than its own. It is written as
// Markdown because the document it was written for is Markdown; the page renders the inline markup.
export const AWAITING_BOUNDARY =
  "Decisions about a capability only. Account-side steps that no session can perform — a" +
  " Cloudflare dashboard action, a billing budget, a repository setting — are listed in" +
  " [`docs/deploy-queue.md`](deploy-queue.md), which is their one home.";

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
  // The per-area line counts units of work, matching the matrix in [By area]. The LIST under it is
  // every node — this is the register — but a heading counted one way over a table counted another
  // is one document contradicting itself, which is what it did for one revision.
  const parents = rollUpIds(allNodes(areas));
  const sections = [LEDGER_INTRO];
  for (const area of areas) {
    const units = area.nodes.filter((node) => !parents.has(node.id));
    const counts = countByStatus(units);
    const shippedCount = counts.get("shipped");
    const rollUpCounts = ROLL_UPS.map(
      (rollUp) =>
        `${rollUp.statuses.reduce((sum, status) => sum + counts.get(status), 0)} ${rollUp.name.toLowerCase()}`,
    ).join(", ");
    sections.push(
      [
        `### ${area.title}`,
        "",
        `[\`roadmap.d/${area.name}\`](../roadmap.d/${area.name}) — ${units.length} units of work,` +
          ` ${share(shippedCount, units.length)} shipped. ${capitalise(rollUpCounts)}.`,
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
