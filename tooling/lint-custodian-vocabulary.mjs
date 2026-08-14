// The custodian-vocabulary gate. The platform holds TWO unrelated things a lawyer would call a
// custodian, and they appear in the same matter — sometimes on the same screen:
//
//   * the CUSTODIAN REGISTER (packages/custodian) — physical client originals the firm holds in
//     safekeeping. Its identifier family is `custody*`, and its person-shaped noun is `custodyOwner`.
//   * the RECORD CUSTODIAN (the discovery area) — whose electronic records these were: an
//     attribution of authorship and possession over documents under review, not a safekeeping
//     relationship.
//
// One word meaning two things is not a style problem, it is a defect waiting to be written. So the
// rule is mechanical rather than conventional: nothing anywhere is a bare `custodian`, and the two
// families never cross into each other's area. Two words — "record custodian" — reads naturally to a
// litigator, carries the industry meaning, and cannot be confused with the register by anyone
// reading either the code or the screen.
//
// THE CODE'S WORD AND THE READER'S LABEL ARE DIFFERENT, AND BOTH ARE PERMITTED. The owner named the
// discovery attribution "Custodian of Record" for everything a person reads — a field label, an
// OpenAPI description, a refusal sentence, a help page — while code, tables, columns, route paths,
// and refusal CODES keep `record_custodian` / `recordCustodian`. So the scan allows exactly two
// forms, and nothing else: the leading-`record` family, and the full phrase "Custodian of Record".
// Both are three-or-two-word constructions a reader cannot mistake for the safekeeping register, and
// neither can be produced by accident — which is what the gate is actually for. A bare `custodian`
// remains a failure in every casing and every position.
//
// WHAT THIS SCANS TODAY. The discovery area, in both directions:
//
//   1. a bare `custodian` identifier inside the discovery trees (only `recordCustodian` /
//      `record_custodian` / `RecordCustodian` / the prose "record custodian" / the reader-facing
//      label "Custodian of Record" are allowed), and
//   2. any `custody*` identifier inside the discovery trees — the physical register's family has no
//      business there.
//
// THE DISCOVERY-TREE SCOPE IS THE RIGHT SCOPE, and this is deliberate rather than provisional. A
// platform-wide version of rule 1 was tried when the review-set model landed and does not work: the
// shipped Custodian register legitimately owns the bare word as its subsystem name in prose ("the
// Custodian register", capitalized), as its package specifier (`@magna-carta/custodian`), and as its
// route and section slug (`/custodian`) — none of which is a defect and none of which a line-level
// regex can tell apart from an identifier. Widening it would have meant renaming a shipped subsystem
// for no defect, or carrying so many exemptions that the gate would stop biting. What the rule
// actually has to prevent is a bare `custodian` meaning DISCOVERY'S attribution, and that lives in
// the discovery trees, where the register's name is never written and the scan is absolute.
//
// Run: `pnpm run lint:custodian-vocabulary`. CI runs it as a governance gate beside
// lint:process-refs, whose shape this follows.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);

// The trees the discovery vocabulary binds in. Paths are repo-relative with forward slashes.
const DISCOVERY_TREES = [
  "crates/discovery-core",
  "containers/discovery",
  "apps/discovery-worker",
  "packages/discovery",
];

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".svelte",
  ".rs",
  ".sql",
  ".toml",
]);

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".claude",
  "dist",
  "build",
  "target",
  // Emitted declarations from `tsc -b`. Linting generated output would report a violation at a line
  // nobody wrote, in a file the fix does not live in.
  ".tsbuild",
  ".svelte-kit",
  ".wrangler",
  ".vite",
]);

// A `custodian` that is neither preceded by `record` nor followed by `of record` — anything else is
// bare. The lookbehind covers every casing and joiner the platform writes: `recordCustodian`,
// `record_custodian`, the prose "record custodian" (also "Record custodian" opening a sentence), and
// the hyphenated adjectival "per-record-custodian". The lookahead covers the reader-facing label the
// owner named, "Custodian of Record", wherever a person will read it. Plurals need neither arm —
// "custodians" fails the trailing word boundary and was never matched.
const BARE_CUSTODIAN = /(?<!record[ _-]?)\bcustodian\b(?![ _-]of[ _-]record\b)/i;

