/*
 * One note, on paper.
 *
 * A note is a record of what somebody did or was told, and it is read back years later — in a fee
 * dispute, in a malpractice review, by a successor lawyer picking the file up. So the sheet states
 * BOTH times the note carries and never lets them blur: when the thing happened, and when the note
 * was written. A record that says only one of those cannot answer how long after the call it was
 * written down, which is the first question anybody asks of a note.
 *
 * The sheet is data, never markup: what reaches the paper is the closed set of strings below.
 */
import type { PrintSheetDates } from "$lib/print-sheet";
import type { PrintSheetDocument } from "@magna-carta/design-system/print-sheet/projection";
import type { MatterNote } from "./notes-api.ts";

/** Everything the sheet needs that is not the note itself. */
export interface NoteSheetContext extends PrintSheetDates {
  readonly matterTitle: string;
  /** The note's author, as a name. Never an account identifier. */
  readonly authorName: string;
  /** Who last changed the words, where anybody has. */
  readonly lastEditedByName: string | null;
  /** A stored instant as a reader sees it. */
  readonly instant: (at: string) => string;
  /** The documents the note points at, by name. */
  readonly attachedNames: readonly string[];
  /** When the sheet was taken, already stated as an instant. */
  readonly printedAt: string;
}

/**
 * When the thing the note describes happened, as one stated line.
 *
 * The zone rides along with a wall-clock time because the two are one fact: "14:30" on paper with
 * no zone is a different moment to every reader who picks the sheet up.
 */
export function occurrenceLine(note: MatterNote, date: (isoDate: string) => string): string | null {
  if (note.occurredOn === null) return null;
  if (note.occurredAtTime === null) return date(note.occurredOn);
  return `${date(note.occurredOn)}, ${note.occurredAtTime}${
    note.timeZone === null ? "" : ` (${note.timeZone})`
  }`;
}

/** What one note's sheet says. */
export function noteSheet(note: MatterNote, context: NoteSheetContext): PrintSheetDocument {
  const happened = occurrenceLine(note, context.date);
  return {
    heading: "Matter Note",
    subtitle: context.matterTitle,
    sections: [
      {
        id: "standing",
        kind: "fields",
        fields: [
          // The note's own subject comes first: a reader reaching for a note is reaching for when
          // the thing happened, not for when somebody got round to typing it.
          {
            label: "Date",
            value: happened ?? "Not recorded (the note has no single date)",
          },
          { label: "Written By", value: context.authorName },
          { label: "Written", value: context.instant(note.createdAt) },
          ...(context.lastEditedByName === null
            ? []
            : [
                { label: "Last Edited By", value: context.lastEditedByName },
                { label: "Last Edited", value: context.instant(note.updatedAt) },
              ]),
        ],
      },
      { id: "body", kind: "text", title: "Note", text: note.body },
      {
        id: "documents",
        kind: "fields",
        title: "Documents",
        fields:
          context.attachedNames.length === 0
            ? [{ label: "Attached", value: "None" }]
            : context.attachedNames.map((name, position) => ({
                label: `Attached ${String(position + 1)}`,
                value: name,
              })),
      },
    ],
    footer: `${context.matterTitle} · printed ${context.printedAt}`,
  };
}
