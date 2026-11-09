/*
 * A firm's numbering schemes, as the settings editor holds them.
 *
 * A NUMBER IS A TEMPLATE OF PARTS. The firm writes each of its numbers — matter, consultation,
 * intake, conflicts check, custody packet, invoice, time entry, call and text — as an ordered list
 * of parts: a fixed piece of text, the year the record was numbered, its office's code, its
 * client's code, and exactly one counter that ticks up. Any part that varies can be given a
 * SEPARATE COUNT (the contract calls it scoping), which keeps one running count for each distinct
 * value of it: with Client Code on, client 3333's matters run 3333-1, 3333-2 while 4444's run
 * 4444-1; with Year on, the count starts again each January, the way a file room's numbers do. The sequence-numbering package owns
 * the model, the renderer and the register of purposes; this file spells the same shape for the
 * editor and states, in the reader's words, what each part is. What each PURPOSE is — its title,
 * when its number is drawn, which parts it may use, what decides its count's scope — arrives from
 * the server's listing, so the screen never keeps a second copy of the register.
 *
 * WHY THE EDITOR VALIDATES BEFORE THE SERVER DOES. The one rule that cannot be broken — exactly
 * one counter — is the server's to enforce, and it does. It is repeated here so the editor can
 * say what is wrong beside the list instead of after a refused save, and so the live preview is
 * not asked to render a scheme the server would refuse.
 *
 * A NUMBER, ONCE DRAWN, IS FROZEN. A scheme change reaches only the records numbered after it.
 * That is the register's rule, restated on the screen so nobody expects a renumbering.
 */

/** Every number the firm issues, as the register names them. All of them take a scheme. */
export type NumberingPurpose =
  | "matter"
  | "consultation"
  | "intake"
  | "conflicts_check"
  | "custody_packet"
  | "invoice"
  | "time_entry"
  | "communication";

/** One purpose as the listing describes it. */
export interface NumberingPurposeRecord {
  readonly purpose: NumberingPurpose;
  /** The plate heading: "Matter Numbers". */
  readonly title: string;
  readonly label: string;
  /** The record numbered, singular and plural: "matter", "matters". */
  readonly subject: string;
  readonly subjects: string;
  /** When the number is drawn, in one sentence. */
  readonly drawnWhen: string;
  /** The parts a scheme for this purpose may use. */
  readonly segmentKinds: readonly NumberSegmentKind[];
  /** What is in force: the firm's scheme or the built-in default; null where nothing is. */
  readonly segments: readonly NumberSegment[] | null;
  readonly usingDefault: boolean;
  /**
   * Whether the count runs within a scope the TEMPLATE decides (its scoping parts) or one the
   * DOMAIN decides — a time entry counts within its matter, an invoice within the letterhead a
   * bill was finalized under. Where the domain decides, no part takes a separate count.
   */
  readonly scopeSource: "segments" | "owner";
  /** The first number the sample would render as under what is in force. */
  readonly example: string | null;
}

/** One part of a number, spelled the way the numbering contract stores it. */
export type NumberSegment =
  | { kind: "literal"; text: string }
  | { kind: "counter"; padWidth: number; start?: number }
  | { kind: "year"; digits: 2 | 4; scoping?: boolean }
  | { kind: "month"; scoping?: boolean }
  | { kind: "day"; scoping?: boolean }
  | { kind: "date_opened"; separator?: NumberPartSeparator; scoping?: boolean }
  | { kind: "matter_number"; scoping?: boolean }
  | { kind: "location_code"; scoping?: boolean }
  | { kind: "matter_type_code"; scoping?: boolean }
  | { kind: "client_code"; scoping?: boolean }
  | { kind: "staff_initials"; scoping?: boolean }
  | { kind: "client_name"; separator?: NumberPartSeparator; scoping?: boolean };

export type NumberSegmentKind = NumberSegment["kind"];

/**
 * What stands between the pieces of the date numbered and between the words of a client's name.
 * Only link-safe punctuation, because a number rides in links, so a slash is never one. Absent
 * renders as nothing, which is how both parts read before a firm could choose.
 */
export type NumberPartSeparator = "-" | "." | "_" | "~" | "";

/** The separators a part offers, in the picker's order, each named by what it is. */
export const NUMBER_PART_SEPARATOR_CHOICES: readonly {
  readonly value: NumberPartSeparator;
  readonly label: string;
}[] = [
  { value: "-", label: "Dash" },
  { value: ".", label: "Period" },
  { value: "_", label: "Underscore" },
  { value: "~", label: "Tilde" },
  { value: "", label: "None" },
];

