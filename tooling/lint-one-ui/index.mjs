/*
 * Fitness function: the shared UI surfaces are ONE component each, and the record window is the
 * shape everyone agreed it is.
 *
 * A second implementation of a shared surface is the most expensive defect this product can ship
 * and the quietest: it renders correctly, it typechecks, it lints, and it reads fine in review. It
 * surfaces a round later, when a correction is applied to one copy and not the other and two
 * screens start disagreeing about something a reader was told was settled. Review does not scale
 * to catching that across dozens of surfaces; a scan does.
 *
 * Eleven rules run here. Their reasoning, and the pure functions that decide them, are in rules.mjs;
 * the registry of what may exist once — and the recorded allowances — are in registry.json.
 *
 * TWO OF THE RULES BORROW THE PRODUCT'S OWN JUDGEMENT rather than restating it. The placeholder
 * rule calls `readsAsFieldName` from the design system, and the status rule reads its words and
 * tones off the status register itself. A second copy of either would be two authorities that
 * disagree the first time one is corrected, which is the exact defect this whole tool exists to
 * stop — so both are imported, and the import failing is a loud failure rather than a quiet skip.
 *
 * WHAT THIS DOES NOT CATCH, stated plainly, because a gate that claims more than it delivers is
 * worse than none:
 *
 *   - "Is this the same BEHAVIOR?" Two surfaces can both use the one component and still disagree
 *     about what it offers. Only tests against the real screens catch that.
 *   - A shell that imports a record's type under an innocuous alias, or takes a domain fact through
 *     a generically named prop, passes the domain scan. The scan reads names, not meanings.
 *   - A hand-composed panel that LOOKS like a registered component but is named something
 *     unrecognizable defeats the registry. Review and the ruling ledgers in docs/conventions/ are
 *     the answer to that one, not this scan.
 *   - The domain scan reads a file's comments for nothing: they are stripped first, deliberately,
 *     so ordinary English ("no matter which tab", "it costs nothing") cannot trip it. A leak that
 *     exists only in a comment is a wording problem, not a duplication problem.
 *   - A dropdown, dialog or glyph assembled at RUNTIME — `createElement("select")`, a scrim whose
 *     inset arrives from a variable, a glyph whose geometry sits in a constant — is invisible to a
 *     text scan. Every rule here reads source, not behaviour.
 *   - A placeholder that is not a literal (`placeholder={hint}`) is not read, and a placeholder
 *     that reads as a field's name but names the WRONG field passes. The predicate answers shape,
 *     never meaning.
 *   - A status word rendered through a locally written mapper is only caught when the file also
 *     spells the register's words out; a mapper keyed on codes alone (`"paid" -> "success"`, with
 *     the label fetched elsewhere) escapes.
 *   - The imperative-DOM rule reads three names. `document.body.append`, `outerHTML`, `insertAdjacentHTML`
 *     and the rest of the imperative surface are not enumerated — the three named are the mockups'
 *     actual idiom, and a list of everything would be noise.
 *   - The two table rules read markup and five named signals. A table built in a module as a markup
 *     string, a sort wired to a plain button with neither the recipe class nor `aria-sort` on it,
 *     and a record list composed from the presentational primitives whose only machinery is its
 *     own selection checkboxes all pass. Whether a primitive-composed list SHOULD be the Grid is a
 *     design question the ledger answers, not a scan; the scan holds the line at "nothing outside
 *     the one table's home writes a table element or re-implements what the Grid carries".
 *   - NO RULE HERE LOOKS FOR A SECOND RECORD WINDOW found by file name. That is the port plan's
 *     rule 2, and it is not built: its structural form is documented as heuristic. It belongs here
 *     when the screens it governs land.
 *   - A violation carried in one of registry.json's ALLOWANCES is not caught, by construction. The
 *     list is printed on every run and an entry that outlives its violation fails — but a rule with
 *     a standing allowance is a rule that is not yet true of this repository, and the run says so.
 *
 * Run: `pnpm run lint:one-ui`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyAllowances,
  exportsName,
  findDomainLeaks,
  findHandBuiltDialogs,
  findFooterSetProblems,
  findHandComposedModals,
  findHandDrawnGlyphs,
  findHandRolledSelects,
  findHeaderSetProblems,
  findImperativeDomUse,
  findInventedStatusTones,
  findPlaceholderProblems,
  findRawTables,
  findRegistryProblems,
  findTableMachinery,
  kebabCase,
  stripReExports,
} from "./rules.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The record window's home, and the file the header set is asserted against. */
const RECORD_WINDOW_HOME = "packages/design-system/src/lib/components/record-window";
const RECORD_WINDOW_SHELL = `${RECORD_WINDOW_HOME}/record-window.svelte`;

