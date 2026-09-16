/*
 * The rules of the catalog-coverage gate, and why each one exists. The runner is index.mjs; every
 * decision here is a pure function over collected facts, so it can be unit-tested without a
 * repository and index.test.mjs can drive the same fixtures the gate self-tests against.
 *
 * THE BOUNDARY — WHAT "A COMPONENT" IS HERE, AND WHY IT IS NOT A FILE.
 *
 * packages/design-system/src holds 329 `.svelte` files against 91 stories, and that ratio is not
 * the finding it looks like. 235 of the 329 are under src/lib (the rest are the stories and their
 * support components), and of those 229 are exported from somewhere — because a compound component
 * exports its parts by design: DataTable alone exports sixteen `.svelte` files (Root, Grid, Header,
 * Body, Row, Head, Cell, Caption, …) and they are the namespace a consumer writes
 * `<DataTable.Cell>` against. Only 56 of the 229 are imported by a story directly. A per-FILE rule
 * would therefore open with a 173-entry baseline, nearly all of it parts that the family's own
 * story already photographs, and a baseline that size is a form people fill in rather than a debt
 * people pay.
 *
 * So the unit is the COMPONENT FAMILY: a directory directly under
 * packages/design-system/src/lib/components/ that holds at least one `.svelte` file. It is the unit
 * the package's own `exports` map exposes (83 of the 84 directories are named there verbatim, one
 * subpath each), the unit a Storybook title names, and the unit a person browsing the catalog can
 * actually find. 83 directories hold a component; item-drag is the 84th and holds none — it is a
 * drag behaviour in `.ts`, so there is nothing for a screenshot to show and it is out of scope by
 * construction rather than by exception.
 *
 * Deliberately outside the boundary, each for a stated reason:
 *   - the individual `.svelte` files inside a family (above);
 *   - src/lib/internal/, which the package declares internal in its own export subpaths
 *     (./internal/*) and which holds one component, the virtual list;
 *   - src/lib/palette and src/lib/status-register, which are token and register galleries rather
 *     than components — both have stories anyway;
 *   - src/stories/support/, which is story scaffolding, not product;
 *   - every `.svelte` file outside the design system. apps/web screens are reviewed on the deployed
 *     site, not in the catalog.
 *
 * THE THREE LEGS OF "PROPERLY COVERED". docs/conventions/testing.md: a component is properly
 * covered when it has a catalog entry, behavior tests, and is under visual regression.
 *
 *   1. CATALOG ENTRY — rule `catalog-entry`, measured: 79 of 83 families have one, 4 do not.
 *   2. BEHAVIOUR TESTS — rule `behaviour-test`. Cheaply checkable, but not as "a test file named
 *      after the component": packages/design-system/test/ holds 51 test files and they reach only
 *      21 of the 83 families, because the design system's behaviour assertions mostly live in the
 *      stories themselves — 87 of the 91 stories import `storybook/test`, and @storybook/addon-vitest
 *      runs each of those as a browser-mode component test (vitest.storybook.config.ts). So a family
 *      is behaviour-checked when its own catalog entry carries assertions OR a file under test/
 *      reaches into it, and the rule says which of the two it found.
 *   3. VISUAL REGRESSION — NOT per-component checkable, and this gate does not pretend it is.
 *      packages/design-system/visual-regression/catalog.spec.ts holds no component list to check
 *      against: its matrix is built at run time from storybook-static/index.json crossed with
 *      .storybook/catalog-matrix.ts, so a new story is photographed on the next run with no edit
 *      anywhere. That makes leg 3 a consequence of leg 1 — and makes the derivation itself the only
 *      thing worth gating, which is rule `visual-regression-derived` below. What is NOT checked:
 *      whether a baseline PNG exists for a story (visual-regression/baselines is not committed in
 *      this checkout, and the suite skips itself by design when it is absent), and whether the
 *      photographed state is a state worth photographing.
 *
 * WHAT THIS DOES NOT CATCH, stated plainly, because a gate that claims more than it delivers is
 * worse than none:
 *
 *   - Whether a story shows the component in the states that matter. A one-state story covers a
 *     family as far as this gate can see. The variant axes are a review question.
 *   - Whether the assertions in a `play` block assert anything. The rule reads the
 *     `storybook/test` import, not what was done with it.
 *   - A family whose story renders a stand-in rather than the component — the resolution follows
 *     `defineMeta({ component })` and the file name, both of which a determined author can point
 *     at something else.
 *   - A second implementation of a surface. That is tooling/lint-one-ui's whole subject; this gate
 *     is the other half of the same argument, which is that a component nobody can see in the
 *     catalog is a component the next person builds again.
 *   - Components outside the design system, and screens. Neither is in the catalog by design.
 */

