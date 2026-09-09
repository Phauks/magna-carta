/*
 * THE ONE SCROLLBAR, and the rules that keep it one.
 *
 * Every scroll region we draw wears the same slim, tokenised scrollbar — the `mc-scrollbar` recipe
 * in packages/design-system/src/lib/styles/recipes/scrollbar.css — or, where a scrollbar appearing
 * would reflow the strip it sits in, its `mc-scrollbar-hidden` sibling with a gilt edge rule
 * (ScrollEdgeHint) saying what the scrollbar no longer can. A region that wears neither gets the
 * operating system's: a fat grey bar with stepper arrows in Chrome, a different one on macOS, a
 * third in Firefox. It is not subtly off — it is the only chrome on the screen the design system
 * did not draw, and it appears exactly when content grows past its box, which is to say on real
 * data and never in the state the screen was built in.
 *
 * That is why this is a gate rather than a convention. The defect is invisible while you build and
 * obvious to whoever reads the deployed screen, and the fix is one class nobody remembers to add.
 * The conflicts check panel is what made it a rule: its fields pane scrolls (the modal frame says
 * so in CSS), the pane element named no recipe, and every panel in the product had the same bug.
 *
 * THE RULE. Any element that can scroll names a scrollbar recipe on the same class expression.
 *
 * WHAT "CAN SCROLL" MEANS IS DERIVED, NEVER LISTED. Two ways an element comes to scroll:
 *
 *   1. A Tailwind overflow utility that can produce a scrollbar — `overflow-auto`, `overflow-scroll`
 *      and their two axis forms, under any variant prefix. `overflow-hidden` and `overflow-clip` are
 *      not among them: they never draw one.
 *   2. A design-system class whose own CSS declares `overflow`, `overflow-x` or `overflow-y` as
 *      `auto` or `scroll`. These are read out of the design system's stylesheets at scan time rather
 *      than written down here, so a recipe that starts scrolling — or stops — moves this gate with
 *      it instead of drifting from it. `.mc-modal-frame-pane` is the worked example: nothing in the
 *      markup says "scroll", and it does.
 *
 * THE PREMISE IS READ, NEVER ASSUMED. The whole rule rests on the two recipe classes existing. If
 * they are renamed or removed, the scan fails on the PREMISE rather than going on quietly demanding
 * a class that dresses nothing — a fitness function that outlives its own reasoning is worse than
 * none, because it is obeyed.
 *
 * WHAT A CLASS EXPRESSION IS. The pairing has to be checkable, so it is checked where both halves
 * are written: the value of one `class` attribute (quoted or `{...}`, `mergeClasses` calls and all),
 * or, outside any such attribute, one string literal — which is how a shared class constant in a
 * `.ts` file is written. A region that took its recipe from somewhere else and its overflow from
 * here is not something this scan can see, and is not something a reader can see either.
 *
 * The rules are pure and the file system stays in index.mjs, so a test states a screen as a string.
 */

/** The recipe that dresses a scrollbar, and the one that removes it. Either satisfies the rule. */
export const SCROLLBAR_RECIPES = ["mc-scrollbar", "mc-scrollbar-hidden"];

/** Where those two are defined. Read for the premise check, and named in every failure message. */
export const SCROLLBAR_RECIPE_FILE = "packages/design-system/src/lib/styles/recipes/scrollbar.css";

/**
 * A Tailwind overflow utility that can draw a scrollbar. Any variant prefix (`sm:`, `dark:`) is
 * allowed for, and the match is against ONE class token — so `overflow-y-auto` is a hit,
 * `lg:overflow-auto` is the same hit under a variant, and `overflow-hidden` is not a hit at all.
 */
const SCROLLING_UTILITY = /^(?:[\w[\]@.,%+/-]+:)*overflow(?:-[xy])?-(?:auto|scroll)$/;

/** An `overflow` declaration whose value can draw a scrollbar, in a stylesheet. */
const SCROLLING_DECLARATION = /(?:^|[\s;{])overflow(?:-[xy])?\s*:\s*(?:auto|scroll)\s*(?:;|$|})/;

/** A class selector in a CSS rule's prelude, so `.mc-table-scroll:hover > .mc-row` yields both. */
const CLASS_SELECTOR = /\.(-?[_a-zA-Z][\w-]*)/g;

/** Splits a class expression into the tokens a browser would see as class names. */
function classTokens(text) {
  return text.split(/[^\w[\]@.,%:+/-]+/).filter((token) => token.length > 0);
}

/** Whether a class expression names one of the recipes. */
function namesRecipe(text) {
  return classTokens(text).some((token) => SCROLLBAR_RECIPES.includes(token));
}

/**
 * The design-system classes whose CSS makes them scroll.
 *
 * Comments go first — a stylesheet explaining why it does NOT scroll something would otherwise
 * register the class it is talking about — and the two recipe classes are excluded, since a rule
 * that says "this is what a scrollbar looks like" is not a region that needs one.
 */
export function scrollingRecipeClasses(stylesheets) {
  const found = new Set();
  for (const { source } of stylesheets) {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const [, prelude, body] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!SCROLLING_DECLARATION.test(body)) continue;
      for (const [, className] of prelude.matchAll(CLASS_SELECTOR)) {
        if (SCROLLBAR_RECIPES.includes(className)) continue;
        found.add(className);
      }
    }
  }
  return found;
}