/** The action dialog's home, and the file the footer set is asserted against. */
const ACTION_DIALOG_HOME = "packages/design-system/src/lib/components/action-dialog";
const ACTION_DIALOG_SHELL = `${ACTION_DIALOG_HOME}/action-dialog.svelte`;

/** Where a second implementation could be written. */
const SEARCH_ROOTS = ["apps", "packages"];

/** The app's own source, and the design system's — the two halves the port plan governs. */
const APP_SOURCE = "apps/web/src";
const DESIGN_SYSTEM_SOURCE = "packages/design-system/src";

/** The one place a mark is drawn by hand, because it is a mark and not an icon. */
const BRAND_MARK_HOME = "packages/design-system/src/lib/components/brand-mark";

/** The status register's own home, which is allowed to be the status register. */
const STATUS_REGISTER_HOME = "packages/design-system/src/lib/status-register";

/**
 * The ported surfaces, where the mockups' imperative idiom must not survive. `wip` has no directory
 * yet; the walk over a missing root is empty, which is the correct answer until the slice lands.
 */
const PORTED_SURFACES = [
  "apps/web/src/lib/file-manager",
  "apps/web/src/lib/wip",
  "apps/web/src/lib/matters",
];

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".claude",
  ".svelte-kit",
  ".wrangler",
  ".vite",
  ".tsbuild",
  "dist",
  "build",
  "coverage",
  "target",
  "pkg",
  "storybook-static",
  "visual-regression",
]);

/**
 * Storybook stories are demonstration code, and the demonstration is the point: a story's ghost
 * text shows what a placeholder looks like, and its badges show every tone the component has. The
 * rules below are about PRODUCT surfaces, and lint:icon-sizes already draws this same line.
 */
const STORIES = /(?:^|\/)stories\//;

const MODULE_FILE = /\.(?:ts|mts|cts|mjs|cjs|js)$/;

function repositoryPath(absolute) {
  return relative(ROOT, absolute).split(sep).join("/");
}

function walk(directory, found = [], { includeStyles = false } = {}) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found; // a root this checkout legitimately does not have
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walk(path, found, { includeStyles });
      continue;
    }
    const wanted =
      MODULE_FILE.test(entry.name) ||
      entry.name.endsWith(".svelte") ||
      (includeStyles && entry.name.endsWith(".css"));
    if (wanted) found.push(path);
  }
  return found;
}

// --- collect --------------------------------------------------------------------------------

const registry = JSON.parse(
  readFileSync(fileURLToPath(new URL("./registry.json", import.meta.url)), "utf8"),
);
const entries = registry.components ?? [];
if (entries.length === 0) {
  console.error(
    "lint:one-ui: registry.json declares no components — the registry is the whole rule, so an " +
      "empty one means the check is broken rather than the repository being clean.",
  );
  process.exit(1);
}

const problems = [];

// Rule: the record window's header set.
let shellSource = "";
try {
  shellSource = readFileSync(join(ROOT, RECORD_WINDOW_SHELL), "utf8");
} catch {
  problems.push({
    rule: "header-set",
    file: RECORD_WINDOW_SHELL,
    detail:
      "is missing. The record window is the product's one record shell and this is the file its " +
      "header set is asserted against; if it moved, move this check with it",
  });
}
if (shellSource !== "") {
  problems.push(...findHeaderSetProblems(RECORD_WINDOW_SHELL, shellSource));
}

