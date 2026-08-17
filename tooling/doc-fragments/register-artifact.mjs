// docs/now.html — the build register as a single self-contained web page, rendered from the same
// `areas` structure docs/now.md is rendered from. Pure: no filesystem, no clock, no network. The
// impure runner is build-register.mjs and the fitness function is tooling/lint-roadmap.mjs, the same
// split roadmap.mjs / build-register.mjs already uses.
//
// This page exists because the register is read by the owner as a page rather than as a Markdown
// file in a repository, and a page that is written by hand is a second copy of the ledger that goes
// stale the first time a node is flipped. Every number, name, status and question below is derived
// from `areas`; nothing on the page is typed in twice.
//
// Everything that is NOT derived from the ledger is a fixed string in this file — the headline, the
// standing prose, the section ledes, the footer, the stylesheet and the filter script. Those are the
// page's editorial voice and they have no source in roadmap.d/; they are written once here rather
// than re-typed into the published page every refresh. Nothing here states a fact that lives
// somewhere else: an operational state, a schedule, a count. A sentence in this file has to still be
// true on any ledger, or it does not belong in a generator.
//
// Everything shared with the Markdown rendering comes from roadmap.mjs and is never restated here:
// ROLL_UPS, countByStatus, share and STATUSES_WITH_NOTHING_BUILT for the arithmetic and the split,
// AWAITING_BOUNDARY for the sentence bounding the owner list. Two renderings of one ledger that each
// keep their own copy will disagree, and the disagreement is unresolvable because neither is more
// authoritative than the other — which is the whole reason this file exists rather than a person
// re-authoring the page after each merge.
//
// No generation timestamp, for the same reason docs/now.md carries none: the output is a byte-exact
// function of the ledger so a diff gate can hold it, and a clock would break that every day.

import {
  AWAITING_BOUNDARY,
  LEDGER_STATUSES,
  ROLL_UPS,
  allNodes,
  REACH_LABEL,
  STATUSES_WITH_SOMETHING_BUILT,
  countByStatus,
  holdsUpABuild,
  reachOf,
  rollUpIds,
  share,
  workUnits,
} from "./roadmap.mjs";

// The nine ledger statuses, as the page writes them and colours them. `tone` selects one of the six
// colour pairs the stylesheet defines: three statuses share the `plan` pair because "specified but
// unbuilt" is one visual weight, and two share `park`. The statuses themselves are never collapsed —
// every one of the nine keeps its own chip, its own legend entry and its own column.
export const STATUS_PRESENTATION = {
  shipped: { label: "Shipped", tone: "done" },
  partial: { label: "Partial", tone: "part" },
  "in-build": { label: "In build", tone: "live" },
  designed: { label: "Designed", tone: "plan" },
  planned: { label: "Planned", tone: "plan" },
  researching: { label: "Researching", tone: "plan" },
  "not-started": { label: "Not started", tone: "todo" },
  deferred: { label: "Deferred", tone: "park" },
  cut: { label: "Cut", tone: "park" },
};

// The four headline cards, keyed by the roll-up they total. The roll-up membership itself lives in
// roadmap.mjs and is shared with the Markdown rendering; only the wording and the colour class are
// this page's. `detail` is the second line of the card — the split inside the roll-up, so a reader
// who wants the nine statuses behind a headline number does not have to scroll to the table.
const ROLL_UP_CARDS = {
  Done: {
    heading: "Shipped",
    modifier: "g",
    // Not "reachable": the reach band below counts how many of these a person can actually open,
    // and it is a small fraction. A headline that claimed otherwise would be refuted two sections
    // down by the same page.
    detail: () => "The artifact exists on main",
  },
  "Part-built": {
    heading: "Part-built",
    modifier: "y",
    detail: (counts) =>
      `${counts.get("partial")} partial &middot; ${counts.get("in-build")} in build`,
  },
  Ahead: {
    heading: "Ahead of us",
    modifier: "n",
    detail: (counts) =>
      `${counts.get("not-started")} not started &middot; ` +
      `${counts.get("designed") + counts.get("planned") + counts.get("researching")} specified`,
  },
  Parked: {
    heading: "Parked",
    modifier: "",
    detail: (counts) => `${counts.get("deferred")} deferred &middot; ${counts.get("cut")} cut`,
  },
};

