/*
 * The rules of the area-note gate, and why each one exists. The runner is index.mjs; every decision
 * here is a pure function over one area's { directory, name, note } so it can be unit-tested without
 * a repository, and so index.test.mjs can drive the same fixtures the gate self-tests against.
 *
 * An "area" here is a workspace package or app — the unit the root CLAUDE.md means by "each code
 * area carries its own CLAUDE.md for local rules and the domain invariants that apply there".
 *
 * WHAT IS CHECKED, AND WHAT IS DELIBERATELY LEFT TO REVIEW. The per-area template
 * (docs/conventions/area-claude-template.md) names six parts: a title, a Purpose lead, Key files,
 * Local conventions, Invariants that apply here, Dependencies & contracts, Gotchas. Measured over
 * the 55 notes that exist today:
 *
 *   title present                      55 / 55
 *   opening prose (what the area is)   55 / 55
 *   `**Purpose.**` verbatim            42 / 55
 *   `## Key files`                     42 / 55
 *   `## Invariants that apply here`    39 / 55
 *   `## Dependencies & contracts`      38 / 55
 *   `## Gotchas`                       41 / 55
 *   `## Local conventions`              9 / 55
 *
 * Only the two universal ones are rules. The section headings are not, and the reason is the
 * numbers: `## Local conventions` appears in nine notes out of fifty-five, which makes it a section
 * of the template rather than a convention of the repository, and requiring it would mint
 * forty-six headings with "None." underneath. The same argument, less starkly, covers the other
 * four — a pure-core package of three files (packages/file-integrity, sixteen lines, no `##`
 * heading at all) legitimately has no gotcha and no local convention, and its note is good. A
 * heading nobody needed is worse than an absence a reviewer notices, because the heading looks
 * like an answer. `**Purpose.**` verbatim is not required for the same reason: the thirteen notes
 * that skip the bold lead open with the same sentence as ordinary prose, which is the thing that
 * was wanted.
 *
 * WHAT THIS DOES NOT CATCH, stated plainly, because a gate that claims more than it delivers is
 * worse than none:
 *
 *   - Whether the note is TRUE. A note describing an area as it was two refactors ago passes every
 *     rule here. Nothing textual can tell a current note from a stale one; that is review's job,
 *     and it is why the rules below check that a note is real rather than that it is complete.
 *   - Whether the note is USEFUL. Sixty characters of opening prose is a floor against a note that
 *     is headings alone, not a measure of whether anything was said.
 *   - Notes beside code that is not a workspace package — a directory inside a package, the
 *     repository root, docs/. The package walk is imported from tooling/affected-lint so there is
 *     one answer in this repository to "what are the packages"; a note at a finer grain than a
 *     package is welcome and invisible here.
 *   - Emojis, which golden rule 2 forbids in docs as well as in the product. Checked and dropped:
 *     the only Extended_Pictographic characters in any existing note are two `↔` arrows used as
 *     arrows in prose (packages/custom-fields, packages/design-system). A rule whose entire live
 *     yield is two false positives is a rule people switch off.
 *   - A note copied wholesale from a NEIGHBOURING package and lightly retitled. The title rule
 *     catches a note that still carries the other area's name in its heading; it cannot catch one
 *     whose heading was fixed and whose body was not.
 */

/**
 * The template's own text, verbatim. A note carrying one of these was pasted and not filled in,
 * which is the failure mode a copyable template actually invites — and the only one of the shape
 * checks here that reads the template rather than the note.
 *
 * VERBATIM PHRASES, NOT BARE ANGLE BRACKETS. The first draft of this rule looked for `<path>`,
 * `<role>` and `<file>` on their own and reported packages/document-assembly, whose note explains
 * the merge-field syntax `<role>.all` — a real fact about that area written in the notation that
 * area uses. Angle brackets are ordinary prose in a repository that documents template languages,
 * so each fragment below carries enough of the template's own sentence around it that nothing but
 * a copy of the template can match. `Delete this intro` is the template's instruction to itself,
 * and its presence means the file was copied including the part that says not to copy it.
 *
 * The template's design-document line is not one of the fragments, and cannot be: writing it out
 * would name that document in source, which tooling/lint-process-references.mjs refuses. The five
 * below already catch a wholesale copy, which is the shape this rule is for.
 */
const TEMPLATE_PLACEHOLDERS = [
  "# <Area name>",
  "**Purpose.** One or two sentences",
  "docs/specs/<file> — <link>",
  "`<path>` — <role>",
  "Delete this intro",
];

/** How many characters of opening prose count as having said what the area is. */
const OPENING_PROSE_FLOOR = 60;

