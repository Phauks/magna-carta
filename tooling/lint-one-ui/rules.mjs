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
 * Each rule is the narrowest form of its question that still bites:
 *
 *   header-set      — the record window's header carries exactly Edit, Print, expand and close, in
 *                     that order. This is an assertion about the component itself, not a sweep of
 *                     its callers, because the component is the one place it can be wrong.
 *   domain-leak     — nothing inside the record window's home names a kind of record. The shell
 *                     serves every kind, so the moment it learns about one of them the next kind
 *                     needs its own window and the reader has two things to learn instead of one.
 *   registry        — every shared component named in registry.json has exactly one home on disk,
 *                     and no other file exports a symbol of its name.
 *   native-select   — no hand-rolled `<select>` in an app screen. Every dropdown is the design
 *                     system's, so keyboard behaviour, typeahead and the popover layer are decided
 *                     once.
 *   hand-built-dialog — no raw `<dialog>`, and no hand-built scrim. A second overlay mechanism is a
 *                     second set of answers about focus, dismissal and z-order.
 *   hand-drawn-glyph — no glyph drawn as SVG geometry outside the brand mark. Icons come from
 *                     Lucide, at the sizes the theme defines.
 *   status-tone     — no surface invents a tone for a status word. The status register is the one
 *                     place a word is given its label, its tone and its meaning.
 *   placeholder     — every ghost text is the field's own name. The judgement is NOT re-implemented
 *                     here: the predicate is injected, and its one home is the design system's
 *                     `readsAsFieldName`.
 *   imperative-dom  — no `getElementById`, no `innerHTML`, and no `querySelector` outside a
 *                     measuring `$effect`, in the ported surfaces. The mockups reached into the
 *                     document by hand; the ported screens are declarative Svelte.
 *   raw-table       — no `<table>`, none of its parts, and no table ARIA role outside the data-table
 *                     home. Every tabular surface is `DataTable.Grid`; a plain grid of facts is the
 *                     design system's primitives, which carry the recipe a raw element does not.
 *   table-machinery — nothing outside that home writes what the Grid already carries: a sortable
 *                     header, the headless engine composed by hand, or the adapter's own parts. A
 *                     second sort is the behaviour gap the one-table ruling calls a defect.
 *   allowance       — every recorded allowance still describes a real violation. An allowance that
 *                     has outlived its violation is a failure, on the same discipline the registry's
 *                     `pending` mark uses: a list nobody re-reads is how a gate goes quiet.
 */

// --- rule: the record window's header set ----------------------------------------------------

/**
 * The header controls, in the one order a reader learns. The menu is the one caller-supplied
 * control — a record kind's rare acts and settings — and renders only when a caller provides it,
 * but its place in the source is fixed here like the rest.
 */
export const HEADER_ACTIONS = ["menu", "edit", "print", "expand", "close"];

/** The marker each header control carries, which is also the harness's hook for finding it. */
export const HEADER_ACTION_ATTRIBUTE = "data-record-window-action";

/**
 * The class that opens the header's action group. The controls sit between it and its `</div>`.
 * A class TOKEN rather than the whole attribute, so the element may carry the modal frame's class
 * beside its own — the frame supplies the group's geometry, this name is the rule's hook.
 */
const HEADER_ACTIONS_CLASS = "mc-record-window-header-actions";

/**
 * Tags that are a control. `<button>` covers the shell's own; the dialog's Close part and the
 * menu's trigger are components that render one, so they are named too — an extra control added
 * as any of these shapes must be found.
 */
const CONTROL_TAG_PATTERN = /<(button|Dialog\.Close|DialogClose|DropdownMenu\.Trigger)\b/g;

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

// --- rule: the action dialog's footer set ------------------------------------------------------

/**
 * The action bar's two controls, in the one order a reader learns: the dismissal at the weak hand,
 * the commit last at the strong hand. Its sibling is HEADER_ACTIONS above, and it exists for the
 * same reason — the promise a shell makes is only worth what stops it being quietly rearranged.
 *
 * A reading panel renders no commit at all; that is a runtime branch on its kind, and this rule
 * reads SOURCE, where the commit's marker is still the last control in the bar. What the rule
 * asserts is therefore the order of the controls that exist, and that no third one joins them.
 */
export const FOOTER_ACTIONS = ["dismiss", "commit"];

/** The marker each footer control carries, which is also a harness's hook for finding it. */
export const FOOTER_ACTION_ATTRIBUTE = "data-action-dialog-action";

/** The class that opens the action bar. The controls sit between it and its `</div>`. */
const FOOTER_ACTIONS_CLASS = "mc-action-dialog-actions";

/** Tags that are a control in the bar. The shell renders both through the design system's Button. */
const FOOTER_CONTROL_PATTERN = /<(Button|button)\b/g;

const FOOTER_MARKER_PATTERN = new RegExp(`${FOOTER_ACTION_ATTRIBUTE}="([a-z-]*)"`, "g");

