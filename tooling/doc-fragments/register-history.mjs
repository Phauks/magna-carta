// The pure model behind "Where we have been" in the build register: what one dated snapshot of the
// feature ledger holds, how the set of snapshots is ordered and merged, and the arithmetic read off
// it. No filesystem and no git here — the impure reconstruction is build-register-history.mjs and
// the rendering is renderBuildRegister in roadmap.mjs. Same split as roadmap.mjs/build-register.mjs.
//
// The ledger itself keeps no history: a node holds one status, and flipping it forgets the last one.
// The history is in version control instead, so a snapshot is produced by parsing the ledger as it
// stood at one commit with the parser the live build uses, never by a second parser written for the
// past. That is the whole design constraint: a reconstruction that parses differently from the build
// produces a trend that disagrees with the number at the top of the document.
//
// Two things this model refuses to do, and they are the reason it can be trusted:
//   - It never estimates. A commit whose ledger does not parse under today's schema is recorded as
//     unread, with the reason, and stays a hole in the series. Nothing is interpolated across it.
//   - It never projects. A count of nodes carries no size or effort, so a completion date derived
//     from one would treat a jurisdiction research corpus and a second authentication factor as
//     equal work. Rates are printed as rates.

// One record per commit, keyed by the full commit hash: the hash is the only identifier that stays
// unambiguous as the series grows, and the short form is derived for display.
export const HISTORY_FORMAT = 1;

export function emptyHistory() {
  return { format: HISTORY_FORMAT, generatedBy: "vp run register-build", snapshots: [] };
}

// Written by hand rather than by JSON.stringify's indent, so that the two repeated leaf objects —
// the status counts and one area's counts — each sit on one line. The file is committed and appended
// to, so the shape of its diff is part of the design: one landed commit should add one block of
// lines that a reader can take in, not thirty times that many.
export function serializeHistory(history) {
  const lines = [
    "{",
    `  "format": ${JSON.stringify(history.format)},`,
    `  "generatedBy": ${JSON.stringify(history.generatedBy)},`,
    '  "snapshots": [',
  ];
  for (const [index, snapshot] of history.snapshots.entries()) {
    const comma = index === history.snapshots.length - 1 ? "" : ",";
    lines.push("    {");
    const fields = [
      `      "commit": ${JSON.stringify(snapshot.commit)}`,
      `      "date": ${JSON.stringify(snapshot.date)}`,
      `      "read": ${JSON.stringify(snapshot.read)}`,
    ];
    if (snapshot.read) {
      fields.push(
        `      "total": ${JSON.stringify(snapshot.total)}`,
        `      "statuses": ${JSON.stringify(snapshot.statuses)}`,
        `      "areas": [\n${snapshot.areas
          .map(
            (area, position) =>
              `        ${JSON.stringify(area)}${position === snapshot.areas.length - 1 ? "" : ","}`,
          )
          .join("\n")}\n      ]`,
      );
    } else {
      fields.push(`      "reason": ${JSON.stringify(snapshot.reason)}`);
    }
    lines.push(fields.join(",\n"), `    }${comma}`);
  }
  lines.push("  ]", "}");
  return `${lines.join("\n")}\n`;
}

