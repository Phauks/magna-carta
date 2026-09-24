/*
 * A firm's numbering schemes, as the settings editor holds them.
 *
 * A NUMBER IS A TEMPLATE OF SEGMENTS. The firm writes each of its numbers — matter, consultation,
 * intake, conflicts check, custody — as an ordered list of parts: a fixed piece of text, the year
 * the record was numbered, its office's code, its practice area's code, the client's code, and
 * exactly one counter that ticks up. Any part that varies can be marked as SCOPING, which starts
 * the count over for each distinct value of it — a year-scoped counter runs 0001 again each
 * January, the way a file room's numbers do. The sequence-numbering package owns the model, the
 * renderer and the register of purposes; this file spells the same shape for the editor and
 * states, in the reader's words, what each part is. What each PURPOSE is — its title, when its
 * number is drawn, which parts it may use — arrives from the server's listing, so the screen
 * never keeps a second copy of the register.
 *
 * WHY THE EDITOR VALIDATES BEFORE THE SERVER DOES. The one rule that cannot be broken — exactly
 * one counter — is the server's to enforce, and it does. It is repeated here so the editor can
 * say what is wrong beside the list instead of after a refused save, and so the live preview is
 * not asked to render a scheme the server would refuse.
 *
 * A NUMBER, ONCE DRAWN, IS FROZEN. A scheme change reaches only the matters numbered after it.
 * That is the matters package's rule, restated on the screen so nobody expects a renumbering.
 */

import { formatDate } from "@magna-carta/design-system/formatters";

/** Every number the firm issues, as the register names them. */
export type NumberingPurpose =
  | "matter"
  | "consultation"
  | "intake"
  | "conflicts_check"
  | "custody_packet"
  | "invoice"
  | "time_entry"
  | "communication";

/** The purposes whose shape the firm writes as a scheme. */
export type SchemeNumberingPurpose =
  | "matter"
  | "consultation"
  | "intake"
  | "conflicts_check"
  | "custody_packet";

/** One purpose as the listing describes it: what it is, and either its scheme or its fixed shape. */
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
  readonly formulation: "scheme" | "fixed";
  /** The parts a scheme for this purpose may use; null for a fixed purpose. */
  readonly segmentKinds: readonly NumberSegmentKind[] | null;
  /** What is in force: the firm's scheme or the built-in default; null where nothing is. */
  readonly segments: readonly NumberSegment[] | null;
  readonly usingDefault: boolean | null;
  /** A fixed purpose's shape and the reason; null for a scheme-shaped purpose. */
  readonly fixedShape: string | null;
  /** The first number the sample would render as under what is in force. */
  readonly example: string | null;
}

export function isSchemeNumberingPurpose(
  purpose: NumberingPurpose,
): purpose is SchemeNumberingPurpose {
  return (
    purpose === "matter" ||
    purpose === "consultation" ||
    purpose === "intake" ||
    purpose === "conflicts_check" ||
    purpose === "custody_packet"
  );
}

/** One part of a number, spelled the way the numbering contract stores it. */
export type NumberSegment =
  | { kind: "literal"; text: string }
  | { kind: "counter"; padWidth: number; start?: number }
  | { kind: "year"; digits: 2 | 4; scoping?: boolean }
  | { kind: "date_opened"; scoping?: boolean }
  | { kind: "location_code"; scoping?: boolean }
  | { kind: "matter_type_code"; scoping?: boolean }
  | { kind: "client_code"; scoping?: boolean }
  | { kind: "staff_initials"; scoping?: boolean }
  | { kind: "client_name"; scoping?: boolean };

export type NumberSegmentKind = NumberSegment["kind"];

/** RFC 3986 unreserved characters: what a rendered number, and so a literal, may be made of. */
export const URL_SAFE_PATTERN = /^[A-Za-z0-9._~-]+$/;

export interface NumberSegmentVocabularyEntry {
  readonly kind: NumberSegmentKind;
  /** The part's name, as the kind picker offers it. */
  readonly label: string;
  /** What the part renders as, in one sentence. */
  readonly description: string;
  /** Whether the part takes its value from the matter, and so can scope the counter. */
  readonly valued: boolean;
}

/**
 * Every part a number can be made of, in the order the picker offers them: the two structural
 * parts first, then the dates, then what the matter carries. A purpose offers the subset the
 * listing names for it (numberSegmentVocabularyFor).
 */
