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
// WHAT THIS SCANS TODAY. The discovery area, in both directions:
//
//   1. a bare `custodian` identifier inside the discovery trees (only `recordCustodian` /
//      `record_custodian` / `RecordCustodian` / the prose "record custodian" are allowed), and
//   2. any `custody*` identifier inside the discovery trees — the physical register's family has no
//      business there.
//
// The platform-wide half of rule 1 — a bare `custodian` anywhere OUTSIDE packages/custodian — lands
// with the review-set model, which is what introduces the permission keys and route segments that
// would have to move for the whole repo to satisfy it. Widening DISCOVERY_TREES (and dropping the
// tree restriction on rule 1) is the whole change when that happens.
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

// A `custodian` that is NOT preceded by `record` — the only permitted form. The lookbehind covers
// every casing and joiner the platform writes: `recordCustodian`, `record_custodian`, the prose
// "record custodian" (also "Record custodian" opening a sentence or a label), and the hyphenated
// adjectival "per-record-custodian".
const BARE_CUSTODIAN = /(?<!record[ _-]?)\bcustodian\b/i;

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
