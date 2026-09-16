/*
 * Every code area carries its local rules.
 *
 * The root CLAUDE.md says it outright — "each code area carries its own CLAUDE.md for local rules
 * and the domain invariants that apply there" — and thirty of the eighty-five workspace packages
 * and apps have none. The thirty are not the obscure corners. packages/data-access is the home of
 * the firm-scoping golden rule itself: every read in the product goes through it and no query may
 * cross firms, and there is no file beside that code saying so. apps/web is every screen the
 * product has. packages/identifiers, packages/money and packages/pdf are each an invariant with no
 * note beside it.
 *
 * This is a ratchet rather than a wall. The thirty are recorded in baseline.json, which may only
 * shrink: a NEW package must arrive with its note, the existing debt is visible and countable, and
 * an entry the repository has since fixed fails the gate so the register cannot rot into a list of
 * names nobody has re-read. Burning the thirty down is a separate pass and a separate decision;
 * what this stops is the thirty-first.
 *
 * MEASURED, 2026-09-16: 85 workspace packages and apps (apps/, packages/, plugins/ — the same walk
 * tooling/affected-lint/index.mjs does, imported rather than rewritten), 55 with a note, 30
 * without. Of the 55 that exist, 55 open with a title, 55 name their own area in that title, 55
 * state what the area is in prose before anything else, and none carries an unfilled template
 * placeholder — so the four shape rules are clean and carry no debt. Which parts of the template
 * are checked, which are left to review, and the section-by-section counts behind that split are
 * documented at the top of rules.mjs.
 *
 * WHAT THIS DOES NOT CATCH: whether a note is true, current or useful; notes at a finer grain than
 * a package; a note copied from a neighbour and retitled. The full list, with the reasoning, is at
 * the top of rules.mjs.
 *
 * Run: `node tooling/lint-area-notes/index.mjs`. Pure filesystem reads; no install, no build.
 * Record today's debt after fixing some of it: `node tooling/lint-area-notes/index.mjs
 * --update-baseline`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverPackages } from "../affected-lint/index.mjs";
import {
  applyBaseline,
  findAreaNoteProblems,
  findCountMismatches,
  findUnknownRules,
  runSelfTest,
} from "./rules.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE = fileURLToPath(new URL("./baseline.json", import.meta.url));

/** The note a code area carries, at the name the root CLAUDE.md gives it. */
const NOTE = "CLAUDE.md";

/** Read every workspace package, with its note when it has one. */
export function collectAreas(root) {
  const areas = [];
  for (const [name, member] of discoverPackages(root)) {
    const notePath = path.join(root, member.dir, NOTE);
    areas.push({
      directory: member.dir,
      name,
      note: existsSync(notePath) ? readFileSync(notePath, "utf8") : undefined,
    });
  }
  return areas.toSorted((a, b) => a.directory.localeCompare(b.directory));
}

/**
 * Rewrite the register, keeping every rule's prose `note` and its order.
 *
 * The prose is the part a reviewer reads, so it survives an update; the entries and the count are
 * the part the repository decides, so they are replaced wholesale.
 */
export function nextBaseline(previous, problems) {
  const byRule = new Map();
  for (const found of problems) {
    byRule.set(found.rule, [...(byRule.get(found.rule) ?? []), found.directory]);
  }
  const next = {};
  for (const [rule, register] of Object.entries(previous)) {
    const entries = (byRule.get(rule) ?? []).toSorted((a, b) => a.localeCompare(b));
    byRule.delete(rule);
    next[rule] = { note: register.note, count: entries.length, entries };
  }
  for (const [rule, directories] of [...byRule].toSorted(([one], [two]) =>
    one.localeCompare(two),
  )) {
    next[rule] = {
      note: "Recorded by --update-baseline. Say here what this debt is and what clears it.",
      count: directories.length,
      entries: directories.toSorted((a, b) => a.localeCompare(b)),
    };
  }
  return next;
}