// The proportional bar under the cards. Six segments rather than nine: the three `plan` statuses read
// as one band of specified-but-unbuilt work, and the two parked ones as one band. The last two
// segments use the background half of their colour pair, so work that has not started recedes instead
// of competing with work that has.
const METER_SEGMENTS = [
  { statuses: ["shipped"], colour: "--done" },
  { statuses: ["partial"], colour: "--part" },
  { statuses: ["in-build"], colour: "--live" },
  { statuses: ["designed", "planned", "researching"], colour: "--plan" },
  { statuses: ["not-started"], colour: "--todo-b" },
  { statuses: ["deferred", "cut"], colour: "--park-b" },
];

export function renderBuildRegisterArtifact(areas) {
  const nodes = allNodes(areas);
  // Two count sets, for two different questions, and mixing them is what made this page overstate
  // `partial` for as long as it existed. The standing — the headline cards, the meter, the legend,
  // the per-area matrix — answers "how much of the product exists", so it runs over units of work: a
  // roll-up parent is a summary of its children and counting it beside them adds the same work twice,
  // under `partial` almost every time. The filter buttons at the bottom answer "how many rows will
  // this button show me", and the list they filter is every node, parents included.
  const units = workUnits(nodes);
  const counts = countByStatus(units);
  const everyNodeCounts = countByStatus(nodes);

  const document = [
    "<title>Magna Carta Build Register</title>",
    `<style>\n${STYLESHEET}\n</style>`,
    "",
    '<div class="wrap">',
    renderHeader(nodes),
    "",
    renderStanding(units, counts, nodes),
    "",
    renderPartialCallout(units, counts, nodes),
    "",
    renderReach(units),
    "",
    renderAreaTable(areas, counts, units),
    "",
    renderAwaiting(nodes),
    "",
    renderEveryNode(areas, nodes, everyNodeCounts, new Set(units.map((unit) => unit.id))),
    "",
    FOOTER,
    "</div>",
    `<script>\n${FILTER_SCRIPT}\n</script>`,
  ].join("\n");
  return `${document}\n`;
}

// --- the head of the page -----------------------------------------------------------------------

function renderHeader(nodes) {
  return `<header style="display:flex;flex-direction:column;gap:13px">
  <p class="eyebrow">Magna Carta &middot; feature ledger</p>
  <h1>${nodes.length} things, and where every one of them stands</h1>
  <p class="lede">Every node in <code>roadmap.d/</code>, at its real status — not banded, not curated, not
  summarised. This is the build instrument: what is done, what is moving, what has not been started.</p>
</header>`;
}

function renderStanding(nodes, counts, everyNode) {
  const totals = new Map(
    ROLL_UPS.map((rollUp) => [
      rollUp.name,
      rollUp.statuses.reduce((sum, status) => sum + counts.get(status), 0),
    ]),
  );

  const cards = ROLL_UPS.map((rollUp) => {
    const card = ROLL_UP_CARDS[rollUp.name];
    const className = card.modifier === "" ? "k" : `k ${card.modifier}`;
    return (
      `    <div class="${className}"><span>${card.heading}</span>` +
      `<b>${totals.get(rollUp.name)}</b><em>${card.detail(counts)}</em></div>`
    );
  }).join("\n");

  const segments = METER_SEGMENTS.map((segment) => {
    const size = segment.statuses.reduce((sum, status) => sum + counts.get(status), 0);
    return `    <i style="flex:${size};background:var(${segment.colour})"></i>`;
  }).join("\n");

  // The bar carries no text of its own, so the whole standing is restated for a screen reader in the
  // one place a sighted reader takes it from the geometry.
  const spoken =
    `${totals.get("Done")} shipped, ${totals.get("Part-built")} part-built, ` +
    `${totals.get("Ahead")} ahead, ${totals.get("Parked")} parked, of ${nodes.length}`;

  const legend = LEDGER_STATUSES.map((status) => {
    const { label, tone } = STATUS_PRESENTATION[status];
    return (
      `<span><i class="sw" style="background:var(--${tone})"></i>` +
      `<b>${counts.get(status)}</b> ${label}</span>`
    );
  }).join("");

  return `<section style="display:flex;flex-direction:column;gap:16px">
  <div class="band">
${cards}
  </div>
  <div class="meter" role="img" aria-label="${spoken}">
${segments}
  </div>
  <p class="legend">${legend}</p>
  <p style="color:var(--soft);font-size:13.5px;max-width:70ch">Counted over the ${nodes.length}
  nodes that are units of work. The other ${everyNode.length - nodes.length} are roll-up parents
  &mdash; a node another node sits beneath &mdash; and a parent goes <em>partial</em> the moment its
  children stop agreeing, so counting them here would add the same work twice under a status nobody
  chose. Every node, parents included, is listed further down.</p>
</section>`;
}

