/*
 * The link rules of the dead-link gate, and why each one is shaped the way it is. The runner is
 * index.mjs; everything here is a pure function over text so it can be tested without a repository
 * and self-tested on every invocation.
 *
 * THE SLUG IS THE HARD PART. A link that names a file either resolves or does not, and a mistake
 * there is a typo somebody notices. A link that carries `#an-anchor` is decided by GitHub's heading
 * slugger, and a gate that computes it even slightly differently reports dozens of perfectly good
 * links as broken — which is the one failure that gets a gate switched off. So the rules below are
 * written against what GitHub's slugger actually does, not against a plausible summary of it:
 *
 *   - lowercase, trimmed;
 *   - every character that is not a letter, a number, a combining mark, a hyphen, an underscore or a
 *     space is DELETED (not replaced) — so `Trust & costs` becomes `trust--costs`, with the two
 *     spaces that survive the deleted ampersand each becoming a hyphen;
 *   - then every remaining space becomes a hyphen;
 *   - a repeated slug in one document gets `-1`, `-2`, … in document order.
 *
 * Underscores survive that filter, which is why emphasis has to be unwrapped BEFORE it runs: the
 * rendered text of `_Delivery model_` is `Delivery model` and its slug is `delivery-model`, but the
 * raw text would slug to `_delivery-model_`. The unwrapping is restricted to underscores that are
 * not flanked by word characters, because CommonMark does not treat `amount_minor_value` as
 * emphasis and neither may this.
 *
 * WHAT THESE RULES DELIBERATELY DO NOT CATCH:
 *
 *   - Anything with a scheme (`https:`, `mailto:`, and a Windows path like `C:/dev/...` by the same
 *     test). External reachability is a network question and a gate must not have one.
 *   - Reference-style USES (`[text][label]`). The definition line `[label]: target` is checked, which
 *     is where the path lives; an unresolvable label is a rendering problem, not a rotted path.
 *   - Raw HTML `<a href>` / `<img src>`. Markdown link syntax is what the documentation uses.
 *   - A root-absolute `/docs/thing.md`. On GitHub that addresses the site root rather than the
 *     repository, so it is not a relative link and this gate has no opinion on it.
 *   - Line-number anchors into source (`index.mjs#L42`) and anchors into anything that is not
 *     Markdown. Only a Markdown file has headings to check them against.
 *   - Setext headings underlined with hyphens are read GENEROUSLY: any non-blank line followed by a
 *     rule of hyphens contributes an anchor, even where a parser would call it a table rule or a
 *     thematic break. Extra anchors can only silence a finding, never invent one, and that is the
 *     safe direction to be wrong in for something this gate does not otherwise reason about.
 */

/** Every character of a match becomes a space, so every index after it still points where it did. */
const blank = (match) => match.replaceAll(/[^\n]/g, " ");

export function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/*
 * Fenced code blocks hold example Markdown — `docs/active-work/README.md` shows the shape of a stream
 * note, several conventions files show a link the author is telling you NOT to write. Those are
 * illustrations, not links, and a gate that followed them would fail on documentation that is doing
 * its job. Blanked rather than removed, so line numbers survive.
 */
export function blankFencedCode(markdown) {
  const lines = markdown.split("\n");
  let fence = null;
  return lines
    .map((line) => {
      const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence === null) {
        if (opener) {
          fence = opener[1][0].repeat(3);
          return blank(line);
        }
        return line;
      }
      if (opener && opener[1][0] === fence[0]) fence = null;
      return blank(line);
    })
    .join("\n");
}

/*
 * Inline code spans hold the same illustrations in one line. Blanking them is also what makes the
 * repository's own house style safe: `[`docs/conventions/dates.md`](docs/conventions/dates.md)`
 * writes the path twice, once as code inside the link text. Blanking the code span leaves the link
 * text empty and the target untouched, which is exactly what the extractor wants.
 *
 * An unpaired backtick blanks more than it should. That costs a missed link, never a false one.
 */
