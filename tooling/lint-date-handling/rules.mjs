/*
 * The rules of the date gate, and why each one exists. The runner is index.mjs; every decision here
 * is a pure function over (path, source) so it can be unit-tested without a repository.
 *
 * WHAT THIS GATE IS FOR. A date has two questions and each has exactly one authority:
 *
 *   SHAPE  — what a civil date, a wall-clock time, a stored instant and a time zone ARE, and the
 *            arithmetic on them: @magna-carta/civil-time.
 *   DISPLAY — how any of them READS to a person: packages/design-system/src/lib/formatters/.
 *
 * Neither authority was disputed when this landed. What existed instead was thirty-odd copies of
 * each, all agreeing, written by people who could not reach the other copy or did not know it was
 * there. That is the failure mode this scans for: not a WRONG answer to "what is a date", a SECOND
 * one. A second answer is invisible in review, passes every type-check, and surfaces a year later
 * when somebody corrects one of them.
 *
 * The count before this gate: six implementations of "is this a real calendar day", three of "is
 * this a resolvable time zone" (two of which accepted a fixed offset the third refused), forty
 * copies of the civil-date pattern, six of the canonical-instant pattern, six of the date-picker's
 * value reader, and nine surfaces each printing a moment their own way.
 *
 * WHAT THIS DOES NOT CATCH, stated plainly, because a gate that claims more than it delivers is
 * worse than none:
 *
 *   - A pattern built at runtime (`new RegExp("^\\d{4}-…")`), or assembled from fragments. Every
 *     rule here reads source text, not behaviour.
 *   - A hand-written validator that reaches the same answer by different means — parsing with
 *     `Date.parse` and comparing month numbers, say. The scan reads the shapes the copies actually
 *     took, and a seventh written deliberately differently defeats it. Review is the answer to that
 *     one, and so is the ruling ledger the failure message points at.
 *   - `new Date().toISOString()` for a stored instant. That is deliberately NOT a rule: it is one
 *     method call with one meaning and no policy in it, there are three hundred of them, and a rule
 *     that fired on all three hundred would teach people to switch the gate off. What IS a rule is
 *     the PATTERN that validates the result, because a loosened pattern silently reorders a sort.
 *   - Whether a surface picked the RIGHT formatter. `formatDate` (a day, pinned to UTC) and
 *     `formatInstantDate` (the day a moment fell on, where the reader is) are both correct calls and
 *     differ by a day; only a person reading the surface can say which it wanted.
 *   - A raw `<Input type="date">` already recorded in ALLOWED_RAW_DATE_INPUTS. That list is frozen
 *     at what existed when this landed, so the split cannot grow while the design question of
 *     whether every one of them should be a DatePicker is open. It is printed on every run.
 */

/** Where the shape of a date, a time and a zone is defined. Nothing else may define one. */
export const SHAPE_HOME = "packages/civil-time/src";

/** Where a date, a time or a moment is turned into words a person reads. */
export const DISPLAY_HOME = "packages/design-system/src/lib/formatters";

/**
 * The calendar grid's own civil-date module. It formats CalendarDate values for the grid's cells
 * and headings and is a design-system component's internal, not a second public answer — the two
 * are different jobs and it says so at the top of its own file.
 */
export const CALENDAR_GRID_HOME = "packages/design-system/src/lib/components/calendar-grid";

/*
 * Comments are ordinary English and must not trip a scan, so they are blanked before any rule runs.
 *
 * BLANKED, NOT REMOVED — every comment character becomes a space and every newline is kept, so the
 * text stays the same length and every index into it is still an index into the real file. Deleting
 * comments instead shifts every offset after the first one, and a gate that reports a real problem
 * at the wrong line is a gate people stop trusting: it sends the reader to whatever happens to sit
 * on that line, which is a different function.
 *
 * The line-comment rule skips `://` so a URL in a string is not read as the start of one. A `//`
 * genuinely inside a string literal is still misread; that costs a false blank, never a false
 * failure, so it is the safe direction to be wrong in.
 */
const blank = (match) => match.replaceAll(/[^\n]/g, " ");

