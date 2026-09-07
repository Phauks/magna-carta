/*
 * THE ONE PAGE INSET, and the rules that keep it one.
 *
 * The App Shell's `<main>` is the scrolling work surface every signed-in screen renders into, and it
 * draws the inset between the chrome and the content ONCE, for everybody. A screen that also pads
 * itself does not look slightly different — it sits at twice every other screen's distance from the
 * chrome, and the difference is invisible on the screen itself and obvious the moment somebody
 * navigates. Tasks, Time and Magnus each carried a second `p-24` for exactly that reason: each was
 * written from a copy of the last one, and a copied wrapper carries a copied mistake. Three screens
 * is where a mistake stops being a mistake and becomes the thing the next screen is copied from.
 *
 * So the rule is stated where it can be checked rather than remembered:
 *
 *   1. No top-level element carries UNIFORM padding — `p-*`, or a whole axis as `px-*` / `py-*`.
 *      Padding an element on every side, or across a whole axis, is what an inset IS, and at the
 *      top level of a screen it lands on top of the shell's. A ONE-SIDED padding is left alone,
 *      because it is never an inset: it is spacing against something in particular, and the home
 *      screen shows the honest use — its closing quote sits under a `border-t` and takes `pt-12`
 *      off its own rule. That is spacing BETWEEN the things on a screen, which this rule does not
 *      govern and should not. The line is drawn on the utility rather than on which element is the
 *      screen's "real" wrapper, because that second question has no reliable answer: the time sheet
 *      is a column AND a record window, both at the top level, and a rule that had to pick one
 *      would have picked wrong.
 *   2. NO top-level element reaches for `flex-1`. `<main>` is a block container, so
 *      `flex-1` on a child resolves against nothing and silently does nothing. A screen that means
 *      to take the height says `h-full`; one that said `flex-1` was never taking it. This is worth a
 *      gate precisely because it fails quietly — nothing looks broken, the list underneath just
 *      stops holding the vertical space it is supposed to hold as rows arrive and filters narrow.
 *
 * THE PREMISES ARE READ, NEVER ASSUMED. Both rules are true only because of how `<main>` is dressed,
 * and `<main>` is free to change. So this module is handed the shell's own markup and derives them:
 * that `<main>` pads itself (so rule 1 has a reason), and that it lays out no children (so rule 2
 * has one). If either stops holding, the scan fails on the PREMISE instead of going quietly on
 * enforcing a rule whose ground has moved — a fitness function that outlives its own reasoning is
 * worse than none, because it is obeyed.
 *
 * WHAT IS IN SCOPE is decided by the layout chain, not by a list. A route file renders into `<main>`
 * when the nearest layout above it is the (app) group's own; anything under a further layout — a
 * matter's sections, settings, tools — renders inside THAT layout's frame, and its spacing is that
 * layout's business rather than this rule's.
 *
 * The rules are pure and the file system stays in index.mjs, so a test can state a screen as a
 * string instead of building a route tree on disk.
 */

/** Elements that never close, so they never open a level. */
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * A Tailwind padding utility that insets on every side of an axis — `p-*` itself, and the two axis
 * forms. Any variant prefix the token carries (`sm:`, `dark:`, `hover:`) is allowed for, and the
 * match is against ONE class token, so `px-24` is a hit and `sm:px-24` is the same hit under a
 * variant, while `mc-panel`, `stop-24` and the one-sided `pt-12` are not.
 */
const PAGE_INSET_UTILITY = /^(?:[\w[\]@.,%+/-]+:)*p[xy]?-/;

/** Any padding at all — what `<main>` is read for, where a one-sided inset would still be one. */
const ANY_PADDING_UTILITY = /^(?:[\w[\]@.,%+/-]+:)*-?p[xytrbsel]?-/;

/** `flex-1` and the two utilities that shorthand the same thing, under the same variant handling. */
const FLEX_GROW_UTILITY = /^(?:[\w[\]@.,%+/-]+:)*flex-(?:1|auto|initial)$/;

/** A flex or grid display utility — what would give a child's `flex-1` something to mean. */
const FLEX_OR_GRID_DISPLAY = /^(?:[\w[\]@.,%+/-]+:)*(?:inline-)?(?:flex|grid)$/;

/** Replaces a region with spaces, keeping its newlines so every reported line number stays true. */
function blankOut(block) {
  return block.replace(/[^\n]/g, " ");
}

/**
 * The markup a component actually PLACES, with everything that is not that blanked out.
 *
 * Three things go, in this order, because each hides the next:
 *
 *   - `<script>`, `<style>` and comments, which hold code and prose rather than markup;
 *   - `{#snippet}` bodies, which are templates handed to something else to render. Their elements
 *     are not the screen's — a screen whose table defines a cell snippet does not thereby have that
 *     cell's `<span>` sitting on the work surface. Snippet bodies are balanced markup, so removing
 *     one leaves the surrounding depth exactly as it was;
 *   - every remaining `{...}` expression. This is what keeps a Svelte block header from being read
 *     as markup, and the time sheet is why it earns a line here: its cell snippet is declared
 *     `{#snippet cell({ row }: DataTable.GridCellContext<TimeEntrySummary>)}`, whose type argument
 *     looks exactly like an opening tag that never closes. Reading it as one swallowed the rest of
 *     the screen and the scan reported the page clean — the quietest way a fitness function can
 *     fail, and the reason this is a scanner rather than a pattern.
 */