/** How far into the note the opening prose is looked for. */
const OPENING_LINES = 12;

const problem = (rule, directory, detail) => ({ rule, directory, detail });

/** The note's title line: the first non-empty line, which must be a level-one heading. */
export function titleOf(note) {
  for (const line of note.split("\n")) {
    if (line.trim() === "") continue;
    const match = /^#\s+(.+?)\s*$/.exec(line);
    return match === null ? undefined : match[1];
  }
  return undefined;
}

/**
 * The prose a note opens with — what it says before it says anything else.
 *
 * Headings, list items, table rows and fenced blocks are skipped rather than counted, because all
 * four are structure: a note that is a title and a bullet list has not said what the area IS. A
 * note whose first words sit under a `## What this package is` heading has (packages/file-type is
 * exactly that shape), which is why headings are skipped over instead of ending the scan.
 */
export function openingProse(note) {
  const collected = [];
  let fenced = false;
  for (const line of note.split("\n").slice(0, OPENING_LINES)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (/^#{1,6}\s/.test(trimmed)) continue;
    if (/^[-*+]\s/.test(trimmed)) continue;
    if (trimmed.startsWith("|")) continue;
    collected.push(trimmed);
  }
  return collected.join(" ");
}

/**
 * Does this title name this area? True when it carries the package name, the directory's own name,
 * or every word of that name — `# @magna-carta/file-type`, `# File manager`, `# Trust ledger` all
 * pass for their own area, and none of them passes for a neighbour's.
 */
export function titleNamesArea(title, { directory, name }) {
  const spoken = title.toLowerCase();
  const base = directory.split("/").at(-1) ?? directory;
  if (spoken.includes(name.toLowerCase())) return true;
  if (spoken.includes(base.toLowerCase())) return true;
  return base.split("-").every((word) => spoken.includes(word.toLowerCase()));
}

// --- rule: every area carries a note ----------------------------------------------------------

/*
 * The rule the whole gate is for. Thirty of eighty-five packages have no note, and the thirty are
 * not the obscure corners: packages/data-access is the home of the firm-scoping golden rule itself,
 * and apps/web is every screen in the product. A rule written in the root CLAUDE.md and enforced by
 * nothing is a rule that decays, and this one had — the missing notes are not a decision anybody
 * took, they are thirty separate moments when a package was created and the note was the part that
 * came later and then did not.
 */
function findMissingNote(area) {
  if (area.note !== undefined) return [];
  return [
    problem(
      "missing-note",
      area.directory,
      `${area.name} has no CLAUDE.md. Copy docs/conventions/area-claude-template.md into ` +
        `${area.directory}/CLAUDE.md and fill it in: what this area is, the invariants that bind ` +
        "here, and the traps. Cross-cutting standards stay in docs/conventions/",
    ),
  ];
}

// --- rule: the note opens with a title that names this area -----------------------------------

/*
 * Two failures in one scan, because they are the same read. A note with no level-one heading is a
 * fragment; a note whose heading names a DIFFERENT area is a note copied from next door, which is
 * worse than no note at all because it reads as an answer. Both are clean today (55 of 55), so this
 * rule carries no debt and exists to keep it that way.
 */
function findTitleProblems(area) {
  if (area.note === undefined) return [];
  const title = titleOf(area.note);
  if (title === undefined) {
    return [
      problem(
        "no-title",
        area.directory,
        "opens with no level-one heading. The first line is the note's title — `# " +
          `${area.name} — CLAUDE.md\` or similar — so a reader landing in the middle of the ` +
          "repository knows which area they are in",
      ),
    ];
  }
  if (!titleNamesArea(title, area)) {
    return [
      problem(
        "title-names-elsewhere",
        area.directory,
        `is titled "${title}", which does not name this area. A note that carries a neighbour's ` +
          "name was copied from that neighbour; retitle it and re-read the body, because the body " +
          "is probably that neighbour's too",
      ),
    ];
  }
  return [];
}

// --- rule: the note says what the area is, before it says anything else ------------------------

/*
 * The one part of the template that every good note here already has, in one form or another: a
 * sentence or two of prose at the top saying what this area does and where its boundary is. Fifty-
 * five of fifty-five clear the floor, so this rule carries no debt either. It is a floor against
 * a note that is a heading and a bullet list, which is a table of contents for an area rather than
 * a description of one.
 */
function findUnstatedPurpose(area) {
  if (area.note === undefined) return [];
  const prose = openingProse(area.note);
  if (prose.length >= OPENING_PROSE_FLOOR) return [];
  return [
    problem(
      "unstated-purpose",
      area.directory,
      `opens with ${String(prose.length)} characters of prose in its first ` +
        `${String(OPENING_LINES)} lines, under the ${String(OPENING_PROSE_FLOOR)} this rule asks ` +
        "for. Say what this area does and where its boundary is, in prose, before the headings and " +
        "the bullets — a reader who has just arrived needs the sentence, not the index",
    ),
  ];
}

// --- rule: no unfilled template placeholder ----------------------------------------------------

/*
 * The template is meant to be copied, and a copied template that was never filled in passes every
 * other rule here: it has a title, it has prose, it has all six sections. This is the one shape
 * check that reads the template's own text, and it is clean today.
 */
function findUnfilledTemplate(area) {
  if (area.note === undefined) return [];
  const left = TEMPLATE_PLACEHOLDERS.filter((placeholder) => area.note.includes(placeholder));
  if (left.length === 0) return [];
  return [
    problem(
      "unfilled-template",
      area.directory,
      `still carries the template's own placeholders (${left.join(", ")}). Fill them in or delete ` +
        "the sections they sit in — an unfilled placeholder reads as a fact until somebody looks",
    ),
  ];
}

/** Every rule, in the order their findings read best. */
export const RULES = [
  findMissingNote,
  findTitleProblems,
  findUnstatedPurpose,
  findUnfilledTemplate,
];

/** Every rule name, so the baseline can be checked for registers naming a rule that no longer runs. */
export const RULE_NAMES = [
  "missing-note",
  "no-title",
  "title-names-elsewhere",
  "unstated-purpose",
  "unfilled-template",
];

/** Run every rule over every area. `areas` is [{ directory, name, note }], note undefined when absent. */
export function findAreaNoteProblems(areas) {
  const found = [];
  for (const area of areas) {
    for (const rule of RULES) found.push(...rule(area));
  }
  return found.toSorted(
    (a, b) => a.rule.localeCompare(b.rule) || a.directory.localeCompare(b.directory),
  );
}

/**
 * Split findings against the committed debt register, and report the register's own drift.
 *
 * `carried` is debt that is still there and is not a failure. `added` is new debt and is. `fixed`
 * is an entry the register still names and the repository no longer has — a failure too, in the
 * other direction, because a register that keeps names nobody has re-read stops being a debt list
 * and becomes a wall.
 */
export function applyBaseline(problems, baseline) {
  const carried = [];
  const added = [];
  const seen = new Set();
  for (const found of problems) {
    const entries = baseline[found.rule]?.entries ?? [];
    if (entries.includes(found.directory)) {
      carried.push(found);
      seen.add(`${found.rule}\t${found.directory}`);
    } else {
      added.push(found);
    }
  }
  const fixed = [];
  for (const [rule, register] of Object.entries(baseline)) {
    for (const directory of register.entries ?? []) {
      if (!seen.has(`${rule}\t${directory}`)) fixed.push({ rule, directory });
    }
  }
  return {
    carried,
    added,
    fixed: fixed.toSorted((a, b) => a.directory.localeCompare(b.directory)),
  };
}

/**
 * The register's `count` against its own entries.
 *
 * The count is a checked redundancy, not a second source of truth: it is the integer a reviewer
 * reads in a diff, and the thing the failure message names when the debt drops, so tightening the
 * gate is a one-integer edit plus the lines it accounts for. A register whose count and entries
 * disagree is refused outright rather than reconciled, because either half could be the mistake.
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

/**
 * The fixtures the gate self-tests against on every invocation, and that index.test.mjs drives
 * through the same entry point. Each is a shape this repository actually holds or actually invites.
 */
export const SELF_TEST = [
  {
    name: "a package with no note is reported",
    areas: [{ directory: "packages/data-access", name: "@magna-carta/data-access" }],
    expect: ["missing-note"],
  },
  {
    name: "a note that opens with prose under its own title passes every rule",
    areas: [
      {
        directory: "packages/trust",
        name: "@magna-carta/trust",
        note:
          "# @magna-carta/trust — CLAUDE.md\n\nThe trust ledger: every client-money movement, " +
          "its running balance and the three-way reconciliation against the bank.\n\n## Gotchas\n\n" +
          "- A trust transaction is never updated in place.\n",
      },
    ],
    expect: [],
  },
  {
    name: "a note whose purpose sits under a heading still passes — packages/file-type's shape",
    areas: [
      {
        directory: "packages/file-type",
        name: "@magna-carta/file-type",
        note:
          "# `@magna-carta/file-type` — local notes\n\n## What this package is\n\nPure mapping " +
          "package. No file detection happens here; it maps raw identification facts to a " +
          "structured report.\n",
      },
    ],
    expect: [],
  },
  {
    name: "a note that is a title and a bullet list has not said what the area is",
    areas: [
      {
        directory: "packages/whois",
        name: "@magna-carta/whois",
        note: "# @magna-carta/whois\n\n- `lookup()` asks the registry.\n- `parse()` reads it.\n",
      },
    ],
    expect: ["unstated-purpose"],
  },
  {
    name: "a note with no level-one heading is a fragment",
    areas: [
      {
        directory: "packages/money",
        name: "@magna-carta/money",
        note:
          "Money is stored in minor units and never as a float, so every amount that crosses a " +
          "boundary is an integer with a currency beside it.\n",
      },
    ],
    expect: ["no-title"],
  },
  {
    name: "a note titled after the package next door is a note copied from next door",
    areas: [
      {
        directory: "packages/costs",
        name: "@magna-carta/costs",
        note:
          "# @magna-carta/billing — CLAUDE.md\n\nInvoice assembly, the billing run and every " +
          "figure a client sees on a statement of account.\n",
      },
    ],
    expect: ["title-names-elsewhere"],
  },
  {
    name: "a title in ordinary words still names its area when it carries the directory's words",
    areas: [
      {
        directory: "packages/matter-search",
        name: "@magna-carta/matter-search",
        note:
          "# Matter search — CLAUDE.md\n\nThe query layer behind the matter list: parsing what a " +
          "member typed, and turning it into a firm-scoped keyset read.\n",
      },
    ],
    expect: [],
  },
  {
    name: "a copied template that was never filled in is caught on its placeholders",
    areas: [
      {
        directory: "packages/fees",
        name: "@magna-carta/fees",
        note:
          "# @magna-carta/fees — CLAUDE.md\n\n**Purpose.** One or two sentences: what this area " +
          "does and its boundary. It is long enough to clear the prose floor, which is the " +
          "point — the other rules cannot tell this from a real note.\n\n## Key files / entry " +
          "points\n\n- `<path>` — <role>\n",
      },
    ],
    expect: ["unfilled-template"],
  },
  {
    name: "angle brackets in prose are prose — packages/document-assembly's merge-field notation",
    areas: [
      {
        directory: "packages/document-assembly",
        name: "@magna-carta/document-assembly",
        note:
          "# @magna-carta/document-assembly — CLAUDE.md\n\nMerge-field resolution and document " +
          "generation: the field registry, the binding pass and the renderer.\n\n" +
          "- `<role>.all` is an ordinary list entry; `{{#each opposingParty.all}}` binds items.\n",
      },
    ],
    expect: [],
  },
  {
    name: "a missing note is ONE finding — the shape rules have nothing to read",
    areas: [{ directory: "apps/web", name: "@magna-carta/web" }],
    expect: ["missing-note"],
  },
];

/** The gate's own rules, checked against their fixtures on every invocation. */
export function runSelfTest() {
  const failures = [];
  for (const { name, areas, expect } of SELF_TEST) {
    const found = findAreaNoteProblems(areas)
      .map((one) => one.rule)
      .toSorted((one, two) => one.localeCompare(two));
    const wanted = [...expect].toSorted((one, two) => one.localeCompare(two));
    if (JSON.stringify(found) !== JSON.stringify(wanted)) failures.push({ name, found, wanted });
  }
  const baselineFixtureFailures = [
    {
      name: "the baseline carries debt forward and refuses new debt",
      check: () => {
        const problems = findAreaNoteProblems([
          { directory: "packages/known", name: "@magna-carta/known" },
          { directory: "packages/fresh", name: "@magna-carta/fresh" },
        ]);
        const { carried, added, fixed } = applyBaseline(problems, {
          "missing-note": { count: 1, entries: ["packages/known"] },
        });
        return carried.length === 1 && added.length === 1 && fixed.length === 0;
      },
    },
    {
      name: "the baseline reports an entry the repository has since fixed",
      check: () => {
        const { added, fixed } = applyBaseline([], {
          "missing-note": { count: 1, entries: ["packages/mended"] },
        });
        return added.length === 0 && fixed.length === 1;
      },
    },
    {
      name: "a register whose count disagrees with its entries is refused",
      check: () =>
        findCountMismatches({ "missing-note": { count: 4, entries: ["packages/one"] } }).length ===
        1,
    },
    {
      name: "a register naming a rule this gate no longer runs is refused",
      check: () => findUnknownRules({ "retired-rule": { count: 0, entries: [] } }).length === 1,
    },
  ];
  for (const { name, check } of baselineFixtureFailures) {
    if (!check()) failures.push({ name, found: ["false"], wanted: ["true"] });
  }
  return failures;
}