export function stripComments(source) {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, blank)
    .replaceAll(/(^|[^:])\/\/.*$/gm, (match, before) => before + blank(match.slice(before.length)));
}

export function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

const problem = (rule, file, text, index, detail) => ({
  rule,
  file,
  line: lineOf(text, index),
  detail,
});

// --- rule: one shape for each of the four things a date can be ---------------------------------

/**
 * The four shapes, as the copies actually wrote them.
 *
 * Each is matched with and without the `u` flag and with the two spellings of the digit class that
 * were both in use, because a copy that differs by a flag is still a copy. The canonical-instant
 * pattern comes first so a full instant is never reported as a stray civil date.
 */
const SHAPE_LITERALS = [
  {
    pattern: /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}T\\d\{2\}:\\d\{2\}:\\d\{2\}\\\.\\d\{3\}Z\$\/u?/g,
    name: "the canonical stored instant",
    fix: "`CANONICAL_INSTANT_PATTERN` from @magna-carta/civil-time/instant",
    why:
      "the federated chronology compares sort keys AS TEXT, so a variant precision reorders a " +
      "timeline rather than failing — six files carried this literal before it had a home",
  },
  {
    pattern: /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/u?/g,
    name: "the civil date",
    fix: "`CIVIL_DATE_PATTERN` from @magna-carta/civil-time/civil-date",
    why:
      "it appeared as a bare literal in more than thirty files, and the pattern ALONE accepts " +
      "2026-02-30 — `isCivilDate` is the check that does not",
  },
  {
    pattern: /\/\^\(\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d\$\/u?/g,
    name: "the wall-clock time",
    fix: "`WALL_CLOCK_TIME_PATTERN` from @magna-carta/civil-time/wall-clock",
    why: "a looser \\d{2}:\\d{2} accepts 29:74, and six files each wrote this one out",
  },
  {
    pattern: /\/\^\[\+-\]\\d\{2\}:\?\\d\{2\}\$\//g,
    name: "the fixed-offset refusal",
    fix: "`isFixedOffset` / `isResolvableTimeZone` from @magna-carta/civil-time/time-zone",
    why:
      "an offset is wrong for half the year in every zone that observes daylight saving, and the " +
      "point of refusing one is that every subsystem refuses the same thing",
  },
];

export function findShapeLiterals(filePath, source) {
  if (filePath.startsWith(`${SHAPE_HOME}/`)) return [];
  const text = stripComments(source);
  const problems = [];
  const claimed = [];
  for (const shape of SHAPE_LITERALS) {
    for (const match of text.matchAll(shape.pattern)) {
      // A civil-date literal inside an instant literal is the same characters twice; report once.
      if (claimed.some(([from, to]) => match.index >= from && match.index < to)) continue;
      claimed.push([match.index, match.index + match[0].length]);
      problems.push(
        problem(
          "date-shape",
          filePath,
          text,
          match.index,
          `writes out ${shape.name} as a literal. Use ${shape.fix} — ${shape.why}`,
        ),
      );
    }
  }
  return problems;
}

// --- rule: one answer to "is this a real day" and "is this a zone" -----------------------------

/**
 * The two hand-written validators, matched by the mechanics every copy shared rather than by name.
 *
 * The calendar round trip is recognised by a UTC construction immediately compared back against the
 * parts it was built from — the shape all six copies took, and a shape nothing else has a reason to
 * write. The zone check is recognised by a formatter constructed inside a `try` for its throw,
 * which is the whole of what those three copies did.
 */
const CALENDAR_ROUND_TRIP =
  /getUTCFullYear\(\)\s*[!=]==?\s*year|\.toISOString\(\)\.slice\(0,\s*10\)\s*===/g;
const ZONE_PROBE = /new Intl\.DateTimeFormat\(\s*"en-US"\s*,\s*\{\s*timeZone\s*\}\s*\)/g;