function stripNonMarkup(source) {
  const withoutCode = source
    .replace(/<script[\s>][\s\S]*?<\/script>/g, blankOut)
    .replace(/<style[\s>][\s\S]*?<\/style>/g, blankOut)
    .replace(/<!--[\s\S]*?-->/g, blankOut);
  return blankExpressions(blankSnippetBodies(withoutCode));
}

/** Blanks each `{#snippet ...}` … `{/snippet}` region, markers included, nesting respected. */
function blankSnippetBodies(markup) {
  let text = markup;
  for (;;) {
    const open = text.indexOf("{#snippet");
    if (open === -1) return text;
    let depth = 0;
    let cursor = open;
    let end = -1;
    while (cursor < text.length) {
      if (text.startsWith("{#snippet", cursor)) depth += 1;
      else if (text.startsWith("{/snippet}", cursor)) {
        depth -= 1;
        if (depth === 0) {
          end = cursor + "{/snippet}".length;
          break;
        }
      }
      cursor += 1;
    }
    // An unterminated snippet is not something to guess the extent of; leave the rest alone.
    if (end === -1) return text;
    text = text.slice(0, open) + blankOut(text.slice(open, end)) + text.slice(end);
  }
}

/** Blanks every `{...}` region — nesting counted, quoted braces left to the quotes. */
function blankExpressions(markup) {
  let out = "";
  let cursor = 0;
  while (cursor < markup.length) {
    if (markup[cursor] !== "{") {
      out += markup[cursor];
      cursor += 1;
      continue;
    }
    const start = cursor;
    let depth = 0;
    let quote = null;
    while (cursor < markup.length) {
      const character = markup[cursor];
      if (quote !== null) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'" || character === "`") quote = character;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          cursor += 1;
          break;
        }
      }
      cursor += 1;
    }
    out += blankOut(markup.slice(start, cursor));
  }
  return out;
}

/** The class list an opening tag carries, as tokens. A fully dynamic `class={...}` yields none. */
export function classTokensOf(openingTag) {
  const literal = /\sclass=(?:"([^"]*)"|'([^']*)')/.exec(openingTag);
  if (literal === null) return [];
  return (literal[1] ?? literal[2]).split(/\s+/).filter((token) => token !== "");
}

/**
 * One tag, from its `<` to the `>` that genuinely ends it — quotes and `{...}` expressions passed
 * over rather than read.
 *
 * The attribute region is walked a character at a time rather than matched, because a Svelte tag
 * routinely holds a `>` that does not end it: `onclick={() => close()}` is the common one, and a
 * pattern that stopped at the first `>` would read the rest of the handler as markup and lose track
 * of every element after it. Returns null where the `<` opens no tag at all, which the caller steps
 * over.
 */
function readTag(markup, open) {
  let cursor = open + 1;
  const closing = markup[cursor] === "/";
  if (closing) cursor += 1;
  const name = /^[A-Za-z][\w:.-]*/.exec(markup.slice(cursor))?.[0];
  if (name === undefined) return null;
  cursor += name.length;

  let quote = null;
  let braces = 0;
  let previous = "";
  while (cursor < markup.length) {
    const character = markup[cursor];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "{") braces += 1;
    else if (character === "}") braces = Math.max(0, braces - 1);
    else if (character === ">" && braces === 0) {
      return {
        name,
        closing,
        selfClosing: previous === "/",
        text: markup.slice(open, cursor + 1),
        end: cursor + 1,
      };
    }
    if (!/\s/.test(character)) previous = character;
    cursor += 1;
  }
  return null;
}

/**
 * Every opening tag at the top level of a component's markup — the elements that become children of
 * whatever renders the component.
 *
 * Depth is counted over tags rather than indentation, so an element wrapped in an `{#if}` is still
 * seen as top level, which it is. A rule measured on indentation would be evaded by the first screen
 * that renders conditionally, and evaded silently.
 */
export function topLevelElements(source) {
  const markup = stripNonMarkup(source);
  const found = [];
  let depth = 0;
  let cursor = 0;
  while (cursor < markup.length) {
    const open = markup.indexOf("<", cursor);
    if (open === -1) break;
    const tag = readTag(markup, open);
    if (tag === null) {
      cursor = open + 1;
      continue;
    }
    if (tag.closing) depth = Math.max(0, depth - 1);
    else {
      if (depth === 0) {
        found.push({
          name: tag.name,
          tag: tag.text,
          line: markup.slice(0, open).split("\n").length,
          classes: classTokensOf(tag.text),
        });
      }
      if (!tag.selfClosing && !VOID_ELEMENTS.has(tag.name.toLowerCase())) depth += 1;
    }
    cursor = tag.end;
  }
  return found;
}

