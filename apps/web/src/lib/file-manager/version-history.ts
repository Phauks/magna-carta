/*
 * The version history's own decisions, kept out of the inspector so they are unit-testable without a
 * DOM: which rows a folded history shows, how many it folded, what a version's kind is called, and
 * how "who" reads when several members were in the document.
 *
 * EVERY SAVE IS A VERSION, AND THE HISTORY FOLDS. The editor's autosave every few minutes is kept
 * as a version like any other (the owner's ruling: the timeline of every state is the point, and too
 * many rows is a folding problem). So the history shows the named saves by default — the member's
 * own Save, the save as the last view left, the idle reap's cut, and every upload — and folds the
 * autosaves behind one line that says how many, opened with a click. Nothing is dropped.
 */
import type { MatterFileVersion, VersionAuthorChanges } from "./matter-file-api.ts";
import type { VersionChange } from "./version-changes-api.ts";

/** Whether a version is one the folded view hides: only the editor's autosaves fold. */
export function isFolded(version: Pick<MatterFileVersion, "saveKind">): boolean {
  return version.saveKind === "autosave";
}

/** The rows a history shows: every version, or the named ones with the autosaves folded away. */
export function versionsToShow(
  versions: readonly MatterFileVersion[],
  showEverySave: boolean,
): readonly MatterFileVersion[] {
  return showEverySave ? versions : versions.filter((version) => !isFolded(version));
}

/** How many versions the folded view is hiding. */
export function foldedCount(versions: readonly MatterFileVersion[]): number {
  return versions.filter(isFolded).length;
}

/** "3 autosaves folded" / "1 autosave folded": the line that opens the fold. */
export function foldedLabel(count: number): string {
  return `${String(count)} ${count === 1 ? "autosave" : "autosaves"} folded`;
}

/** What a version's kind is called in the history's Kind column. */
export function saveKindText(saveKind: MatterFileVersion["saveKind"]): string {
  switch (saveKind) {
    case "explicit":
      return "Saved";
    case "autosave":
      return "Autosaved";
    case "exit":
      return "Saved on close";
    case "reap":
      return "Saved when idle";
    case null:
      return "Added";
  }
}

/**
 * Who a version is by: the member whose save cut it, then everyone else who was in the document —
 * "Ana Vasquez · with Trevor Goldsmith, Mira Chen". A participant whose member row is gone reads as
 * "a former member", never as a blank. A version with no recorded participants reads as its creator.
 */
export function createdByText(
  version: Pick<MatterFileVersion, "uploadedBy" | "uploadedByName" | "participants">,
): string {
  const creator = version.uploadedByName ?? "";
  const others = version.participants
    .filter((participant) => participant.userId !== version.uploadedBy)
    .map((participant) => participant.name ?? "a former member");
  return others.length === 0 ? creator : `${creator} · with ${others.join(", ")}`;
}

/*
 * WHO CHANGED WHAT. A version cut from the editor carries the document's own change marks, read
 * into one tally per author; the history's Changes column states that tally in a clause per author,
 * and opening it lists every mark grouped by where it sits in the document.
 */

/** "3 added, 2 removed, 1 reformatted": the parts of one author's tally, the zero parts left out. */
function tallyParts(tally: VersionAuthorChanges): readonly string[] {
  const parts: string[] = [];
  if (tally.insertions > 0) parts.push(`${String(tally.insertions)} added`);
  if (tally.deletions > 0) parts.push(`${String(tally.deletions)} removed`);
  if (tally.formatting > 0) parts.push(`${String(tally.formatting)} reformatted`);
  return parts;
}

/**
 * The Changes column: one clause per author, "Ana Vasquez: 3 added, 2 removed · Trevor Goldsmith:
 * 1 reformatted". Empty where the version recorded nothing new, and an author whose tally is all
 * zeros contributes no clause. The name is the API's own, which already reads as the member's
 * current name where they are still here and as the document's name otherwise.
 */
export function changesSummaryText(version: Pick<MatterFileVersion, "changes">): string {
  return version.changes
    .map((tally) => ({ name: tally.authorName, parts: tallyParts(tally) }))
    .filter((clause) => clause.parts.length > 0)
    .map((clause) => `${clause.name}: ${clause.parts.join(", ")}`)
    .join(" · ");
}

/** A part of the document package as a reader names it; an unfamiliar part keeps its own name. */
export function partLabel(part: string): string {
  const name = part.slice(part.lastIndexOf("/") + 1);
  if (name === "document.xml") return "Body";
  if (/^header\d*\.xml$/u.test(name)) return "Header";
  if (/^footer\d*\.xml$/u.test(name)) return "Footer";
  if (name === "footnotes.xml") return "Footnotes";
  if (name === "endnotes.xml") return "Endnotes";
  if (name === "comments.xml") return "Comments";
  return part;
}

export interface VersionChangeParagraph {
  readonly paragraphIndex: number;
  readonly changes: readonly VersionChange[];
}

export interface VersionChangePart {
  readonly part: string;
  readonly label: string;
  readonly paragraphs: readonly VersionChangeParagraph[];
}

/**
 * The changes grouped by part, then by paragraph within the part, each group in the order its
 * first change arrived — which is document order, because that is the order the API answers in.
 */
export function groupChangesByPart(
  changes: readonly VersionChange[],
): readonly VersionChangePart[] {
  const parts = new Map<string, Map<number, VersionChange[]>>();
  for (const change of changes) {
    let paragraphs = parts.get(change.part);
    if (paragraphs === undefined) {
      paragraphs = new Map();
      parts.set(change.part, paragraphs);
    }
    let paragraph = paragraphs.get(change.paragraphIndex);
    if (paragraph === undefined) {
      paragraph = [];
      paragraphs.set(change.paragraphIndex, paragraph);
    }
    paragraph.push(change);
  }
  return [...parts].map(([part, paragraphs]) => ({
    part,
    label: partLabel(part),
    paragraphs: [...paragraphs].map(([paragraphIndex, grouped]) => ({
      paragraphIndex,
      changes: grouped,
    })),
  }));
}

/**
 * Who a change is by: the member's name today where the author is still here, else the name the
 * document holds — which is what a departed member's stays as, never a blank.
 */
export function changeAuthorText(
  change: Pick<VersionChange, "authorName" | "authorCurrentName">,
): string {
  return change.authorCurrentName ?? change.authorName;
}

/** A run of a change's text: words, or the paragraph break the document wrote as "\n". */
export type ChangeTextSegment =
  | { readonly kind: "words"; readonly text: string }
  | { readonly kind: "paragraph-break" };

/**
 * A change's text as the runs it renders in: the words as words, and each "\n" as a paragraph
 * break the view names rather than draws. An empty run between two breaks is dropped, so two
 * breaks in a row read as two breaks and nothing else.
 */
export function changeTextSegments(text: string): readonly ChangeTextSegment[] {
  const segments: ChangeTextSegment[] = [];
  for (const [index, words] of text.split("\n").entries()) {
    if (index > 0) segments.push({ kind: "paragraph-break" });
    if (words !== "") segments.push({ kind: "words", text: words });
  }
  return segments;
}
