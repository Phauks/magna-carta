/*
 * The one-UI rules, as pure functions over text and already-collected facts. No filesystem here —
 * the impure runner is index.mjs and the fixture test is index.test.mjs, the same split as
 * tooling/lint-unwired-writes/rules.mjs.
 *
 * WHAT THIS EXISTS FOR. The shared surfaces of this product are supposed to be ONE component each:
 * one table, one record window, one dropdown. A second implementation of any of them is the most
 * expensive defect available, and it is silent — it renders correctly, it typechecks, it lints, and
 * it looks right in review. It is discovered a round later, when a correction is applied in one
 * place and not the other, and by then two surfaces disagree about something a reader was told was
 * settled. Review does not scale to catching that; a scan does.
 *
 * Three rules live here, each the narrowest form of its question that still bites:
 *
 *   header-set  — the record window's header carries exactly Edit, Print, expand and close, in that
 *                 order. This is an assertion about the component itself, not a sweep of its
 *                 callers, because the component is the one place it can be wrong.
 *   domain-leak — nothing inside the record window's home names a kind of record. The shell serves
 *                 every kind, so the moment it learns about one of them the next kind needs its own
 *                 window and the reader has two things to learn instead of one.
 *   registry    — every shared component named in registry.json has exactly one home on disk, and
 *                 no other file exports a symbol of its name.
 */

// --- rule: the record window's header set ----------------------------------------------------

/** The four header controls, in the one order a reader learns. */
export const HEADER_ACTIONS = ["edit", "print", "expand", "close"];

/** The marker each header control carries, which is also the harness's hook for finding it. */
export const HEADER_ACTION_ATTRIBUTE = "data-record-window-action";

/** The class that opens the header's action group. The controls sit between it and its `</div>`. */
const HEADER_ACTIONS_CLASS = 'class="mc-record-window-header-actions"';

/**
 * Tags that are a control. `<button>` covers the shell's own; the dialog's Close part is a
 * component, so it is named too — a fifth control added as either shape must be found.
 */
const CONTROL_TAG_PATTERN = /<(button|Dialog\.Close|DialogClose)\b/g;

const ACTION_MARKER_PATTERN = new RegExp(`${HEADER_ACTION_ATTRIBUTE}="([a-z-]*)"`, "g");

/**
 * Problems with the record window's header set, given the component's source.
 *
 * The action group is delimited by its own class and the first `</div>` after it: the controls
 * inside close with `</button>` and `</Dialog.Close>`, so no nested `</div>` can end the region
 * early. A restructure that breaks that assumption fails loudly here rather than passing vacuously,
 * which is why the missing-region and unterminated-region cases are their own problems.
 */
export function findHeaderSetProblems(filePath, source) {
  const problems = [];
  const start = source.indexOf(HEADER_ACTIONS_CLASS);
  if (start === -1) {
    problems.push({
      rule: "header-set",
      file: filePath,
      detail:
        `no element carries ${HEADER_ACTIONS_CLASS} — the header's action group is where the four ` +
        "controls live, and without it this rule cannot see them at all",
    });
    return problems;
  }
  const end = source.indexOf("</div>", start);
  if (end === -1) {
    problems.push({
      rule: "header-set",
      file: filePath,
      detail:
        "the header's action group is never closed by a `</div>` — the rule reads the group as the " +
        "text between its class and that tag, so it cannot check an unterminated one",
    });
    return problems;
  }

  const region = source.slice(start, end);
  const found = [...region.matchAll(ACTION_MARKER_PATTERN)].map((match) => match[1]);
  const controlCount = [...region.matchAll(CONTROL_TAG_PATTERN)].length;

  if (found.join(" ") !== HEADER_ACTIONS.join(" ")) {
    problems.push({
      rule: "header-set",
      file: filePath,
      detail:
        `the header carries [${found.join(", ")}] — it must carry exactly ` +
        `[${HEADER_ACTIONS.join(", ")}], in that order. A reader learns this window once; a fifth ` +
        "control, a missing one, or a different order makes every record window a fresh puzzle",
    });
  }
  if (controlCount !== found.length) {
    problems.push({
      rule: "header-set",
      file: filePath,
      detail:
        `the header's action group holds ${controlCount} control(s) but ${found.length} carry ` +
        `${HEADER_ACTION_ATTRIBUTE} — every control there declares which of the four it is, so a ` +
        "new one cannot slip in unnamed",
    });
  }
  return problems;
}