// The delineation `status` cannot make: whether anybody can get to the thing. Rendered as its own
// band rather than folded into the standing, because it answers a question the nine statuses have
// never been able to answer, and the number that matters here — how much works and cannot be reached
// — is the one a reader would otherwise have to infer from `partial` and get wrong.
const REACH_CARDS = [
  {
    surface: "screen",
    heading: "Reachable",
    modifier: "g",
    detail: "A person can open it in the application today.",
  },
  {
    surface: "awaiting-screen",
    heading: "Waiting on a screen",
    modifier: "y",
    detail: "It works. Nobody can get to it, because its interface is not built.",
  },
  {
    surface: "internal",
    heading: "Under the floor",
    modifier: "b",
    detail: "A port, a table, a queue. Finished without a screen, and always will be.",
  },
];

function renderReach(units) {
  const built = units.filter((unit) => STATUSES_WITH_SOMETHING_BUILT.includes(unit.status));
  const tally = (surface) => built.filter((unit) => unit.surface === surface).length;
  const unclassified = built.filter((unit) => unit.surface === null).length;

  const cards = REACH_CARDS.map(
    (card) =>
      `    <div class="k ${card.modifier}"><span>${card.heading}</span>` +
      `<b>${tally(card.surface)}</b><em>${card.detail}</em></div>`,
  ).join("\n");

  return `<section style="display:flex;flex-direction:column;gap:14px">
  <h2>Built, and can anybody reach it</h2>
  <p class="lede">${built.length} units of work have something built behind them. Whether a person
  can reach one is a separate fact from how complete it is, and no status holds it: a backend nobody
  can open and a screen somebody uses every day are both shipped. The ledger records it separately.</p>
  <div class="band">
${cards}
  </div>
  <p style="color:var(--soft);font-size:13.5px;max-width:70ch">${
    unclassified === 0
      ? "Every one of them is classified."
      : `${unclassified} are not classified yet and are counted in none of the three.`
  } The middle figure is the interface debt stated directly rather than guessed at from
  <em>partial</em>: work that is engineered, paid for, and unreachable.</p>
</section>`;
}

// The one paragraph on the page that argues rather than reports. `partial` is the count most likely to
// be read as progress and least likely to mean it, so the page says so where the number is, instead of
// leaving a reader to work it out from a table.
function renderPartialCallout(nodes, counts, everyNode) {
  const shipped = counts.get("shipped");
  const partial = counts.get("partial");
  const delivered = shipped + partial;
  const parentPartials = everyNode.filter(
    (node) => node.status === "partial" && !nodes.includes(node),
  ).length;

  return `<section class="callout">
  <h2>Read &ldquo;Partial&rdquo; carefully</h2>
  <p>It is the single most misleading number here, and it is ${rankingOf("partial", counts)}.
  <strong>${partial} units of work are partial</strong> — delivered in part, and not finished.
  Counting those as progress is honest; counting them as done is not. A further
  ${parentPartials} roll-up parents are also partial and are deliberately not counted: a parent is
  partial by definition once its children disagree, so it reports its subtree rather than any work of
  its own.</p>
  <p style="color:var(--soft)">Shipped plus partial is ${delivered} of ${nodes.length}
  (${share(delivered, nodes.length)}). Shipped alone is ${share(shipped, nodes.length)}. Which of the
  two a reader wants is usually really a question about reach, which is the band below.</p>
</section>`;
}

