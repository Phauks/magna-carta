export const CATEGORY_ORDER = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

// Who a fragment is written for. There is deliberately NO default in either direction, and the two
// wrong defaults fail differently: defaulting to `public` publishes an internal research note the
// first time an author forgets, which cannot be unpublished; defaulting to `internal` means the
// public changelog quietly stops being written and nobody notices, which is worse because it fails
// silently. So an undecided fragment fails the build instead. Rule of thumb: a fragment describing
// something a user can now do is `public`; a design, a decision, a research finding or an internal
// tool is `internal`, and design-only work is `internal` because it has not shipped.
export const AUDIENCES = ["public", "internal"];

const FRONTMATTER_KEYS = ["category", "audience"];
const FENCE = "---";

// The marker that separates the developer entry from the customer entry inside one fragment. Two
// audiences, two sets of sentences, one file and one review — rather than a second directory that
// has to be kept in step, or a generated paraphrase of the developer entry that would overstate a
// change without anyone reading it.
export const PUBLIC_HEADING = "## Public";

// A fragment body is entry TEXT: `foldFragments` is what turns it into a list item. Authors reasonably
// write the body the way it will read in the file, leading `- ` and all, and the two prefixes then
// stack into `- - **The entry...**` in the rendered changelog. Strip whichever marker the author used
// (`-`, `*`, `+`) so the assembler owns exactly one. A body that leads with something else — prose, a
// heading, a fenced block — is left alone.
const LEADING_LIST_MARKER = /^[-*+][ \t]+/;

// Characters that render as emoji by default. Emoji_Presentation is the right set to test rather
// than Extended_Pictographic, which also covers the typographic signs that legitimately appear in
// prose (trade mark, copyright, registered). A variation selector is checked separately because it
// turns a text-presentation character into an emoji one.
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const EMOJI_VARIATION_SELECTOR = /\uFE0F/u;

function stripLeadingListMarker(text) {
  return text.replace(LEADING_LIST_MARKER, "");
}

export function containsEmoji(text) {
  return EMOJI_PRESENTATION.test(text) || EMOJI_VARIATION_SELECTOR.test(text);
}

// Structural read of a changelog fragment. It THROWS rather than returning a half-built record: the
// frontmatter is the only place the category and the audience come from, and a fragment that opens
// with prose instead of a fence would otherwise parse into a record with an empty category, fold
// into no section at all, and be deleted by the assembler in the same pass. Semantic problems are
// NOT thrown here — `validateFragment` returns them as a list so an author sees every one at once.
export function parseFragment(markdown, context = "changelog fragment") {
  const lines = markdown.split("\n");
  if (lines[0] !== FENCE) {
    throw new Error(
      `${context}: missing the opening \`${FENCE}\` frontmatter fence — a changelog fragment starts with frontmatter (${FRONTMATTER_KEYS.join(", ")}), not with the entry text`,
    );
  }
  const end = lines.indexOf(FENCE, 1);
  if (end === -1) {
    throw new Error(`${context}: missing the closing \`${FENCE}\` frontmatter fence`);
  }

  const record = { category: "", audience: "", text: "", publicText: null };
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    const key = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).trim();
    if (!FRONTMATTER_KEYS.includes(key)) {
      throw new Error(
        `${context}: unknown frontmatter line "${line}" (expected one of ${FRONTMATTER_KEYS.join(", ")}, each written as \`key: value\`)`,
      );
    }
    record[key] = value;
  }

  const body = lines.slice(end + 1);
  const publicAt = body.findIndex((line) => line.trim() === PUBLIC_HEADING);
  const developerLines = publicAt === -1 ? body : body.slice(0, publicAt);
  record.text = rebaseLinks(stripLeadingListMarker(developerLines.join("\n").trim()), "developer");
  if (publicAt !== -1) {
    record.publicText = rebaseLinks(
      stripLeadingListMarker(
        body
          .slice(publicAt + 1)
          .join("\n")
          .trim(),
      ),
      "public",
    );
  }
  return record;
}

// A fragment is written in changelog.d/, and its links are written from there: `../docs/x` reaches
// the repository's docs from the fragment's own directory. The entry it becomes lives somewhere
// else — the developer text at the repository root (CHANGELOG.md), the public text under docs/
// (public-changelog.md) — so a link that was right in the fragment points one directory too high
// once assembled, and lint:doc-links refuses the rendered file for a mistake nobody made. The
// assembler rebases each relative link to where the text is going. Absolute links and anchors are
// left alone.
export function rebaseLinks(text, destination) {
  return text.replace(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (match, target) => {
    let path = target;
    // From changelog.d/, `../` is the repository root; the fragment's own directory is never linked.
    if (path.startsWith("../")) path = path.slice(3);
    if (destination === "public") {
      // The public changelog lives in docs/: a root-relative link into docs/ loses that prefix, and
      // a link out of docs/ climbs one directory.
      path = path.startsWith("docs/") ? path.slice(5) : `../${path}`;
    }
    return `](${path})`;
  });
}

