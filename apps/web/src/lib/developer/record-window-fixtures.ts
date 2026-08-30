/*
 * The review fixtures for the record family: one plausible matter, one record standing on it, and
 * every list the gallery beside this file needs to show a state that real data cannot reach.
 *
 * IT IS INVENTED, COMPLETELY. No person, client, matter or document named here exists. That is a
 * hard rule for a page anybody can open, and it costs the review nothing.
 *
 * IT READS LIKE REAL WORK, DELIBERATELY. The owner reviews this page for typography and density,
 * and placeholder prose hides exactly the defects that review is looking for: a narrative of the
 * right length wraps where a real one wraps, a nine-event history scrolls where a real one scrolls,
 * and a name of a realistic length is what pushes a metadata line onto two.
 *
 * IT IS FIXED. No clock and no randomness anywhere, so the page renders the same on every visit and
 * a reviewer comparing two visits is comparing the components rather than the data.
 *
 * IT PULLS NO COMPONENT. Everything imported here is either a type (erased) or a pure function, so
 * this module loads under a plain node test runner. The printed document is built next door in
 * record-window-sheet.ts, which reaches for the design system's projection helpers and therefore
 * pulls the component barrel with them.
 */
import { formatDuration } from "@magna-carta/design-system/formatters";
import type { EventRailEvent } from "@magna-carta/design-system/event-rail";
import type { PrintSheetDocument } from "@magna-carta/design-system/print-sheet";
import type {
  AttachableDocumentFolder,
  RecordAttachment,
} from "@magna-carta/design-system/record-attachments";

/** The matter everything below belongs to. One invented litigation file, named once. */
export const GALLERY_MATTER = {
  title: "Pemberton v. Hale",
  client: "Pemberton Millworks",
  number: "2026-0147",
} as const;

/** The record itself, as the window's heading and subtitle name it. */
export const GALLERY_RECORD = {
  heading: "Motion to compel: drafting and conferral",
  reference: "2026-0147.0042",
} as const;

/**
 * The record's duration, in the two forms every surface renders it in. The decimal leads because it
 * is the figure the arithmetic multiplies; the clock form reads beside it.
 */
export const GALLERY_DURATION = formatDuration(150);

/**
 * The record as a consumer actually holds one, internal text included.
 *
 * The memo is here on purpose: it is what the firm wrote for itself, it must never reach a client,
 * and the sheet built from this record goes through the projection that removes it. A fixture with
 * nothing to strip would show that projection working against no evidence at all.
 */
export const GALLERY_CHARGE = {
  workDate: "14 August 2026",
  timekeeper: "Rosalind Chase",
  hours: GALLERY_DURATION.decimal,
  hoursClockForm: GALLERY_DURATION.clock,
  rate: "$450.00 per hour",
  amount: "$1,125.00",
  description:
    "Drafted the motion to compel production of the Hale custodial mailboxes, reviewed the " +
    "responses served on 7 August, and conferred with opposing counsel on the four requests still " +
    "outstanding after that service.",
  internalMemo:
    "Hale's counsel has moved every deadline once. Keep the conferral on its own line so it " +
    "survives a fee challenge.",
};

/**
 * The record's history, oldest first, long enough to scroll.
 *
 * One event is sourced to the platform rather than to a person, because the platform acts on its
 * own and a rail that only ever showed people would be a rail nobody had tested against the truth.
 */
export const GALLERY_HISTORY: readonly EventRailEvent[] = [
  {
    id: "entered",
    action: "Entered as a draft",
    at: "2026-08-14T21:12:00.000Z",
    source: "Rosalind Chase",
  },
  {
    id: "attached-transcript",
    action: "Deposition transcript attached",
    at: "2026-08-14T21:19:00.000Z",
    source: "Rosalind Chase",
  },
  {
    id: "submitted-first",
    action: "Submitted for review",
    at: "2026-08-15T13:40:00.000Z",
    source: "Rosalind Chase",
  },
  {
    id: "kicked-back",
    action: "Kicked back to draft",
    at: "2026-08-15T18:02:00.000Z",
    source: "Edmund Voss",
    detail:
      "The conferral and the drafting are one line here. Split them, so the conferral stands on " +
      "its own if the fee is challenged.",
  },
  {
    id: "split",
    action: "Narrative rewritten and the conferral separated",
    at: "2026-08-16T14:27:00.000Z",
    source: "Rosalind Chase",
  },
  {
    id: "rate-refreshed",
    action: "Rate refreshed from the 2026 fee schedule",
    at: "2026-08-16T14:29:00.000Z",
    source: "Magna Carta",
    detail:
      "The schedule that governs this matter changed on 1 August. The earlier rate was $425.00.",
  },
  {
    id: "submitted-second",
    action: "Submitted for review",
    at: "2026-08-17T09:11:00.000Z",
    source: "Rosalind Chase",
  },
  {
    id: "approved",
    action: "Approved",
    at: "2026-08-17T15:36:00.000Z",
    source: "Edmund Voss",
  },
  {
    id: "billed",
    action: "Billed on Invoice 2026-114",
    at: "2026-08-21T17:05:00.000Z",
    source: "Marian Holt",
  },
];