export function blankInlineCode(markdown) {
  return markdown.replaceAll(/(`+)(?:(?!\1)[\s\S])*?\1/g, blank);
}

/** Text with no link in it can still be read: `[a](b)` inside a comment is still a link. */
export function readableText(markdown) {
  return blankInlineCode(blankFencedCode(markdown));
}

const INLINE_LINK = /!?\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^\s)]*)(?:\s+"[^"\n]*"|\s+'[^'\n]*')?\s*\)/g;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]\n]+\]:[ \t]*(\S+)/gm;

/** A scheme (`https:`, `mailto:`, `C:`) or a root-absolute path — neither is ours to resolve. */
export function isExternalTarget(target) {
  return (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || target.startsWith("//") || target.startsWith("/")
  );
}

/**
 * Every relative link in a Markdown document, as `{ target, anchor, line }`. `target` is the path
 * part ("" for a link into the same document) and `anchor` is the fragment without its `#`, or null.
 */
export function extractLinks(markdown) {
  const text = readableText(markdown);
  const links = [];
  for (const pattern of [INLINE_LINK, REFERENCE_DEFINITION]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const raw = match[1].replace(/^<|>$/g, "").trim();
      if (raw === "" || isExternalTarget(raw)) continue;
      const hash = raw.indexOf("#");
      const target = hash === -1 ? raw : raw.slice(0, hash);
      const anchor = hash === -1 ? null : raw.slice(hash + 1);
      if (target === "" && (anchor === null || anchor === "")) continue;
      links.push({
        target: decodePath(target.split("?")[0]),
        anchor: anchor === null || anchor === "" ? null : decodePath(anchor),
        line: lineOf(text, match.index),
      });
    }
  }
  return links.sort((left, right) => left.line - right.line);
}

/** `%20` in a path is a space on disk. A malformed escape is left exactly as written. */
export function decodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/*
 * The rendered text of a heading, which is what the slug is computed from. Links become their text,
 * images their alt text, emphasis is unwrapped, and a closing run of hashes is dropped.
 */
export function headingText(raw) {
  return raw
    .replace(/\s+#+\s*$/, "")
    .replaceAll(/!?\[([^\]\n]*)\]\((?:[^)\n]*)\)/g, "$1")
    .replaceAll(/!?\[([^\]\n]*)\]\[[^\]\n]*\]/g, "$1")
    .replaceAll(/\*\*([^*]+)\*\*/g, "$1")
    .replaceAll(/\*([^*]+)\*/g, "$1")
    .replaceAll(/(?<![\w])__([^_]+)__(?![\w])/g, "$1")
    .replaceAll(/(?<![\w])_([^_]+)_(?![\w])/g, "$1")
    .trim();
}

/** GitHub's heading slug for one piece of rendered text, before duplicate numbering. */
export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replaceAll(/[^\p{L}\p{N}\p{M}\-_ ]/gu, "")
    .replaceAll(" ", "-");
}

/**
 * Every anchor a Markdown document offers: its headings (numbered for duplicates the way GitHub
 * numbers them) and any `id=`/`name=` attribute in raw HTML it embeds.
 */