// Rule: the action dialog's footer set. The header set's sibling, and for the same reason — a
// shell's promise is only worth what stops it being quietly rearranged.
let actionDialogSource = "";
try {
  actionDialogSource = readFileSync(join(ROOT, ACTION_DIALOG_SHELL), "utf8");
} catch {
  problems.push({
    rule: "footer-set",
    file: ACTION_DIALOG_SHELL,
    detail:
      "is missing. The action dialog is the product's one shell for an act asked of a reader and " +
      "this is the file its action bar is asserted against; if it moved, move this check with it",
  });
}
if (actionDialogSource !== "") {
  problems.push(...findFooterSetProblems(ACTION_DIALOG_SHELL, actionDialogSource));
}

// Rule: no kind of act inside the action dialog's shell. The same scan the record window gets, and
// the same argument: the moment a shell learns about one kind of thing, the next kind needs its own.
for (const absolute of walk(join(ROOT, ACTION_DIALOG_HOME), [], { includeStyles: true })) {
  const path = repositoryPath(absolute);
  problems.push(...findDomainLeaks(path, readFileSync(absolute, "utf8")));
}

// Rule: no kind of record inside the shell. Every file in its home, stylesheets included — a
// recipe class can name a kind of record as easily as a prop can.
for (const absolute of walk(join(ROOT, RECORD_WINDOW_HOME), [], { includeStyles: true })) {
  const path = repositoryPath(absolute);
  problems.push(...findDomainLeaks(path, readFileSync(absolute, "utf8")));
}

// Rule: the one-implementation registry.
const homesPresent = new Set();
for (const entry of entries) {
  try {
    const stats = statSync(join(ROOT, entry.home));
    if (stats.isDirectory() && readdirSync(join(ROOT, entry.home)).length > 0) {
      homesPresent.add(entry.name);
    }
  } catch {
    // absent; findRegistryProblems decides whether that is a failure or a notice
  }
}

const foreignExports = [];
const allFiles = SEARCH_ROOTS.flatMap((root) => walk(join(ROOT, root)));
for (const absolute of allFiles) {
  const path = repositoryPath(absolute);
  let source;
  for (const entry of entries) {
    if (path.startsWith(`${entry.home}/`)) continue;
    if (path.endsWith(".svelte")) {
      if (basename(path) === `${kebabCase(entry.name)}.svelte`) {
        foreignExports.push({ name: entry.name, file: path });
      }
      continue;
    }
    source ??= stripReExports(readFileSync(absolute, "utf8"));
    if (exportsName(source, entry.name)) foreignExports.push({ name: entry.name, file: path });
  }
}

const { problems: registryProblems, notices } = findRegistryProblems(entries, {
  homesPresent,
  foreignExports,
});
problems.push(...registryProblems);

// --- the authorities the last two rules borrow ------------------------------------------------

/**
 * Load one of the product's own modules and use ITS answer.
 *
 * These are TypeScript, loaded by Node's own type stripping (Node 22.18+ / 23.6+, where it is on by
 * default). If that is not available the rule cannot run, and the honest response is to say so and
 * fail — a rule that quietly skips is a rule that reports nothing forever.
 */
async function authority(modulePath, description) {
  try {
    return await import(pathToFileURL(join(ROOT, modulePath)).href);
  } catch (error) {
    console.error(
      `\nlint:one-ui: could not load ${modulePath}, which is ${description}.\n` +
        `      ${error.message}\n` +
        "      This tool reads the product's own judgement rather than restating it, which means " +
        "loading a\n      TypeScript module from plain Node (type stripping, Node 22.18 or newer). " +
        "If the module moved,\n      move this reference with it.\n",
    );
    process.exit(1);
  }
}

const { readsAsFieldName } = await authority(
  "packages/design-system/src/lib/formatters/placeholder.ts",
  "the one home of what reads as a field's name",
);
const { STATUS_REGISTER } = await authority(
  "packages/design-system/src/lib/status-register/status-register.ts",
  "the one home of every status word, its tone and its meaning",
);

/** The register's own words and its own tones — never a copy of them kept in this tool. */
const statusLabels = Object.values(STATUS_REGISTER).map((entry) => entry.label);
const statusTones = [...new Set(Object.values(STATUS_REGISTER).map((entry) => entry.tone))];

// --- the source sweeps ------------------------------------------------------------------------

const isStory = (path) => STORIES.test(path);
const isSvelte = (path) => path.endsWith(".svelte");