// The physical register's identifier family, which must never appear in a discovery tree. Matched
// with a word boundary before it so `recordCustody…` (which does not exist, and should not) would
// still be caught, while an ordinary word ending in "custody" cannot produce a false hit.
const CUSTODY_FAMILY = /\bcustody[A-Za-z_]/;

// The scan self-tests before it scans, the way lint-licenses.mjs's classifier does. A vocabulary
// gate that silently stopped matching would read as a permanently green check while the very thing
// it exists to prevent walked in — so the patterns are proven to BITE on known-bad lines and to stay
// quiet on the permitted forms, on every run, and a logic regression fails loudly here instead.
const SELF_TEST = [
  // [line, should the bare-custodian rule fire, should the custody* rule fire]
  ["const custodian = load.custodian;", true, false],
  ["pub struct Custodian { name: String }", true, false],
  ["/// whose custodian held this document", true, false],
  ['case "custodian":', true, false],
  ["const recordCustodian = load.recordCustodian;", false, false],
  ["pub struct RecordCustodian { display_name: String }", false, false],
  ["/// the record custodian this document was collected from", false, false],
  ["record_custodian_id TEXT NOT NULL", false, false],
  ["/// one zip per-record-custodian", false, false],
  // The reader-facing label, in the shapes a person actually meets it in.
  ['title: "Custodian of Record",', false, false],
  ['detail: "No such Custodian of Record in this firm."', false, false],
  ["/// the Custodian of Record this document is attributed to", false, false],
  // …and the near-misses it must not license. Only the full phrase passes.
  ["const custodian = ofRecord;", true, false],
  ["/// the custodian of the estate", true, false],
  ["const packet = custodyPacket(id);", false, true],
  ["custody_item_id TEXT", false, true],
  ["const owner = custodyOwner;", false, true],
  ["const holder = safekeeping;", false, false],
];
const selfTestFailures = SELF_TEST.filter(
  ([line, expectBare, expectFamily]) =>
    BARE_CUSTODIAN.test(line) !== expectBare || CUSTODY_FAMILY.test(line) !== expectFamily,
);
if (selfTestFailures.length > 0) {
  console.error(
    "\nlint-custodian-vocabulary: the scan's own patterns no longer match what they must.\n",
  );
  for (const [line, expectBare, expectFamily] of selfTestFailures) {
    console.error(
      `  ${JSON.stringify(line)}\n    bare custodian: expected ${expectBare}, got ${BARE_CUSTODIAN.test(line)}` +
        `\n    custody* family: expected ${expectFamily}, got ${CUSTODY_FAMILY.test(line)}`,
    );
  }
  process.exit(1);
}

const files = [];
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRECTORIES.has(name)) walk(full);
      continue;
    }
    files.push(full);
  }
}
for (const tree of DISCOVERY_TREES) {
  const full = join(ROOT, tree);
  try {
    if (statSync(full).isDirectory()) walk(full);
  } catch {
    // A tree that does not exist yet is not a failure — the areas land across several slices, and a
    // scan that demanded all of them would fail on the first one to arrive.
  }
}

const offenders = [];
for (const file of files) {
  if (file === SELF) continue;
  const name = basename(file);
  const extension = name.slice(name.lastIndexOf("."));
  if (!CODE_EXTENSIONS.has(extension)) continue;

  const relativePath = relative(ROOT, file).split(sep).join("/");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (BARE_CUSTODIAN.test(line)) {
      offenders.push(
        `  ${relativePath}:${index + 1}  [bare custodian]  ${line.trim()}\n` +
          `    write "record custodian" / recordCustodian / record_custodian — always two words.`,
      );
    }
    if (CUSTODY_FAMILY.test(line)) {
      offenders.push(
        `  ${relativePath}:${index + 1}  [custody* in discovery]  ${line.trim()}\n` +
          `    the custody* family belongs to the Custodian register (packages/custodian), not to discovery.`,
      );
    }
  });
}

if (offenders.length > 0) {
  console.error(
    "\nCustodian vocabulary — the register and the record custodian are two different things.",
  );
  console.error(
    "Discovery says 'record custodian', always two words; the physical register keeps custody*.\n",
  );
  console.error(offenders.join("\n"));
  console.error(`\n${offenders.length} vocabulary violation(s) found.`);
  process.exit(1);
}
console.log(
  `Custodian vocabulary clean across ${files.length} discovery file(s): no bare "custodian", no custody* .`,
);