/** Whether a part is made of pieces a separator stands between. */
export function takesSeparator(
  segment: NumberSegment,
): segment is Extract<NumberSegment, { kind: "date_opened" | "client_name" }> {
  return segment.kind === "date_opened" || segment.kind === "client_name";
}

/** RFC 3986 unreserved characters: what a rendered number, and so a literal, may be made of. */
export const URL_SAFE_PATTERN = /^[A-Za-z0-9._~-]+$/;

export interface NumberSegmentVocabularyEntry {
  readonly kind: NumberSegmentKind;
  /** The part's name, as the kind picker offers it. */
  readonly label: string;
  /** What the part renders as, in one sentence. The picker carries it; the table does not. */
  readonly description: string;
  /** Whether the part takes its value from the record, and so can scope the counter. */
  readonly valued: boolean;
}

/**
 * Every part a number can be made of, IN ALPHABETICAL ORDER (owner ruling, 2026-09-19). A dozen
 * parts is a list somebody scans rather than reads, and the reader knows the name of the one they
 * are looking for; grouping them by kind only helps somebody who already knows the grouping. A
 * purpose offers the subset the listing names for it (numberSegmentVocabularyFor).
 */
export const NUMBER_SEGMENT_VOCABULARY: readonly NumberSegmentVocabularyEntry[] = [
  {
    kind: "staff_initials",
    label: "Attorney Initials",
    description: "The responsible attorney's initials.",
    valued: true,
  },
  {
    kind: "client_code",
    label: "Client Code",
    description: "The firm's own short code for the client.",
    valued: true,
  },
  {
    kind: "client_name",
    label: "Client Name",
    description:
      "The client's name, accents folded out and words joined by the separator you choose.",
    valued: true,
  },
  {
    kind: "counter",
    label: "Counter",
    description: "The part that ticks up with each number drawn. Every scheme has exactly one.",
    valued: false,
  },
  {
    kind: "date_opened",
    label: "Date Numbered",
    description:
      "The date the record was numbered: year, month and day, with the separator you choose.",
    valued: true,
  },
  {
    kind: "day",
    label: "Day",
    description: "The day of the month the record was numbered, as two digits.",
    valued: true,
  },
  {
    kind: "matter_number",
    label: "Matter Number",
    description: "The number of the matter the record belongs to.",
    valued: true,
  },
  {
    kind: "month",
    label: "Month",
    description: "The month the record was numbered, as two digits.",
    valued: true,
  },
  {
    kind: "location_code",
    label: "Office Code",
    description: "The code of the office the record belongs to.",
    valued: true,
  },
  {
    kind: "matter_type_code",
    label: "Practice Area Code",
    description: "The code of the matter's practice area.",
    valued: true,
  },
  {
    kind: "literal",
    label: "Text",
    description: "A fixed piece of text, such as a separator or a prefix.",
    valued: false,
  },
  {
    kind: "year",
    label: "Year",
    description: "The year the record was numbered, as two or four digits.",
    valued: true,
  },
];

/** The parts one purpose may use, in the picker's order. */
export function numberSegmentVocabularyFor(
  kinds: readonly NumberSegmentKind[],
): readonly NumberSegmentVocabularyEntry[] {
  return NUMBER_SEGMENT_VOCABULARY.filter((entry) => kinds.includes(entry.kind));
}

export function numberSegmentVocabulary(kind: NumberSegmentKind): NumberSegmentVocabularyEntry {
  const entry = NUMBER_SEGMENT_VOCABULARY.find((candidate) => candidate.kind === kind);
  if (entry === undefined) throw new Error(`no vocabulary for segment kind ${kind}`);
  return entry;
}

/** A fresh part of the given kind, with the defaults a firm most often keeps. */
export function newNumberSegment(kind: NumberSegmentKind): NumberSegment {
  switch (kind) {
    case "literal":
      return { kind, text: "-" };
    case "counter":
      // No padding by default: 3333-9 is followed by 3333-10, and a firm that wants 0001 says so.
      return { kind, padWidth: 1, start: 1 };
    case "year":
      // The year scopes by default: a per-year run is what a file room's numbers do.
      return { kind, digits: 4, scoping: true };
    case "date_opened":
      return { kind, separator: ".", scoping: false };
    case "client_name":
      return { kind, separator: "-", scoping: false };
    case "month":
    case "day":
    case "matter_number":
    case "location_code":
    case "matter_type_code":
    case "client_code":
    case "staff_initials":
      return { kind, scoping: false };
  }
}

