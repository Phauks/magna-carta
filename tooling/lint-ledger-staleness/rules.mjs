// The staleness rules for the roadmap.d/* feature ledger, as pure functions over parsed nodes plus
// an injected `exists(path)`. No filesystem here — the impure runner is index.mjs and the fixture
// test is index.test.mjs, mirroring the split in tooling/doc-fragments/roadmap.mjs.
//
// WHAT THIS EXISTS FOR. tooling/lint-roadmap.mjs compares the RENDERED documents against the ledger
// and never the ledger against the REPOSITORY. So the assembler cannot invent a state and equally
// cannot notice a stale one: a node nobody updates stays wrong forever and every derived document
// repeats it faithfully. These rules close that direction.
//
// THE DESIGN CONSTRAINT. The hard part is not detection, it is failing loudly and RARELY. The ledger
// holds 702 nodes, so a rule firing on two percent of them prints fourteen lines nobody reads twice,
// and a fitness function people skip is worse than none. Every rule below was measured against the
// whole ledger before it was kept, and three plausible rules were measured and thrown away:
//
//   - "a node's slice tag has built files, so it cannot be pre-code" — 13 hits, 13 of them false. A
//     slice tag is shared across nodes at different maturities: calendar.sync, messaging.port and
//     payments.port are all genuinely not started and all tagged to a port system that is genuinely
//     built. Only a third of nodes carry a tag at all.
//   - "an affirmative build claim inside a pre-code node" ("is built", "now exists", "unit-tested")
//     — 22 hits, 22 of them false, every one the same good idiom: a pre-code node explaining what it
//     is waiting on ("the bulk-download engine it reuses is shipped; no portal-scoped path"). The
//     obvious narrowing — ignore the claim when the field also contains a contrasting absence clause
//     — suppresses the one true positive it was built for, whose evidence also said "Still dormant".
//   - "a diff touching a claimed path must touch its node" — needs a diff base, fires on every
//     refactor, and is satisfied by TOUCHING a node rather than by making it true.
//
// Whatever else changes here, do not trade precision for reach. The reasoning is in
// docs/specs/2026-08-14-feature-ledger-staleness-detection.md.

// The two status groups, taken from the vocabulary table in roadmap.d/README.md rather than invented:
// pre-code statuses ASSERT THAT CODE DOES NOT EXIST ("no code", "no artifact or spec yet", "build not
// started"), has-code statuses assert that some does. `researching`, `deferred` and `cut` are in
// neither on purpose — they make no claim about code in either direction, so no rule may read them.
export const PRE_CODE_STATUSES = ["not-started", "designed", "planned"];
export const HAS_CODE_STATUSES = ["shipped", "partial", "in-build"];

// The trees that hold code. docs/, status.d/, changelog.d/ and roadmap.d/ are deliberately absent:
// the ledger names those by prefix rather than by filename ("status.d/2-1", "docs/decisions/0027"),
// and changelog fragments are CONSUMED at assembly, so a resolved-path rule over them is 45 false
// positives on today's ledger. Measured before this list was narrowed to these six.
const CODE_ROOTS = ["apps", "packages", "crates", "containers", "tooling", "tools"];

// A path token inside prose. Anchored to a code root so ordinary prose with a slash in it cannot
// match, and trailing punctuation is excluded so "packages/trust." yields "packages/trust".
const CODE_PATH = new RegExp(
  String.raw`(?:${CODE_ROOTS.join("|")})/[A-Za-z0-9._\-/]*[A-Za-z0-9_\-]`,
  "g",
);

// The prose fields a node can make a claim about the repository in.
const PROSE_FIELDS = ["evidence", "notes", "scope", "awaitingOwner"];

// The escape hatch, per node, with its reason required. It suppresses ONLY the three rules that
// reason about the filesystem — a node can have a legitimate reason to name a path the tree does not
// place the way the scan assumes, and no node has a legitimate reason to contradict its own child or
// to cite a decision nobody wrote. Same marker-plus-reason idiom as the object-dimension scan's
// `fitness:allow-no-dimensions` and lint-conflicts-vocabulary's `conflicts-vocabulary:allow`.
const ALLOW_MARKER = /ledger-staleness:allow\b[ \t]*(?:[-—:][ \t]*(?<reason>\S.*)?)?/;

export function allowance(node) {
  const match = ALLOW_MARKER.exec(node.notes ?? "");
  if (match === null) return null;
  return { reason: match.groups?.reason?.trim() ?? "" };
}