export const NUMBER_SEGMENT_VOCABULARY: readonly NumberSegmentVocabularyEntry[] = [
  {
    kind: "literal",
    label: "Text",
    description: "A fixed piece of text, such as a separator or a prefix.",
    valued: false,
  },
  {
    kind: "counter",
    label: "Counter",
    description: "The part that ticks up with each number drawn. Every scheme has exactly one.",
    valued: false,
  },
  {
    kind: "year",
    label: "Year",
    description: "The year the record was numbered, as two or four digits.",
    valued: true,
  },
  {
    kind: "date_opened",
    label: "Date Numbered",
    description: "The date the record was numbered, as eight digits (YYYYMMDD).",
    valued: true,
  },
  {
    kind: "location_code",
    label: "Office Code",
    description: "The code of the office the matter belongs to.",
    valued: true,
  },
  {
    kind: "matter_type_code",
    label: "Practice Area Code",
    description: "The code of the matter's practice area.",
    valued: true,
  },
  {
    kind: "client_code",
    label: "Client Code",
    description: "The firm's own short code for the client.",
    valued: true,
  },
  {
    kind: "staff_initials",
    label: "Attorney Initials",
    description: "The responsible attorney's initials.",
    valued: true,
  },
  {
    kind: "client_name",
    label: "Client Name",
    description: "The client's name, with spaces and accents folded out.",
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
      return { kind, padWidth: 4, start: 1 };
    case "year":
      // The year scopes by default: a per-year run is what a file room's numbers do.
      return { kind, digits: 4, scoping: true };
    case "date_opened":
    case "location_code":
    case "matter_type_code":
    case "client_code":
    case "staff_initials":
    case "client_name":
      return { kind, scoping: false };
  }
}

/** Whether a part can scope the counter: the parts that take a value from the matter. */
export function isScopingCapable(segment: NumberSegment): boolean {
  return numberSegmentVocabulary(segment.kind).valued;
}

/** Whether a part is marked scoping. */
export function isScoping(segment: NumberSegment): boolean {
  return "scoping" in segment && segment.scoping === true;
}

/** How one part reads on the scheme's own line, before the preview renders it. */
export function numberSegmentSummary(segment: NumberSegment): string {
  switch (segment.kind) {
    case "literal":
      return `"${segment.text}"`;
    case "counter":
      return `Counter, ${String(segment.padWidth)} digits${
        segment.start !== undefined && segment.start !== 1 ? `, from ${String(segment.start)}` : ""
      }`;
    case "year":
      return `Year, ${String(segment.digits)} digits${segment.scoping === true ? ", restarts the count" : ""}`;
    default:
      return `${numberSegmentVocabulary(segment.kind).label}${isScoping(segment) ? ", restarts the count" : ""}`;
  }
}

/**
 * What stands in the way of saving a scheme, in one sentence, or null where nothing does. The
 * counter rule is the server's own; the rest is what the server would refuse segment by segment.
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

export interface NumberingStarter {
  readonly key: string;
  readonly label: string;
  /** What it renders as at the first draw, given the year of the sample the server supplied. */
  readonly exampleFor: (year: string) => string;
  readonly segments: readonly NumberSegment[];
}

/**
 * The shapes a firm most often begins from. Each is a complete scheme the editor loads into the
 * list; every part is then the firm's to change. The examples are what the renderer produces for
 * the first number drawn in the sample's year, so a starter can be chosen by what it looks like
 * and never disagrees with the preview it loads.
 */
export const NUMBERING_STARTERS: readonly NumberingStarter[] = [
  {
    key: "year-counter",
    label: "Year and counter",
    exampleFor: (year) => `${year}-0001`,
    segments: [
      { kind: "year", digits: 4, scoping: true },
      { kind: "literal", text: "-" },
      { kind: "counter", padWidth: 4, start: 1 },
    ],
  },
  {
    key: "counter",
    label: "A running count",
    exampleFor: () => "00001",
    segments: [{ kind: "counter", padWidth: 5, start: 1 }],
  },
  {
    key: "type-year-counter",
    label: "Practice area, year and counter",
    exampleFor: (year) => `LIT-${year}-0001`,
    segments: [
      { kind: "matter_type_code", scoping: true },
      { kind: "literal", text: "-" },
      { kind: "year", digits: 4, scoping: true },
      { kind: "literal", text: "-" },
      { kind: "counter", padWidth: 4, start: 1 },
    ],
  },
  {
    key: "client-counter",
    label: "Client code and counter",
    exampleFor: () => "ASH-001",
    segments: [
      { kind: "client_code", scoping: true },
      { kind: "literal", text: "-" },
      { kind: "counter", padWidth: 3, start: 1 },
    ],
  },
];

