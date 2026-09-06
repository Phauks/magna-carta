/*
 * A screen's header is its NAME. This is the gate that keeps it one.
 *
 * The rule was issued against the list screens in 2026-08 ("a heading carries no explanatory
 * sub-text") and bound only them, so the rest of the application drifted into four different ways
 * of introducing a screen: a greeting, a title the sidebar disagreed with, an eyebrow repeating the
 * title it sat above, and a sentence under the title restating it. Consolidating them was a day's
 * work; the drift took an afternoon to reappear — the uploads screen shipped with
 * `eyebrow="Uploads"` over `title="Uploads"` while the consolidation was still open, written by
 * somebody with no way to know the rule existed. That is the case this scan exists for. A rule
 * recorded in a ledger binds the people who read the ledger; a rule with a gate binds the diff.
 *
 * THREE QUESTIONS, all answered from the route tree and the sidebar registry rather than a list
 * somebody keeps by hand:
 *
 *   1. Does any screen carry an EYEBROW? The eyebrow names what a screen's SUBJECT is — PERSON over
 *      a person's name — so on a screen that IS a destination the title already answers it and the
 *      eyebrow can only repeat it. No screen in the application carries one today.
 *   2. Does a destination screen's TITLE match what the sidebar calls it? A screen and the row that
 *      opens it disagreeing about the screen's name costs the product one vocabulary and buys
 *      nothing.
 *   3. Does a header's META line carry a FACT, or a description? This is the sub-text rule, and the
 *      test it was given is whether removing the line loses a fact. That is not mechanically
 *      decidable in general — but its SHAPE is, and the shape is unambiguous in practice: a fact is
 *      read from somewhere (an interpolation, a component), and a description is a fixed sentence
 *      typed into the markup. Every line removed in the consolidation was static text; every line
 *      kept interpolates a value or renders a component. So a meta whose whole body is static prose
 *      is reported, and one that reads anything is left alone.
 *
 * Rule 3 is a heuristic and says so. It is deliberately biased toward silence: it reports only the
 * shape that has never once been a fact, so a false positive needs somebody to write a header line
 * that is both fixed prose AND a fact — at which point the honest answer is usually that it belongs
 * on the page anyway, and the exemption below is the escape hatch when it is not.
 */

/** The header component every screen states itself through. */
export const SCREEN_HEADER = "ScreenHeader";

/** The sidebar registry: the one place a destination's user-facing name lives. */
export const DESTINATIONS_SOURCE = "apps/web/src/lib/navigation/destinations.ts";

/*
 * NAMED EXEMPTIONS. A header that genuinely needs one of the shapes above, with the reason, so the
 * exception is visible in the gate rather than hidden in a file nobody re-reads. Keyed by
 * repository-relative path. Empty is the honest state today, and adding an entry should feel like
 * a decision.
 */
export const EXEMPTIONS = new Map();

/*
 * Blanks the script block and every comment, so a scan never matches a mention inside prose or
 * code. It BLANKS rather than deletes — each stripped region becomes the same number of characters,
 * newlines kept — because every offset this module reports is turned back into a line number
 * against the original file. Deleting would slide every subsequent match earlier and quietly
 * misreport the line, which is worse than not reporting one.
 */