/** Whether a part can scope the counter: the parts that take a value from the record. */
export function isScopingCapable(segment: NumberSegment): boolean {
  return numberSegmentVocabulary(segment.kind).valued;
}

/** Whether a part is marked scoping. */
export function isScoping(segment: NumberSegment): boolean {
  return "scoping" in segment && segment.scoping === true;
}

/**
 * What stands in the way of saving a scheme, in one sentence, or null where nothing does. The
 * counter rule is the server's own; the rest is what the server would refuse part by part.
 */
export function numberingSchemeRefusal(segments: readonly NumberSegment[]): string | null {
  if (segments.length === 0) return "A scheme needs at least a counter.";
  const counters = segments.filter((segment) => segment.kind === "counter").length;
  if (counters === 0) return "A scheme needs a counter: the part that ticks up with each number.";
  if (counters > 1) return "A scheme has exactly one counter; remove the others.";
  for (const segment of segments) {
    if (segment.kind === "literal" && !URL_SAFE_PATTERN.test(segment.text)) {
      return segment.text.length === 0
        ? "A text part cannot be empty."
        : `Text can carry only letters, digits and . _ ~ -; "${segment.text}" cannot appear in a number.`;
    }
    if (
      segment.kind === "counter" &&
      (!Number.isInteger(segment.padWidth) || segment.padWidth < 1)
    ) {
      return "The counter's width is at least one digit.";
    }
    if (
      segment.kind === "counter" &&
      segment.start !== undefined &&
      (!Number.isInteger(segment.start) || segment.start < 1)
    ) {
      return "The counter starts at one or higher.";
    }
  }
  return null;
}

/** The list with one part moved by `delta` places; unchanged when the move would leave the list. */
export function moveNumberSegment(
  segments: readonly NumberSegment[],
  index: number,
  delta: -1 | 1,
): readonly NumberSegment[] {
  const target = index + delta;
  if (index < 0 || index >= segments.length || target < 0 || target >= segments.length) {
    return segments;
  }
  const next = [...segments];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return segments;
  next.splice(target, 0, moved);
  return next;
}

/** The list with the part at `from` taken out and seated at `to`, as a drag drops it. */
export function moveNumberSegmentTo(
  segments: readonly NumberSegment[],
  from: number,
  to: number,
): readonly NumberSegment[] {
  if (from === to || from < 0 || from >= segments.length || to < 0 || to >= segments.length) {
    return segments;
  }
  const next = [...segments];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return segments;
  next.splice(to, 0, moved);
  return next;
}

export function replaceNumberSegment(
  segments: readonly NumberSegment[],
  index: number,
  segment: NumberSegment,
): readonly NumberSegment[] {
  return segments.map((existing, at) => (at === index ? segment : existing));
}

export function removeNumberSegment(
  segments: readonly NumberSegment[],
  index: number,
): readonly NumberSegment[] {
  return segments.filter((_, at) => at !== index);
}