function prosePaths(node) {
  const found = new Map();
  for (const field of PROSE_FIELDS) {
    const text = node[field];
    if (typeof text !== "string") continue;
    let match;
    CODE_PATH.lastIndex = 0;
    while ((match = CODE_PATH.exec(text)) !== null) {
      if (!found.has(match[0])) found.set(match[0], { field, index: match.index, text });
    }
  }
  return found;
}

// Two paths are the same claim when one is the other or sits beneath it: a node citing
// `crates/search-core` is accounted for by a shipped node citing `crates/search-core/src/lib.rs`,
// and the reverse. Without this a rule would fire on every difference in citation depth.
function sameSubtree(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

// ---------------------------------------------------------------------------------------------
// Rule 1 — unaccounted code. THE staleness rule.
// ---------------------------------------------------------------------------------------------
//
// A pre-code node names a code path that EXISTS and that NO has-code node claims.
//
// The whole rule rests on one observation about how this ledger is actually written: a pre-code node
// legitimately points at substrate that is already built, and substrate that is already built BELONGS
// TO SOME OTHER NODE THAT SAYS SO. That is what separates the twenty-two "the engine it reuses is
// shipped" lines — every one of which names a path some shipped node also claims — from a node
// claiming no code while pointing at four directories no node in the ledger accounts for.
//
// Measured: 41 pre-code nodes name an existing code path (the noise floor of the cruder rule); the
// unclaimed filter takes that to 1 on today's ledger and 2 on the tree from before the search fix,
// where the extra one is the stale node itself.
export function unaccountedCode(node, allNodes, exists) {
  if (!PRE_CODE_STATUSES.includes(node.status)) return [];

  const accounted = new Set();
  for (const other of allNodes) {
    if (other === node) continue;
    if (!HAS_CODE_STATUSES.includes(other.status)) continue;
    for (const path of prosePaths(other).keys()) accounted.add(path);
  }

  const problems = [];
  for (const [path, where] of prosePaths(node)) {
    if (!exists(path)) continue;
    if ([...accounted].some((claimed) => sameSubtree(path, claimed))) continue;
    problems.push({
      rule: "unaccounted-code",
      node,
      detail:
        `is \`${node.status}\` — which asserts there is no code — but its \`${where.field}\` names` +
        ` \`${path}\`, which exists and which no shipped/partial/in-build node claims`,
    });
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Rule 2 — an absence claim about a path that resolves.
// ---------------------------------------------------------------------------------------------
//
// The checkable core of "a future-tense claim about something that is now present". It fires only
// where the claim NAMES A PATH, which is exactly the narrowing that keeps it exact rather than a
// guess at English, and the phrase must sit within a bounded window of the path token so a claim
// binds to the thing it is about instead of to a clause three sentences away.
//
// Unlike rule 1 this applies at ANY status, so it covers what rule 1 structurally cannot see: a
// `partial` node saying one of its own parts is missing when it is not.
//
// Measured: of 499 path mentions across the ledger, exactly one sits inside an absence claim.
const CLAIM_WINDOW = 60;

const ABSENT_AFTER =
  /^\s*(?:does not (?:yet )?exist|do not (?:yet )?exist|is not (?:yet )?built|are not (?:yet )?built|is unbuilt|are unbuilt|is not written|has no code|is not on the tree|is absent|is missing|does not exist yet)/i;

const ABSENT_BEFORE =
  /(?:^|[;,:.]|\b(?:and|but|so|while|though|although)\b)\s*(?:there is |there are )?(?:no|not yet an?|nothing in|no such)\s+$/i;

// Does the prose around this path token claim the path is ABSENT? Shared with rule 4, which must not
// report "this path is not on the tree" about a line whose whole point is to say so.
function claimsAbsent(path, where) {
  const after = where.text.slice(
    where.index + path.length,
    where.index + path.length + CLAIM_WINDOW,
  );
  const before = where.text.slice(Math.max(0, where.index - CLAIM_WINDOW), where.index);
  return ABSENT_AFTER.test(after) || ABSENT_BEFORE.test(before);
}

export function absentPathThatResolves(node, _allNodes, exists) {
  const problems = [];
  for (const [path, where] of prosePaths(node)) {
    if (!claimsAbsent(path, where)) continue;
    if (!exists(path)) continue;
    problems.push({
      rule: "absent-path-resolves",
      node,
      detail: `\`${where.field}\` says \`${path}\` is absent, and it exists on the tree`,
    });
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Rule 3 — roll-up contradiction. No filesystem involved.
// ---------------------------------------------------------------------------------------------
//
// A pre-code parent with a has-code descendant contradicts itself: roadmap.d/README.md defines
// `partial` as "Parent node whose children mix shipped and not", so a parent asserting no code exists
// beneath it while a child asserts some does is wrong on the ledger's own terms.
//
// Restricting to THIS shape is what makes it usable. The natural generalisation — "a parent ranks
// below its most-advanced child" — fires 87 times, because a `partial` parent over `shipped` children
// is the most common and most CORRECT shape in the whole ledger.
//
// It also makes the repair cascade, which is why it sits next to rule 1: correcting a stale child
// from `designed` to `partial` immediately surfaces its still-stale parent.
export function rollUpContradiction(node, allNodes) {
  if (!PRE_CODE_STATUSES.includes(node.status)) return [];
  const built = allNodes.filter(
    (other) => other.id.startsWith(`${node.id}.`) && HAS_CODE_STATUSES.includes(other.status),
  );
  if (built.length === 0) return [];
  return [
    {
      rule: "roll-up-contradiction",
      node,
      detail:
        `is \`${node.status}\` but ${built.length === 1 ? "its descendant" : "its descendants"}` +
        ` ${built.map((other) => `\`${other.id}\` (\`${other.status}\`)`).join(", ")} ${built.length === 1 ? "has" : "have"} code` +
        " — a parent's status is a roll-up of what is beneath it",
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Rule 4 — a named path does not resolve.
// ---------------------------------------------------------------------------------------------
//
// Cheap and exact. It catches deletion and renaming, the direction the other rules cannot see, and it
// is what keeps rules 1 and 2 honest: both reason from "this path exists", so both weaken silently if
// the ledger drifts towards naming paths that do not.
//
// Measured: 323 distinct code paths named across the ledger and zero unresolved — a zero-cost guard
// installed at the cheapest possible moment, while the invariant is still clean.
export function unresolvedPath(node, _allNodes, exists) {
  const problems = [];
  for (const [path, where] of prosePaths(node)) {
    if (exists(path)) continue;
    // A line whose whole point is that the path is not there yet is not a broken reference. Rule 2
    // owns that sentence and fires on it the day the path appears; this rule must stay silent on it,
    // or naming an absence correctly becomes the thing that fails the gate.
    if (claimsAbsent(path, where)) continue;
    problems.push({
      rule: "unresolved-path",
      node,
      detail: `\`${where.field}\` names \`${path}\`, which is not on the tree — renamed, moved, or deleted`,
    });
  }
  if (node.spec !== null && !exists(node.spec)) {
    problems.push({
      rule: "unresolved-path",
      node,
      detail: `\`spec\` names \`${node.spec}\`, which is not on the tree`,
    });
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Rule 5 — a decision reference resolves.
// ---------------------------------------------------------------------------------------------
//
// roadmap.d/README.md already requires `adrs` to be `ADR-NNNN` present in docs/decisions/, and
// nothing enforced it, because the parser dropped the key before the lint could see it.
//
// Measured: five entries across four nodes name decisions by their PENDING FRAGMENT SLUG
// ("notifications-delivery-half") for decisions long since accepted and numbered. Same staleness as
// the rest of this file wearing a different hat — the ledger naming a thing by a name it no longer
// has — which is why it belongs here rather than in the format lint.
export function unresolvedDecision(node, _allNodes, _exists, decisionNumbers) {
  const problems = [];
  for (const reference of node.adrs) {
    const match = /^ADR-(\d{4})$/.exec(reference);
    if (match === null) {
      problems.push({
        rule: "unresolved-decision",
        node,
        detail:
          `\`adrs\` entry \`${reference}\` is not an \`ADR-NNNN\` reference` +
          " — a pending fragment slug here goes stale the moment the decision is accepted and numbered",
      });
      continue;
    }
    if (decisionNumbers.has(match[1])) continue;
    problems.push({
      rule: "unresolved-decision",
      node,
      detail: `\`adrs\` names \`${reference}\`, which has no file in docs/decisions/`,
    });
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Rule 6 — `not-started` carries no `spec:`.
// ---------------------------------------------------------------------------------------------
//
// The vocabulary defines `not-started` as "no artifact OR SPEC yet", so the key contradicts the
// status. A node that has grown a spec is `designed`. Zero hits today; free to keep true.
export function notStartedWithSpec(node) {
  if (node.status !== "not-started" || node.spec === null) return [];
  return [
    {
      rule: "not-started-with-spec",
      node,
      detail:
        `is \`not-started\`, which the vocabulary defines as "no artifact or spec yet", but carries` +
        ` \`spec: ${node.spec}\` — a capability with an accepted spec is \`designed\``,
    },
  ];
}

// The three rules the per-node allowance can suppress: exactly the ones that reason about the tree.
const SUPPRESSIBLE = new Set(["unaccounted-code", "absent-path-resolves", "unresolved-path"]);

const RULES = [
  unaccountedCode,
  absentPathThatResolves,
  rollUpContradiction,
  unresolvedPath,
  unresolvedDecision,
  notStartedWithSpec,
];

// ---------------------------------------------------------------------------------------------
// The fixtures the scan proves itself against on every run.
// ---------------------------------------------------------------------------------------------
//
// Two of these are the real nodes that went stale, reduced to the fields that matter. They are here
// rather than only in the test because a check that never fires is indistinguishable from a ledger
// with no drift, and that is exactly how both of them survived: nothing was watching.
//
// The `not-caught` fixture is the honest one. It is the auto-file node as it actually read, and it
// asserts that this scan finds NOTHING wrong with it — because its claim ("nothing evaluates during a
// capture yet: the port on the capture core and the evidence gatherer in the consumer are the next
// slice") names no path and no identifier, and sits on a status that makes no claim about code.
// Catching it needs an English noun phrase resolved against the tree. If someone later believes they
// have solved that, this fixture is where the belief gets tested.

// A decision reference, assembled rather than written out. Rule 5 validates the shape of these
// references, so a fixture for it necessarily contains one — and a literal here would read to the
// source scan in tooling/lint-process-references.mjs as this file citing a decision, which it is not
// doing. Composing it keeps that scan fully in force over this file instead of exempting the file
// from it. The convention it enforces: docs/conventions/code-style.md.
const decisionReference = (number) => `ADR-${number}`;

function fixture(fields) {
  return {
    id: "area.node",
    name: "Node",
    scope: "",
    status: "not-started",
    area: "fixture.md",
    line: 1,
    audience: "internal",
    notes: null,
    evidence: null,
    spec: null,
    adrs: [],
    awaitingOwner: null,
    slices: [],
    ...fields,
  };
}

export const SELF_TEST = [
  {
    name: "instance 1: a `designed` node pointing at four directories nobody accounts for",
    nodes: [
      fixture({
        id: "discovery.search.keyword",
        status: "designed",
        evidence:
          "crates/search-core has the split format; containers/search wraps it in an axum service," +
          " apps/search-worker owns that Container, and it is measured by crates/search-eval.",
      }),
    ],
    tree: ["crates/search-core", "containers/search", "apps/search-worker", "crates/search-eval"],
    expect: ["unaccounted-code", "unaccounted-code", "unaccounted-code", "unaccounted-code"],
  },
  {
    name: "instance 2: the auto-file notes — NOT caught, and no rule here pretends otherwise",
    nodes: [
      fixture({
        id: "communications.email.filing.auto-file-rules",
        status: "partial",
        evidence: "packages/email-filing/src/auto-file-rules.ts (resolveAutoFileDecision)",
        notes:
          "Build slice 1 only. Nothing evaluates during a capture yet: the port on the capture core" +
          " and the evidence gatherer in the consumer are the next slice. No screens.",
      }),
    ],
    tree: ["packages/email-filing/src/auto-file-rules.ts"],
    expect: [],
  },
  {
    name: "the permitted form: a pre-code node naming substrate a shipped node claims",
    nodes: [
      fixture({
        id: "portal.capabilities.download",
        status: "not-started",
        evidence:
          "The bulk-download engine it reuses is shipped (apps/worker); no portal-scoped path.",
      }),
      fixture({
        id: "matters.file-manager.bulk-download",
        status: "shipped",
        evidence: "apps/worker",
      }),
    ],
    tree: ["apps/worker"],
    expect: [],
  },
  {
    name: "an absence claim about a path that resolves",
    nodes: [
      fixture({
        id: "financial.trust.jurisdiction-engine",
        status: "designed",
        evidence: "approved design on main; packages/trust-jurisdictions does not exist yet",
      }),
    ],
    tree: ["packages/trust-jurisdictions"],
    // Both rules see it, which is the corroboration working rather than a duplicate.
    expect: ["unaccounted-code", "absent-path-resolves"],
  },
  {
    name: "the same absence claim while the path really is absent",
    nodes: [
      fixture({
        id: "financial.trust.jurisdiction-engine",
        status: "designed",
        evidence: "approved design on main; packages/trust-jurisdictions does not exist yet",
      }),
    ],
    tree: [],
    expect: [],
  },
  {
    name: "a pre-code parent over a shipped child",
    nodes: [
      fixture({ id: "financial.billing.ledes", status: "not-started" }),
      fixture({ id: "financial.billing.ledes.e-billing-flag", status: "shipped" }),
    ],
    tree: [],
    expect: ["roll-up-contradiction"],
  },
  {
    name: "a partial parent over a shipped child is the correct shape, not a finding",
    nodes: [
      fixture({ id: "documents.pdf", status: "partial" }),
      fixture({ id: "documents.pdf.redaction", status: "shipped" }),
    ],
    tree: [],
    expect: [],
  },
  {
    name: "a named path that is not on the tree",
    nodes: [fixture({ status: "shipped", evidence: "packages/search/src/extraction.ts" })],
    tree: [],
    expect: ["unresolved-path"],
  },
  {
    name: "a spec path that is not on the tree",
    nodes: [fixture({ status: "designed", spec: "docs/specs/2026-01-01-gone.md" })],
    tree: [],
    expect: ["unresolved-path"],
  },
  {
    name: "a decision cited by its pending slug rather than its number",
    nodes: [
      fixture({
        status: "partial",
        adrs: [decisionReference("0059"), "notifications-delivery-half"],
      }),
    ],
    tree: [],
    decisions: ["0059"],
    expect: ["unresolved-decision"],
  },
  {
    name: "a decision number with no file",
    nodes: [fixture({ status: "partial", adrs: [decisionReference("9999")] })],
    tree: [],
    decisions: ["0059"],
    expect: ["unresolved-decision"],
  },
  {
    name: "not-started carrying a spec",
    nodes: [fixture({ status: "not-started", spec: "docs/specs/2026-01-01-real.md" })],
    tree: ["docs/specs/2026-01-01-real.md"],
    expect: ["not-started-with-spec"],
  },
  {
    name: "the allowance suppresses the tree rules when it carries a reason",
    nodes: [
      fixture({
        status: "designed",
        evidence: "packages/only-a-scaffold",
        notes: "ledger-staleness:allow — the package is an empty scaffold with no implementation",
      }),
    ],
    tree: ["packages/only-a-scaffold"],
    expect: [],
  },
  {
    name: "a bare allowance with no reason is itself a failure, and suppresses nothing",
    nodes: [
      fixture({
        status: "designed",
        evidence: "packages/only-a-scaffold",
        notes: "ledger-staleness:allow",
      }),
    ],
    tree: ["packages/only-a-scaffold"],
    expect: ["empty-allowance", "unaccounted-code"],
  },
  {
    name: "the allowance does not reach the rules that compare the ledger against itself",
    nodes: [
      fixture({
        id: "financial.billing.ledes",
        status: "not-started",
        notes: "ledger-staleness:allow — a reason that must not excuse a contradicted roll-up",
      }),
      fixture({ id: "financial.billing.ledes.e-billing-flag", status: "shipped" }),
    ],
    tree: [],
    expect: ["roll-up-contradiction"],
  },
  {
    name: "researching and deferred assert nothing about code, so no rule reads them",
    nodes: [
      fixture({ id: "tasks", status: "researching", evidence: "packages/unclaimed-by-anyone" }),
      fixture({ id: "other", status: "deferred", evidence: "packages/also-unclaimed" }),
    ],
    tree: ["packages/unclaimed-by-anyone", "packages/also-unclaimed"],
    expect: [],
  },
];

// Every problem across every node. `exists` and `decisionNumbers` are injected so the whole rule set
// runs against a fixture in the test rather than against a paraphrase of itself.
export function findStaleness(nodes, exists, decisionNumbers = new Set()) {
  const problems = [];
  for (const node of nodes) {
    const allowed = allowance(node);
    if (allowed !== null && allowed.reason === "") {
      problems.push({
        rule: "empty-allowance",
        node,
        detail:
          "carries a bare `ledger-staleness:allow` with no reason — state why the tree does not" +
          " match what this node says, or drop the marker",
      });
    }
    for (const rule of RULES) {
      for (const problem of rule(node, nodes, exists, decisionNumbers)) {
        if (allowed !== null && allowed.reason !== "" && SUPPRESSIBLE.has(problem.rule)) continue;
        problems.push(problem);
      }
    }
  }
  return problems;
}