// Where one status sits among the nine by size. The sentence above used to say "the second largest"
// as a typed phrase, which was true when it was typed and had no way of stopping being true out loud:
// the day another status overtook `partial`, the page would have gone on asserting it with nothing to
// notice. Derived, the claim moves when the ledger does. A tie says so rather than picking a winner —
// "the second largest" is a stronger statement than the counts support when two statuses are level.
const SIZE_PLACES = [
  "the largest",
  "the second largest",
  "the third largest",
  "the fourth largest",
  "the fifth largest",
  "the sixth largest",
  "the seventh largest",
  "the eighth largest",
  "the ninth largest",
];

export function rankingOf(status, counts) {
  const value = counts.get(status);
  const larger = LEDGER_STATUSES.filter((other) => counts.get(other) > value).length;
  const level = LEDGER_STATUSES.filter(
    (other) => other !== status && counts.get(other) === value,
  ).length;
  const place = SIZE_PLACES[larger];
  return level === 0 ? place : place.replace("the ", "the joint ");
}

// --- the per-area matrix ------------------------------------------------------------------------

function renderAreaTable(areas, counts, units) {
  const headings = LEDGER_STATUSES.map(
    (status) => `<th scope="col">${STATUS_PRESENTATION[status].label}</th>`,
  ).join("");

  // Units of work, matching the standing above rather than the full node list: a matrix whose rows
  // summed to a different total than the page's own headline would read as one of the two being wrong.
  const inUnits = new Set(units.map((unit) => unit.id));
  const rows = areas
    .map((area) => {
      const areaUnits = area.nodes.filter((node) => inUnits.has(node.id));
      const areaCounts = countByStatus(areaUnits);
      const cells = LEDGER_STATUSES.map((status) => cell(areaCounts.get(status))).join("");
      const shippedShare = share(areaCounts.get("shipped"), areaUnits.length);
      return (
        `<tr><th scope="row"><a href="#area-${area.name}">${escapeHtml(area.title)}</a></th>` +
        `${cells}<td class="tot">${areaUnits.length}</td>` +
        `<td class="bar"><span style="--p:${shippedShare}"></span><em>${shippedShare}</em></td></tr>`
      );
    })
    .join("");

  const totalCells = LEDGER_STATUSES.map((status) => `<td>${counts.get(status)}</td>`).join("");
  const total = units.length;

  return `<section style="display:flex;flex-direction:column;gap:14px">
  <h2>By area</h2>
  <div class="scroll"><table>
    <thead><tr><th scope="col" style="text-align:left">Area</th>${headings}<th scope="col">Total</th><th scope="col">Shipped</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th scope="row" style="text-align:left">All areas</th>${totalCells}<td class="tot">${total}</td><td>${share(counts.get("shipped"), total)}</td></tr></tfoot>
  </table></div>
</section>`;
}

// A zero is written as a centre dot in the faint colour rather than as "0". Thirty rows of nine
// columns is mostly zeros, and printing them as digits makes the numbers that are there harder to
// find than the ones that are not.
function cell(value) {
  return value === 0 ? '<td class="zero">·</td>' : `<td>${value}</td>`;
}

// --- what is blocked on the owner ---------------------------------------------------------------

// Split the same way docs/now.md splits it, on the same set of statuses, because the two documents
// answering "what is blocked on me?" differently would be worse than either answering it alone. A
// question on a capability with nothing built behind it is holding work still; a question on one that
// already runs is refining something that works, and those are different asks.
function renderAwaiting(nodes) {
  const parents = rollUpIds(nodes);
  const awaiting = nodes.filter((node) => node.awaitingOwner !== null);
  const parts = ['<section class="callout"><h2>Blocked on a decision from you</h2>'];

  if (awaiting.length === 0) {
    parts.push("<p>No capability is blocked on an owner decision.</p>");
  } else {
    const holdingABuild = awaiting.filter((node) => holdsUpABuild(node, parents.has(node.id)));
    const refining = awaiting.filter((node) => !holdsUpABuild(node, parents.has(node.id)));

    if (holdingABuild.length > 0) {
      parts.push(
        `<h3>${holdingABuild.length} answer${holdingABuild.length === 1 ? "" : "s"} would let work start</h3>`,
        '<p style="color:var(--soft);font-size:13.5px">Nothing is built behind these yet, and nothing can be until they land.</p>',
        `<ul>${holdingABuild.map((node) => awaitingItem(node, parents)).join("")}</ul>`,
      );
    }
    if (refining.length > 0) {
      parts.push(
        `<h3>${refining.length} are not holding a build still</h3>`,
        '<p style="color:var(--soft);font-size:13.5px">Nobody is waiting on these to start writing something: most have code behind them already, and the parked ones are set aside by an earlier decision that an answer would revisit.</p>',
        `<ul>${refining.map((node) => awaitingItem(node, parents)).join("")}</ul>`,
      );
    }
  }

  // The boundary of this list, stated where the list is: it holds capabilities and nothing else, so a
  // reader who trusts it as "everything waiting on me" would be trusting something that is wrong. The
  // sentence is not written here — it is AWAITING_BOUNDARY, the same string the Markdown rendering
  // prints. The page carried its own wording for a while and the two had already drifted into
  // different lists of examples, one of which asserted a live operational state that no ledger change
  // could ever make false again.
  parts.push(
    `  <p style="color:var(--soft);font-size:13.5px">${renderInlineMarkup(AWAITING_BOUNDARY)}</p></section>`,
  );

  return parts.join("\n");
}

