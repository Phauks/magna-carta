/*
 * What one Save of a record's contact card has to send, worked out from what the card started as
 * and what the reader left it as.
 *
 * The card is edited as a whole: every line becomes its fields at once, Preferred and Do Not Use
 * become switches, lines can be taken away and new ones added, and nothing is written until Save.
 * The write paths are still one contact point at a time, so Save turns the difference into a list
 * of single writes. Kept pure so the list can be asserted without a browser.
 *
 * ONLY WHAT CHANGED IS SENT. A line whose value and switches are as they were makes no request: a
 * write the reader did not make would move `updated_at`, and a correction nobody asked for reads
 * later as one somebody did. A line taken away is removed and nothing else is sent for it.
 *
 * PREFERRED IS ONE ANSWER ACROSS EVERY CHANNEL, and the server keeps it so: promoting a line demotes
 * whichever held it, in any table. So the card keeps at most one line switched on, and the plan
 * sends a line's preference only when its switch moved. Turning one off and another on sends both,
 * the "off" first, so the record never passes through a moment with the wrong one preferred.
 */
import {
  contactDraftRefusal,
  contactUpdateFrom,
  type ContactDraft,
  type ContactPointUpdate,
  type ContactRow,
} from "./contact-draft.ts";

/** One line as the card holds it while being edited. */
export interface EditedContactLine {
  /** The recorded contact point this line edits, or null for a line added in this edit. */
  readonly row: ContactRow | null;
  /** The draft the line started from; null for a new line. Compared to decide whether it changed. */
  readonly original: ContactDraft | null;
  readonly draft: ContactDraft;
  readonly preferred: boolean;
  readonly permitted: boolean;
  /** Taken away in this edit. A new line taken away is simply dropped. */
  readonly removed: boolean;
}

export type ContactEdit =
  | { readonly kind: "remove"; readonly row: ContactRow }
  | { readonly kind: "update"; readonly row: ContactRow; readonly body: ContactPointUpdate }
  | {
      readonly kind: "add";
      readonly draft: ContactDraft;
      readonly preference: { preferred: boolean; permitted: boolean };
    };

/** A line as it starts an edit: the recorded row, its own draft, and its two switches. */
export function lineFromRow(row: ContactRow, draft: ContactDraft): EditedContactLine {
  return {
    row,
    original: draft,
    draft,
    preferred: row.state.preferred,
    permitted: row.state.permitted,
    removed: false,
  };
}

/** A new, empty line of the given draft. Permitted, and not preferred, as a new entry starts. */
export function newLine(draft: ContactDraft): EditedContactLine {
  return { row: null, original: null, draft, preferred: false, permitted: true, removed: false };
}

/**
 * The lines with this one's Preferred switch moved. Switching one on switches every other off,
 * because only one way to reach a person can be the one they asked for.
 */
export function withPreferred(
  lines: readonly EditedContactLine[],
  index: number,
  preferred: boolean,
): EditedContactLine[] {
  return lines.map((line, at) =>
    at === index ? { ...line, preferred } : preferred ? { ...line, preferred: false } : line,
  );
}

/** Whether the line's value differs from what was recorded, judged by the request it would make. */
function valueChanged(line: EditedContactLine): boolean {
  if (line.original === null) return true;
  return (
    JSON.stringify(contactUpdateFrom(line.draft)) !==
    JSON.stringify(contactUpdateFrom(line.original))
  );
}

/**
 * Why the card cannot be saved, if it cannot: the index of the first line that is not ready.
 * A line taken away is never in the way, and neither is a new line left wholly empty, which is
 * dropped rather than refused.
 */
export function firstRefusedLine(lines: readonly EditedContactLine[]): number | null {
  const index = lines.findIndex(
    (line) => !line.removed && !isEmptyNewLine(line) && contactDraftRefusal(line.draft) !== null,
  );
  return index === -1 ? null : index;
}

/** A line added in this edit and never typed into. Saving ignores it. */
export function isEmptyNewLine(line: EditedContactLine): boolean {
  if (line.row !== null) return false;
  switch (line.draft.kind) {
    case "email":
      return line.draft.address.trim() === "";
    case "telephone":
    case "fax":
      return line.draft.number.trim() === "" && line.draft.extension.trim() === "";
    case "address":
      return false;
  }
}

/** The writes one Save makes, in the order they are sent: removals, then changes, then additions. */
export function planContactEdits(lines: readonly EditedContactLine[]): ContactEdit[] {
  const removals: ContactEdit[] = [];
  const demotions: ContactEdit[] = [];
  const updates: ContactEdit[] = [];
  const additions: ContactEdit[] = [];
  for (const line of lines) {
    if (line.row === null) {
      if (line.removed || isEmptyNewLine(line)) continue;
      additions.push({
        kind: "add",
        draft: line.draft,
        preference: { preferred: line.preferred, permitted: line.permitted },
      });
      continue;
    }
    const row = line.row;
    if (line.removed) {
      removals.push({ kind: "remove", row });
      continue;
    }
    const preference: { preferred?: boolean; permitted?: boolean } = {};
    if (line.preferred !== row.state.preferred) preference.preferred = line.preferred;
    if (line.permitted !== row.state.permitted) preference.permitted = line.permitted;
    const fields = valueChanged(line) ? contactUpdateFrom(line.draft) : null;
    const preferenceMoved = Object.keys(preference).length > 0;
    if (fields === null && !preferenceMoved) continue;
    const body: ContactPointUpdate = {
      ...fields,
      ...(preferenceMoved ? { preference } : {}),
    };
    // A line losing the preference goes first, so the record never holds the old and new together
    // in the reader's mind; the server would demote it anyway when the new one is promoted.
    (preference.preferred === false ? demotions : updates).push({ kind: "update", row, body });
  }
  return [...removals, ...demotions, ...updates, ...additions];
}