function main() {
  const selfTestFailures = runSelfTest();
  if (selfTestFailures.length > 0) {
    console.error("\nlint:area-notes: the gate's own rules no longer do what they must.\n");
    for (const failure of selfTestFailures) {
      console.error(
        `  ${failure.name}\n` +
          `    expected: ${JSON.stringify(failure.wanted)}\n` +
          `    got:      ${JSON.stringify(failure.found)}`,
      );
    }
    process.exit(1);
  }

  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const unknownRules = findUnknownRules(baseline);
  if (unknownRules.length > 0) {
    console.error(
      `\nlint:area-notes: baseline.json records debt against ${unknownRules.join(", ")}, which ` +
        "this gate does not run. A register against a rule that no longer exists can never fail " +
        "and never shrink — delete it, or restore the rule.\n",
    );
    process.exit(1);
  }
  const mismatches = findCountMismatches(baseline);
  if (mismatches.length > 0) {
    console.error("\nlint:area-notes: a register's count disagrees with its own entries.\n");
    for (const one of mismatches) {
      console.error(
        `  [${one.rule}] count says ${String(one.count)}, entries hold ${String(one.actual)}`,
      );
    }
    console.error(
      "\n  The count is the integer a reviewer reads in a diff. Either half could be the mistake, " +
        "so this is refused rather than reconciled: fix the one that is wrong, or re-record with " +
        "--update-baseline.\n",
    );
    process.exit(1);
  }

  const areas = collectAreas(ROOT);
  // Vacuity guard: a walk that finds no packages is a broken gate, not a clean repository.
  if (areas.length === 0) {
    console.error(
      "\nlint:area-notes: found no workspace packages at all. The package walk comes from " +
        "tooling/affected-lint/index.mjs; if the workspace layout moved, move that walk with it " +
        "rather than letting this gate pass by scanning nothing.\n",
    );
    process.exit(1);
  }

  const problems = findAreaNoteProblems(areas);

  if (process.argv.includes("--update-baseline")) {
    const next = nextBaseline(baseline, problems);
    writeFileSync(BASELINE, `${JSON.stringify(next, undefined, 2)}\n`);
    const total = Object.values(next).reduce((sum, register) => sum + register.count, 0);
    console.log(
      `lint:area-notes: baseline.json re-recorded — ${String(total)} carried finding(s) across ` +
        `${String(Object.keys(next).length)} rule(s). Read the diff before committing: this ` +
        "register may only shrink. Then run `pnpm fix:scoped` over it — the repository's formatter " +
        "owns the register's layout, and this writer only owns its contents.",
    );
    return;
  }

  const { carried, added, fixed } = applyBaseline(problems, baseline);

  if (added.length > 0) {
    console.error("\nlint:area-notes: a code area does not carry its local rules.\n");
    for (const one of added) {
      console.error(`  [${one.rule}] ${one.directory}/${NOTE}\n      ${one.detail}.\n`);
    }
    console.error(
      "  The template is docs/conventions/area-claude-template.md. A note is LOCAL: what this " +
        "area does and where its boundary is, the invariants from docs/conventions/invariants.md " +
        "that bind here and how they show up in the code, and the traps. Cross-cutting standards " +
        "stay in docs/conventions/ and are linked, never restated.\n",
    );
  }

  if (fixed.length > 0) {
    const byRule = new Map();
    for (const one of fixed) byRule.set(one.rule, [...(byRule.get(one.rule) ?? []), one.directory]);
    console.error("\nlint:area-notes: the baseline names debt the repository no longer has.\n");
    for (const [rule, directories] of [...byRule].toSorted(([one], [two]) =>
      one.localeCompare(two),
    )) {
      const register = baseline[rule];
      const remaining = register.count - directories.length;
      console.error(
        `  [${rule}] set "count" to ${String(remaining)} and delete ${String(directories.length)} ` +
          `entr${directories.length === 1 ? "y" : "ies"}:`,
      );
      for (const directory of directories) console.error(`      ${directory}`);
    }
    console.error(
      "\n  The register only shrinks, and a stale entry turns it into a list of names nobody has " +
        "re-read. `node tooling/lint-area-notes/index.mjs --update-baseline` does both edits.\n",
    );
  }

  if (added.length > 0 || fixed.length > 0) process.exit(1);

  const withNote = areas.length - carried.filter((one) => one.rule === "missing-note").length;
  console.log(
    `lint:area-notes: ${String(withNote)} of ${String(areas.length)} workspace package(s) carry a ` +
      `${NOTE}; each one opens with a title naming its own area and says what that area is before ` +
      `anything else. ${String(carried.length)} carried finding(s) in baseline.json, none added.`,
  );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