/**
 * Problems with the action dialog's footer set, given the shell's source.
 *
 * The whole value of one modal shell is that its action bar is the same bar everywhere — a reader
 * who has learned where the commit sits has learned it in every panel in the product. A third
 * control added here, or the two swapped, un-learns that silently and in one edit. So the set is
 * asserted at the source, exactly as the record window's header set is.
 *
 * The bar is delimited by its own class and the first `</div>` after it. A restructure that breaks
 * that assumption fails loudly rather than passing vacuously, which is why the missing-region and
 * unterminated-region cases are their own problems.
 */
export function findFooterSetProblems(filePath, source) {
  const problems = [];
  const start = source.indexOf(FOOTER_ACTIONS_CLASS);
  if (start === -1) {
    problems.push({
      rule: "footer-set",
      file: filePath,
      detail:
        `no element carries \`${FOOTER_ACTIONS_CLASS}\` — the action bar is where the dismissal ` +
        "and the commit live, and without it this rule cannot see them at all",
    });
    return problems;
  }
  const end = source.indexOf("</div>", start);
  if (end === -1) {
    problems.push({
      rule: "footer-set",
      file: filePath,
      detail:
        "the action bar is never closed by a `</div>` — the rule reads the bar as the text between " +
        "its class and that tag, so it cannot check an unterminated one",
    });
    return problems;
  }

  const region = source.slice(start, end);
  const found = [...region.matchAll(FOOTER_MARKER_PATTERN)].map((match) => match[1]);
  const controlCount = [...region.matchAll(FOOTER_CONTROL_PATTERN)].length;

  if (found.join(" ") !== FOOTER_ACTIONS.join(" ")) {
    problems.push({
      rule: "footer-set",
      file: filePath,
      detail:
        `the action bar carries [${found.join(", ")}] — it must carry exactly ` +
        `[${FOOTER_ACTIONS.join(", ")}], in that order. A reader who has learned where the commit ` +
        "sits has learned it in every panel in the product; a third control, or the two swapped, " +
        "un-learns that everywhere at once",
    });
  }
  if (controlCount !== found.length) {
    problems.push({
      rule: "footer-set",
      file: filePath,
      detail:
        `the action bar holds ${controlCount} control(s) but ${found.length} carry ` +
        `${FOOTER_ACTION_ATTRIBUTE} — every control there declares which of the two it is, so a ` +
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

/** The `<style>` blocks of a Svelte file, blanked elsewhere so line numbers survive. */
export function styleBlocksOnly(source) {
  let result = blank(source);
  for (const match of source.matchAll(/<style\b[^>]*>([^]*?)<\/style>/g)) {
    const bodyStart = match.index + match[0].indexOf(">") + 1;
    result = result.slice(0, bodyStart) + match[1] + result.slice(bodyStart + match[1].length);
  }
  return result;
}

/** The 1-based line a character index falls on, so a problem points at a line a reader can open. */
export function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
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

// --- rule: no hand-rolled select -------------------------------------------------------------

/**
 * A native `<select>` in an app screen.
 *
 * Lowercase only, deliberately: `<Select` is the design system's component and `<select` is the
 * browser's element, and the case is the whole difference. The design system's own `Select` wraps
 * the native element in one place, which is where every answer about keyboard behaviour, typeahead,
 * the anchored layer and the disabled look is decided — a second one decides them again, differently.
 */
export function findHandRolledSelects(filePath, source) {
  const text = stripComments(source);
  return [...text.matchAll(/<select\b/g)].map((match) => ({
    rule: "native-select",
    file: filePath,
    line: lineOf(text, match.index),
    detail:
      "renders a native `<select>`. Every dropdown in this product is `Combobox`, or `Select` " +
      "where the set is closed and short — the design system's `Select` is the one wrapper around " +
      "the native element, so keyboard behaviour, typeahead and the anchored layer are settled once",
  }));
}

// --- rule: no raw dialog, and no hand-built scrim ---------------------------------------------

/** `inset: 0` as the shorthand, which is how a full-viewport scrim is nearly always written. */
const FULL_INSET = /\binset\s*:\s*0(?:px|rem|em|%)?\s*(?:!important)?\s*(?:;|$)/;

/** The logical pair, and the four physical sides — the same rectangle spelled out longhand. */
const LOGICAL_INSET_PAIR = [/\binset-block\s*:\s*0/, /\binset-inline\s*:\s*0/];
const PHYSICAL_SIDES = [/\btop\s*:\s*0/, /\bright\s*:\s*0/, /\bbottom\s*:\s*0/, /\bleft\s*:\s*0/];

function coversTheViewport(declarations) {
  if (FULL_INSET.test(declarations)) return true;
  if (LOGICAL_INSET_PAIR.every((pattern) => pattern.test(declarations))) return true;
  return PHYSICAL_SIDES.every((pattern) => pattern.test(declarations));
}

/**
 * A dialog built by hand rather than taken from the design system.
 *
 * Two shapes, because a hand-built overlay arrives as either. The raw `<dialog>` element is the
 * obvious one. The quieter one is the scrim: a rule that is both `position: fixed` and pinned to
 * every edge is a full-viewport overlay, and an overlay carries its own answers about focus
 * trapping, dismissal, scroll locking and z-order — the four things `Dialog` exists to answer once.
 *
 * The scrim half reads only `<style>` blocks. The design system's own recipes legitimately pin an
 * overlay to every edge, and they live in `components.css` where they belong; a `<style>` block in
 * a component is a second home for the same decision.
 */
export function findHandBuiltDialogs(filePath, source) {
  const text = stripComments(source);
  const problems = [];

  for (const match of text.matchAll(/<dialog\b/g)) {
    problems.push({
      rule: "hand-built-dialog",
      file: filePath,
      line: lineOf(text, match.index),
      detail:
        "renders a raw `<dialog>`. Dialogs come from the design system — `Dialog`, `AlertDialog` " +
        "or `Sheet` — which is where focus trapping, dismissal, the scroll lock and the anchored " +
        "layer are decided; the native element answers none of them the way the rest of the " +
        "product does",
    });
  }

  const styles = styleBlocksOnly(text);
  for (const rule of styles.matchAll(/\{([^{}]*)\}/g)) {
    const declarations = rule[1];
    if (!/position\s*:\s*fixed\b/.test(declarations)) continue;
    if (!coversTheViewport(declarations)) continue;
    problems.push({
      rule: "hand-built-dialog",
      file: filePath,
      line: lineOf(styles, rule.index),
      detail:
        "pins a `position: fixed` element to every edge — that is a scrim, and a scrim is the " +
        "visible half of an overlay whose other half is focus trapping, dismissal and scroll " +
        "locking. Use the design system's `Dialog`, `AlertDialog` or `Sheet`, which bring all four",
    });
  }

  return problems.toSorted((first, second) => first.line - second.line);
}

// --- rule: no modal built outside the shells --------------------------------------------------

/**
 * The design system's own modal parts, composed. `Sheet` is in the list because an edge panel is a
 * modal surface with a different entrance, not a different set of answers about focus and dismissal.
 */
const COMPOSED_PANEL = /<(Dialog|AlertDialog|Sheet)\.Content\b/g;

/**
 * A scrim written as Tailwind utilities rather than as CSS.
 *
 * The `<style>`-block half of `findHandBuiltDialogs` cannot see this one, and this is the shape
 * this repository actually writes: `class="fixed inset-0 …"`. Both orders are matched because a
 * class list is unordered, and `z-modal`/`z-overlay` is required alongside so an ordinary pinned
 * background (a page-level decorative layer) is not called an overlay — a scrim is the thing that
 * sits at the modal layer AND covers the viewport.
 */
const UTILITY_SCRIM =
  /class=(?:"|')(?=[^"']*\bfixed\b)(?=[^"']*\binset-0\b)(?=[^"']*\bz-(?:modal|overlay)\b)[^"']*(?:"|')/g;

/** Opening a modal by reaching for the platform directly, which no source scan sees as markup. */
const IMPERATIVE_MODAL = /\.showModal\s*\(|HTMLDialogElement/g;

/**
 * A modal panel assembled outside the two shells.
 *
 * This is the rule that keeps the shells from being optional. `findHandBuiltDialogs` already
 * catches the crude shapes — a raw `<dialog>`, a scrim written in a `<style>` block — but the
 * expensive shape is subtler and passes every other gate: a screen imports the design system's own
 * `Dialog.Root` and `Dialog.Content`, composes a title, a body and a footer by hand, and ships. It
 * renders correctly, it typechecks, it lints, and it reads fine in review. What it does not do is
 * share the answers the shells settle — the dismissal verb, whether the corner dismiss shows, which
 * primitive a question deserves, and above all whether a close gesture asks before discarding. Every
 * hand-composed panel in this repository answered that last one the same way: it did not ask.
 *
 * Three signals, because a modal built outside the system arrives as any of them:
 *
 *   1. A composed `Dialog`/`AlertDialog`/`Sheet` `.Content` outside the shells' own homes.
 *   2. A scrim written as utilities — `fixed inset-0` at the modal or overlay layer.
 *   3. A reach for the platform's own modal (`showModal`, `HTMLDialogElement`).
 *
 * WHAT THIS DOES NOT CATCH, stated plainly: a panel whose parts are aliased on import
 * (`import { Content as Panel }`), a `.Content` chosen at runtime from a variable, and any modal a
 * third-party component renders inside itself. Those are why the shells also stamp
 * `data-modal-shell` on the panel they render — a marker a rendered-DOM check can require of
 * anything carrying the `dialog` or `alertdialog` role, which is the half of this that reads
 * behaviour rather than source.
 */
export function findHandComposedModals(filePath, source, shellHomes) {
  // The homes allowed to compose a modal panel are DECLARED, in registry.json beside the component
  // register, rather than listed here — adding a shell is then a reviewed edit to the file that
  // already answers "what is in the system", and this rule has no opinion nobody can see. Being a
  // registered component is NOT enough on its own: a registered component may perfectly well
  // contain a confirmation that should be an ActionDialog, and one does.
  if (shellHomes.some((home) => filePath === home || filePath.startsWith(`${home}/`))) return [];

  const text = stripComments(source);
  const problems = [];

  for (const match of text.matchAll(COMPOSED_PANEL)) {
    problems.push({
      rule: "hand-composed-modal",
      file: filePath,
      line: lineOf(text, match.index),
      detail:
        `composes \`${match[1]}.Content\` into a panel of its own. Every modal surface in this ` +
        "product is one of two shells — `RecordWindow` for reading and changing a record, " +
        "`ActionDialog` for an act asked of a reader — and a hand-composed panel re-answers what " +
        "they settle: the dismissal verb, whether the corner dismiss shows, which primitive a " +
        "question deserves, and whether a close gesture asks before discarding the reader's typing",
    });
  }

  for (const match of text.matchAll(UTILITY_SCRIM)) {
    problems.push({
      rule: "hand-composed-modal",
      file: filePath,
      line: lineOf(text, match.index),
      detail:
        "pins an element to every edge at the modal layer with utilities — that is a scrim, and a " +
        "scrim is the visible half of an overlay whose other half is focus trapping, dismissal and " +
        "scroll locking. Reach for `ActionDialog` or `RecordWindow`, which bring all of it",
    });
  }

  for (const match of text.matchAll(IMPERATIVE_MODAL)) {
    problems.push({
      rule: "hand-composed-modal",
      file: filePath,
      line: lineOf(text, match.index),
      detail:
        "opens a modal through the platform directly. The product's modals are `ActionDialog` and " +
        "`RecordWindow`; the native element answers nothing the way the rest of the product does, " +
        "and nothing downstream can recognize it as a modal of ours",
    });
  }

  return problems.toSorted((first, second) => first.line - second.line);
}

// --- rule: no hand-drawn glyphs ---------------------------------------------------------------

/**
 * A `<path>` whose geometry is written out as a literal string — a glyph somebody drew.
 *
 * The literal is the discriminator, and it is the honest one. A chart computes its geometry from
 * data (`d={area}`), so its path is a picture OF something rather than a picture somebody drew; a
 * glyph's geometry is a constant, because a glyph is a constant. Matching literals only is what
 * keeps this rule off the plotted surfaces it has no business on.
 */
const LITERAL_GEOMETRY = /<path\b[^>]*?\bd\s*=\s*(["'])((?:\\.|(?!\1).)*)\1/g;

export function findHandDrawnGlyphs(filePath, source) {
  const text = stripComments(source);
  if (!/<svg\b/.test(text)) return [];
  return [...text.matchAll(LITERAL_GEOMETRY)].map((match) => ({
    rule: "hand-drawn-glyph",
    file: filePath,
    line: lineOf(text, match.index),
    detail:
      "draws a glyph as literal SVG geometry. Icons are Lucide, imported one deep path at a time " +
      "(`@lucide/svelte/icons/<name>`), so the whole product's iconography has one weight, one " +
      "grid and one set of sizes. The only hand-drawn mark is the brand mark, which is not an icon",
  }));
}

// --- rule: no raw table, and no table machinery beside the one table ------------------------

/** The home of the platform's one table — the only place table markup, or its machinery, is written. */
export const DATA_TABLE_HOME = "packages/design-system/src/lib/components/data-table";

const insideDataTableHome = (filePath) => filePath.startsWith(`${DATA_TABLE_HOME}/`);

/**
 * Table markup written out by hand: the browser's elements, and the ARIA roles a `<div>` wears to
 * be a table without saying so.
 *
 * Lowercase only, as with `<select`: `<Table` is the design system's primitive and `<table` is the
 * browser's element, and the case is the whole difference. The word boundary is what keeps `<tr`
 * off `<track`, `<th` off `<thead` (its own alternative) and `<td` off nothing at all — and every
 * component name is PascalCase, so no component starts with a lowercase `<t`.
 */
const TABLE_MARKUP =
  /<(?:table|thead|tbody|tfoot|tr|th|td)\b|\brole\s*=\s*["'](?:table|grid|treegrid|rowgroup|row|rowheader|columnheader|gridcell|cell)["']/g;

/**
 * A table written as elements rather than taken from the design system.
 *
 * One problem per file, at the first line, because a raw table arrives as six or seven elements
 * and a reader who opens the file at the first one is looking at the rest. The design system's
 * data-table home is the one place `<table>` is written: `DataTable.Grid` is the platform's one
 * table, and the presentational primitives (`DataTable.Root`, `Header`, `Body`, `Row`, `Head`,
 * `Cell`) are what a plain grid of facts composes. A raw element carries the recipe of neither, so
 * the first correction to the table's look — its header voice, its density, its scrollbar — misses
 * it, and two tables start disagreeing about something a reader was told was settled.
 */
export function findRawTables(filePath, source) {
  if (insideDataTableHome(filePath)) return [];
  const text = stripComments(source);
  const matches = [...text.matchAll(TABLE_MARKUP)];
  if (matches.length === 0) return [];
  const [first] = matches;
  const more = matches.length - 1;
  return [
    {
      rule: "raw-table",
      file: filePath,
      line: lineOf(text, first.index),
      detail:
        `writes table markup by hand (\`${first[0]}\`${more === 0 ? "" : `, and ${more} more below`}). ` +
        "Every tabular surface is `DataTable.Grid` — the platform's one table, where sorting, the " +
        "per-column filters, column show/hide, reorder, pinning, resizing, selection and the totals " +
        "row are settled once — and a plain grid of facts with none of that machinery composes the " +
        "design system's `DataTable.Root`/`Header`/`Body`/`Row`/`Head`/`Cell`, which carry the " +
        "`mc-table` recipe. A raw element carries neither",
    },
  ];
}

/**
 * The machinery `DataTable.Grid` carries, spotted being written a second time.
 *
 * Each signal is a shape this repository has actually reached for, and none has a legitimate home
 * outside the one table's own directory: the sort affordance (its ARIA state and the recipe class
 * that styles it), the headless engine composed at a call site (`createSvelteTable`, or the
 * `@tanstack/table-core` import that composition needs), and the adapter's own toolbar parts. The
 * design system exports those last two for the Grid to be built from, not for a screen to build a
 * second Grid with.
 */
const TABLE_MACHINERY = [
  { signal: "aria-sort", pattern: /\baria-sort\s*=/, what: "a sortable header" },
  { signal: "mc-table-sort", pattern: /\bmc-table-sort\b/, what: "the sort affordance's recipe" },
  {
    signal: "createSvelteTable",
    pattern: /\bcreateSvelteTable\s*\(/,
    what: "the headless engine composed by hand",
  },
  {
    signal: "@tanstack/table-core",
    pattern: /["']@tanstack\/table-core["']/,
    what: "the table engine imported directly",
  },
  {
    signal: "the adapter's parts",
    pattern:
      /<DataTable\.(?:ViewMenu|ColumnFilter|Search|FlexRender)\b|<Table(?:ViewMenu|ColumnFilter|Search)\b|<FlexRender\b/,
    what: "the adapter's toolbar parts outside the Grid",
  },
];

/**
 * A surface that has written, beside the presentational primitives, what the Grid already does.
 *
 * This is the half a scan for `<table>` cannot see, and it is the expensive half: a screen composes
 * `DataTable.Root` and `DataTable.Head` correctly, adds a `sortBy` of its own and an `aria-sort` on
 * the header, and ships. It passes typecheck, it passes lint, and it uses the recipe, so it reads
 * fine in review. What it does not do is answer "what does clicking a header do" the way every other
 * table on the product answers it — empties last, a stable sort, the type-aware comparator, the
 * menu on right-click — which is precisely the behaviour gap the one-table ruling calls a defect
 * by definition. One problem per file, naming every signal found, so the reader sees the whole
 * shape and not one symptom of it.
 */
export function findTableMachinery(filePath, source) {
  if (insideDataTableHome(filePath)) return [];
  const text = stripComments(source);
  const found = [];
  for (const { signal, pattern, what } of TABLE_MACHINERY) {
    const match = pattern.exec(text);
    if (match === null) continue;
    found.push({ signal, what, line: lineOf(text, match.index) });
  }
  if (found.length === 0) return [];
  const inOrder = found.toSorted((first, second) => first.line - second.line);
  return [
    {
      rule: "table-machinery",
      file: filePath,
      line: inOrder[0].line,
      detail:
        "carries table machinery of its own: " +
        inOrder.map((one) => `${one.what} (\`${one.signal}\`, line ${one.line})`).join(", ") +
        ". Sorting, the per-column filters, column show/hide, reorder, pinning, resizing, " +
        "selection and the totals row are settled once in `DataTable.Grid`, and a sort written " +
        "locally answers 'what does clicking a header do' a second time — the behaviour gap the " +
        "one-table ruling calls a defect by definition. Give the surface a column model and " +
        "`createDataTableGrid`, and let the Grid render it",
    },
  ];
}

// --- rule: one status register ----------------------------------------------------------------

/** How a file says it is using the register, in either the package or the relative spelling. */
const REGISTER_IMPORT = /status-register/;

/**
 * How few status words a file needs to be speaking a vocabulary rather than using a word.
 *
 * Two, because one status label in a file is a label and two with a tone beside them is a mapping —
 * and because on the repository as it stands two produced no false positive at all while catching
 * every second register that exists.
 */
const SECOND_REGISTER_THRESHOLD = 2;

const STRING_LITERAL = /(["'])((?:\\.|(?!\1).)*)\1/g;

/** Every distinct string literal in a source file. */
function stringLiterals(source) {
  return new Set([...source.matchAll(STRING_LITERAL)].map((match) => match[2]));
}

/** `<Badge …>text</Badge>`, as its attributes and the text between the tags. */
const BADGE_USAGE = /<Badge\b([^>]*)>([^<]*)</g;

/**
 * A surface that has decided for itself what a status word looks like.
 *
 * Two shapes, because inventing a tone arrives as either.
 *
 *   1. A `Badge` whose `variant` is a LITERAL and whose text is a word the register already owns.
 *      That is the shape the port plan prescribes, and it is the one an author writes inline.
 *   2. A file that pairs two or more of the register's own words with a tone name, and does not
 *      import the register. That is a second register: a `Record<Status, BadgeVariant>` or a
 *      `statusTone()` written locally. It matters more than the first shape, because it renders
 *      through an expression and so is invisible to a scan for literals — and it is where every
 *      disagreement found on this repository actually lives.
 *
 * `labels` and `tones` are passed in rather than listed here: they are read off the register itself,
 * so this rule cannot drift from the thing it is enforcing.
 */
export function findInventedStatusTones(filePath, source, { labels, tones }) {
  if (REGISTER_IMPORT.test(source)) return [];

  const text = stripComments(source);
  const problems = [];
  const labelSet = new Set(labels);

  for (const usage of text.matchAll(BADGE_USAGE)) {
    const variant = /\bvariant\s*=\s*"([a-z-]+)"/.exec(usage[1]);
    const word = usage[2].trim();
    if (variant === null || !labelSet.has(word)) continue;
    problems.push({
      rule: "status-tone",
      file: filePath,
      line: lineOf(text, usage.index),
      detail:
        `hands the status word \`${word}\` a tone (\`${variant[1]}\`) of its own. The status ` +
        "register is the one place a status word is given its label, its tone and its meaning — " +
        "take them from `statusEntry(key)` or `statusBadgeAttributes(key)`",
    });
  }

  const literals = stringLiterals(text);
  const spoken = labels.filter((label) => literals.has(label));
  const invented = tones.filter((tone) => literals.has(tone));
  if (spoken.length >= SECOND_REGISTER_THRESHOLD && invented.length > 0) {
    problems.push({
      rule: "status-tone",
      file: filePath,
      detail:
        `names ${spoken.length} of the register's own status words (${spoken.join(", ")}) beside ` +
        `the tone(s) ${invented.join(", ")}, and does not import the register. That is a second ` +
        "status register, and two registers disagree the moment either one is corrected — take " +
        "the words and the tones from `@magna-carta/design-system/status-register` instead",
    });
  }

  return problems;
}

// --- rule: every ghost text is the field's name ------------------------------------------------

const PLACEHOLDER_ATTRIBUTE = /\bplaceholder\s*=\s*(["'])((?:\\.|(?!\1).)*)\1/g;

/** The repository's documented escape, read off the source line rather than a list in this tool. */
const INLINE_ALLOWANCE = /fitness-allow:/;

/**
 * Ghost text that is not the field's own name.
 *
 * The JUDGEMENT is not made here. `readsAsFieldName` is injected, and its one home is
 * `packages/design-system/src/lib/formatters/placeholder.ts` — the same predicate the product's own
 * `placeholderOf` is documented against. A second copy of that judgement in this tool would be two
 * predicates that disagree, which is strictly worse than one imperfect one.
 *
 * Only literal placeholders are read. `placeholder={label}` is already the right answer: it is the
 * field's name, arriving from the one place the field's name lives.
 */
export function findPlaceholderProblems(filePath, source, readsAsFieldName) {
  const text = stripComments(source);
  const rawLines = source.split("\n");
  const problems = [];

  for (const match of text.matchAll(PLACEHOLDER_ATTRIBUTE)) {
    const ghostText = match[2];
    if (readsAsFieldName(ghostText)) continue;
    const line = lineOf(text, match.index);
    const nearby = `${rawLines[line - 1] ?? ""}\n${rawLines[line - 2] ?? ""}`;
    if (INLINE_ALLOWANCE.test(nearby)) continue;
    problems.push({
      rule: "placeholder",
      file: filePath,
      line,
      text: ghostText,
      detail:
        `the ghost text "${ghostText}" is a description or an instruction, not the field's name. ` +
        "Ghost text disappears exactly when someone starts typing, which is the moment an " +
        'instruction would be needed — so a placeholder carries the field\'s NAME ("Theme", not ' +
        '"Select a theme"), and anything a person must be told goes in an inline hint under the ' +
        "field, where it stays. Pass the field's own label through `placeholderOf`",
    });
  }

  return problems;
}

// --- rule: no imperative DOM in the ported surfaces --------------------------------------------

/** `$effect`, `$effect.pre` and friends, with the extent of the body each one opens. */
export function effectRegions(text) {
  const regions = [];
  for (const match of text.matchAll(/\$effect(?:\.\w+)?\s*\(/g)) {
    const open = text.indexOf("{", match.index);
    if (open === -1) continue;
    let depth = 0;
    for (let at = open; at < text.length; at += 1) {
      if (text[at] === "{") depth += 1;
      else if (text[at] === "}") {
        depth -= 1;
        if (depth === 0) {
          regions.push([match.index, at]);
          break;
        }
      }
    }
  }
  return regions;
}

/**
 * The mockups' idiom, which must not survive the port.
 *
 * `getElementById` and `innerHTML` have no legitimate form here at all: the first reaches around
 * Svelte's own binding to find a node by a global name, and the second hands the browser a string
 * to parse as markup, which is both an injection surface and the thing that makes a component's
 * rendered output unreviewable.
 *
 * `querySelector` gets ONE exemption, and it is narrow: measuring. A component that has to read a
 * laid-out size does it in an `$effect`, after the DOM exists, and there is no declarative way to
 * ask. Anywhere else, a `bind:this` says the same thing without a selector string that silently
 * stops matching when a class is renamed.
 */
export function findImperativeDomUse(filePath, source) {
  const text = stripStringLiterals(stripComments(source));
  const regions = effectRegions(text);
  const problems = [];

  const forbid = (pattern, detail) => {
    for (const match of text.matchAll(pattern)) {
      problems.push({
        rule: "imperative-dom",
        file: filePath,
        line: lineOf(text, match.index),
        detail,
      });
    }
  };

  forbid(
    /\bgetElementById\b/g,
    "reaches for a node by id. A ported screen is declarative Svelte: bind the element with " +
      "`bind:this` and hold it in state — an id is a global name, and two screens that both use " +
      "one are one copy-paste away from finding each other's nodes",
  );
  forbid(
    /\binnerHTML\b/g,
    "assigns markup as a string. That is an injection surface and it makes the rendered output " +
      "unreviewable — render the markup as Svelte, or, for genuinely untrusted content, sanitize " +
      "it deliberately and say so where it is done",
  );

  for (const match of text.matchAll(/\bquerySelector(?:All)?\b/g)) {
    const inside = regions.some(([start, end]) => match.index > start && match.index < end);
    if (inside) continue;
    problems.push({
      rule: "imperative-dom",
      file: filePath,
      line: lineOf(text, match.index),
      detail:
        "queries the document by selector outside an `$effect`. The one legitimate use is " +
        "measuring a laid-out element, which happens in an effect because that is when the DOM " +
        "exists; everywhere else `bind:this` names the node without a selector string that stops " +
        "matching the day a class is renamed",
    });
  }

  return problems.toSorted((first, second) => first.line - second.line);
}

// --- rule: an allowance may not outlive its violation ------------------------------------------

/** The identity of one violation, for matching an allowance to the thing it excuses. */
export function allowanceKey({ rule, file, text }) {
  return `${rule} ${file} ${text ?? ""}`;
}

/**
 * Apply the recorded allowances to what the scan found, and check the allowances themselves.
 *
 * An allowance is pre-existing debt, declared out loud: it names a rule, a file, optionally the
 * exact text, and the reason it stands. It is NOT a way to make a rule quiet. Two things keep it
 * honest — every allowance carries a reason, and an allowance whose violation is gone is itself a
 * failure, so the list cannot fill up with entries nobody re-reads. That is the same discipline the
 * registry's `pending` mark already uses here.
 */
export function applyAllowances(problems, allowances) {
  const byKey = new Map(allowances.map((allowance) => [allowanceKey(allowance), allowance]));
  const used = new Set();
  const remaining = [];
  const excused = [];

  for (const problem of problems) {
    const key = allowanceKey(problem);
    const allowance = byKey.get(key);
    if (allowance === undefined) {
      remaining.push(problem);
      continue;
    }
    used.add(key);
    excused.push({ problem, allowance });
  }

  for (const allowance of allowances) {
    if (String(allowance.reason ?? "").trim() === "") {
      remaining.push({
        rule: "allowance",
        file: allowance.file,
        detail:
          `the allowance for \`${allowance.rule}\` carries no reason — say what it stands on, or ` +
          "take it out and let the violation fail",
      });
      continue;
    }
    if (used.has(allowanceKey(allowance))) continue;
    remaining.push({
      rule: "allowance",
      file: allowance.file,
      detail:
        `is allowed for \`${allowance.rule}\`${allowance.text === undefined ? "" : ` ("${allowance.text}")`}` +
        ", and no longer violates it. Take the allowance out — an entry that has outlived its " +
        "violation is how a list stops being read",
    });
  }

  return { problems: remaining, excused };
}
// --- rule: one caps register ------------------------------------------------------------------

/** The design system's own recipes, which ARE the caps register and so may spell it out. */
export const CAPS_REGISTER_HOMES = [
  "packages/design-system/src/lib/components",
  "packages/design-system/src/lib/styles",
];

/**
 * The letterspaced small-caps voice, written out by hand.
 *
 * Two shapes, and the second is the reason this rule exists at all. The first is a class list that
 * builds the voice from utilities — `text-xs` + `uppercase` + a `text-text-*` tone. The second is an
 * inline `letter-spacing: var(--mc-tracking-caps)`, which is what a surface reaches for once it
 * notices the utilities alone give uppercase WITHOUT the tracking: Tailwind has no utility for the
 * tracking token, so the only way to finish the voice by hand is raw CSS in a codebase that forbids
 * it. 77 sites had done exactly that.
 *
 * The remedy is FieldLabel, or the `caps` option on the component being dressed (Badge has one).
 */
const CAPS_BY_UTILITIES =
  /class\s*=\s*"(?=[^"]*\btext-xs\b)(?=[^"]*\buppercase\b)(?=[^"]*\btext-text-[a-z-]+\b)[^"]*"/g;
const CAPS_BY_INLINE_STYLE = /style\s*=\s*"[^"]*letter-spacing\s*:[^"]*"/g;

export function findHandWrittenCapsRegister(filePath, source) {
  if (CAPS_REGISTER_HOMES.some((home) => filePath.startsWith(`${home}/`))) return [];
  const text = stripComments(source);
  const problems = [];
  for (const match of text.matchAll(CAPS_BY_UTILITIES)) {
    problems.push({
      rule: "caps-register",
      file: filePath,
      line: lineOf(text, match.index),
      detail:
        "builds the letterspaced small-caps label out of utilities. That voice is one component — " +
        "`FieldLabel` (@magna-carta/design-system/field-label), which renders whichever element the " +
        "surrounding document structure needs. Built by hand it drifts a tone at a time, and it " +
        "arrives without the caps tracking every recipe in the package carries",
    });
  }
  for (const match of text.matchAll(CAPS_BY_INLINE_STYLE)) {
    problems.push({
      rule: "caps-register",
      file: filePath,
      line: lineOf(text, match.index),
      detail:
        "sets letter-spacing in an inline style, which is raw CSS. If this is the caps voice, it is " +
        "`FieldLabel`, or the `caps` option on the component being dressed; if it is a component " +
        "that ought to wear the voice itself, give its recipe the register rather than every caller",
    });
  }
  return problems;
}

// --- rule: one money presenter -----------------------------------------------------------------

/**
 * The two files allowed to turn an amount into a string.
 *
 * `packages/money` owns what an amount IS and prints it exactly from its own decimal; the design
 * system's formatter prints the major-unit numbers a surface hands it. A third would be a third
 * answer to "how much", and the first correction to any of them would leave the others behind.
 */
export const MONEY_PRESENTATION_HOMES = [
  "packages/money/src/format.ts",
  "packages/design-system/src/lib/formatters/money.ts",
];

const CURRENCY_FORMATTING = /style\s*:\s*"currency"/g;

export function findMoneyPresentation(filePath, source) {
  if (MONEY_PRESENTATION_HOMES.includes(filePath)) return [];
  const text = stripComments(source);
  return [...text.matchAll(CURRENCY_FORMATTING)].map((match) => ({
    rule: "money-presentation",
    file: filePath,
    line: lineOf(text, match.index),
    detail:
      "formats currency here. Money reads the same in a cell, a details panel and a printed sheet " +
      "only if one function prints it: `formatMoney` from @magna-carta/design-system/formatters " +
      "for a major-unit number, or `format` from @magna-carta/money for an exact Money",
  }));
}

// --- rule: one refusal sentence ----------------------------------------------------------------

/** Where the sentence a refused control carries is written. */
export const REFUSAL_HOME = "apps/web/src/lib/access/refusal.ts";

/*
 * Both wordings the sentence ever had, and NEITHER of them loosely.
 *
 * "does not hold" on its own is ordinary English — a dev-console note about somebody who "does not
 * hold the address" is not a refusal — so both alternatives require the word the sentence is
 * actually about. That is the difference between a rule people keep and a rule people switch off.
 */
const REFUSAL_PROSE =
  /needs the [^"`\n]{0,80}?(?:permission|capability)|does not hold the [^"`\n]{0,80}?(?:permission|capability)/g;

export function findHandWrittenRefusals(filePath, source) {
  if (filePath === REFUSAL_HOME) return [];
  const text = stripComments(source);
  return [...text.matchAll(REFUSAL_PROSE)].map((match) => ({
    rule: "permission-refusal",
    file: filePath,
    line: lineOf(text, match.index),
    detail:
      "writes the refusal sentence out. It had two wordings before it had one, and the shorter of " +
      "them lost the half a reader can act on: use `permissionRefusal(act, permission)` from " +
      "$lib/access/refusal.ts",
  }));
}

// --- rule: one details panel -------------------------------------------------------------------

/** The shell every ledger's smaller altitude is composed from. */
export const DETAILS_PANEL_HOME = "apps/web/src/lib/details-panel";

/**
 * The panel's frame and its scrolling body, written out rather than composed.
 *
 * Both are matched as the exact utility runs the four copies shared, because that is what a fifth
 * copy is made of: somebody opens one of the four, reads its aside, and writes the same one. A
 * panel assembled from different utilities that happens to look the same is not caught here, and
 * review is the answer to that one.
 */
const PANEL_FRAME =
  /flex h-full w-full flex-col border-l border-border-default bg-surface-default/g;
const PANEL_BODY = /flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16/g;

export function findHandComposedDetailsPanels(filePath, source) {
  if (filePath.startsWith(`${DETAILS_PANEL_HOME}/`)) return [];
  const text = stripComments(source);
  const problems = [];
  for (const [pattern, part] of [
    [PANEL_FRAME, "frame"],
    [PANEL_BODY, "scrolling body"],
  ]) {
    for (const match of text.matchAll(pattern)) {
      problems.push({
        rule: "details-panel",
        file: filePath,
        line: lineOf(text, match.index),
        detail:
          `writes the details panel's ${part} out. Four ledgers each had their own copy of this ` +
          "shape and a correction to it was four edits: compose `$lib/details-panel` " +
          "(DetailsPanel.Root / Header / Body / Section / Facts / Fact) instead",
      });
    }
  }
  return problems;
}