/** A history with exactly one event on it: the record was entered, and nothing has happened since. */
export const GALLERY_SINGLE_EVENT: readonly EventRailEvent[] = [GALLERY_HISTORY[0]!];

/**
 * A history nobody performed by hand: a document's own safety and retention events, every one of
 * them caused by the platform. It is a different world on the same rail, which is the rail's claim.
 */
export const GALLERY_PLATFORM_HISTORY: readonly EventRailEvent[] = [
  {
    id: "scanned",
    action: "Safety check completed, nothing found",
    at: "2026-08-14T21:13:00.000Z",
    source: "Magna Carta",
  },
  {
    id: "typed",
    action: "Recognized as a deposition transcript",
    at: "2026-08-14T21:14:00.000Z",
    source: "Magna Carta",
  },
  {
    id: "indexed",
    action: "Indexed for search",
    at: "2026-08-14T21:15:00.000Z",
    source: "Magna Carta",
  },
  {
    id: "rescanned",
    action: "Re-scanned against updated signatures",
    at: "2026-08-24T04:00:00.000Z",
    source: "Magna Carta",
    detail: "Every file in this matter is re-scanned when the signature set changes.",
  },
];

/** The files riding the record. */
export const GALLERY_ATTACHMENTS: readonly RecordAttachment[] = [
  {
    identifier: "association-transcript",
    documentIdentifier: "document-transcript",
    name: "Hale deposition transcript, volume I.pdf",
    contentType: "application/pdf",
    attachedAt: "2026-08-14T21:19:00.000Z",
    attachedBy: "Rosalind Chase",
  },
  {
    identifier: "association-conferral",
    documentIdentifier: "document-conferral-letter",
    name: "Meet-and-confer letter, 12 August.pdf",
    contentType: "application/pdf",
    attachedAt: "2026-08-16T14:31:00.000Z",
    attachedBy: "Rosalind Chase",
  },
  {
    identifier: "association-custodian-chart",
    documentIdentifier: "document-custodian-chart",
    name: "Custodian coverage chart.png",
    contentType: "image/png",
    attachedAt: "2026-08-16T14:33:00.000Z",
    attachedBy: "Marian Holt",
  },
];

/**
 * The matter's own documents, grouped by the folder they were filed in.
 *
 * The transcript is in here as well as on the record above, so the picker can be seen leaving out a
 * document this record already carries rather than offering a second association with one file.
 */
export const GALLERY_MATTER_DOCUMENTS: readonly AttachableDocumentFolder[] = [
  {
    identifier: "folder-discovery",
    name: "Discovery",
    documents: [
      { identifier: "document-transcript", name: "Hale deposition transcript, volume I.pdf" },
      { identifier: "document-interrogatories", name: "Interrogatories, first set.pdf" },
      { identifier: "document-production-log", name: "Production log.xlsx" },
      { identifier: "document-privilege-log", name: "Privilege log, as served.xlsx" },
    ],
  },
  {
    identifier: "folder-correspondence",
    name: "Correspondence",
    documents: [
      { identifier: "document-conferral-letter", name: "Meet-and-confer letter, 12 August.pdf" },
      { identifier: "document-scheduling", name: "Scheduling, opposing counsel.eml" },
    ],
  },
  {
    identifier: "folder-pleadings",
    name: "Pleadings",
    documents: [
      { identifier: "document-answer", name: "Answer and affirmative defenses.docx" },
      { identifier: "document-protective-order", name: "Stipulated protective order.pdf" },
    ],
  },
];

/**
 * A sheet with very little recorded on it: a cost entered a moment ago, with two facts, no
 * narrative and a history nothing has been written into yet.
 *
 * It states its facts directly rather than through the projection, because there is no record
 * behind it carrying anything to strip: it is the paper, and nothing else.
 */
export const GALLERY_SPARSE_SHEET: PrintSheetDocument = {
  heading: "Cost",
  reference: "2026-0147.0113",
  subtitle: `${GALLERY_MATTER.title}, ${GALLERY_MATTER.client}`,
  sections: [
    {
      id: "work",
      kind: "fields",
      fields: [
        { label: "Date", value: "24 August 2026" },
        { label: "Amount", value: "$62.40" },
      ],
    },
    { id: "history", kind: "history", title: "History", events: [] },
  ],
};