/**
 * Run one rule over one set of roots, and report how many files it actually read.
 *
 * The count is not decoration. A sweep that reads nothing passes forever and says so cheerfully,
 * which is how a scan drifts into vacuity when a directory is renamed — so the caller asserts it,
 * on the same discipline the header-set rule uses when its action group has gone missing.
 */
function sweep(roots, decide, { svelteOnly = true, skipStories = true } = {}) {
  let read = 0;
  for (const root of roots) {
    for (const absolute of walk(join(ROOT, root))) {
      const path = repositoryPath(absolute);
      if (skipStories && isStory(path)) continue;
      if (svelteOnly && !isSvelte(path)) continue;
      read += 1;
      problems.push(...decide(path, readFileSync(absolute, "utf8")));
    }
  }
  return read;
}

/** A sweep that read nothing is a broken check, not a clean repository. */
function mustHaveRead(count, what, roots) {
  if (count > 0) return;
  problems.push({
    rule: "sweep",
    file: roots.join(", "),
    detail:
      `the ${what} sweep read no files at all. That is a broken check rather than a clean ` +
      "repository — the root moved, and this rule has been passing vacuously ever since. Point it " +
      "at where the source lives now",
  });
}

const BOTH_SIDES = [APP_SOURCE, DESIGN_SYSTEM_SOURCE];

// Rule: no hand-rolled select. App screens only — the design system's Select is the one legitimate
// wrapper around the native element, and it lives on the other side of that line.
mustHaveRead(sweep([APP_SOURCE], findHandRolledSelects), "hand-rolled select", [APP_SOURCE]);

// Rule: no raw dialog and no hand-built scrim, on both sides of the line. A second overlay
// mechanism inside the design system would be as expensive as one outside it.
mustHaveRead(sweep(BOTH_SIDES, findHandBuiltDialogs), "hand-built dialog", BOTH_SIDES);

// Rule: every modal surface is one of the two shells. Both sides of the line: a second panel
// assembled inside the design system would be as expensive as one assembled outside it, and the
// shells' own homes exempt themselves. Not svelte-only — the imperative signals are reached for
// from modules as readily as from components.
const modalShellHomes = (registry.modalShells ?? []).map((shell) => shell.home);
if (modalShellHomes.length === 0) {
  problems.push({
    rule: "hand-composed-modal",
    file: "tooling/lint-one-ui/registry.json",
    detail:
      "declares no modal shells. The rule below exempts the homes named there, so an empty list " +
      "means every shell in the product reads as a hand-composed panel — a broken check rather " +
      "than a clean repository",
  });
}
mustHaveRead(
  sweep(BOTH_SIDES, (path, source) => findHandComposedModals(path, source, modalShellHomes), {
    svelteOnly: false,
  }),
  "hand-composed modal",
  BOTH_SIDES,
);

// Rule: no hand-drawn glyphs, except the brand mark, which is a mark rather than an icon.
mustHaveRead(
  sweep(BOTH_SIDES, (path, source) =>
    path.startsWith(`${BRAND_MARK_HOME}/`) ? [] : findHandDrawnGlyphs(path, source),
  ),
  "hand-drawn glyph",
  BOTH_SIDES,
);

// Rule: no raw table, on both sides of the line. The data-table home is the only place `<table>` is
// written, and a second one inside the design system would be as expensive as one outside it.
mustHaveRead(sweep(BOTH_SIDES, findRawTables), "raw table", BOTH_SIDES);

// Rule: no table machinery beside the one table. Modules as well as components, because the headless
// engine is as readily composed in a `.svelte.ts` state module as in a screen.
mustHaveRead(
  sweep(BOTH_SIDES, findTableMachinery, { svelteOnly: false }),
  "table machinery",
  BOTH_SIDES,
);

// Rule: one status register. Modules as well as components — the second registers that exist on
// this repository are `.ts` files holding a label map and a tone map side by side.
mustHaveRead(
  sweep(
    BOTH_SIDES,
    (path, source) =>
      path.startsWith(`${STATUS_REGISTER_HOME}/`)
        ? []
        : findInventedStatusTones(path, source, { labels: statusLabels, tones: statusTones }),
    { svelteOnly: false },
  ),
  "status register",
  BOTH_SIDES,
);