export function findHandWrittenValidators(filePath, source) {
  if (filePath.startsWith(`${SHAPE_HOME}/`)) return [];
  const text = stripComments(source);
  const problems = [];
  for (const match of text.matchAll(CALENDAR_ROUND_TRIP)) {
    problems.push(
      problem(
        "date-validator",
        filePath,
        text,
        match.index,
        "round-trips a date through the calendar to see whether the day exists. That is " +
          "`isCivilDate` from @magna-carta/civil-time/civil-date, and it was written out six times " +
          "before it was one function — one of the six also excluded year 0000 and the other five " +
          "did not, which is what a duplicate that is right looks like just before it stops being",
      ),
    );
  }
  for (const match of text.matchAll(ZONE_PROBE)) {
    problems.push(
      problem(
        "zone-validator",
        filePath,
        text,
        match.index,
        "asks the runtime whether a zone resolves by constructing a formatter. That is " +
          "`isResolvableTimeZone` from @magna-carta/civil-time/time-zone. Three copies of this " +
          "existed and TWO OF THEM ACCEPTED A FIXED OFFSET like +05:00, so a note could store a " +
          "zone a calendar entry could not — the drift a second copy always eventually is",
      ),
    );
  }
  return problems;
}

// --- rule: one reading of the viewer's own zone -------------------------------------------------

const VIEWER_ZONE = /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/g;

export function findInlineViewerZone(filePath, source) {
  if (filePath.startsWith(`${SHAPE_HOME}/`)) return [];
  const text = stripComments(source);
  return [...text.matchAll(VIEWER_ZONE)].map((match) =>
    problem(
      "viewer-zone",
      filePath,
      text,
      match.index,
      "resolves the reader's own zone inline. `viewerTimeZone()` from " +
        "@magna-carta/civil-time/time-zone is the one function for it — four modules resolved it " +
        "themselves, and a default that four places compute is a default nobody can change",
    ),
  );
}

// --- rule: one "today" ---------------------------------------------------------------------------

const TODAY_BY_STRING_SURGERY = /\.toISOString\(\)\.slice\(0,\s*10\)/g;

/*
 * The same cut, on a value that is ALREADY an ISO instant — `createdAt.slice(0, 10)`.
 *
 * This is the form the rule missed first time round, and it is the form that had actually shipped
 * bugs: four surfaces took the first ten characters of a stored instant and rendered the result
 * through `formatDate`, which pins to UTC. Two of them are print sheets. A record entered at 18:30
 * in Los Angeles has a `createdAt` of 01:30Z the next day, so "Date Entered" named the wrong day
 * for every entry after late afternoon.
 *
 * It is also the case that defeats a type. `createdAt.slice(0, 10)` produces a perfectly
 * well-formed YYYY-MM-DD — a branded `CivilDate` obtained by parsing would accept it without
 * complaint. It is not malformed; it is the wrong day. Only knowing where the string came from
 * catches it, which is what this reads.
 *
 * KEYED ON NAMES THAT CAN ONLY MEAN AN INSTANT — a trailing `At`, or `now`/`instant`/`sortKey` —
 * rather than on `.slice(0, 10)` at large, which is also how somebody truncates a title. The
 * deliberate omission is `validFrom`/`validTo`: those columns hold a civil date at one end and an
 * instant at the other by design, and the reads that slice them are normalising exactly that. A
 * dual-shape column is a hazard, but it is not this one.
 */
const CIVIL_DATE_CUT_FROM_AN_INSTANT =
  /\b(?:\w*[aA]t|now|nowIso|instant|sortKey)\b\)?\??\.slice\(0,\s*10\)/g;

export function findHandCutToday(filePath, source) {
  if (filePath.startsWith(`${SHAPE_HOME}/`)) return [];
  const text = stripComments(source);
  const problems = [];
  for (const match of text.matchAll(TODAY_BY_STRING_SURGERY)) {
    problems.push(
      problem(
        "civil-date-of",
        filePath,
        text,
        match.index,
        "cuts a civil date out of an ISO string. `civilDateOf(instant)` and `todayInUtc()` from " +
          "@magna-carta/civil-time/civil-date say what this means and are findable; a string slice " +
          "is not, which is why forty of them accumulated with nothing able to name them",
      ),
    );
  }
  for (const match of text.matchAll(CIVIL_DATE_CUT_FROM_AN_INSTANT)) {
    problems.push(
      problem(
        "day-of-an-instant",
        filePath,
        text,
        match.index,
        "takes the first ten characters of a stored INSTANT to get a day, which gets the UTC day — " +
          "a different day from the reader's for roughly a third of every day. Four surfaces " +
          'shipped that under labels like "Date Entered". To DISPLAY the day a moment fell on, ' +
          "call `formatInstantDate` (@magna-carta/design-system/formatters), which reads in the " +
          "viewer's own zone; to compute with it, `civilDateOf(Date.parse(value))` for the UTC day " +
          "or `zonedReading(Date.parse(value), zone).civilDate` for a named zone — and say which " +
          "you meant, because the two differ by a day",
      ),
    );
  }
  return problems;
}

