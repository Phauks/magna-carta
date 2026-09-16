/*
 * A component the catalog cannot see.
 *
 * docs/conventions/testing.md sets the bar: a component is properly covered when it has a catalog
 * entry, behavior tests, and is under visual regression. Nothing checked any of the three.
 * packages/design-system/src holds 329 `.svelte` files against 91 stories, and while that ratio is
 * not the finding it looks like (the split, and the unit this gate actually uses, are argued at the
 * top of rules.mjs), the gap underneath it is real: four component families have no catalog entry
 * of their own, which means four shared surfaces that no screenshot photographs, no reviewer sees,
 * and nobody about to build a fifth can find.
 *
 * That last part is the point, and it is the argument tooling/lint-one-ui opens with, taken one
 * step earlier. A second implementation of a shared surface is the most expensive defect this
 * product can ship and the quietest. lint-one-ui catches the second implementation once it has been
 * written. This catches the condition that invites it — a component nobody can find is a component
 * the next person builds again, in good faith, having looked.
 *
 * MEASURED, 2026-09-16, packages/design-system:
 *   - 84 directories under src/lib/components; 83 hold at least one `.svelte` file and are the
 *     families this gate reads. item-drag holds none (a drag behaviour in `.ts`) and is out of
 *     scope by construction.
 *   - 91 stories. 79 families have a catalog entry of their own; 4 do not — field-label,
 *     folder-glyph, record-reference, service-marks. Four further stories (app-shell,
 *     design-tokens, focus-ring-proposal, palette-swatches) belong to no family, which is correct:
 *     they are compositions and token galleries.
 *   - 87 of the 91 stories carry interaction assertions (`storybook/test`, run as browser-mode
 *     component tests by @storybook/addon-vitest). test/ holds 51 unit tests, which reach 21
 *     families. Between them, every family that has an entry has behaviour coverage: 0 findings.
 *   - visual-regression/catalog.spec.ts enumerates no components at all — its matrix is
 *     storybook-static/index.json crossed with .storybook/catalog-matrix.ts — so leg 3 follows from
 *     leg 1, and what this gate asserts is that derivation rather than a component list that does
 *     not exist.
 *
 * All three rules are ratchets over baseline.json, which may only shrink: a NEW family must arrive
 * with its entry, the existing debt is visible and countable, and an entry the repository has since
 * covered fails the gate so the register cannot rot into a list of names nobody has re-read.
 *
 * WHAT THIS DOES NOT CATCH: whether a story shows the states that matter; whether a `play` block
 * asserts anything; whether a baseline PNG exists (visual-regression/baselines is not committed
 * here and the suite skips itself when it is absent); a story pointed at a stand-in. The full list,
 * with the reasoning, is at the top of rules.mjs.
 *
 * Run: `node tooling/lint-catalog-coverage/index.mjs`. Pure filesystem reads; no install, no build.
 * Record today's debt after fixing some of it: `node tooling/lint-catalog-coverage/index.mjs
 * --update-baseline`.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FAMILY_HOME,
  applyBaseline,
  findCountMismatches,
  findCoverageProblems,
  findUnknownRules,
  runSelfTest,
} from "./rules.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE = fileURLToPath(new URL("./baseline.json", import.meta.url));

/** The design system: the one package with a catalog. */
export const DESIGN_SYSTEM = "packages/design-system";

/** The catalog's own home, and the unit tests' home, both relative to the package. */
const STORY_HOME = "src/stories";
const TEST_HOME = "test";

/** The sweep whose derivation makes a catalog entry also visual-regression coverage. */
const VISUAL_REGRESSION_SPEC = "visual-regression/catalog.spec.ts";

function walk(directory, found = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(child, found);
    } else {
      found.push(child);
    }
  }
  return found;
}

/** Read the catalog: the families that hold a component, every story, and every unit test. */
export function collectCatalog(root) {
  const packageRoot = path.join(root, DESIGN_SYSTEM);
  const familyRoot = path.join(packageRoot, FAMILY_HOME);
  let directories = [];
  try {
    directories = readdirSync(familyRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    directories = [];
  }
  const families = directories
    .filter((name) => walk(path.join(familyRoot, name)).some((file) => file.endsWith(".svelte")))
    .toSorted((a, b) => a.localeCompare(b));

  const stories = walk(path.join(packageRoot, STORY_HOME))
    .filter((file) => file.endsWith(".stories.svelte"))
    .map((file) => ({
      file: path.relative(packageRoot, file).split(path.sep).join("/"),
      base: path.basename(file).replace(/\.stories\.svelte$/, ""),
      source: readFileSync(file, "utf8"),
    }))
    .toSorted((a, b) => a.file.localeCompare(b.file));

  const tests = walk(path.join(packageRoot, TEST_HOME))
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => ({
      file: path.relative(packageRoot, file).split(path.sep).join("/"),
      source: readFileSync(file, "utf8"),
    }))
    .toSorted((a, b) => a.file.localeCompare(b.file));

  const specPath = path.join(packageRoot, VISUAL_REGRESSION_SPEC);
  return {
    families,
    stories,
    tests,
    visualRegressionSpec: existsSync(specPath) ? readFileSync(specPath, "utf8") : undefined,
  };
}

/**
 * Rewrite the register, keeping every rule's prose `note` and its order. The prose is what a
 * reviewer reads, so it survives an update; the entries and the count are what the repository
 * decides, so they are replaced wholesale.
 */
