/*
 * The one document all three header specimens state, and the small vocabulary they share.
 *
 * Deterministic on purpose: no clock, no randomness, so the three bands differ only in how they
 * arrange the same facts. A screenshot pass is then never chasing data, and the only thing that
 * can change between two specimens is the arrangement under review.
 *
 * The facts are exactly the ones the shipping screens carry today. From the document's own header
 * (apps/web/src/lib/screen/screen-header.svelte, as the edit route composes it): the file's name,
 * the version number, the size, the instant it was last written, and the matter its files live
 * under. From the editor itself (apps/web/src/lib/documents/office-document-editor.svelte): the
 * read-only seat, which is what a member gets while another member holds the exclusive lock. The
 * folder path is the file manager's, and is here because one of the three candidates uses the path
 * itself as the way back.
 */

/** The document a specimen is open on, with everything its header could state about it. */
export interface SpecimenDocument {
  readonly fileId: string;
  readonly matterId: string;
  /** The file's own name, as the file manager records it. */
  readonly name: string;
  /** The matter the file belongs to, by the name a member reads. */
  readonly matterTitle: string;
  /** The matter's own number, the one somebody reads back down a telephone. */
  readonly matterNumber: string;
  /** The folders between the matter's files and this document, outermost first. */
  readonly folderPath: readonly string[];
  readonly versionNumber: number;
  readonly sizeBytes: number;
  /** When the stored file was last written, as an instant. */
  readonly updatedAt: string;
}

export const SPECIMEN_DOCUMENT: SpecimenDocument = {
  fileId: "file-motion-to-compel",
  matterId: "matter-hale-pemberton",
  name: "Motion to Compel Production.docx",
  matterTitle: "Hale v. Pemberton",
  matterNumber: "2026-0147",
  folderPath: ["Pleadings", "Motion to Compel"],
  versionNumber: 7,
  sizeBytes: 253_952,
  updatedAt: "2026-09-15T16:24:00Z",
};

/** Which of the three arrangements a specimen renders. */
export type HeaderVariant = "continuous-chrome" | "document-masthead" | "path-bar";

/**
 * What this member may do with the open document. `read-only` is the seat an edit session comes
 * back with when another member holds the exclusive lock: the document opens and cannot be
 * changed, which is stated and never turned into a blocked screen.
 */
export type EditorSeat = "editing" | "read-only";

/**
 * What the header says about the work reaching storage. The editor writes the file itself, so
 * these are the three answers a host can give: it is writing, it has written, or it has lost the
 * editor and nothing since the last write has left this tab.
 */
export type SaveState = "saved" | "saving" | "disconnected";

/** The word each save state shows. Short, because it sits on a band that is fighting for width. */
export const SAVE_STATE_WORDS: Readonly<Record<SaveState, string>> = Object.freeze({
  saved: "Saved",
  saving: "Saving",
  disconnected: "Not saved",
});

/**
 * The one line a band gives to a state that is not the ordinary one, or null in the ordinary case.
 *
 * Read-only outranks a save state, because a seat that cannot write has nothing to say about
 * writing. Both states carry their own sentence: a badge on its own tells a reader that something
 * is different without telling them what, and neither of these is a fact a reader can be left to
 * work out.
 */
export interface BandState {
  readonly badge: string;
  /** The design-system badge register the word wears. */
  readonly variant: "neutral" | "warning";
  readonly sentence: string;
}

export function bandState(seat: EditorSeat, saveState: SaveState): BandState | null {
  if (seat === "read-only") {
    return {
      badge: "Read-only",
      variant: "neutral",
      sentence: "Another member holds this document's exclusive lock.",
    };
  }
  if (saveState === "disconnected") {
    return {
      badge: "Not saved",
      variant: "warning",
      sentence: "The editor lost its connection. Nothing since the last save has left this tab.",
    };
  }
  return null;
}

/**
 * The elapsed time the Time Sheet handle reads. A fixed string, because the specimens seat the
 * handle's footprint rather than the live chip: a gallery that ran the firm's timer would report
 * a different number in every screenshot, and the question here is where the handle sits.
 */
export const SPECIMEN_ELAPSED = "1:42:07";

/**
 * The stand-in page under the band. Enough of a document that the proportions read true and the
 * band can be judged against a real canvas, and no more: what is under review is the chrome.
 */
export const SPECIMEN_PAGE_LINES: readonly string[] = [
  "Plaintiff moves this Court for an order compelling Defendant to produce the documents",
  "identified in Plaintiff's First Request for Production, served on 14 July 2026, and to",
  "produce a privilege log conforming to the requirements of Rule 26(b)(5)(A).",
  "",
  "Defendant served responses on 13 August 2026 consisting entirely of objections. No",
  "documents were produced. No privilege log accompanied the responses, and counsel for",
  "Defendant has not responded to three written requests to confer.",
];