// --- rule: one display of a date, a time, or a moment -------------------------------------------

/**
 * Locale formatting outside the display home.
 *
 * `Intl.DateTimeFormat` is matched wherever a formatter is CONSTRUCTED for output, and the
 * `toLocale*` family wherever a value is turned into words. Number formatting is not this scan's
 * business — `toLocaleString` on a number is money's and the number formatter's question — so the
 * date family is named exactly.
 */
const LOCALE_DATE_OUTPUT = /\.toLocale(?:Date|Time)String\(/g;
const LOCALE_STRING_ON_A_DATE =
  /\bnew Date\([^\n)]*\)\.toLocaleString\(|\bDate\)\.toLocaleString\(/g;
const FORMATTER_CONSTRUCTION = /new Intl\.DateTimeFormat\(/g;

export function findSecondDisplay(filePath, source) {
  if (filePath.startsWith(`${DISPLAY_HOME}/`)) return [];
  if (filePath.startsWith(`${CALENDAR_GRID_HOME}/`)) return [];
  if (filePath.startsWith(`${SHAPE_HOME}/`)) return [];
  const text = stripComments(source);
  const problems = [];
  const seen = new Set();
  const add = (index, detail) => {
    if (seen.has(index)) return;
    seen.add(index);
    problems.push(problem("date-display", filePath, text, index, detail));
  };
  for (const match of text.matchAll(LOCALE_DATE_OUTPUT)) {
    add(
      match.index,
      "formats a date or a time for a reader. The platform's answers are `formatDate` (a calendar " +
        "day, pinned to UTC so it never shifts), `formatInstant` / `formatInstantDate` / " +
        "`formatTimeOfDay` (a moment, in the reader's own zone) and `formatDateRange` / " +
        "`formatMonth`, all from @magna-carta/design-system/formatters",
    );
  }
  for (const match of text.matchAll(LOCALE_STRING_ON_A_DATE)) {
    add(
      match.index,
      "formats a moment for a reader. `formatInstant` from @magna-carta/design-system/formatters " +
        "is the one that already handles an unreadable value by showing what arrived",
    );
  }
  for (const match of text.matchAll(FORMATTER_CONSTRUCTION)) {
    add(
      match.index,
      "builds its own date formatter. Every wording a date has on a surface comes from " +
        "@magna-carta/design-system/formatters; a formatter built here is a second answer to a " +
        "question that has one, and the correction to it will be applied to only one of them",
    );
  }
  return problems;
}

// --- rule: elapsed time is banned outright ------------------------------------------------------

/**
 * "2 hours ago" and its family. The ruling is the instant formatter's own and predates this scan:
 * an elapsed time decays while the reader looks at it, cannot be compared between two rows, and a
 * record is a record.
 *
 * Matched as the API and as the prose, because both are how it arrives. The prose form requires a
 * template hole or a number beside it, so ordinary English ("the step before this one") is safe.
 */
const RELATIVE_TIME_API = /Intl\.RelativeTimeFormat/g;
const ELAPSED_PROSE = /["`'][^"`'\n]{1,60}\bago["`']|["`']\s*just now\s*["`']/gi;

export function findElapsedTime(filePath, source) {
  const text = stripComments(source);
  const problems = [];
  for (const pattern of [RELATIVE_TIME_API, ELAPSED_PROSE]) {
    for (const match of text.matchAll(pattern)) {
      problems.push(
        problem(
          "elapsed-time",
          filePath,
          text,
          match.index,
          'states a time as elapsed ("2 hours ago", "just now"). That is banned outright and the ' +
            "reason is on packages/design-system/src/lib/formatters/instant.ts: it decays while " +
            "the reader looks at it, two rows carrying it cannot be compared, and a record is a " +
            "record. State the actual instant with `formatInstant`",
        ),
      );
    }
  }
  return problems;
}

// --- rule: the date field is one component ------------------------------------------------------

/**
 * The surfaces holding a raw `<Input type="date">`, FROZEN at what existed when this gate landed.
 *
 * The platform has one date field — `DatePicker` (@magna-carta/design-system/date-picker) — and
 * nine surfaces use it. These fifteen use the native control instead. Whether every one of them
 * SHOULD be the DatePicker is a design question with real trade-offs (the native control is
 * lighter, familiar, and free on mobile; the DatePicker is the one that can carry a firm-configured
 * week start), and it is the owner's to settle, not a scan's.
 *
 * So the list is frozen rather than empty: nothing here fails, a SIXTEENTH does, and the split
 * cannot quietly grow while the question is open. An entry that no longer holds a raw date input
 * fails too — a stale allowance is a rule pretending to be weaker than it is.
 */
export const ALLOWED_RAW_DATE_INPUTS = Object.freeze([
  "apps/web/src/lib/auth/screens/redeem-invitation-screen.svelte",
  "apps/web/src/lib/billing/amend-agreement-dialog.svelte",
  "apps/web/src/lib/billing/credit-note-dialog.svelte",
  "apps/web/src/lib/billing/draft-bill-dialog.svelte",
  "apps/web/src/lib/billing/fee-record-window.svelte",
  "apps/web/src/lib/billing/finalize-bill-dialog.svelte",
  "apps/web/src/lib/billing/record-delivery-dialog.svelte",
  "apps/web/src/lib/billing/write-off-dialog.svelte",
  "apps/web/src/lib/costs/cost-record-window.svelte",
  "apps/web/src/lib/directory/life-dates-pane.svelte",
  "apps/web/src/lib/matters/note-record-window.svelte",
  "apps/web/src/lib/matters/plan-proposal.svelte",
  "apps/web/src/lib/matters/task-list.svelte",
  "packages/design-system/src/lib/components/data-table/data-table-grid-filter.svelte",
  "packages/design-system/src/stories/field-row.stories.svelte",
  /*
   * THE SIXTEENTH, AND HOW IT GOT HERE — recorded rather than hidden inside the count.
   *
   * The communications fields landed on `main` while this gate was on a branch, so it was written
   * against a rule that did not exist yet. That is the one way this list can legitimately grow, and
   * it is a merge race rather than a precedent: a surface written AFTER the gate is on `main` has
   * no such excuse, and the count below is what makes the difference visible instead of letting a
   * sixteenth entry pass as quietly as a fifteenth did.
   */
  "apps/web/src/lib/communications/communication-fields.svelte",
]);

const RAW_DATE_INPUT = /type=["']date["']/g;
/*
 * The same shape without the global flag. A `g` regex carries `lastIndex` between `.test()` calls,
 * so reusing one across files reports every second file as clean — which here would have read as
 * six allowances going stale at once.
 */
const RAW_DATE_INPUT_ONCE = /type=["']date["']/;

export function findRawDateInputs(filePath, source) {
  if (ALLOWED_RAW_DATE_INPUTS.includes(filePath)) return [];
  const text = stripComments(source);
  return [...text.matchAll(RAW_DATE_INPUT)].map((match) =>
    problem(
      "date-field",
      filePath,
      text,
      match.index,
      "renders a native date input. The platform's date field is `DatePicker` " +
        "(@magna-carta/design-system/date-picker), which nine surfaces already use and which is " +
        "the only one that can carry a firm-configured week start. The surfaces still on the " +
        "native control are recorded in tooling/lint-date-handling/rules.mjs and that list is " +
        "closed — settle the design question before adding to it",
    ),
  );
}

/** An allowance that has outlived its violation: the rule is stronger than the list admits. */
export function findStaleAllowances(filesByPath) {
  return ALLOWED_RAW_DATE_INPUTS.filter((allowed) => {
    const source = filesByPath.get(allowed);
    return source === undefined || !RAW_DATE_INPUT_ONCE.test(stripComments(source));
  }).map((allowed) => ({
    rule: "stale-allowance",
    file: allowed,
    line: 1,
    detail:
      "is recorded as holding a raw date input and no longer does (or no longer exists). Drop it " +
      "from ALLOWED_RAW_DATE_INPUTS — an allowance nobody needs makes the rule read weaker than " +
      "it is",
  }));
}

// --- the recorded allowances --------------------------------------------------------------------

/**
 * The findings that are recorded rather than fixed, each with the reason it is not a duplicate.
 *
 * Four of them, in two groups, and both groups are cases where a rule's premise genuinely does not
 * reach. They are PRINTED ON EVERY RUN, and an entry whose finding has gone fails — an allowance
 * that outlives its violation makes the rule read weaker than it is, which is how a list like this
 * rots into a blanket exemption.
 *
 * THE ELAPSED-TIME CARVE-OUT, stated once because three files share it: the ban is on elapsed time
 * for a RECORD. Its reasoning is that "2 hours ago" decays while the reader looks at it and cannot
 * be compared between two rows — both fatal for a fact somebody may rely on later, and both exactly
 * what is wanted of a STALENESS indicator on a live measurement, whose whole subject is how long
 * ago it was taken. A probe's age and a snapshot's age are that; a filing date is not. Both surfaces
 * here also fall back to the absolute instant when they cannot compute an age, which is the tell
 * that they are reporting freshness rather than naming a moment.
 *
 * Anything else that "needs" an allowance almost certainly needs the shared function instead. That
 * is what the previous thirty-odd duplicates each believed about themselves.
 */
export const ALLOWANCES = Object.freeze([
  {
    file: "apps/web/src/lib/auth/sent-stamp.ts",
    rule: "date-display",
    reason:
      'assembles a zone\'s ABBREVIATION and its offset — "PDT (UTC-07:00)" — from formatToParts, ' +
      "which no formatter offers and which only a stamp leaving this machine needs, and prints a " +
      "24-hour clock the product's surfaces deliberately do not use. It is one module with its own " +
      "tests against a fixed zone; a second one is what this list would stop",
  },
  {
    file: "apps/web/src/lib/versions/version-overlay-model.ts",
    rule: "elapsed-time",
    reason:
      "states the age of a LIVE PROBE, not of a record — the carve-out above. The API caches the " +
      'aggregate briefly, so the panel says how stale its reading is rather than implying "now"',
  },
  {
    file: "apps/status-worker/src/render-status-page.ts",
    rule: "elapsed-time",
    reason:
      "states how long ago the last automatic review ran on the public status page — the age of a " +
      "measurement, not of a record, and the carve-out above. It falls back to the absolute " +
      "instant when it cannot compute the age",
  },
  {
    file: "apps/status-worker/test/render-status-page.test.ts",
    rule: "elapsed-time",
    reason: "asserts the stale strip that file renders, so it necessarily carries the same words",
  },
]);

/** Drop the findings an allowance covers, and report an allowance that no longer covers anything. */
export function applyAllowances(problems) {
  const used = new Set();
  const kept = problems.filter((found) => {
    const allowance = ALLOWANCES.find(
      (entry) => entry.file === found.file && entry.rule === found.rule,
    );
    if (allowance === undefined) return true;
    used.add(allowance);
    return false;
  });
  const stale = ALLOWANCES.filter((entry) => !used.has(entry)).map((entry) => ({
    rule: "stale-allowance",
    file: entry.file,
    line: 1,
    detail:
      `is allowed to break the ${entry.rule} rule and no longer does. Drop the entry from ` +
      "ALLOWANCES in tooling/lint-date-handling/rules.mjs — an allowance nobody needs makes the " +
      "rule read weaker than it is",
  }));
  return { problems: [...kept, ...stale] };
}

/** Every rule, in the order a failure reads best: shape, then meaning, then words. */
export const RULES = Object.freeze([
  findShapeLiterals,
  findHandWrittenValidators,
  findInlineViewerZone,
  findHandCutToday,
  findSecondDisplay,
  findElapsedTime,
  findRawDateInputs,
]);