function awaitingItem(node, parents) {
  return (
    `<li><strong>${renderInlineMarkup(node.name)}</strong> — ` +
    `<em style="font-style:normal;color:var(--faint)">${REACH_LABEL[reachOf(node, parents.has(node.id))]}</em> ` +
    `${renderInlineMarkup(node.awaitingOwner)}</li>`
  );
}

// --- every node ----------------------------------------------------------------------------------

function renderEveryNode(areas, nodes, counts, units) {
  const filters = LEDGER_STATUSES.map((status) => {
    const { label } = STATUS_PRESENTATION[status];
    return (
      `<button class="f" data-s="${status}" aria-pressed="false">` +
      `${label} <b>${counts.get(status)}</b></button>`
    );
  }).join("");

  return `<section style="display:flex;flex-direction:column;gap:6px">
  <h2>Every node</h2>
  <p class="lede">All ${nodes.length}, in ledger order, indented by depth. Filter by status or search the
  names, ids and scope text.</p>
  <div class="controls">
    ${filters}
    <button class="f" id="clear" aria-pressed="true">All</button>
    <input id="q" type="search" placeholder="Search names, ids, scope" aria-label="Search the register">
    <span id="hits">${nodes.length} shown</span>
  </div>
${areas.map((area) => renderArea(area, units)).join("\n")}
</section>`;
}

// The heading counts units of work, matching the By-area table and the standing; the LIST under it
// is every node, parents included, because this is the register. The two were counted differently
// for one revision and the page said "18 of 34 shipped" over a table row reading 17 of 29.
function renderArea(area, units) {
  const areaUnits = area.nodes.filter((node) => units.has(node.id));
  const shipped = countByStatus(areaUnits).get("shipped");
  const items = area.nodes.map((node) => renderNode(node)).join("");
  return `<section class="area" id="area-${area.name}">
<h3>${renderInlineMarkup(area.title)} <span class="ac">${shipped} of ${areaUnits.length} shipped</span></h3>
<ol class="nodes">${items}</ol>
</section>`;
}

// One node. Depth comes from the dotted id, the same way the Markdown rendering derives its
// indentation, so the two show the same tree. `data-s` is what the filter script reads; it is the
// ledger's own status string, never a band.
function renderNode(node) {
  const depth = node.id.split(".").length - 1;
  const { label, tone } = STATUS_PRESENTATION[node.status];
  const lines = [
    `<li class="n d${depth}" data-s="${node.status}">`,
    `<span class="chip ${tone}">${label}</span>`,
    `<span class="nm">${renderInlineMarkup(node.name)}</span>`,
    // The id is an identifier, not prose: it is already inside a <code>, and a dotted kebab-case path
    // has no markup in it to render.
    `<code>${escapeHtml(node.id)}</code>`,
    `<p>${renderInlineMarkup(node.scope)}</p>`,
  ];
  if (node.notes !== null) lines.push(`<p class="note">${renderInlineMarkup(node.notes)}</p>`);
  if (node.awaitingOwner !== null) {
    lines.push(
      `<p class="ask"><strong>Waiting on you.</strong> ${renderInlineMarkup(node.awaitingOwner)}</p>`,
    );
  }
  lines.push("</li>");
  return lines.join("\n");
}

