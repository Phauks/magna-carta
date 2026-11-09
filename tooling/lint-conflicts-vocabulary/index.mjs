import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// The conflicts-vocabulary gate. Sibling of tooling/lint-custodian-vocabulary.mjs, whose shape this
// follows: a source scan whose patterns self-test before they scan, run as a governance step.
//
// WHAT IT PROTECTS, and why it is a build failure rather than a convention.
//
// A conflicts check searches a corpus and reports what it found. It does not, and cannot, establish
// that no conflict exists — the corpus is only what the firm has recorded, several registered sources
// have no data behind them at all, and a traversal is bounded. So the platform is allowed to assert
// facts about its own search ("these channels ran", "this source has no corpus", "nothing surfaced")
// and is never allowed to assert a fact about the world ("this matter is conflict-free").
//
// The distinction is legal, not stylistic. A firm that reports "conflict-free" and is later served
// with a disqualification motion has to defend that sentence. A firm that reports what it searched,
// what it could not search, and what surfaced is defending a procedure, which is what the rules on
// imputed disqualification actually ask for. A single label in a response schema or a single line of
// help text is enough to make the platform say the first thing, and vocabulary discipline that lives
// in a document decays. So it is mechanical.
//
// TWO RULES:
//
//   1. ASSERTION PHRASES. "conflict-free", "no conflicts", "clear of conflicts", "conflicts cleared",
//      "conflict check passed", "all clear", "no conflict found" — each asserts a fact about a matter.
//      Banned outright in the scanned trees.
//   2. VERDICT-SHAPED FIELDS. A response or read-model field whose name reads as a verdict —
//      `clear`, `clean`, `ok`, `passed`, `conflictFree` — is banned even where no banned phrase
//      appears, because the first surface to render it will render a green tick.
//
// THE ONE LEGITIMATE `cleared`. `cleared` is a DISPOSITION KIND: a named human's conclusion about one
// hit, carried on a row that also carries that human's identity and their rationale. A person may
// conclude; the platform may not. So `cleared` is allowed where it is a disposition value and nowhere
// else, and the allowance is narrow enough to be checked by reading the line.
//
// Run: `pnpm run lint:conflicts-vocabulary`. Runs in the gate's governance dimension (every
// `lint:*` script does, derived from the root package.json) beside lint:custodian-vocabulary.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// The trees the conflicts vocabulary binds in: the domain package, the HTTP surface, the emitted
// contract, the web surfaces, and the user-facing help. Paths are repo-relative with forward slashes.
// A path that does not exist yet is not a failure — the web surface is a later slice, and a scan that
// demanded every tree would fail on the first one to arrive.
const CONFLICTS_TREES = [
  "packages/conflicts",
  "apps/api-worker/src/http/routes/directory/conflicts.ts",
  "apps/web/src/routes/(app)/conflicts",
  "apps/web/src/routes/(app)/matters/[id]/conflicts",
  "apps/web/src/lib/conflicts",
  // Intake gates a consultation's opening on the conflicts posture, which is exactly where a
  // verdict-shaped word tempts a builder: the package, its route, and its web surfaces.
  "packages/intake",
  "apps/api-worker/src/http/routes/matters/intake.ts",
  "apps/web/src/lib/intake",
  "apps/web/src/routes/(app)/matters/[id]/intake",
  "apps/web/src/routes/(app)/settings/intake-procedures",
  "docs/user",
];

const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".svelte",
  ".sql",
  ".md",
]);

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".claude",
  "dist",
  "build",
  "target",
  ".tsbuild",
  ".svelte-kit",
  ".wrangler",
  ".vite",
]);

// ---------------------------------------------------------------------------------------------------
// Rule 1 — assertion phrases.
// ---------------------------------------------------------------------------------------------------
//
// Written as one alternation so a line is reported once with the phrase that matched. Separators are
// permissive (`conflict-free`, `conflict free`, `conflictFree`) because the hyphen is not the defect.
// "all clear" is matched only as those two words together: `clear` on its own is an ordinary English
// word that appears legitimately (clearing a filter, a cleared timeout) and banning it would either
// bury the gate in exemptions or push authors into synonyms that mean the same thing.
// Ordered most specific first, so the phrase reported back is the longest one that actually matched
// rather than a prefix of it — the message has to name the sentence the author wrote.
export const ASSERTION_PHRASES = [
  /\bno[\s_-]+conflicts?[\s_-]+(?:found|surfaced|detected)\b/i,
  /\bconflicts?[\s_-]+check[\s_-]+passed\b/i,
  /\bclear(?:ed)?[\s_-]+of[\s_-]+conflicts?\b/i,
  /conflicts?[\s_-]*free\b/i,
  /\bno[\s_-]+conflicts?\b/i,
  /\bconflicts?[\s_-]+(?:is|are|was|were)?[\s_-]*clear(?:ed)?\b/i,
  /\ball[\s_-]+clear\b/i,
];

