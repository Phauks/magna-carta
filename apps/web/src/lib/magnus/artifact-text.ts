/*
 * What the pane does with a document's text, kept apart from the markup so it is tested alone: its
 * paragraphs, which of them changed from the version before, where the reader's words stand in it,
 * and the name a download is saved under. None of it reaches the server; the text is the version
 * the reader is already looking at.
 */
import type { MagnusArtifact, MagnusArtifactVersion } from "./magnus-api.ts";

/** A document's paragraphs: its runs of text between blank lines, each kept as written. */
export function paragraphsOf(text: string): readonly string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ""))
    .filter((paragraph) => paragraph.trim() !== "");
}

/**
 * Which paragraphs of `current` are not in `previous`, by position in `current`. A paragraph moved
 * but unchanged is not marked: what a reader checks is the words, and the words are the same.
 */
export function changedParagraphs(current: string, previous: string | null): ReadonlySet<number> {
  if (previous === null) return new Set();
  const before = new Set(paragraphsOf(previous).map((paragraph) => paragraph.trim()));
  const changed = new Set<number>();
  paragraphsOf(current).forEach((paragraph, index) => {
    if (!before.has(paragraph.trim())) changed.add(index);
  });
  return changed;
}

/** How many times the reader's words stand in the text, ignoring case. */
export function countMatches(text: string, query: string): number {
  const needle = query.trim().toLowerCase();
  if (needle === "") return 0;
  const haystack = text.toLowerCase();
  let count = 0;
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    count += 1;
    from = haystack.indexOf(needle, from + needle.length);
  }
  return count;
}

/** The file name a version is saved under: the document's name, its version, and the extension. */
export function artifactFileName(
  title: string,
  versionNumber: number,
  extension: "md" | "txt",
): string {
  const base = title
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${base === "" ? "Document" : base} (version ${versionNumber}).${extension}`;
}

/** The newest version of a document. Every document has at least one. */
export function latestVersion(artifact: MagnusArtifact): MagnusArtifactVersion | undefined {
  return artifact.versions.at(-1);
}

/**
 * How a version came to be, in words: written by Magnus for the member who asked, or put back by a
 * member from an earlier version.
 */
export function versionOrigin(version: MagnusArtifactVersion, memberName: string): string {
  if (version.restoredFromVersion !== null) {
    return `${memberName} restored version ${version.restoredFromVersion}`;
  }
  return `Magnus, asked by ${memberName}`;
}

/** The versions an answer wrote, for the cards under it in the conversation. */
export function versionsWrittenBy(
  artifacts: readonly MagnusArtifact[],
  turnId: string,
): readonly { artifact: MagnusArtifact; version: MagnusArtifactVersion }[] {
  const written: { artifact: MagnusArtifact; version: MagnusArtifactVersion }[] = [];
  for (const artifact of artifacts) {
    for (const version of artifact.versions) {
      if (version.writtenByTurnId === turnId) written.push({ artifact, version });
    }
  }
  return written;
}