// Ledger text is prose, not markup: the three characters that would otherwise open a tag or an entity
// are escaped and everything else is passed through. Quotes are left alone deliberately — no ledger
// value is ever placed in an attribute (ids and statuses are the only attribute values, and both are
// kebab-case), so escaping them would only make the page source harder to read.
export function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// For a value going into a double-quoted attribute rather than into text. escapeHtml deliberately
// leaves quotes alone — it was written for element content, where a bare quote is a quote — and a
// ledger `name` or `scope` containing one would otherwise close the attribute early and turn the
// rest of the sentence into markup. Separate from escapeHtml rather than folded into it so the
// element-content path keeps printing readable quotation marks.
export function escapeAttribute(text) {
  return escapeHtml(text).replaceAll('"', "&quot;");
}

// The ledger's prose fields are Markdown — they are written for docs/now.md, which is Markdown — so a
// page that only escaped them printed a code span's own backticks (`custom.<handle>` came out with
// the backticks visible). Escaping is the floor, not the whole job.
//
// Two constructs, because two are what the source actually contains: inline code spans, used in five
// nodes' `notes`, and one Markdown link, in AWAITING_BOUNDARY. Nothing in roadmap.d/ uses bold,
// emphasis, links or HTML entities, and this deliberately does not invent support for them — an
// unused branch is an untested branch. If the ledger starts using one, the text will render as its own
// source characters, which is visible and reads as a bug rather than silently swallowing content.
//
// A link becomes its own text, with the target dropped. The page is published standalone, so a
// repository-relative target resolves to nothing wherever it is actually read, and a link that goes
// nowhere is worse than the name of the file the reader can then go and find.
const INLINE_MARKUP = /\[([^\]]+)\]\(([^)]*)\)|`([^`]+)`/g;

export function renderInlineMarkup(text) {
  let rendered = "";
  let consumedTo = 0;
  for (const match of text.matchAll(INLINE_MARKUP)) {
    rendered += escapeHtml(text.slice(consumedTo, match.index));
    const [whole, linkText, , codeText] = match;
    // A link's text is rendered in turn, because the one link in the source has a code span for its
    // text and the backticks would otherwise survive into the page.
    rendered +=
      linkText === undefined
        ? `<code>${escapeHtml(codeText)}</code>`
        : renderInlineMarkup(linkText);
    consumedTo = match.index + whole.length;
  }
  return rendered + escapeHtml(text.slice(consumedTo));
}

// --- the fixed parts ------------------------------------------------------------------------------

const FOOTER =
  "<footer>Rendered from <code>roadmap.d/</code> — the same source <code>docs/now.md</code> is built" +
  " from, so the two cannot disagree. Statuses are the ledger's own nine, never banded.</footer>";

// Light palette on bare :root so it is the definition of record; the dark palette is redefined twice —
// once under the media query, guarded so an explicit light choice wins over the system preference, and
// once under an explicit dark choice. A colour defined only inside a media block would have no value
// at all for a reader whose host stamps a theme on the root element.
// Exported so the decision desk is styled by this palette rather than by a second one that drifts
// from it. The two pages are read minutes apart by the same person and a status chip that is one
// green here and a different green there reads as two different systems.
export const STYLESHEET = `:root{
  --paper:#F6F6F4; --raised:#FFFFFF; --ink:#141821; --soft:#5A6070; --faint:#8A8F9C;
  --rule:#DAD8D3; --hair:#EAE8E4; --accent:#9E3B2F;
  --done:#2F6E4F; --part:#A8761F; --live:#2C5C8F; --plan:#6B5CA5; --todo:#8A8F9C; --park:#94908A;
  --done-b:#E4EFE8; --part-b:#F7EEDC; --live-b:#E3EDF7; --plan-b:#EDEAF6; --todo-b:#EEEEF0; --park-b:#EDEBE8;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --paper:#101317; --raised:#171B21; --ink:#E9EAED; --soft:#A3A9B6; --faint:#767C8A;
  --rule:#2A2F38; --hair:#20242B; --accent:#D9705F;
  --done:#6FBF93; --part:#DEB160; --live:#7FB0E0; --plan:#A99BE0; --todo:#8A8F9C; --park:#8C8880;
  --done-b:#16261E; --part-b:#2A2113; --live-b:#141F2B; --plan-b:#1E1B2B; --todo-b:#1C1F25; --park-b:#201E1B;
}}
:root[data-theme="dark"]{
  --paper:#101317; --raised:#171B21; --ink:#E9EAED; --soft:#A3A9B6; --faint:#767C8A;
  --rule:#2A2F38; --hair:#20242B; --accent:#D9705F;
  --done:#6FBF93; --part:#DEB160; --live:#7FB0E0; --plan:#A99BE0; --todo:#8A8F9C; --park:#8C8880;
  --done-b:#16261E; --part-b:#2A2113; --live-b:#141F2B; --plan-b:#1E1B2B; --todo-b:#1C1F25; --park-b:#201E1B;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;
  font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:40px 24px 96px;display:flex;flex-direction:column;gap:44px}