export function findAssertionPhrase(line) {
  for (const pattern of ASSERTION_PHRASES) {
    const match = pattern.exec(line);
    if (match !== null) return match[0].trim();
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Rule 2 — verdict-shaped field names.
// ---------------------------------------------------------------------------------------------------
//
// A field DECLARATION, not a mention: an object-literal key, an interface member, a zod property, or a
// JSON key. Matching declarations rather than every occurrence of the word is what keeps the rule
// sharp — `if (ok)` in a helper is not a verdict a caller can render, and a schema key is.
//
// `passed` is included; `passedAt` and friends are not, because the boundary is a whole word. The word
// list is exactly the design's: a caller that wants a single word for where a matter stands has to
// write that word itself, in its own surface, and own it.
const VERDICT_FIELD_WORDS = ["clear", "clean", "ok", "passed", "conflictFree", "conflict_free"];

const VERDICT_FIELD = new RegExp(
  String.raw`(?:^|[\s,{[("'\`])(?:readonly\s+)?["'\`]?(${VERDICT_FIELD_WORDS.join("|")})["'\`]?\s*[?!]?\s*:`,
  "i",
);

export function findVerdictField(line) {
  const match = VERDICT_FIELD.exec(line);
  return match === null ? null : match[1];
}

// ---------------------------------------------------------------------------------------------------
// The allowance: `cleared` as a disposition kind.
// ---------------------------------------------------------------------------------------------------
//
// A line is exempt from rule 1 when the `cleared` on it is the disposition value — the catalogue
// entry, a comparison against it, or prose that says so in the same breath. This is narrow on purpose:
// it exempts `"cleared"` as a quoted value and lines that name DISPOSITION_KINDS or the disposition
// itself, and it does not exempt a bare sentence about a matter being cleared.
const DISPOSITION_ALLOWANCE = [
  /DISPOSITION_KINDS/,
  /\bdisposition\b/i,
  /\bDispositionKind\b/,
  /["'`]cleared["'`]/,
];

export function isDispositionAllowance(line) {
  return DISPOSITION_ALLOWANCE.some((pattern) => pattern.test(line));
}

// ---------------------------------------------------------------------------------------------------
// The second allowance: a line that STATES the prohibition.
// ---------------------------------------------------------------------------------------------------
//
// The rule cannot be explained without writing the sentence it bans — a comment saying "never report a
// matter as conflict-free" contains the phrase, and so does the reasoning behind it. Silently
// special-casing comments would be worse than useless (the most dangerous strings in the codebase are
// user-facing prose, and a `//` is one keystroke), so the exemption is explicit, per line, and carries
// its reason, exactly as a bucket write without dimensions is allowlisted in
// apps/api-worker/test/r2-object-dimension-scan.test.ts.
//
// It exempts ONLY the assertion-phrase rule. A verdict-shaped FIELD has no legitimate meta-use in the
// scanned trees, so that rule has no escape hatch at all.
const PROHIBITION_MARKER = /conflicts-vocabulary:allow\b/;

export function statesTheProhibition(line) {
  return PROHIBITION_MARKER.test(line);
}

// ---------------------------------------------------------------------------------------------------
// The scan self-tests before it scans.
// ---------------------------------------------------------------------------------------------------
//
// A vocabulary gate that silently stopped matching reads as a permanently green check while the exact
// thing it exists to prevent walks in. So the patterns are proven to BITE on known-bad lines and to
// stay quiet on the permitted forms, on every run, and a logic regression fails loudly here.
//
// [line, rule-1 phrase expected (or null), rule-2 field expected (or null)]
export const SELF_TEST = [
  ["This matter is conflict-free.", "conflict-free", null],
  ["// the matter is conflict free as of today", "conflict free", null],
  ["description: 'No conflicts were found for this matter'", "No conflicts", null],
  ["Your matter is clear of conflicts.", "clear of conflicts", null],
  ["// once the conflicts are cleared the matter may open", "conflicts are cleared", null],
  ["The conflicts check passed.", "conflicts check passed", null],
  ["<span>All clear</span>", "All clear", null],
  ["No conflict found in the party corpus.", "No conflict found", null],
  ["  clear: z.boolean(),", null, "clear"],
  ["  readonly clean: boolean;", null, "clean"],
  ['  "ok": true,', null, "ok"],
  ["  passed: z.boolean(),", null, "passed"],
  // A verdict-shaped field spelled with the banned phrase trips both rules, and should.
  ["  conflictFree: z.boolean(),", "conflictFree", "conflictFree"],
  // The permitted forms.
  ['export const DISPOSITION_KINDS = ["cleared", "waiver_obtained"] as const;', null, null],
  ["if (disposition.kind === 'cleared') return;", null, null],
  ["// a reviewer who cleared a hit and later reverses that call leaves BOTH rows", null, null],
  ["Nothing surfaced.", null, null],
  ["statements.push('Nothing surfaced.');", null, null],
  ["// clear the cached page before the next read", null, null],
  ["const cleared = clearTimeout(handle);", null, null],
  ["  clearedAt: text('cleared_at'),", null, null],
  ["  neverChecked: z.boolean(),", null, null],
  // The marker exempts prose that states the prohibition, and only the assertion rule.
  [
    "// conflicts-vocabulary:allow — states the rule: never report a matter as conflict-free.",
    null,
    null,
  ],
  ["  clear: z.boolean(), // conflicts-vocabulary:allow — no escape hatch here", null, "clear"],
];

function runSelfTest() {
  const failures = [];
  for (const [line, expectedPhrase, expectedField] of SELF_TEST) {
    const phrase =
      isDispositionAllowance(line) || statesTheProhibition(line) ? null : findAssertionPhrase(line);
    const field = findVerdictField(line);
    const phraseMatches =
      expectedPhrase === null
        ? phrase === null
        : phrase !== null && phrase.toLowerCase() === expectedPhrase.toLowerCase();
    if (!phraseMatches || field !== expectedField) {
      failures.push({ line, expectedPhrase, phrase, expectedField, field });
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The scan itself.
// ---------------------------------------------------------------------------------------------------

function collectFiles(root, trees) {
  const files = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const full = join(directory, name);
      if (statSync(full).isDirectory()) {
        if (!SKIP_DIRECTORIES.has(name)) walk(full);
        continue;
      }
      files.push(full);
    }
  };
  for (const tree of trees) {
    const full = join(root, tree);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) walk(full);
    else files.push(full);
  }
  return files;
}

// Offenders for one file's text. Exported so the fixture test drives the same code the gate runs,
// rather than a paraphrase of it.
export function scanText(relativePath, text) {
  const offenders = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!isDispositionAllowance(line) && !statesTheProhibition(line)) {
      const phrase = findAssertionPhrase(line);
      if (phrase !== null) {
        offenders.push({
          path: relativePath,
          line: index + 1,
          rule: "assertion",
          detail: phrase,
          text: line.trim(),
        });
      }
    }
    const field = findVerdictField(line);
    if (field !== null) {
      offenders.push({
        path: relativePath,
        line: index + 1,
        rule: "verdict-field",
        detail: field,
        text: line.trim(),
      });
    }
  });
  return offenders;
}