// Rule: every ghost text is the field's name, judged by the product's own predicate.
mustHaveRead(
  sweep(BOTH_SIDES, (path, source) => findPlaceholderProblems(path, source, readsAsFieldName)),
  "placeholder",
  BOTH_SIDES,
);

// Rule: no imperative DOM in the ported surfaces. `wip` has no directory yet, so this asserts only
// that SOME ported surface was read — not every one of them.
mustHaveRead(
  sweep(PORTED_SURFACES, findImperativeDomUse, { svelteOnly: false }),
  "imperative DOM",
  PORTED_SURFACES,
);

// --- the recorded allowances ------------------------------------------------------------------

const { problems: unexcused, excused } = applyAllowances(problems, registry.allowances ?? []);

// --- report ---------------------------------------------------------------------------------

for (const notice of notices) console.log(`lint:one-ui: ${notice}`);

/*
 * The standing allowances, grouped so the count is impossible to miss and the run stays readable.
 * Each one's reason is in registry.json beside it — the point of printing them here is that nobody
 * can believe the repository is clean when it is only excused.
 */
if (excused.length > 0) {
  const byRule = new Map();
  for (const { problem } of excused) {
    const at = problem.line === undefined ? problem.file : `${problem.file}:${problem.line}`;
    byRule.set(problem.rule, [...(byRule.get(problem.rule) ?? []), at]);
  }
  console.log(
    `lint:one-ui: ${excused.length} standing allowance(s) — real violations that predate their ` +
      "rule, recorded in tooling/lint-one-ui/registry.json with the reason each one stands on. " +
      "They are debt, not exemptions: fixing one means deleting its entry, and an entry that " +
      "outlives its violation fails this check.",
  );
  for (const [rule, places] of [...byRule].toSorted()) {
    console.log(`    ${rule} (${places.length}): ${places.join(", ")}`);
  }
}

if (unexcused.length > 0) {
  console.error(
    "\nlint:one-ui: the product's shared UI surfaces are one component each, and one of them is not.\n",
  );
  for (const problem of unexcused) {
    const at = problem.line === undefined ? problem.file : `${problem.file}:${problem.line}`;
    console.error(`  [${problem.rule}] ${at}\n      ${problem.detail}\n`);
  }
  console.error(
    `${unexcused.length} problem(s). The rulings these rules serve live in ` +
      "docs/conventions/design-corrections.md and the per-surface ledgers beside it; the rules " +
      "themselves, and what they deliberately do not catch, are documented in " +
      "tooling/lint-one-ui/index.mjs.",
  );
  process.exit(1);
}

console.log(
  `lint:one-ui: the record window's header set is exactly the kind's menu, Edit, Print, expand, close; the ` +
    "action dialog's bar is exactly the dismissal then the commit; neither shell names a kind of " +
    `thing; ${entries.length} registered component(s) each have one ` +
    "home; no app screen rolls its own select, dialog, scrim, glyph or table; nothing outside the " +
    "one table's home carries table machinery; the ported surfaces reach for no node by id, " +
    "selector or markup string; and every modal surface is one of the declared shells." +
    (excused.length === 0
      ? " No surface outside the register gives a status word a tone, and every literal" +
        " placeholder reads as a field's name."
      : ` Every status tone and every literal placeholder is either the register's own or one of` +
        ` the ${excused.length} allowance(s) above — nothing new.`),
);
console.log(
  "  Not caught: the same component behaving differently on two screens; a domain fact arriving " +
    "through a generically named prop; a look-alike panel nobody named recognizably; a select, " +
    "scrim or glyph assembled at runtime rather than written out; a placeholder that is not a " +
    "literal, or that names the wrong field; a status mapper keyed on codes with its labels " +
    "elsewhere; imperative DOM beyond the three names the mockups actually used; a table built " +
    "as a markup string in a module, a sort wired to a plain button with neither the recipe nor " +
    "`aria-sort`, or a primitive-composed list whose only machinery is its own selection " +
    "checkboxes; and a modal whose parts are aliased on import or chosen at runtime, which is " +
    "why both shells also stamp `data-modal-shell` on the panel they render — a marker a " +
    "rendered-DOM check can require of anything carrying the dialog or alertdialog role.",
);