h1,h2,h3{font-family:"Iowan Old Style",Georgia,"Times New Roman",serif;font-weight:600;
  text-wrap:balance;margin:0;letter-spacing:-.01em}
h1{font-size:clamp(30px,4.4vw,46px);line-height:1.08}
h2{font-size:22px}
h3{font-size:17px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
p{margin:0}
a{color:inherit}
.lede{color:var(--soft);max-width:66ch;font-size:16px}
.eyebrow{font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:var(--accent);font-weight:650}
.band{display:grid;grid-template-columns:repeat(auto-fit,minmax(178px,1fr));gap:2px;
  background:var(--rule);border:1px solid var(--rule);border-radius:3px;overflow:hidden}
.k{background:var(--raised);padding:22px 20px 20px;display:flex;flex-direction:column;gap:5px}
.k b{font-size:clamp(38px,6.5vw,60px);line-height:.94;font-weight:600;letter-spacing:-.03em;
  font-family:"Iowan Old Style",Georgia,serif}
.k span{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);font-weight:650}
.k em{font-style:normal;font-size:13px;color:var(--soft);line-height:1.4}
.k.g b{color:var(--done)} .k.y b{color:var(--part)} .k.b b{color:var(--live)} .k.n b{color:var(--todo)}
.meter{display:flex;height:15px;border-radius:2px;overflow:hidden;border:1px solid var(--rule)}
.meter i{display:block}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--soft)}
.legend b{color:var(--ink);font-weight:650}
.sw{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:7px;vertical-align:baseline}
.scroll{overflow-x:auto;border:1px solid var(--rule);border-radius:3px;background:var(--raised)}
table{border-collapse:collapse;width:100%;font-size:13px;min-width:900px}
th,td{padding:8px 9px;text-align:right;border-bottom:1px solid var(--hair);white-space:nowrap}
thead th{position:sticky;top:0;background:var(--raised);font-size:11px;letter-spacing:.05em;
  text-transform:uppercase;color:var(--faint);font-weight:650;border-bottom:1px solid var(--rule);z-index:1}
tbody th{text-align:left;font-weight:500;white-space:normal;min-width:230px}
tbody th a{text-decoration:none;border-bottom:1px solid var(--rule)}
tbody th a:hover{border-bottom-color:var(--accent);color:var(--accent)}
td.zero{color:var(--faint)}
td.tot{font-weight:650;border-left:1px solid var(--hair)}
td.bar{width:118px;position:relative}
td.bar span{display:block;height:5px;background:var(--hair);border-radius:3px;position:relative;min-width:70px}
td.bar span::after{content:"";position:absolute;inset:0 auto 0 0;width:var(--p);background:var(--done);border-radius:3px}
td.bar em{font-style:normal;font-size:11px;color:var(--faint);position:absolute;right:9px;top:6px}
tfoot td,tfoot th{font-weight:650;border-top:1px solid var(--rule);border-bottom:none}
.controls{display:flex;flex-wrap:wrap;gap:9px;align-items:center;position:sticky;top:0;z-index:3;
  background:var(--paper);padding:12px 0;border-bottom:1px solid var(--hair)}