/** Where the component families live, relative to the design-system package. */
export const FAMILY_HOME = "src/lib/components";

/** The import that marks a story as carrying interaction assertions, run by @storybook/addon-vitest. */
const ASSERTION_IMPORT = /from\s+["']storybook\/test["']/;

/** Any specifier that reaches into a component family, however many `../` it opens with. */
const FAMILY_IN_SPECIFIER = /(?:^|\/)lib\/components\/([^/]+)(?:\/|$)/;

const problem = (rule, family, detail) => ({ rule, family, detail });

/** The family a module specifier reaches into, or undefined when it reaches somewhere else. */
export function familyInSpecifier(specifier) {
  return FAMILY_IN_SPECIFIER.exec(specifier)?.[1];
}

/** Every module specifier a source file imports from, in source order. */
export function specifiersOf(source) {
  return [...source.matchAll(/["'](\.{1,2}\/[^"']+|@magna-carta\/[^"']+)["']/g)].map(
    (match) => match[1],
  );
}

/**
 * The binding an import clause introduces, so `defineMeta({ component: X })` can be traced to the
 * file X came from. Default imports, namespace imports and named imports (with or without `as`)
 * all bind a name that a meta can point at, and all three are used in this catalog.
 */
export function importBindings(source) {
  const bindings = new Map();
  for (const match of source.matchAll(/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g)) {
    const [, clause, specifier] = match;
    const namespace = /^\*\s+as\s+([A-Za-z0-9_$]+)$/.exec(clause.trim());
    if (namespace !== null) {
      bindings.set(namespace[1], specifier);
      continue;
    }
    const byDefault = /^([A-Za-z0-9_$]+)\s*(?:,|$)/.exec(clause.trim());
    if (byDefault !== null) bindings.set(byDefault[1], specifier);
    const named = /\{([\s\S]*)\}/.exec(clause);
    if (named !== null) {
      for (const part of named[1].split(",")) {
        const name = part
          .trim()
          .split(/\s+as\s+/)
          .at(-1)
          ?.trim();
        if (name !== undefined && name !== "") bindings.set(name, specifier);
      }
    }
  }
  return bindings;
}

/**
 * Which family a story is ABOUT — its own catalog entry, not a component it happens to render.
 *
 * Two signals, in this order. The file name (`top-bar.stories.svelte` is TopBar's entry) settles
 * most of the catalog on its own. Where it does not, `defineMeta({ component })` is traced back
 * through the story's imports to the file it came from. Both are deliberate author statements;
 * neither is an incidental import.
 *
 * INCIDENTAL IMPORTS ARE NOT CREDITED, and that is the whole reason this is stricter than it could
 * be. Crediting any story that imports from a family raises coverage from 79 of 83 to 80 — the
 * family it adds is field-label, which the TopBar and Form stories render inside their own
 * compositions and which has no entry of its own anywhere in the catalog. Rendered somewhere is
 * enough for a screenshot to change when it regresses; it is not enough for a person to FIND the
 * component, and not finding it is how the second implementation gets built.
 */
export function storyFamily(story, families) {
  if (families.includes(story.base)) return story.base;
  const named = /defineMeta\(\s*\{[\s\S]*?\bcomponent:\s*([A-Za-z0-9_$]+)/.exec(story.source);
  if (named === null) return undefined;
  const specifier = importBindings(story.source).get(named[1]);
  if (specifier === undefined) return undefined;
  const family = familyInSpecifier(specifier);
  return family !== undefined && families.includes(family) ? family : undefined;
}

/** True when a story carries interaction assertions — a `play` block driven by `storybook/test`. */
export function storyAsserts(story) {
  return ASSERTION_IMPORT.test(story.source);
}

/** Every family a test file reaches into, by its imports. */
export function familiesUnderTest(tests, families) {
  const reached = new Map();
  for (const test of tests) {
    for (const specifier of specifiersOf(test.source)) {
      const family = familyInSpecifier(specifier);
      if (family === undefined || !families.includes(family)) continue;
      reached.set(family, [...(reached.get(family) ?? []), test.file]);
    }
  }
  return reached;
}

// --- rule: every component family has a catalog entry of its own --------------------------------

/*
 * The catalog is not paperwork. It is the review surface the visual-regression baselines
 * photograph, and it is the one place a person can look before building a surface to find out that
 * the surface already exists. A family with no entry is invisible to both, which makes it the
 * cheapest possible way to end up with two implementations of the same thing — the defect
 * tooling/lint-one-ui exists to catch AFTER it has been written. This catches the condition that
 * invites it.
 */
export function findFamiliesWithoutEntry(families, stories) {
  const owned = new Set();
  for (const story of stories) {
    const family = storyFamily(story, families);
    if (family !== undefined) owned.add(family);
  }
  return families
    .filter((family) => !owned.has(family))
    .map((family) =>
      problem(
        "catalog-entry",
        family,
        `has no catalog entry of its own. Add packages/design-system/src/stories/${family}` +
          ".stories.svelte with a `defineMeta` title and the states that matter, so the component " +
          "is reviewable, photographed by the visual-regression sweep, and findable by the next " +
          "person before they build it again",
      ),
    );
}

// --- rule: every family's catalog entry asserts its behaviour -----------------------------------

/*
 * The second leg. A story that only draws is a picture; a story that drives its component and
 * asserts is a component test, and in this package it is the usual one — 87 of 91 stories import
 * `storybook/test` and run in headless Chromium through @storybook/addon-vitest. A family whose
 * only story draws, and which no file under test/ reaches, has appearance coverage and no
 * behaviour coverage at all, which is exactly the half of "properly covered" that a screenshot
 * cannot supply.
 *
 * A family with no entry at all is NOT reported here. It is already reported by `catalog-entry`,
 * and reporting the same absence twice makes a list of two problems out of one.
 */
export function findFamiliesWithoutBehaviour(families, stories, tests) {
  const asserted = new Set();
  const entries = new Set();
  for (const story of stories) {
    const family = storyFamily(story, families);
    if (family === undefined) continue;
    entries.add(family);
    if (storyAsserts(story)) asserted.add(family);
  }
  const tested = familiesUnderTest(tests, families);
  return families
    .filter((family) => entries.has(family) && !asserted.has(family) && !tested.has(family))
    .map((family) =>
      problem(
        "behaviour-test",
        family,
        "has a catalog entry that only draws it: no `play` block importing `storybook/test`, and " +
          "no file under packages/design-system/test/ reaches into it. Drive the component in its " +
          "story and assert what it did, or add the unit test — a screenshot cannot tell a " +
          "component that responds from one that only looks right",
      ),
    );
}

// --- rule: the visual-regression sweep still derives its matrix from the catalog -----------------

/*
 * The third leg is a consequence of the first, and this is the rule that keeps it one.
 *
 * visual-regression/catalog.spec.ts photographs every story in storybook-static/index.json crossed
 * with every theme and mode in .storybook/catalog-matrix.ts. Nothing enumerates components, which
 * is why "has a story" IS "is under visual regression" and why this gate can check leg 3 by
 * checking leg 1. The day somebody replaces that derivation with a hand-written list of story ids,
 * the sentence above quietly stops being true and a new story silently stops being photographed —
 * so the derivation is what is asserted, not the components.
 */
export function findVisualRegressionDrift(spec) {
  if (spec === undefined) {
    return [
      problem(
        "visual-regression-derived",
        "visual-regression/catalog.spec.ts",
        "is missing. It is the sweep that photographs every story in every theme and mode, and " +
          "this gate's claim that a catalog entry is also visual-regression coverage rests on it; " +
          "if it moved, move this check with it",
      ),
    ];
  }
  const derivesFromIndex = /index\.json/.test(spec) && /\bentries\b/.test(spec);
  if (derivesFromIndex) return [];
  return [
    problem(
      "visual-regression-derived",
      "visual-regression/catalog.spec.ts",
      "no longer builds its matrix from the static build's index.json. That derivation is what " +
        "makes a new story photographed automatically, and it is the only reason this gate treats " +
        "a catalog entry as visual-regression coverage. Restore it, or this gate is overstating " +
        "what it checks",
    ),
  ];
}

/** Every rule name, so a register naming a rule the gate no longer runs can be refused. */
export const RULE_NAMES = ["catalog-entry", "behaviour-test", "visual-regression-derived"];

/** Run every rule over the collected catalog. */
export function findCoverageProblems({ families, stories, tests, visualRegressionSpec }) {
  return [
    ...findFamiliesWithoutEntry(families, stories),
    ...findFamiliesWithoutBehaviour(families, stories, tests),
    ...findVisualRegressionDrift(visualRegressionSpec),
  ].toSorted((a, b) => a.rule.localeCompare(b.rule) || a.family.localeCompare(b.family));
}

/**
 * Split findings against the committed debt register. `carried` is debt that is still there and is
 * not a failure; `added` is new debt and is; `fixed` is an entry the register still names and the
 * repository no longer has, which is a failure in the other direction — a register that keeps names
 * nobody has re-read stops being a debt list and becomes a wall.
 */
export function applyBaseline(problems, baseline) {
  const carried = [];
  const added = [];
  const seen = new Set();
  for (const found of problems) {
    if ((baseline[found.rule]?.entries ?? []).includes(found.family)) {
      carried.push(found);
      seen.add(`${found.rule}\t${found.family}`);
    } else {
      added.push(found);
    }
  }
  const fixed = [];
  for (const [rule, register] of Object.entries(baseline)) {
    for (const family of register.entries ?? []) {
      if (!seen.has(`${rule}\t${family}`)) fixed.push({ rule, family });
    }
  }
  return { carried, added, fixed: fixed.toSorted((a, b) => a.family.localeCompare(b.family)) };
}

/**
 * The register's `count` against its own entries.
 *
 * The count is a checked redundancy, not a second source of truth: it is the integer a reviewer
 * reads in a diff, and the one the failure message names when the debt drops, so tightening the
 * gate is a one-integer edit plus the lines it accounts for. A register whose count and entries
 * disagree is refused rather than reconciled, because either half could be the mistake.
 */
export function findCountMismatches(baseline) {
  const mismatched = [];
  for (const [rule, register] of Object.entries(baseline)) {
    const entries = register.entries ?? [];
    if (register.count !== entries.length) {
      mismatched.push({ rule, count: register.count, actual: entries.length });
    }
  }
  return mismatched;
}

/** Registers naming a rule this gate no longer runs — dead weight that would never fail. */
export function findUnknownRules(baseline) {
  return Object.keys(baseline)
    .filter((rule) => !RULE_NAMES.includes(rule))
    .toSorted((a, b) => a.localeCompare(b));
}

const story = (base, source) => ({ file: `src/stories/${base}.stories.svelte`, base, source });
const derivedSpec =
  "const indexPath = path.join(staticBuildDirectory, 'index.json');\n" +
  "const storybookIndex = JSON.parse(readFileSync(indexPath, 'utf8'));\n" +
  "const stories = Object.values(storybookIndex.entries).filter((e) => e.type === 'story');\n";

/**
 * The fixtures the gate self-tests against on every invocation, and that index.test.mjs drives
 * through the same entry point. Each is a shape this catalog actually holds or actually invites.
 */
export const SELF_TEST = [
  {
    name: "a family whose story is named after it has its catalog entry",
    input: {
      families: ["top-bar"],
      stories: [story("top-bar", "import Root from '../lib/components/top-bar/top-bar.svelte';")],
      tests: [],
      visualRegressionSpec: derivedSpec,
    },
    expect: ["behaviour-test"],
  },
  {
    name: "a family with no story at all is reported once, on the entry rule only",
    input: {
      families: ["folder-glyph"],
      stories: [],
      tests: [],
      visualRegressionSpec: derivedSpec,
    },
    expect: ["catalog-entry"],
  },
  {
    name: "a story named differently still claims its family through defineMeta's component",
    input: {
      families: ["maturity"],
      stories: [
        story(
          "maturity-badge",
          "import Badge from '../lib/components/maturity/maturity-badge.svelte';\n" +
            "import { expect } from 'storybook/test';\n" +
            "const { Story } = defineMeta({ title: 'Status/Maturity', component: Badge });",
        ),
      ],
      tests: [],
      visualRegressionSpec: derivedSpec,
    },
    expect: [],
  },
  {
    name: "a namespace import is traced too — `import * as TopBar` then component: TopBar.Root",
    input: {
      families: ["record-window"],
      stories: [
        story(
          "record-chain",
          "import * as RecordWindow from '../lib/components/record-window/index.ts';\n" +
            "import { expect } from 'storybook/test';\n" +
            "const { Story } = defineMeta({ component: RecordWindow });",
        ),
      ],
      tests: [],
      visualRegressionSpec: derivedSpec,
    },
    expect: [],
  },
  {
    name: "rendering a family inside another family's story is not that family's catalog entry",
    input: {
      families: ["field-label", "form"],
      stories: [
        story(
          "form",
          "import FieldLabel from '../lib/components/field-label/field-label.svelte';\n" +
            "import Root from '../lib/components/form/form.svelte';\n" +
            "import { expect } from 'storybook/test';\n" +
            "const { Story } = defineMeta({ component: Root });",
        ),
      ],
      tests: [],
      visualRegressionSpec: derivedSpec,
    },
    expect: ["catalog-entry"],
  },
  {
    name: "a story that only draws has no behaviour coverage",
    input: {
      families: ["design-tokens-family"],
      stories: [
        story(
          "design-tokens-family",
          "import Root from '../lib/components/design-tokens-family/root.svelte';",
        ),
      ],
      tests: [],
      visualRegressionSpec: derivedSpec,
    },
    expect: ["behaviour-test"],
  },
  {
    name: "a unit test under test/ covers behaviour where the story does not",
    input: {
      families: ["print-sheet"],
      stories: [
        story(
          "print-sheet",
          "import Root from '../lib/components/print-sheet/print-sheet.svelte';",
        ),
      ],
      tests: [
        {
          file: "test/print-sheet.test.ts",
          source: "import { project } from '../src/lib/components/print-sheet/projection.ts';",
        },
      ],
      visualRegressionSpec: derivedSpec,
    },
    expect: [],
  },
  {
    name: "a test naming a family it does not import does not cover it",
    input: {
      families: ["toast"],
      stories: [story("toast", "import Root from '../lib/components/toast/toaster.svelte';")],
      tests: [{ file: "test/toast.test.ts", source: "// toast is mentioned but nothing imported" }],
      visualRegressionSpec: derivedSpec,
    },
    expect: ["behaviour-test"],
  },
  {
    name: "a visual-regression sweep with a hand-written story list no longer derives from the catalog",
    input: {
      families: [],
      stories: [],
      tests: [],
      visualRegressionSpec: "const stories = ['button--default', 'badge--tones'];",
    },
    expect: ["visual-regression-derived"],
  },
  {
    name: "a missing visual-regression sweep is a finding, not a silent pass",
    input: { families: [], stories: [], tests: [], visualRegressionSpec: undefined },
    expect: ["visual-regression-derived"],
  },
];

/** The gate's own rules, checked against their fixtures on every invocation. */
export function runSelfTest() {
  const failures = [];
  for (const { name, input, expect } of SELF_TEST) {
    const found = findCoverageProblems(input)
      .map((one) => one.rule)
      .toSorted((one, two) => one.localeCompare(two));
    const wanted = [...expect].toSorted((one, two) => one.localeCompare(two));
    if (JSON.stringify(found) !== JSON.stringify(wanted)) failures.push({ name, found, wanted });
  }
  const mechanics = [
    {
      name: "the baseline carries debt forward and refuses new debt",
      check: () => {
        const { carried, added, fixed } = applyBaseline(
          [
            { rule: "catalog-entry", family: "known", detail: "" },
            { rule: "catalog-entry", family: "fresh", detail: "" },
          ],
          { "catalog-entry": { count: 1, entries: ["known"] } },
        );
        return carried.length === 1 && added.length === 1 && fixed.length === 0;
      },
    },
    {
      name: "the baseline reports an entry the catalog has since covered",
      check: () =>
        applyBaseline([], { "catalog-entry": { count: 1, entries: ["mended"] } }).fixed.length ===
        1,
    },
    {
      name: "a register whose count disagrees with its entries is refused",
      check: () =>
        findCountMismatches({ "catalog-entry": { count: 7, entries: ["one"] } }).length === 1,
    },
    {
      name: "a register naming a rule this gate no longer runs is refused",
      check: () => findUnknownRules({ "retired-rule": { count: 0, entries: [] } }).length === 1,
    },
  ];
  for (const { name, check } of mechanics) {
    if (!check()) failures.push({ name, found: ["false"], wanted: ["true"] });
  }
  return failures;
}