export function nextBaseline(previous, problems) {
  const byRule = new Map();
  for (const found of problems) {
    byRule.set(found.rule, [...(byRule.get(found.rule) ?? []), found.family]);
  }
  const next = {};
  for (const [rule, register] of Object.entries(previous)) {
    const entries = (byRule.get(rule) ?? []).toSorted((a, b) => a.localeCompare(b));
    byRule.delete(rule);
    next[rule] = { note: register.note, count: entries.length, entries };
  }
  for (const [rule, names] of [...byRule].toSorted(([one], [two]) => one.localeCompare(two))) {
    next[rule] = {
      note: "Recorded by --update-baseline. Say here what this debt is and what clears it.",
      count: names.length,
      entries: names.toSorted((a, b) => a.localeCompare(b)),
    };
  }
  return next;
}

function main() {
  const selfTestFailures = runSelfTest();
  if (selfTestFailures.length > 0) {
    console.error("\nlint:catalog-coverage: the gate's own rules no longer do what they must.\n");
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
      `\nlint:catalog-coverage: baseline.json records debt against ${unknownRules.join(", ")}, ` +
        "which this gate does not run. A register against a rule that no longer exists can never " +
        "fail and never shrink — delete it, or restore the rule.\n",
    );
    process.exit(1);
  }
  const mismatches = findCountMismatches(baseline);
  if (mismatches.length > 0) {
    console.error("\nlint:catalog-coverage: a register's count disagrees with its own entries.\n");
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

  const catalog = collectCatalog(ROOT);
  // Vacuity guard: a sweep that reads no families or no stories is a broken gate, not a covered
  // catalog. Both halves are asserted, because either one going missing passes this gate silently.
  if (catalog.families.length === 0 || catalog.stories.length === 0) {
    console.error(
      `\nlint:catalog-coverage: read ${String(catalog.families.length)} component famil(ies) and ` +
        `${String(catalog.stories.length)} story/stories under ${DESIGN_SYSTEM}. A zero on either ` +
        "side means the catalog moved, not that it is covered — repoint this gate rather than " +
        "letting it pass by scanning nothing.\n",
    );
    process.exit(1);
  }

  const problems = findCoverageProblems(catalog);

  if (process.argv.includes("--update-baseline")) {
    const next = nextBaseline(baseline, problems);
    writeFileSync(BASELINE, `${JSON.stringify(next, undefined, 2)}\n`);
    const total = Object.values(next).reduce((sum, register) => sum + register.count, 0);
    console.log(
      `lint:catalog-coverage: baseline.json re-recorded — ${String(total)} carried finding(s) ` +
        `across ${String(Object.keys(next).length)} rule(s). Read the diff before committing: ` +
        "this register may only shrink. Then run `pnpm fix:scoped` over it — the repository's " +
        "formatter owns the register's layout, and this writer only owns its contents.",
    );
    return;
  }

  const { carried, added, fixed } = applyBaseline(problems, baseline);

  if (added.length > 0) {
    console.error("\nlint:catalog-coverage: a component the catalog cannot see.\n");
    for (const one of added) {
      const where =
        one.rule === "visual-regression-derived"
          ? `${DESIGN_SYSTEM}/${one.family}`
          : `${DESIGN_SYSTEM}/${FAMILY_HOME}/${one.family}`;
      console.error(`  [${one.rule}] ${where}\n      ${one.detail}.\n`);
    }
    console.error(
      "  The bar is docs/conventions/testing.md: a catalog entry, behaviour tests, and visual " +
        "regression. The catalog is the review surface the baselines photograph and the one place " +
        "a person can find a shared surface before building it a second time — which is the defect " +
        "tooling/lint-one-ui catches after the fact.\n",
    );
  }

  if (fixed.length > 0) {
    const byRule = new Map();
    for (const one of fixed) byRule.set(one.rule, [...(byRule.get(one.rule) ?? []), one.family]);
    console.error("\nlint:catalog-coverage: the baseline names debt the catalog no longer has.\n");
    for (const [rule, names] of [...byRule].toSorted(([one], [two]) => one.localeCompare(two))) {
      const remaining = baseline[rule].count - names.length;
      console.error(
        `  [${rule}] set "count" to ${String(remaining)} and delete ${String(names.length)} ` +
          `entr${names.length === 1 ? "y" : "ies"}:`,
      );
      for (const name of names) console.error(`      ${name}`);
    }
    console.error(
      "\n  The register only shrinks, and a stale entry turns it into a list of names nobody has " +
        "re-read. `node tooling/lint-catalog-coverage/index.mjs --update-baseline` does both " +
        "edits.\n",
    );
  }

  if (added.length > 0 || fixed.length > 0) process.exit(1);

  const withoutEntry = carried.filter((one) => one.rule === "catalog-entry").length;
  const total = catalog.families.length;
  console.log(
    `lint:catalog-coverage: ${String(total - withoutEntry)} of ${String(total)} component ` +
      `families have a catalog entry of their own across ${String(catalog.stories.length)} ` +
      "stories; every one of them asserts its behaviour in that entry or under " +
      `${DESIGN_SYSTEM}/${TEST_HOME}; and the visual-regression sweep still photographs whatever ` +
      `the catalog holds. ${String(carried.length)} carried finding(s) in baseline.json, none added.`,
  );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