// --- rule: no kind of record inside the shell ------------------------------------------------

/**
 * The vocabulary, split by how safely it can be matched.
 *
 * `SINGLE_WORD_TERMS` are matched even as a lone word, but ONLY in code with its comments and
 * string literals removed — because several of them are ordinary English and a check that fires on
 * "no matter which tab" or "it costs nothing" in a comment gets switched off within a week. In code
 * position a lone `invoice` or `cost` is a variable or a prop, which is exactly the leak.
 *
 * `COMPOUND_TERMS` are word sequences that only ever occur as an identifier, so they are matched
 * everywhere the comments have been stripped — markup, attribute names, class names included.
 */
export const SINGLE_WORD_TERMS = ["invoice", "cost", "fee", "matter", "narrative", "timekeeper"];
export const COMPOUND_TERMS = [["time", "entry"]];

/**
 * Blank a run of text to spaces, keeping its newlines. Every stripper here works this way so a
 * reported line number still points at the line the reader has to look at.
 */
const blank = (text) => text.replaceAll(/[^\n]/g, " ");

/** Strip comments while preserving line count, so a reported line number still points at the code. */
export function stripComments(source) {
  return source
    .replaceAll(/\/\*[^]*?\*\//g, blank)
    .replaceAll(/<!--[^]*?-->/g, blank)
    .replaceAll(/(^|[^:\w])\/\/[^\n]*/gm, (match, lead) => lead + blank(match.slice(lead.length)));
}

/** Strip string and template literals the same way, so prose inside them cannot trip the scan. */
export function stripStringLiterals(source) {
  return source.replaceAll(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, (match) => {
    return match[0] + blank(match.slice(1, -1)) + match[0];
  });
}

/** Re-export statements, blanked: a barrel forwarding a component is not a second one. */
export function stripReExports(source) {
  return source
    .replaceAll(/export\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?/g, blank)
    .replaceAll(/export\s*\*(?:\s+as\s+\w+)?\s*from\s*["'][^"']+["'];?/g, blank);
}

/** The `<script>` blocks of a Svelte file, blanked elsewhere so line numbers survive. */
export function scriptBlocksOnly(source) {
  let result = blank(source);
  for (const match of source.matchAll(/<script\b[^>]*>([^]*?)<\/script>/g)) {
    const bodyStart = match.index + match[0].indexOf(">") + 1;
    result = result.slice(0, bodyStart) + match[1] + result.slice(bodyStart + match[1].length);
  }
  return result;
}

/** Split an identifier into its lowercase parts across camelCase, snake_case and kebab-case. */
export function identifierParts(token) {
  return token
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .toLowerCase()
    .split(" ")
    .filter((part) => part !== "")
    .map((part) => (part.length > 3 && part.endsWith("s") ? part.slice(0, -1) : part));
}

function partsCarryTerm(parts) {
  if (parts.some((part) => SINGLE_WORD_TERMS.includes(part))) return true;
  return COMPOUND_TERMS.some((sequence) =>
    parts.some((_part, index) => sequence.every((word, offset) => parts[index + offset] === word)),
  );
}

const IDENTIFIER_PATTERN = /[A-Za-z][A-Za-z0-9_-]*/g;

function scan(text, { requireCompoundIdentifier }) {
  const hits = [];
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(IDENTIFIER_PATTERN)) {
      const token = match[0];
      const parts = identifierParts(token);
      if (requireCompoundIdentifier && parts.length < 2) continue;
      if (!partsCarryTerm(parts)) continue;
      hits.push({ token, line: index + 1 });
    }
  });
  return hits;
}

/**
 * Names of a kind of record found inside the shell, given one file's path and source.
 *
 * Two passes, because the two halves of the question have different false-positive risks:
 *
 *   1. CODE — comments and string literals removed (and, in a Svelte file, only the script blocks) —
 *      where even a lone `cost` or `matter` is an identifier and therefore a leak.
 *   2. THE WHOLE FILE with comments removed, where only a MULTI-PART identifier counts. That is what
 *      reaches a recipe class (`mc-record-window-invoice`), an attribute name (`data-fee-id`) or a
 *      quoted key, without firing on ordinary English in a label.
 */