.f{font:inherit;font-size:12.5px;padding:6px 12px;border:1px solid var(--rule);background:var(--raised);
  color:var(--soft);border-radius:20px;cursor:pointer}
.f[aria-pressed="true"]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.f:focus-visible,#q:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#q{font:inherit;font-size:13px;padding:7px 12px;border:1px solid var(--rule);border-radius:3px;
  background:var(--raised);color:var(--ink);min-width:220px;flex:1}
#hits{font-size:12.5px;color:var(--faint);margin-left:auto}
.area{padding-top:6px}
.area h3{padding-bottom:7px;border-bottom:1px solid var(--rule);margin-bottom:2px}
.ac{font-family:system-ui,sans-serif;font-size:12px;font-weight:500;color:var(--faint);letter-spacing:0}
ol.nodes{list-style:none;margin:0;padding:0}
.n{display:grid;grid-template-columns:96px 1fr;gap:2px 13px;padding:9px 0 9px var(--ind,0px);
  border-bottom:1px solid var(--hair);align-items:baseline}
.n.d1{--ind:20px} .n.d2{--ind:40px} .n.d3{--ind:60px} .n.d4{--ind:78px}
.n[hidden]{display:none}
.chip{grid-row:1;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;font-weight:650;
  padding:3px 0;text-align:center;border-radius:2px}
.chip.done{color:var(--done);background:var(--done-b)}
.chip.part{color:var(--part);background:var(--part-b)}
.chip.live{color:var(--live);background:var(--live-b)}
.chip.plan{color:var(--plan);background:var(--plan-b)}
.chip.todo{color:var(--todo);background:var(--todo-b)}
.chip.park{color:var(--park);background:var(--park-b)}
.nm{font-weight:600;font-size:14.5px}
.n code{grid-column:2;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--faint)}
.n p{grid-column:2;color:var(--soft);font-size:13.5px;max-width:78ch}
.n .note{color:var(--faint);font-size:13px}
.n .ask{color:var(--accent);border-left:2px solid var(--accent);padding-left:10px;margin-top:4px}
.ask strong{font-weight:650}
.callout{border:1px solid var(--rule);border-left:3px solid var(--accent);border-radius:3px;
  background:var(--raised);padding:18px 20px;display:flex;flex-direction:column;gap:9px}
.callout ul{margin:0;padding-left:19px;color:var(--soft);display:flex;flex-direction:column;gap:7px}
.callout li strong{color:var(--ink)}
.callout h3{font-size:14px;font-family:system-ui,sans-serif;letter-spacing:.02em}
footer{color:var(--faint);font-size:12.5px;border-top:1px solid var(--rule);padding-top:18px}`;

// Status filtering and free-text search over the rendered nodes. Deliberately plain: no framework, no
// build step, no external request — the page has to work as one file opened from anywhere. An area
// whose every node is filtered out hides itself, so the page never shows an empty heading.
const FILTER_SCRIPT = `(function(){
  var items=[].slice.call(document.querySelectorAll(".n"));
  var chips=[].slice.call(document.querySelectorAll(".f[data-s]"));
  var clear=document.getElementById("clear"), q=document.getElementById("q"), hits=document.getElementById("hits");
  var on=new Set(), term="";
  function apply(){
    var shown=0;
    items.forEach(function(el){
      var okS=on.size===0||on.has(el.dataset.s);
      var okQ=term===""||el.textContent.toLowerCase().indexOf(term)!==-1;
      var v=okS&&okQ; el.hidden=!v; if(v)shown++;
    });
    document.querySelectorAll(".area").forEach(function(a){
      a.hidden=a.querySelectorAll(".n:not([hidden])").length===0;
    });
    hits.textContent=shown+" shown";
    clear.setAttribute("aria-pressed",on.size===0?"true":"false");
  }
  chips.forEach(function(b){b.addEventListener("click",function(){
    var s=b.dataset.s;
    if(on.has(s)){on.delete(s);b.setAttribute("aria-pressed","false");}
    else{on.add(s);b.setAttribute("aria-pressed","true");}
    apply();
  });});
  clear.addEventListener("click",function(){on.clear();chips.forEach(function(b){b.setAttribute("aria-pressed","false");});apply();});
  q.addEventListener("input",function(){term=q.value.trim().toLowerCase();apply();});
})();`;