/**
 * The source with everything that is not code blanked out, newlines kept so line numbers hold.
 *
 * Comments are the whole point: this file's own head names `overflow-auto` and `mc-modal-frame-pane`
 * a dozen times, and so does every component that explains its scroll region. A scan that read prose
 * would report its own documentation.
 */
function stripComments(source) {
  const blank = (block) => block.replace(/[^\n]/g, " ");
  return (
    source
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/\/\*[\s\S]*?\*\//g, blank)
      // A line comment, but never the `//` in a URL — `https://…` inside a string is not a comment.
      .replace(/(^|[^:\w])\/\/[^\n]*/g, (match, lead) => lead + blank(match.slice(lead.length)))
  );
}

/** Reads a balanced `{…}` from `text` at `start`, returning the index just past its close. */
function pastBalancedBraces(text, start) {
  let depth = 0;
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
  }
  return text.length;
}

/** Reads a quoted string from `text` at its opening quote, returning the index just past its close. */
function pastQuoted(text, start) {
  const quote = text[start];
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] === "\\") cursor += 1;
    else if (text[cursor] === quote) return cursor + 1;
  }
  return text.length;
}

/**
 * Every `class` attribute's value, as a span over the source. `class:foo={…}` is a Svelte class
 * DIRECTIVE toggling one name and is not one of these; neither is `className`, which is a variable.
 */
function classAttributeSpans(source) {
  const spans = [];
  for (const match of source.matchAll(/(?<![\w:-])class\s*=\s*/g)) {
    const start = match.index + match[0].length;
    const opener = source[start];
    if (opener === "{") spans.push({ start, end: pastBalancedBraces(source, start) });
    else if (opener === '"' || opener === "'")
      spans.push({ start, end: pastQuoted(source, start) });
  }
  return spans;
}

/** Every string literal, as a span. The unit a shared class constant is written in. */
function stringLiteralSpans(source) {
  const spans = [];
  let cursor = 0;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '"' || character === "'" || character === "`") {
      const end = pastQuoted(source, cursor);
      spans.push({ start: cursor, end });
      cursor = end;
    } else cursor += 1;
  }
  return spans;
}

/** The 1-based line an offset falls on. */
function lineAt(source, offset) {
  let line = 1;
  for (let cursor = 0; cursor < offset; cursor += 1) if (source[cursor] === "\n") line += 1;
  return line;
}

/**
 * Audits one file's class expressions.
 *
 * A class attribute is the outer unit and wins: the recipe and the overflow may be in different
 * string literals of the same `mergeClasses` call, and that is a region a reader can see is dressed.
 * Only string literals OUTSIDE every class attribute are units of their own.
 */
export function auditFile({ path, source, scrollingClasses }) {
  const code = stripComments(source);
  const attributes = classAttributeSpans(code);
  const inAttribute = (span) =>
    attributes.some((attribute) => span.start >= attribute.start && span.end <= attribute.end);
  const units = [...attributes, ...stringLiteralSpans(code).filter((span) => !inAttribute(span))];

  const problems = [];
  for (const unit of units) {
    const text = code.slice(unit.start, unit.end);
    const tokens = classTokens(text);
    const scroller = tokens.find(
      (token) => SCROLLING_UTILITY.test(token) || scrollingClasses.has(token),
    );
    if (scroller === undefined) continue;
    if (namesRecipe(text)) continue;
    problems.push({
      file: path,
      line: lineAt(code, unit.start),
      scroller,
      // Why this token scrolls, so the message can say it — a recipe class does not look like one.
      reason: SCROLLING_UTILITY.test(scroller) ? "utility" : "recipe",
    });
  }
  return problems;
}

/**
 * The whole scan. `stylesheets` derives what scrolls; `files` is what is held to it.
 *
 * `premiseProblem` is set when the recipe itself has moved out from under the rule, and no file
 * problem is reported alongside it — the rule has no ground to stand on until that is answered.
 */
export function auditScrollbars({ files, stylesheets, recipeSource }) {
  const missing = SCROLLBAR_RECIPES.filter(
    (recipe) => !new RegExp(`\\.${recipe}\\b`).test(recipeSource ?? ""),
  );
  if (missing.length > 0) {
    return {
      premiseProblem: `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} no longer defined in ${SCROLLBAR_RECIPE_FILE}`,
      problems: [],
      scrollingClasses: [],
      regionsSeen: 0,
    };
  }

  const scrollingClasses = scrollingRecipeClasses(stylesheets);
  const problems = [];
  let regionsSeen = 0;
  for (const file of files) {
    const found = auditFile({ ...file, scrollingClasses });
    problems.push(...found);
    regionsSeen += countRegions(file, scrollingClasses);
  }
  return { problems, scrollingClasses: [...scrollingClasses].sort(), regionsSeen };
}

/** How many scroll regions the scan looked at — the number a clean run reports. */
function countRegions({ source }, scrollingClasses) {
  const code = stripComments(source);
  const attributes = classAttributeSpans(code);
  const inAttribute = (span) =>
    attributes.some((attribute) => span.start >= attribute.start && span.end <= attribute.end);
  const units = [...attributes, ...stringLiteralSpans(code).filter((span) => !inAttribute(span))];
  return units.filter((unit) =>
    classTokens(code.slice(unit.start, unit.end)).some(
      (token) => SCROLLING_UTILITY.test(token) || scrollingClasses.has(token),
    ),
  ).length;
}
