// Pure parse + render for the feature ledger (roadmap.d/* → docs/public-roadmap.md + docs/now.md).
// No filesystem here — every function is a pure transform, unit-tested in roadmap.test.mjs. The
// impure runner is build-public-roadmap.mjs and the fitness function is tooling/lint-roadmap.mjs.
// Mirrors the split in status.mjs / build-status.mjs and changelog.mjs / build-changelog.mjs.
//
// The ledger is the one home for how complete each capability is; both documents are renderings of
// it, never second copies. The split that makes drift impossible: a human authors the durable half
// of a public entry (whether it is public at all, its name, its sentence) and this module derives
// the volatile half (which horizon band it sits in) from the node's status on every run. Nobody can
// forget to move an entry because nobody can move one.
//
// Neither rendered document carries a generation timestamp: they are byte-exact functions of the
// ledger so that a diff gate can hold them, and a clock in the output would break that every day.
// A renderer that wants a build time stamps its own — see packages/product-updates.

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
// docs/public-roadmap.md — what users see.

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
// docs/now.md — the owner's one screen.

const NOW_PREAMBLE = `# Now

One screen: what is blocked on the owner, what is being built, what is queued, and how much of the
product exists. Every line is derived from the feature ledger in [\`roadmap.d/\`](../roadmap.d/), so
nothing here can describe a state the ledger does not hold.

**Assembled, never hand-edited.** Run \`vp run public-roadmap-build\` after changing a ledger node.

What has already shipped is deliberately not repeated here — that is the
[changelog's](../CHANGELOG.md) fact, and a second account of it would be a second thing to keep
current. Slice-by-slice build stages live in [\`STATUS.md\`](../STATUS.md); the narrative of what each
stream is doing lives in [\`ROADMAP.md\`](../ROADMAP.md).`;

// Keep only the shallowest node of any subtree in a list. A parent and nine of its children all
// sitting in "Next up" is nine lines saying what one line said, and it is exactly what turns a
// one-screen digest back into something nobody reads. Hierarchy is in the dotted id, so an ancestor
// is a dotted prefix.
export function collapseToShallowest(nodes) {
  const present = new Set(nodes.map((node) => node.id));
  return nodes.filter((node) => {
    const segments = node.id.split(".");
    for (let depth = 1; depth < segments.length; depth += 1) {
      if (present.has(segments.slice(0, depth).join("."))) return false;
    }
    return true;
  });
}

export function renderNow(areas) {
  const nodes = allNodes(areas);
  const sections = [NOW_PREAMBLE];

  // This section answers "what is blocked on me?" only for decisions about a CAPABILITY, because the
  // ledger holds capabilities and nothing else. Account-side work — a dashboard step, a billing
  // budget, a repository setting — blocks real work just as hard and has no node to hang from, so the
  // section names its own boundary and points at that list. A "waiting on you" that silently omits
  // half of what is waiting is worse than no list at all: it is trusted, and it is wrong.
  const awaiting = nodes.filter((node) => node.awaitingOwner !== null);
  sections.push(
    section(
      "Waiting on you",
      [
        awaiting.length === 0
          ? "_No capability is blocked on an owner decision._"
          : awaiting
              .map((node) => `- **${node.name}** (${node.area}) — ${node.awaitingOwner}`)
              .join("\n"),
        "",
        "Decisions about a capability only. Account-side steps that no session can perform — a" +
          " Cloudflare dashboard action, a billing budget, a repository setting — are listed in" +
          " [`docs/deploy-queue.md`](deploy-queue.md), which is their one home.",
      ].join("\n"),
    ),
  );

  const building = collapseToShallowest(nodes.filter((node) => node.status === "in-build"));
  sections.push(
    section(
      "Being built now",
      building.length === 0
        ? "_No capability is marked in-build._"
        : building.map((node) => `- **${node.name}** (${node.area}) — ${node.scope}`).join("\n"),
    ),
  );

  const next = collapseToShallowest(
    nodes.filter((node) => node.status === "planned" || node.status === "designed"),
  );
  sections.push(
    section(
      "Next up",
      next.length === 0
        ? "_Nothing is planned or designed and waiting to be built._"
        : next.map((node) => `- **${node.name}** (${node.area}) — ${node.scope}`).join("\n"),
    ),
  );

  sections.push(section("Where the program stands", renderTally(areas)));

  return `${sections.join("\n\n")}\n`;
}

function section(heading, body) {
  return `## ${heading}\n\n${body}`;
}

// Per-area counts in the public bands, so the two documents count the product the same way. Emitted
// width-independent (one space around each cell) so one long area name cannot re-pad every row.
function renderTally(areas) {
  // Every band, including the empty ones: a column of zeros is cheap, and a total that does not sum
  // to the count beside it is the kind of small wrongness that makes a reader stop trusting a table.
  const columns = BAND_ORDER;
  const rows = [
    `| Area | ${columns.join(" | ")} | Total |`,
    `| --- | ${columns.map(() => "---:").join(" | ")} | ---: |`,
  ];
  const totals = new Map(columns.map((column) => [column, 0]));
  let grandTotal = 0;

  for (const area of areas) {
    const counts = new Map(columns.map((column) => [column, 0]));
    for (const node of area.nodes) {
      const band = bandForStatus(node.status);
      if (counts.has(band)) counts.set(band, counts.get(band) + 1);
    }
    const areaTotal = area.nodes.length;
    grandTotal += areaTotal;
    for (const column of columns) totals.set(column, totals.get(column) + counts.get(column));
    rows.push(
      `| ${area.publicGroup} | ${columns.map((column) => counts.get(column)).join(" | ")} | ${areaTotal} |`,
    );
  }

  rows.push(
    `| **All areas** | ${columns.map((column) => `**${totals.get(column)}**`).join(" | ")} | **${grandTotal}** |`,
  );
  return rows.join("\n");
}