/** Whether two schemes are the same template, part for part. */
export function numberingSchemesEqual(
  left: readonly NumberSegment[] | null,
  right: readonly NumberSegment[] | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The sample record the live preview renders against, as the server's listing supplies it. Every
 * valued part has a value, so a scheme previews whatever parts it uses; the sentence beside the
 * preview says these are samples. The server renders every example on the listing against the
 * same sample, so the two never disagree.
 */
export interface NumberingSampleContext {
  readonly openedDate: string;
  readonly matterNumber: string;
  readonly locationCode: string;
  readonly matterTypeCode: string;
  readonly clientCode: string;
  readonly staffInitials: string;
  readonly clientName: string;
}

/** The year of the sample, for the copy that names one: the digits picker and the examples. */
export function numberingSampleYear(context: Pick<NumberingSampleContext, "openedDate">): string {
  return context.openedDate.slice(0, 4);
}

/**
 * What one kind of part would put into a number for the sample record, as the Part picker shows it
 * beside each choice so a reader sees what they are choosing before they choose it. The parts with
 * a separator show the one a fresh part starts with. The preview of the whole scheme stays the
 * server's: this answers "what is this part", never "what is the number".
 */
export function numberSegmentSampleValue(
  kind: NumberSegmentKind,
  sample: NumberingSampleContext,
): string {
  switch (kind) {
    case "literal":
      return "-";
    case "counter":
      return "1";
    case "year":
      return sample.openedDate.slice(0, 4);
    case "month":
      return sample.openedDate.slice(5, 7);
    case "day":
      return sample.openedDate.slice(8, 10);
    case "date_opened":
      return sample.openedDate.split("-").join(".");
    case "matter_number":
      return sample.matterNumber;
    case "location_code":
      return sample.locationCode;
    case "matter_type_code":
      return sample.matterTypeCode;
    case "client_code":
      return sample.clientCode;
    case "staff_initials":
      return sample.staffInitials;
    case "client_name":
      return sample.clientName.trim().split(/\s+/).join("-");
  }
}

/**
 * What the Current row says beneath its name, which is nothing while a scheme is in force: the
 * number beside it says what the scheme is (owner ruling, 2026-11-09). Only an unset scheme earns a
 * line, because that is a consequence rather than an explanation.
 */
export function numberingCurrentDescriptor(
  record: Pick<NumberingPurposeRecord, "purpose" | "subjects">,
  committed: readonly NumberSegment[] | null,
): string {
  return committed === null ? numberingNothingInForceSentence(record) : "";
}

/**
 * What the Current row says beneath its name when the firm has set nothing — the consequence a
 * reader must know before they leave the page, in the sequence's own terms. Only the matter
 * sequence has no built-in default: a matter number is the firm's file spine and refuses to be
 * invented; every other sequence numbers from its default until the firm writes its own.
 */
export function numberingNothingInForceSentence(
  record: Pick<NumberingPurposeRecord, "purpose" | "subjects">,
): string {
  return record.purpose === "matter"
    ? "Nothing. A matter cannot open until a scheme is set, because its number is drawn at that moment and never changes."
    : `Nothing of the firm's; the built-in sequence numbers ${record.subjects} until one is set.`;
}

/** What Save says once it has landed, in the sequence's own terms. */
export function numberingSavedSentence(record: Pick<NumberingPurposeRecord, "subjects">): string {
  const subjects = record.subjects.charAt(0).toUpperCase() + record.subjects.slice(1);
  return `Saved. ${subjects} numbered from now on draw their number from this scheme; numbers already drawn are unchanged.`;
}

/** The consequence line beside Save, in the owner's words (owner ruling, 2026-11-09). */
export const NUMBERING_FUTURE_ONLY_SENTENCE = "Numbering Scheme only affects future generation.";

/**
 * Why a part's cell holds a control that cannot be typed into: the fact the column asks for does
 * not exist for this kind of part. Said on the control's hover, so the table keeps its columns
 * where they are instead of reflowing under the hand (docs/conventions/design-corrections.md,
 * "Changing an answer must not move the form"). Where the cell would state a VALUE instead, the
 * editor states what the part will put into the number rather than a reason.
 */
export function numberSegmentCellRefusal(
  kind: NumberSegmentKind,
  column: "value" | "format" | "start" | "scoping",
  scopeSource: "segments" | "owner" = "segments",
): string | null {
  const label = numberSegmentVocabulary(kind).label;
  switch (column) {
    case "value":
      return kind === "literal"
        ? null
        : `${label} has no text of its own; it takes its value from the record.`;
    case "format":
      return kind === "counter" ||
        kind === "year" ||
        kind === "date_opened" ||
        kind === "client_name"
        ? null
        : `${label} has no format to set.`;
    case "start":
      return kind === "counter" ? null : `Only the counter starts at a number.`;
    case "scoping":
      if (scopeSource === "owner") {
        return "Each record this belongs to already keeps its own count, so no part can separate it.";
      }
      return numberSegmentVocabulary(kind).valued
        ? null
        : `${label} takes no value from the record, so it cannot keep a separate count.`;
  }
}

// ---- a number set by hand -------------------------------------------------------------------

/**
 * What stands in the way of setting a matter's number by hand, or null where nothing does. A
 * court's number, a legacy number from the firm's old system, a correction: the server checks the
 * same two things (URL-safe, unique in the firm) and the second only it can answer.
 */
export function matterNumberRefusal(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (trimmed.length === 0) return "Type the number.";
  if (!URL_SAFE_PATTERN.test(trimmed)) {
    return "A matter number can carry only letters, digits and . _ ~ - so it can stand in a link.";
  }
  return null;
}