export function findDomainLeaks(filePath, source) {
  const withoutComments = stripComments(source);
  const isSvelte = filePath.endsWith(".svelte");
  const codeText = stripStringLiterals(
    isSvelte ? scriptBlocksOnly(withoutComments) : withoutComments,
  );

  const seen = new Set();
  const problems = [];
  for (const hit of [
    ...scan(codeText, { requireCompoundIdentifier: false }),
    ...scan(withoutComments, { requireCompoundIdentifier: true }),
  ]) {
    const key = `${hit.line}:${hit.token}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push({
      rule: "domain-leak",
      file: filePath,
      line: hit.line,
      detail:
        `\`${hit.token}\` names a kind of record. The shell serves every kind, so it may not know ` +
        "about any of them — move the fact into the record's own pane, tab or action bar, which " +
        "the caller supplies",
    });
  }
  return problems.toSorted((first, second) => first.line - second.line);
}

// --- rule: the one-implementation registry ---------------------------------------------------

/**
 * Problems with the registry, given the declared entries and the facts collected about them.
 *
 * `homesPresent` is the set of entry names whose home exists on disk; `foreignExports` is a list of
 * `{ name, file }` for every export of a registered name found outside that name's home.
 *
 * A `pending` entry is one whose home is being written right now: its absence is reported as a
 * notice rather than a failure, so a component contract can be declared before every home lands.
 * The note is not a permanent escape — a pending entry whose home HAS arrived is itself a failure,
 * on the same discipline the other gates here use for stale suppressions: a list nobody re-reads is
 * how a gate goes quiet without anyone deciding it should.
 */
export function findRegistryProblems(entries, { homesPresent, foreignExports }) {
  const problems = [];
  const notices = [];

  for (const entry of entries) {
    const present = homesPresent.has(entry.name);
    if (!present && entry.pending !== undefined) {
      if (String(entry.pending).trim() === "") {
        problems.push({
          rule: "registry",
          file: entry.home,
          detail:
            `${entry.name} is marked pending with no reason — say what it is waiting on, or drop ` +
            "the mark and let the missing home fail",
        });
        continue;
      }
      notices.push(
        `${entry.name} has no home at ${entry.home} yet: ${entry.pending}. Expected to arrive; ` +
          "this is not a failure.",
      );
      continue;
    }
    if (!present) {
      problems.push({
        rule: "registry",
        file: entry.home,
        detail:
          `${entry.name} is declared with its home at ${entry.home}, and nothing is there. A ` +
          "registered component has exactly one home: build it there, correct the path, or take " +
          "the entry out",
      });
      continue;
    }
    if (entry.pending !== undefined) {
      problems.push({
        rule: "registry",
        file: entry.home,
        detail:
          `${entry.name} is still marked pending and its home has arrived — take the mark off, so ` +
          "the entry cannot outlive the reason it was excused",
      });
    }
  }

  for (const foreign of foreignExports) {
    const entry = entries.find((candidate) => candidate.name === foreign.name);
    problems.push({
      rule: "registry",
      file: foreign.file,
      detail:
        `exports \`${foreign.name}\`, which already has one home at ${entry?.home ?? "the registry"}. ` +
        "A second implementation of a shared component is the defect this registry exists to stop: " +
        "import the one that exists, and extend it in place if it does not do what this surface needs",
    });
  }

  return { problems, notices };
}

/** Every way a module can export a named symbol, for one name. */
export function exportPatternsFor(name) {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(
      String.raw`\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class)\s+${escaped}\b`,
    ),
    new RegExp(String.raw`\bexport\s+(?:const|let|var|type|interface|enum)\s+${escaped}\b`),
    new RegExp(String.raw`\bexport\s*\{[^}]*\bas\s+${escaped}\s*[,}]`),
    new RegExp(String.raw`\bexport\s*\{[^}]*\b${escaped}\s*[,}]`),
  ];
}

/** Whether a module's source exports the given name. */
export function exportsName(source, name) {
  return exportPatternsFor(name).some((pattern) => pattern.test(source));
}

/** The kebab-case spelling of a component name, which is also its file and folder spelling here. */
export function kebabCase(name) {
  return name.replaceAll(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