// Strict, for the same reason parseArea is strict: this file feeds a document that has no other
// store of the past, so a record that half-parses would render a wrong number rather than fail.
export function parseHistory(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new HistoryError(`the history file is not JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HistoryError("the history file must be an object");
  }
  if (parsed.format !== HISTORY_FORMAT) {
    throw new HistoryError(
      `the history file is format ${JSON.stringify(parsed.format)}, and this build writes format ${HISTORY_FORMAT} — rebuild it from scratch`,
    );
  }
  if (!Array.isArray(parsed.snapshots)) {
    throw new HistoryError("the history file has no snapshots array");
  }
  for (const snapshot of parsed.snapshots) checkSnapshot(snapshot);
  return parsed;
}

export class HistoryError extends Error {
  constructor(message) {
    super(message);
    this.name = "HistoryError";
  }
}

const COMMIT_HASH = /^[\da-f]{40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkSnapshot(snapshot) {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new HistoryError("a snapshot is not an object");
  }
  if (!COMMIT_HASH.test(snapshot.commit ?? "")) {
    throw new HistoryError(
      `a snapshot has no full commit hash: ${JSON.stringify(snapshot.commit)}`,
    );
  }
  if (!ISO_DATE.test(snapshot.date ?? "")) {
    throw new HistoryError(`snapshot ${short(snapshot.commit)} has no YYYY-MM-DD date`);
  }
  if (snapshot.read === true) {
    if (typeof snapshot.total !== "number" || snapshot.statuses === undefined) {
      throw new HistoryError(`snapshot ${short(snapshot.commit)} is read but holds no counts`);
    }
    return;
  }
  if (snapshot.read !== false) {
    throw new HistoryError(`snapshot ${short(snapshot.commit)} does not say whether it was read`);
  }
  if (typeof snapshot.reason !== "string" || snapshot.reason.trim() === "") {
    throw new HistoryError(
      `snapshot ${short(snapshot.commit)} was not read and gives no reason — an unread commit without a reason is indistinguishable from a guess`,
    );
  }
}

export function short(commit) {
  return commit.slice(0, 8);
}

// --- building one snapshot ----------------------------------------------------------------------

export function countStatuses(nodes, ledgerStatuses) {
  const counts = {};
  for (const status of ledgerStatuses) counts[status] = 0;
  for (const node of nodes) counts[node.status] += 1;
  return counts;
}

// Per area, only the two numbers the movement table reads. Every ledger status per area per commit
// would be nine times the file for a question nobody asked of the past.
export function countAreas(areas) {
  return areas.map((area) => ({
    name: area.name,
    total: area.nodes.length,
    shipped: area.nodes.filter((node) => node.status === "shipped").length,
  }));
}

export function readSnapshot({ commit, date }, areas, ledgerStatuses) {
  const nodes = areas.flatMap((area) => area.nodes);
  return {
    commit,
    date,
    read: true,
    total: nodes.length,
    statuses: countStatuses(nodes, ledgerStatuses),
    areas: countAreas(areas),
  };
}

export function unreadSnapshot({ commit, date }, reason) {
  return { commit, date, read: false, reason };
}

// --- merging with what is already on disk --------------------------------------------------------

// The commits a run has to read: everything in the log that the file does not already hold. Normally
// one — today's — which is what keeps an ordinary build cheap.
export function missingCommits(history, commits) {
  const known = new Set(history.snapshots.map((snapshot) => snapshot.commit));
  return commits.filter((entry) => !known.has(entry.commit));
}

// Order is the log's order, oldest first, never the order rows were appended. A snapshot whose
// commit is no longer in the log (a rewritten branch, a squashed merge) is dropped and reported
// rather than left in place: a series carrying commits that are not in the history it claims to
// describe is worse than a shorter one.
export function orderSnapshots(history, commits, additions = []) {
  const byCommit = new Map();
  for (const snapshot of [...history.snapshots, ...additions]) {
    byCommit.set(snapshot.commit, snapshot);
  }
  const snapshots = [];
  for (const entry of commits) {
    const snapshot = byCommit.get(entry.commit);
    if (snapshot !== undefined) {
      snapshots.push(snapshot);
      byCommit.delete(entry.commit);
    }
  }
  return { snapshots, dropped: [...byCommit.values()] };
}

// --- the arithmetic ------------------------------------------------------------------------------

const DAY_IN_MILLISECONDS = 86_400_000;

function daysBetween(from, to) {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_IN_MILLISECONDS,
  );
}

function shippedIn(snapshot) {
  return snapshot.statuses.shipped ?? 0;
}

function ratePerWeek(change, days) {
  if (days <= 0) return null;
  return (change * 7) / days;
}

// Everything the section renders, computed once. Returns null when no commit in the series was read
// — a history file that holds only unread commits has nothing to say and must say that, not zero.
export function summariseHistory(history) {
  const read = history.snapshots.filter((snapshot) => snapshot.read);
  const unread = history.snapshots.filter((snapshot) => !snapshot.read);
  if (read.length === 0) return null;

  const rows = [];
  let previous = null;
  let unreadSincePrevious = 0;
  for (const snapshot of history.snapshots) {
    if (!snapshot.read) {
      unreadSincePrevious += 1;
      continue;
    }
    rows.push({
      ...snapshot,
      shippedChange: previous === null ? null : shippedIn(snapshot) - shippedIn(previous),
      totalChange: previous === null ? null : snapshot.total - previous.total,
      unreadBefore: previous === null ? 0 : unreadSincePrevious,
    });
    previous = snapshot;
    unreadSincePrevious = 0;
  }

  const first = read[0];
  const last = read.at(-1);
  const spanDays = daysBetween(first.date, last.date);
  const shippedChange = shippedIn(last) - shippedIn(first);

  return {
    rows,
    unread,
    first,
    last,
    spanDays,
    shippedFirst: shippedIn(first),
    shippedLast: shippedIn(last),
    shippedChange,
    totalFirst: first.total,
    totalLast: last.total,
    totalChange: last.total - first.total,
    ratePerWeek: ratePerWeek(shippedChange, spanDays),
    sinceLastGap: sinceLastGap(history.snapshots),
    areas: areaMovement(first, last),
  };
}

// The stretch of read commits after the last unread one — a rate over commits that were all read,
// with no hole inside it. Null when the last stretch is a single snapshot or lands inside one day,
// because a rate over no elapsed time is a division, not a measurement.
function sinceLastGap(snapshots) {
  const lastUnread = snapshots.findLastIndex((snapshot) => !snapshot.read);
  if (lastUnread === -1) return null;
  const stretch = snapshots.slice(lastUnread + 1).filter((snapshot) => snapshot.read);
  if (stretch.length < 2) return null;
  const from = stretch[0];
  const to = stretch.at(-1);
  const days = daysBetween(from.date, to.date);
  if (days <= 0) return null;
  const shippedChange = shippedIn(to) - shippedIn(from);
  return {
    from,
    to,
    days,
    snapshots: stretch.length,
    shippedChange,
    ratePerWeek: ratePerWeek(shippedChange, days),
  };
}

// Movement per area between the first and the last read snapshot. An area that did not exist at the
// first one carries `presentThen: false` so the renderer can say "new area" instead of printing a
// zero that reads as "shipped nothing".
function areaMovement(first, last) {
  const then = new Map((first.areas ?? []).map((area) => [area.name, area]));
  const movement = [];
  for (const area of last.areas ?? []) {
    const before = then.get(area.name) ?? null;
    movement.push({
      name: area.name,
      presentThen: before !== null,
      thenTotal: before === null ? null : before.total,
      thenShipped: before === null ? null : before.shipped,
      nowTotal: area.total,
      nowShipped: area.shipped,
      shippedChange: before === null ? area.shipped : area.shipped - before.shipped,
      nodesAdded: before === null ? area.total : area.total - before.total,
    });
  }
  // An area file the ledger no longer has: kept, so the series does not quietly lose one.
  const now = new Set((last.areas ?? []).map((area) => area.name));
  for (const area of first.areas ?? []) {
    if (now.has(area.name)) continue;
    movement.push({
      name: area.name,
      presentThen: true,
      thenTotal: area.total,
      thenShipped: area.shipped,
      nowTotal: null,
      nowShipped: null,
      shippedChange: null,
      nodesAdded: null,
    });
  }
  return movement;
}