export function markupOf(source) {
  const blank = (text) => text.replace(/[^\n]/gu, " ");
  return source
    .replace(/<script[\s\S]*?<\/script>/gu, blank)
    .replace(/<!--[\s\S]*?-->/gu, blank)
    .replace(/\/\*[\s\S]*?\*\//gu, blank);
}

/**
 * Every `<ScreenHeader …>` opening tag in a file, as { attributes, index }. Handles both the
 * self-closing form and the form with snippet children, because the attributes are all that matter
 * and both spell them the same way.
 */
export function headerTags(markup) {
  const tags = [];
  const opening = new RegExp(`<${SCREEN_HEADER}(\\s[^>]*?)?/?>`, "gu");
  for (const match of markup.matchAll(opening)) {
    tags.push({ attributes: match[1] ?? "", index: match.index ?? 0 });
  }
  return tags;
}

/** The line a character offset falls on, 1-indexed, for a message somebody can click. */
export function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

/** A literal string attribute's value, or null when absent or dynamic (`title={…}`). */
export function literalAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`, "u"));
  return match === null ? null : match[1];
}

/** Whether the tag passes the attribute at all, literal or not. */
export function hasAttribute(attributes, name) {
  return new RegExp(`\\b${name}\\s*=`, "u").test(attributes);
}

/**
 * The sidebar's destinations as { href -> label }. Read from the registry source rather than
 * imported, so this scan stays a plain script with no build step behind it.
 */
export function destinationLabels(source) {
  const labels = new Map();
  for (const match of source.matchAll(
    /\bid:\s*"[^"]+",\s*\n\s*label:\s*"([^"]+)",\s*\n\s*href:\s*"([^"]+)",/gu,
  )) {
    if (!labels.has(match[2])) labels.set(match[2], match[1]);
  }
  return labels;
}

/**
 * The body of each `{#snippet meta()}…{/snippet}` in the markup, with its offset. Nesting is
 * counted rather than matched lazily, because a meta that holds an `{#if}` closes with a `{/if}`
 * of its own and a lazy match would stop at the first one.
 */
export function metaSnippets(markup) {
  const found = [];
  const opener = /\{#snippet meta\(\)\}/gu;
  /*
   * One token alternation, and the two halves must not overlap: an earlier version spelled the
   * closer as `\{[#/](…|snippet)\b`, which matched the OPENING half of `{/snippet}` and left the
   * closer itself unrecognised — so every body came back empty and rule 3 reported nothing while
   * appearing to run. Openers and closers are matched as distinct, fully-delimited shapes.
   */
  const token = /\{#(?:if|each|await|key|snippet)\b|\{\/(?:if|each|await|key|snippet)\}/gu;

  for (const match of markup.matchAll(opener)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let cursor = -1;
    token.lastIndex = start;
    let step;
    while ((step = token.exec(markup)) !== null) {
      if (step[0].startsWith("{#")) {
        depth += 1;
        continue;
      }
      depth -= 1;
      if (depth === 0) {
        cursor = step.index;
        break;
      }
    }
    // An unclosed snippet is a syntax error the compiler reports; here it simply has no body.
    if (cursor === -1) continue;
    found.push({ body: markup.slice(start, cursor), index: match.index ?? 0 });
  }
  return found;
}

/**
 * Whether a meta body READS something — an interpolation, or a rendered component. Static prose
 * reads nothing, which is the shape rule 3 reports. `&nbsp;` and friends are not reads; a bare
 * entity is still a fixed string.
 */
export function readsAValue(body) {
  if (/\{[^}]/u.test(body)) return true;
  return /<[A-Z][A-Za-z0-9]*[\s/>]/u.test(body);
}

/**
 * The screens' headers, audited. `files` is [{ path, source }]; `destinations` maps href to label;
 * `routeHref` maps a file path to the destination path it serves, or null when it serves none.
 */
export function auditScreenHeaders({ files, destinations, routeHref, exemptions = EXEMPTIONS }) {
  const problems = [];
  let headersSeen = 0;

  for (const { path: file, source } of files) {
    if (exemptions.has(file)) continue;
    const markup = markupOf(source);
    const tags = headerTags(markup);
    headersSeen += tags.length;

    for (const tag of tags) {
      const line = lineOf(source, tag.index);

      if (hasAttribute(tag.attributes, "eyebrow")) {
        problems.push({
          file,
          line,
          rule: "eyebrow",
          message:
            "carries an `eyebrow`. The eyebrow names what a screen's SUBJECT is (PERSON over a " +
            "person's name), never what the screen is — a screen's own title already says that, " +
            "so an eyebrow here can only repeat it. Drop it.",
        });
      }

      const href = routeHref(file);
      const expected = href === null ? null : (destinations.get(href) ?? null);
      const title = literalAttribute(tag.attributes, "title");
      if (expected !== null && title !== null && title !== expected) {
        problems.push({
          file,
          line,
          rule: "title",
          message:
            `titles itself "${title}" but the sidebar calls this destination "${expected}". A ` +
            "screen and the row that opens it must agree on the screen's name — take it from " +
            `${DESTINATIONS_SOURCE}.`,
        });
      }
    }

    for (const meta of metaSnippets(markup)) {
      if (tags.length === 0) continue;
      if (readsAValue(meta.body)) continue;
      const text = meta.body
        .replace(/<[^>]*>/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
      if (text === "") continue;
      problems.push({
        file,
        line: lineOf(source, meta.index),
        rule: "meta",
        message:
          `states "${text}" under its title, and reads nothing to do it. A header's meta line ` +
          "carries FACTS — a date, a count, a status — not a sentence describing the screen. If " +
          "the line tells the reader something they need, it belongs on the page where they need " +
          "it; otherwise it is restating the title. See docs/conventions/design-corrections.md, " +
          '"Screen headers".',
      });
    }
  }

  return { problems, headersSeen };
}