// Semantic checks on a parsed fragment, returned as a list so one run reports every problem in the
// file. Structural problems are already impossible here — parseFragment threw on those.
export function validateFragment(record, context = "changelog fragment") {
  const problems = [];

  if (record.category === "") {
    problems.push(
      `${context}: no \`category:\` — one of ${CATEGORY_ORDER.join(", ")}, naming the section the entry folds into`,
    );
  } else if (!CATEGORY_ORDER.includes(record.category)) {
    problems.push(
      `${context}: category "${record.category}" is not one of ${CATEGORY_ORDER.join(", ")}`,
    );
  }

  if (record.audience === "") {
    problems.push(
      `${context}: no \`audience:\` — write \`public\` for a change a user can now see or do, \`internal\` for a design, a decision, research, or a tool that only this repository uses. There is no default: an unpublished public entry and a published internal one are both silent failures, so the key is required`,
    );
  } else if (!AUDIENCES.includes(record.audience)) {
    problems.push(
      `${context}: audience "${record.audience}" is not one of ${AUDIENCES.join(", ")}`,
    );
  }

  if (record.text === "") {
    problems.push(`${context}: no entry text below the frontmatter`);
  }

  if (record.audience === "public" && (record.publicText === null || record.publicText === "")) {
    problems.push(
      `${context}: marked \`audience: public\` but carries no \`${PUBLIC_HEADING}\` block — the customer-facing sentences go below that heading, in the reader's language rather than the repository's`,
    );
  }
  if (record.audience === "internal" && record.publicText !== null) {
    problems.push(
      `${context}: marked \`audience: internal\` but carries a \`${PUBLIC_HEADING}\` block, which nothing would ever read — either publish the fragment or delete the block`,
    );
  }

  // Golden rule 2 bans emojis outright, and the changelog is the one place the ban is most likely to
  // be tested: bulleted highlights with emoji prefixes are the house style of every hosted changelog
  // product. Checked here rather than left to review because a public entry is unpublishable once
  // shipped. Standard: docs/conventions/documentation-style.md.
  if (
    containsEmoji(record.text) ||
    (record.publicText !== null && containsEmoji(record.publicText))
  ) {
    problems.push(
      `${context}: contains an emoji — write the emphasis in words, and use a Lucide icon where a surface needs a glyph`,
    );
  }

  return problems;
}

// Parse and validate a whole set at once. Every file is reported, not just the first offender, and
// the assembler must know the WHOLE set is sound before it consumes any of it — folding a fragment
// deletes it, so a half-consumed assembly is not something an author can re-run their way out of.
export function collectFragments(entries) {
  const records = new Map();
  const problems = [];
  for (const { key, context, markdown } of entries) {
    let record;
    try {
      record = parseFragment(markdown, context);
    } catch (error) {
      problems.push(error.message);
      continue;
    }
    const found = validateFragment(record, context);
    if (found.length > 0) problems.push(...found);
    else records.set(key ?? context, record);
  }
  return { records, problems };
}

// Fold entries into one section of a Keep-a-Changelog document, under their category headings,
// creating a heading that is not there yet. The section is a parameter because two documents are
// assembled from the same fragments: the developer changelog collects everything under
// `## [Unreleased]`, and the public changelog collects the published half under a dated heading.
export function foldFragments(changelogMarkdown, fragments, sectionHeading = "## [Unreleased]") {
  const lines = changelogMarkdown.split("\n");
  const section = lines.findIndex((line) => line.startsWith(sectionHeading));
  if (section === -1) throw new Error(`the document is missing the ${sectionHeading} section`);
  let nextSection = lines.findIndex((line, index) => index > section && line.startsWith("## "));
  if (nextSection === -1) nextSection = lines.length;

  for (const category of CATEGORY_ORDER) {
    const entries = fragments.filter((fragment) => fragment.category === category);
    if (entries.length === 0) continue;
    let heading = lines.findIndex(
      (line, index) => index > section && index < nextSection && line === `### ${category}`,
    );
    if (heading === -1) {
      lines.splice(
        nextSection,
        0,
        `### ${category}`,
        "",
        ...entries.map((entry) => `- ${entry.text}`),
        "",
      );
      nextSection += entries.length + 3;
      continue;
    }
    let insertAt = heading + 1;
    while (
      insertAt < nextSection &&
      !(lines[insertAt] === "" && lines[insertAt + 1]?.startsWith("###"))
    ) {
      if (lines[insertAt] === "" && (insertAt + 1 >= nextSection || lines[insertAt + 1] === ""))
        break;
      insertAt++;
    }
    lines.splice(insertAt, 0, ...entries.map((entry) => `- ${entry.text}`));
    nextSection += entries.length;
  }
  return lines.join("\n");
}

// Ensure a dated section exists in the public changelog, inserting it above the newest existing one
// so the document stays reverse-chronological. Returns the document unchanged when the date is
// already there — a second assembly on the same day appends to that day's entry rather than opening
// a duplicate heading.
export function ensureDatedSection(markdown, date) {
  const heading = `## ${date}`;
  const lines = markdown.split("\n");
  if (lines.some((line) => line.trim() === heading)) return markdown;
  const insertAt = lines.findIndex((line) => line.startsWith("## "));
  if (insertAt === -1) {
    // No dated section yet. Append after the document's prose preamble, leaving one blank line.
    while (lines.length > 0 && lines.at(-1) === "") lines.pop();
    return [...lines, "", heading, ""].join("\n");
  }
  lines.splice(insertAt, 0, heading, "");
  return lines.join("\n");
}