export function collectAnchors(markdown) {
  const text = blankFencedCode(markdown);
  const lines = text.split("\n");
  const seen = new Map();
  const anchors = new Set();
  const add = (raw) => {
    const base = slugify(headingText(raw));
    if (base === "") return;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${String(count)}`);
  };
  for (const [index, line] of lines.entries()) {
    const atx = /^ {0,3}#{1,6}\s+(.*)$/.exec(line);
    if (atx) {
      add(atx[1]);
      continue;
    }
    const next = lines[index + 1];
    if (next !== undefined && line.trim() !== "" && /^ {0,3}(=+|-+)\s*$/.test(next))
      add(line.trim());
  }
  for (const match of text.matchAll(/<[a-zA-Z][^>]*\s(?:id|name)=["']([^"']+)["']/g)) {
    anchors.add(match[1]);
  }
  return anchors;
}

/**
 * The gate's decision for one link, given what the tree can answer: `null` when the link is sound,
 * or `{ rule, detail }` when it is not.
 *
 * @param {object} link  one entry from extractLinks, already resolved to a repo-relative `path`.
 * @param {object} tree
 * @param {(path: string) => "file"|"directory"|null} tree.kindOf  what lives at a repo-relative path.
 * @param {(path: string) => Set<string>} tree.anchorsOf  the anchors a Markdown file offers.
 */
export function checkLink(link, tree) {
  const kind = tree.kindOf(link.path);
  if (kind === null) {
    return {
      rule: "missing-target",
      detail: `${link.path} does not exist — repoint the link at the file that holds this now, or delete the sentence that depends on it`,
    };
  }
  if (link.anchor === null || kind !== "file" || !link.path.endsWith(".md")) return null;
  const anchors = tree.anchorsOf(link.path);
  if (anchors.has(link.anchor)) return null;
  const near = [...anchors].find(
    (one) => one.startsWith(link.anchor) || link.anchor.startsWith(one),
  );
  return {
    rule: "missing-anchor",
    detail:
      `${link.path} has no heading that slugs to "#${link.anchor}"` +
      (near === undefined ? "" : ` — the closest heading there is "#${near}"`),
  };
}

/*
 * The fixtures the gate self-tests against on every invocation, and that index.test.mjs drives
 * through the same functions. Each is a shape this tree actually contains, or one that cost a false
 * positive while the slug rules were being written against it.
 */
export const SELF_TEST = [
  {
    name: "an inline relative link is found with its line",
    markdown: "# Title\n\nSee [the rules](docs/conventions/dates.md).\n",
    links: [{ target: "docs/conventions/dates.md", anchor: null, line: 3 }],
  },
  {
    name: "the house style — a code span inside the link text — does not hide the target",
    markdown: "See [`tooling/lint-status.mjs`](../../tooling/lint-status.mjs).\n",
    links: [{ target: "../../tooling/lint-status.mjs", anchor: null, line: 1 }],
  },
  {
    name: "an anchor is split off the path, and a query string is dropped",
    markdown: "[x](../Firm-Handbook.md#core-domain)\n",
    links: [{ target: "../Firm-Handbook.md", anchor: "core-domain", line: 1 }],
  },
  {
    name: "a link into the same document keeps an empty target",
    markdown: "[jump](#golden-rules)\n",
    links: [{ target: "", anchor: "golden-rules", line: 1 }],
  },
  {
    name: "external links are out of scope — a gate must not depend on the network",
    markdown: "[a](https://example.com) [b](http://x.y) [c](mailto:x@y.z) [d](C:/dev/thing)\n",
    links: [],
  },
  {
    name: "a root-absolute path is not a relative link",
    markdown: "[a](/docs/thing.md)\n",
    links: [],
  },
  {
    name: "a link inside a fenced block is an illustration, not a link",
    markdown: "```markdown\n[x](does/not/exist.md)\n```\n\n[y](real.md)\n",
    links: [{ target: "real.md", anchor: null, line: 5 }],
  },
  {
    name: "a link inside an inline code span is an illustration too",
    markdown: "Never write `[x](does/not/exist.md)` — write [y](real.md).\n",
    links: [{ target: "real.md", anchor: null, line: 1 }],
  },
  {
    name: "a reference definition carries a path and is checked; its uses are not",
    markdown: "See [the log][log].\n\n[log]: docs/Decision-Log.md\n",
    links: [{ target: "docs/Decision-Log.md", anchor: null, line: 3 }],
  },
  {
    name: "a link title in quotes is not mistaken for the target",
    markdown: '[x](docs/now.md "The build register")\n',
    links: [{ target: "docs/now.md", anchor: null, line: 1 }],
  },
  {
    name: "a percent-escaped space resolves to the space on disk",
    markdown: "[x](docs/a%20b.md)\n",
    links: [{ target: "docs/a b.md", anchor: null, line: 1 }],
  },
  {
    name: "an image is a link to a file that must exist",
    markdown: "![a diagram](docs/images/flow.png)\n",
    links: [{ target: "docs/images/flow.png", anchor: null, line: 1 }],
  },
  {
    name: "headings slug the way GitHub slugs them, punctuation deleted rather than replaced",
    markdown: "# Trust & costs\n## Authentication, encryption\n### `vp run worktrees`\n",
    anchors: ["trust--costs", "authentication-encryption", "vp-run-worktrees"],
  },
  {
    name: "emphasis is unwrapped before slugging, but an underscored identifier is not",
    markdown: "## _Delivery model_\n## The **hard** part\n## amount_minor and rate_e4\n",
    anchors: ["delivery-model", "the-hard-part", "amount_minor-and-rate_e4"],
  },
  {
    name: "a heading that is a link slugs to its text, never to its target",
    markdown: "## [The firm handbook](docs/Firm-Handbook.md)\n",
    anchors: ["the-firm-handbook"],
  },
  {
    name: "an em dash leaves the two spaces that flanked it, so the slug doubles its hyphen",
    markdown: "## Orientation — where everything lives\n",
    anchors: ["orientation--where-everything-lives"],
  },
  {
    name: "repeated headings are numbered in document order, as GitHub numbers them",
    markdown: "## Notes\n## Notes\n## Notes\n",
    anchors: ["notes", "notes-1", "notes-2"],
  },
  {
    name: "a heading inside a fenced block is not a heading",
    markdown: "# Real\n\n```\n# Fake\n```\n",
    anchors: ["real"],
  },
  {
    name: "a closing run of hashes is not part of the heading",
    markdown: "## Commands ##\n",
    anchors: ["commands"],
  },
  {
    name: "an explicit HTML anchor is an anchor",
    markdown: '<a id="ledger-rules"></a>\n\n# Ledger rules\n',
    anchors: ["ledger-rules"],
  },
  {
    name: "a missing file is reported with the path that does not exist",
    link: { path: "docs/gone.md", anchor: null },
    tree: {},
    expect: "missing-target",
  },
  {
    name: "a directory target resolves, and carries no anchor question",
    link: { path: "docs/conventions", anchor: "anything" },
    tree: { "docs/conventions": "directory" },
    expect: null,
  },
  {
    name: "an anchor that exists passes",
    link: { path: "docs/x.md", anchor: "golden-rules" },
    tree: { "docs/x.md": "file" },
    anchorsBy: { "docs/x.md": ["golden-rules"] },
    expect: null,
  },
  {
    name: "an anchor that does not exist is reported",
    link: { path: "docs/x.md", anchor: "golden-rule" },
    tree: { "docs/x.md": "file" },
    anchorsBy: { "docs/x.md": ["golden-rules"] },
    expect: "missing-anchor",
  },
  {
    name: "an anchor into a source file is not checked — only Markdown has headings",
    link: { path: "tooling/lint-status.mjs", anchor: "L42" },
    tree: { "tooling/lint-status.mjs": "file" },
    expect: null,
  },
];
