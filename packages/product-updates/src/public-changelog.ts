import {
  CHANGELOG_CATEGORIES,
  type ChangelogCategory,
  type PublicChangelogArtifact,
  type PublicChangelogEntry,
  SCHEMA_VERSION,
  publicChangelogArtifactSchema,
} from "./schema.ts";

// The assembled customer-facing changelog is Markdown, and this turns it into the artifact every
// renderer reads. Markdown is the authoring home rather than the transport for the reason the
// repository authors every other generated document that way: a human curates a dated section into
// a roll-up by editing prose, and prose is the only format that survives being edited by hand.
//
// It is STRICT. A malformed document fails the build rather than producing a shorter artifact,
// because the failure this guards is silent omission: a mistyped category heading, or a bullet
// written above the first dated heading, would otherwise drop a shipped change out of the published
// changelog with nothing raised. The parse is small enough that strictness costs nothing.

// `## 2026-08-12` — a dated section, the shape published today.
const DATE_HEADING = /^## (\d{4}-\d{2}-\d{2})$/;
// `## [1.4.0] - 2026-08-12` — the versioned shape, accepted now so that cutting the first release is
// an edit to this document rather than a change to this parser and every reader downstream.
const VERSION_HEADING = /^## \[([^\]]+)] - (\d{4}-\d{2}-\d{2})$/;
const CATEGORY_HEADING = /^### (.+)$/;
const BULLET = /^- (.*)$/;

export class PublicChangelogParseError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `The public changelog document is malformed:\n${problems.map((problem) => `  ${problem}`).join("\n")}`,
    );
    this.name = "PublicChangelogParseError";
    this.problems = problems;
  }
}

function isCategory(value: string): value is ChangelogCategory {
  return (CHANGELOG_CATEGORIES as readonly string[]).includes(value);
}

export function parsePublicChangelog(markdown: string): PublicChangelogEntry[] {
  const lines = markdown.split("\n");
  const entries: PublicChangelogEntry[] = [];
  const problems: string[] = [];
  const seenDates = new Set<string>();

  let date: string | null = null;
  let version: string | null = null;
  let category: ChangelogCategory | null = null;
  // The entry currently being accumulated, so a bullet may run over several lines.
  let pending: string[] | null = null;

  const flush = (at: number) => {
    if (pending === null) return;
    const text = pending.join("\n").trim();
    pending = null;
    if (text === "") {
      problems.push(`line ${at}: an empty bullet`);
      return;
    }
    // Both guards are unreachable through the loop below, which never opens a bullet without a
    // date and a category; they are kept so a future edit to the loop fails loudly here.
    if (date === null || category === null) return;
    entries.push({ date, version, category, text });
  };

  for (const [index, line] of lines.entries()) {
    const at = index + 1;

    const versioned = VERSION_HEADING.exec(line);
    const dated = DATE_HEADING.exec(line);
    if (versioned !== null || dated !== null) {
      flush(at);
      version = versioned === null ? null : (versioned[1] ?? null);
      date = versioned === null ? (dated?.[1] ?? null) : (versioned[2] ?? null);
      category = null;
      if (date !== null) {
        if (seenDates.has(date)) {
          problems.push(
            `line ${at}: a second section for ${date} — one dated section per day, so a reader is not shown the same day twice`,
          );
        }
        seenDates.add(date);
      }
      continue;
    }

    // Any other level-two heading ends the current section. The document's own title is level one,
    // so this only fires on a heading that was meant to be a release and is not shaped like one.
    if (line.startsWith("## ")) {
      flush(at);
      problems.push(
        `line ${at}: "${line.trim()}" is not a release heading — write \`## YYYY-MM-DD\`, or \`## [version] - YYYY-MM-DD\` once releases are cut`,
      );
      date = null;
      version = null;
      category = null;
      continue;
    }

    const heading = CATEGORY_HEADING.exec(line);
    if (heading !== null) {
      flush(at);
      const name = (heading[1] ?? "").trim();
      if (!isCategory(name)) {
        problems.push(
          `line ${at}: "${name}" is not a changelog category — one of ${CHANGELOG_CATEGORIES.join(", ")}`,
        );
        category = null;
        continue;
      }
      if (date === null) {
        problems.push(`line ${at}: category "${name}" sits above the first release heading`);
      }
      category = name;
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      flush(at);
      if (date === null || category === null) {
        problems.push(
          `line ${at}: an entry outside a dated release and category section, which no renderer would show`,
        );
        continue;
      }
      pending = [bullet[1] ?? ""];
      continue;
    }

    // A continuation line of the bullet being accumulated. Anything else is the document's prose
    // preamble, which is deliberately not carried into the artifact.
    if (pending !== null) pending.push(line);
  }
  flush(lines.length);

  if (problems.length > 0) throw new PublicChangelogParseError(problems);
  return entries;
}

export function buildPublicChangelogArtifact(
  markdown: string,
  generatedAt: string,
): PublicChangelogArtifact {
  // Parsed, then re-validated against the published schema. The parse and the contract are separate
  // things, and a reader of the artifact is entitled to the contract having actually been checked.
  return publicChangelogArtifactSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    entries: parsePublicChangelog(markdown),
  });
}