/**
 * What the shell's `<main>` establishes, read off the shell's own source: the inset it draws, and
 * whether it lays its children out with flex or grid.
 *
 * A shell with no `<main>`, or a `<main>` dressed from an expression this cannot read, is not
 * something to guess about — the caller is told what could not be read and stops.
 */
export function readSurface(shellSource) {
  const opening = topLevelTagNamed(stripNonMarkup(shellSource), "main");
  if (opening === null) return { problem: "it has no <main> element" };
  const classes = classTokensOf(opening);
  if (classes.length === 0) return { problem: "its <main> carries no literal class list" };
  return {
    inset: classes.find((token) => ANY_PADDING_UTILITY.test(token)),
    laysOutChildren: classes.some((token) => FLEX_OR_GRID_DISPLAY.test(token)),
  };
}

/** The first opening tag of a given name, at whatever depth. */
function topLevelTagNamed(markup, wanted) {
  let cursor = 0;
  while (cursor < markup.length) {
    const open = markup.indexOf("<", cursor);
    if (open === -1) return null;
    const tag = readTag(markup, open);
    if (tag === null) {
      cursor = open + 1;
      continue;
    }
    if (!tag.closing && tag.name === wanted) return tag.text;
    cursor = tag.end;
  }
  return null;
}

/**
 * Whether a route file's top-level elements land in `<main>`: true when the nearest layout ABOVE it
 * is the one that renders the shell.
 *
 * A layout is measured against the layouts above it and never itself — the matter layout is a child
 * of `<main>` in exactly the way its own pages are not, and it is the file that has to obey the rule
 * on their behalf.
 */
export function rendersIntoSurface(file, { layouts, shellLayout }) {
  if (file === shellLayout) return false;
  const directory = file.slice(0, file.lastIndexOf("/"));
  const enclosing = layouts
    .filter((layout) => layout !== file)
    .map((layout) => ({ layout, directory: layout.slice(0, layout.lastIndexOf("/")) }))
    .filter(
      ({ directory: layoutDirectory }) =>
        directory === layoutDirectory || directory.startsWith(`${layoutDirectory}/`),
    )
    // A layout's own directory does not enclose it; only a directory above it does.
    .filter(
      ({ directory: layoutDirectory }) =>
        !file.endsWith("/+layout.svelte") || layoutDirectory !== directory,
    )
    .sort((a, b) => b.directory.length - a.directory.length);
  return enclosing[0]?.layout === shellLayout;
}

/**
 * Audits every screen that renders into `<main>`.
 *
 * `files` are `{ path, source }` pairs for the whole route tree; the scan picks its own subjects out
 * of them, so no caller keeps a list of screens in step with the routes on disk.
 */
export function auditPageInset({ files, shellSource, shellLayout }) {
  const surface = readSurface(shellSource);
  if (surface.problem !== undefined) {
    return { premiseProblem: surface.problem, problems: [], screensSeen: 0 };
  }
  if (surface.inset === undefined) {
    return {
      premiseProblem:
        "its <main> no longer draws a page inset, so a screen padding itself is no longer drawing a " +
        "SECOND one — the rule's whole reason is gone, and this scan must be rewritten or retired " +
        "rather than left enforcing it",
      problems: [],
      screensSeen: 0,
    };
  }

  const layouts = files.map((file) => file.path).filter((path) => path.endsWith("/+layout.svelte"));
  const screens = files.filter((file) => rendersIntoSurface(file.path, { layouts, shellLayout }));

  const problems = [];
  for (const screen of screens) {
    // `<svelte:head>` and its kin place nothing on the work surface, so they are not the screen.
    const elements = topLevelElements(screen.source).filter(
      (element) => !element.name.startsWith("svelte:"),
    );

    for (const element of elements) {
      const padding = element.classes.find((token) => PAGE_INSET_UTILITY.test(token));
      if (padding === undefined) continue;
      problems.push({
        rule: "second-inset",
        file: screen.path,
        line: element.line,
        utility: padding,
        message:
          `insets itself with \`${padding}\`, on top of the \`${surface.inset}\` the App ` +
          "Shell's <main> already draws, so it sits at twice every other screen's distance from " +
          "the chrome. Drop it — the spacing BETWEEN the things on the screen is still yours, and " +
          "so is a one-sided padding against a border",
      });
    }

    if (surface.laysOutChildren) continue;
    for (const element of elements) {
      const grow = element.classes.find((token) => FLEX_GROW_UTILITY.test(token));
      if (grow === undefined) continue;
      problems.push({
        rule: "inert-grow",
        file: screen.path,
        line: element.line,
        utility: grow,
        message:
          `reaches for \`${grow}\` at its top level, and <main> is a block container, so it ` +
          "resolves against nothing and does nothing at all. A screen that means to take the " +
          "height says `h-full`",
      });
    }
  }

  return { premiseProblem: undefined, problems, screensSeen: screens.length, inset: surface.inset };
}