/** The starters a purpose may begin from: those built only of parts it may use. */
export function numberingStartersFor(
  kinds: readonly NumberSegmentKind[],
): readonly NumberingStarter[] {
  return NUMBERING_STARTERS.filter((starter) =>
    starter.segments.every((segment) => kinds.includes(segment.kind)),
  );
}

/**
 * The sample record the live preview renders against, as the server's listing supplies it. Every
 * valued part has a value, so a scheme previews whatever parts it uses; the sentence beside the
 * preview says these are samples. The server renders every example on the listing against the
 * same sample, so the two never disagree.
 */
export interface NumberingSampleContext {
  readonly openedDate: string;
  readonly locationCode: string;
  readonly matterTypeCode: string;
  readonly clientCode: string;
  readonly staffInitials: string;
  readonly clientName: string;
}

/** The year of the sample, for the copy that names one: the digits picker and the starters. */
export function numberingSampleYear(context: Pick<NumberingSampleContext, "openedDate">): string {
  return context.openedDate.slice(0, 4);
}

/**
 * How the sample reads beside the preview, so a rendered code is never mistaken for the firm's.
 * Only the facts the purpose's parts can use are named: a conflicts check has no office or client.
 * The day is formatted the way every recorded day on the product is, never as the wire form.
 */
export function numberingSampleSentence(
  context: NumberingSampleContext,
  record: Pick<NumberingPurposeRecord, "subject" | "segmentKinds">,
): string {
  const kinds = record.segmentKinds ?? [];
  const facts: string[] = [];
  if (kinds.includes("location_code")) facts.push(`at office ${context.locationCode}`);
  if (kinds.includes("matter_type_code")) facts.push(`practice area ${context.matterTypeCode}`);
  if (kinds.includes("client_code")) facts.push(`client code ${context.clientCode}`);
  if (kinds.includes("staff_initials")) facts.push(`attorney ${context.staffInitials}`);
  if (kinds.includes("client_name")) facts.push(`client ${context.clientName}`);
  const opened = `Previewed for a ${record.subject} numbered ${formatDate(context.openedDate)}`;
  return facts.length === 0 ? `${opened}.` : `${opened} ${facts.join(", ")}.`;
}

/**
 * What the In Force row says under its value: the parts of the scheme in force, said to be the
 * built-in sequence where it is, or the consequence of nothing being in force.
 */
export function numberingInForceDescriptor(
  record: Pick<NumberingPurposeRecord, "purpose" | "subjects">,
  committed: readonly NumberSegment[] | null,
  usingDefault: boolean,
): string {
  if (committed === null) return numberingNothingInForceSentence(record);
  const recipe = committed.map(numberSegmentSummary).join(" · ");
  return usingDefault ? `The built-in sequence: ${recipe}` : recipe;
}

/**
 * The name of the row that loads a common shape into the editor: the scheme itself, named for the
 * sequence it shapes ("Matter Numbering Scheme"), by the owner's ruling of 2026-09-11. It used to
 * read "Start from", which named the gesture rather than the thing being chosen.
 */
export function numberingSchemeLabel(record: Pick<NumberingPurposeRecord, "title">): string {
  return `${record.title.replace(/ Numbers$/, "")} Numbering Scheme`;
}

/**
 * What the In Force row says beneath its name when the firm has set nothing — the consequence a
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

/** The consequence line beside Save, in the sequence's own terms. */
export function numberingFrozenSentence(record: Pick<NumberingPurposeRecord, "subjects">): string {
  return `A number already drawn is frozen. Saving reaches only the ${record.subjects} numbered from now on.`;
}

/**
 * Why a part's cell holds a control that cannot be typed into: the fact the column asks for does
 * not exist for this kind of part. Said on the control's hover, so the table keeps its columns
 * where they are instead of reflowing under the hand (docs/conventions/design-corrections.md,
 * "Changing an answer must not move the form").
 */
export function numberSegmentCellRefusal(
  kind: NumberSegmentKind,
  column: "text" | "digits" | "start" | "scoping",
): string | null {
  const label = numberSegmentVocabulary(kind).label;
  switch (column) {
    case "text":
      return kind === "literal"
        ? null
        : `${label} has no text of its own; it takes its value from the record.`;
    case "digits":
      return kind === "counter" || kind === "year" ? null : `${label} has no digit count to set.`;
    case "start":
      return kind === "counter" ? null : `Only the counter starts at a number.`;
    case "scoping":
      return numberSegmentVocabulary(kind).valued
        ? null
        : `${label} takes no value from the record, so it cannot restart the count.`;
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
