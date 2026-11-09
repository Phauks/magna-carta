/*
 * A changelog entry's text, turned into something the screen can draw without `{@html}`.
 *
 * The customer changelog (docs/public-changelog.md) is curated prose, and the prose leans on a
 * small, fixed slice of Markdown: paragraphs separated by a blank line, **bold** for the lead
 * sentence, `code` for a literal a reader types or sees, the odd _emphasis_, and a link to a user
 * guide. That slice is all this reads. It returns a tree of plain nodes the page renders through
 * ordinary Svelte markup, so no string from the document ever reaches the DOM as markup — an entry
 * that happened to contain an angle bracket is text, not an element.
 *
 * LINKS RENDER AS THEIR TEXT. The document's links are relative to the repository (`user/...md`),
 * which is a path in this source tree rather than an address the application serves, so following
 * one would land on the not-found screen. The words stay; the address is dropped until the help
 * centre gives those guides a public home (the Documentation entry in
 * src/lib/navigation/ecosystem-sites.ts is that switch).
 *
 * Anything this does not recognise stays as the characters that were written. An unclosed `**`
 * reads as two asterisks rather than swallowing the rest of the entry into bold.
 */

export type ChangelogInline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong"; readonly children: readonly ChangelogInline[] }
  | { readonly kind: "emphasis"; readonly children: readonly ChangelogInline[] };

/** One paragraph of an entry: a run of inline nodes. */
export type ChangelogParagraph = readonly ChangelogInline[];

// `[words](address)` — a link, of which only the words are kept (see above).
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)/u;

function pushText(nodes: ChangelogInline[], text: string): void {
  if (text === "") return;
  const last = nodes.at(-1);
  if (last?.kind === "text") {
    nodes[nodes.length - 1] = { kind: "text", text: last.text + text };
    return;
  }
  nodes.push({ kind: "text", text });
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}]/u.test(character);
}

/*
 * Inline Markdown in one paragraph's text, as nodes. The delimiters are tried at each position in
 * this order: code first, because nothing inside a code span is Markdown; the double asterisk before
 * the single, so `**` is never read as two empty emphases. Emphasis only opens and closes at a word
 * boundary, so a `snake_case` name in prose is not cut in half.
 */
export function parseChangelogInline(source: string): ChangelogInline[] {
  const nodes: ChangelogInline[] = [];
  let index = 0;
  let plain = "";

  const flushPlain = () => {
    pushText(nodes, plain);
    plain = "";
  };

  while (index < source.length) {
    const rest = source.slice(index);
    const character = source[index];

    if (character === "`") {
      const close = source.indexOf("`", index + 1);
      if (close > index + 1) {
        flushPlain();
        nodes.push({ kind: "code", text: source.slice(index + 1, close) });
        index = close + 1;
        continue;
      }
    }

    if (rest.startsWith("**")) {
      const close = source.indexOf("**", index + 2);
      if (close > index + 2) {
        flushPlain();
        nodes.push({
          kind: "strong",
          children: parseChangelogInline(source.slice(index + 2, close)),
        });
        index = close + 2;
        continue;
      }
    }

    if (
      (character === "_" || character === "*") &&
      !isWordCharacter(source[index - 1]) &&
      source[index + 1] !== " " &&
      source[index + 1] !== character
    ) {
      let close = source.indexOf(character, index + 1);
      // A closing underscore must end a word too, or `_a_b` would close inside a name.
      if (character === "_") {
        while (close !== -1 && isWordCharacter(source[close + 1])) {
          close = source.indexOf(character, close + 1);
        }
      }
      if (close > index + 1 && source[close - 1] !== " ") {
        flushPlain();
        nodes.push({
          kind: "emphasis",
          children: parseChangelogInline(source.slice(index + 1, close)),
        });
        index = close + 1;
        continue;
      }
    }

    if (character === "[") {
      const link = LINK.exec(rest);
      if (link !== null) {
        flushPlain();
        for (const node of parseChangelogInline(link[1] ?? "")) {
          if (node.kind === "text") pushText(nodes, node.text);
          else nodes.push(node);
        }
        index += link[0].length;
        continue;
      }
    }

    plain += character;
    index += 1;
  }
  flushPlain();
  return nodes;
}

/*
 * An entry's whole text, as paragraphs. A blank line separates paragraphs, as in the document; a
 * single line break inside one is the document's own wrapping at its line width, not a break the
 * author meant a reader to see, so it reads as a space.
 */
export function parseChangelogText(text: string): ChangelogParagraph[] {
  return text
    .split(/\n[ \t]*\n/u)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .join(" "),
    )
    .filter((paragraph) => paragraph !== "")
    .map((paragraph) => parseChangelogInline(paragraph));
}