export function scanTrees(root, trees) {
  const self = fileURLToPath(import.meta.url);
  const files = collectFiles(root, trees).filter((file) => {
    if (file === self) return false;
    const name = basename(file);
    return SCANNED_EXTENSIONS.has(name.slice(name.lastIndexOf(".")));
  });
  const offenders = [];
  for (const file of files) {
    const relativePath = relative(root, file).split(sep).join("/");
    offenders.push(...scanText(relativePath, readFileSync(file, "utf8")));
  }
  return { files, offenders };
}

const RULE_ADVICE = {
  assertion:
    "the platform reports what it searched and found; it never states a conclusion about the matter. " +
    'Say what the search did — "Nothing surfaced." — or name the disposition and the reviewer who made it. ' +
    "If the line exists to state that rule rather than to break it, mark it " +
    "`conflicts-vocabulary:allow — <reason>` on the same line.",
  "verdict-field":
    "a verdict-shaped field is a green tick waiting to be rendered. Report the parts instead " +
    "(what ran, what did not, what is unanswered) and let the caller write its own word.",
};

function main() {
  const selfTestFailures = runSelfTest();
  if (selfTestFailures.length > 0) {
    console.error(
      "\nlint-conflicts-vocabulary: the scan's own patterns no longer match what they must.\n",
    );
    for (const failure of selfTestFailures) {
      console.error(
        `  ${JSON.stringify(failure.line)}\n` +
          `    assertion phrase: expected ${JSON.stringify(failure.expectedPhrase)}, got ${JSON.stringify(failure.phrase)}\n` +
          `    verdict field:    expected ${JSON.stringify(failure.expectedField)}, got ${JSON.stringify(failure.field)}`,
      );
    }
    process.exit(1);
  }

  const { files, offenders } = scanTrees(ROOT, CONFLICTS_TREES);

  if (offenders.length > 0) {
    console.error(
      "\nConflicts vocabulary — the platform may state what it searched, never that a matter is clear.\n",
    );
    for (const offender of offenders) {
      console.error(
        `  ${offender.path}:${offender.line}  [${offender.rule}: ${offender.detail}]  ${offender.text}\n` +
          `    ${RULE_ADVICE[offender.rule]}`,
      );
    }
    console.error(`\n${offenders.length} vocabulary violation(s) found.`);
    process.exit(1);
  }

  console.log(
    `Conflicts vocabulary clean across ${files.length} file(s): no assertion phrase, no verdict-shaped field.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
