import { type NumberSegment, type NumberSegmentKind, NUMBER_SEGMENT_KINDS } from "./segments.ts";

/*
 * EVERY NUMBER THE FIRM ISSUES, IN ONE REGISTER.
 *
 * A firm numbers many things — matters, consultations, enquiries, conflicts checks, custody
 * packets, invoices, time entries, calls — and until this table existed each subsystem answered
 * "what shape is my number, and can the firm change it?" on its own: matters with a template
 * engine and a settings screen, custodian with a fixed-shape record nothing ever configured,
 * conflicts with a hard-coded prefix and MAX + 1. Three answers to one question drift, and a firm
 * looking for where its numbers are decided found one screen that named one of them.
 *
 * So what a sequence IS lives here, as one row per purpose: what it is called, when its number is
 * drawn, whether the firm shapes it and with which parts, what keeps its counters separate from
 * another purpose's in a shared counter table, and what renders until the firm chooses. A purpose
 * that is shaped by a scheme reads its active template from `numbering_scheme` (one active row per
 * purpose) and falls back to the default recorded here. A purpose whose shape is FIXED — ruled by
 * the owner rather than left to the firm — is still listed, with the shape and the reason, so the
 * one settings screen is the whole inventory rather than the configurable half of it.
 *
 * The register is static on purpose: a new sequence is one row here, one `purpose` value on the
 * scheme table's enum, and the owning package's counter tables. Nothing registers at runtime, so a
 * reader can see every number the platform draws without starting it.
 */

export type NumberingPurpose =
  | "matter"
  | "consultation"
  | "intake"
  | "conflicts_check"
  | "custody_packet"
  | "invoice"
  | "time_entry"
  | "communication";

/** The purposes whose shape the firm writes as a scheme, in the order the settings screen lists them. */
export type SchemeNumberingPurpose =
  | "matter"
  | "consultation"
  | "intake"
  | "conflicts_check"
  | "custody_packet";

interface PurposeCommon {
  readonly purpose: NumberingPurpose;
  /** The plate heading on the settings screen: "Matter Numbers". */
  readonly title: string;
  /** What the run is called when a draw that could not converge has to be reported: "matter number". */
  readonly label: string;
  /** The record the run numbers, singular, for a sentence: "a matter". */
  readonly subject: string;
  /** The same, plural: "matters numbered from now on". */
  readonly subjects: string;
  /** When the number is drawn, in one sentence a reader of the settings screen needs. */
  readonly drawnWhen: string;
}

/** A purpose the firm shapes with a scheme of segments. */
export interface SchemeNumberingPurposeDefinition extends PurposeCommon {
  readonly purpose: SchemeNumberingPurpose;
  readonly formulation: "scheme";
  /**
   * The parts a scheme for this purpose may use. A matter carries an office, a practice area, a
   * client and a responsible attorney, so its number may be built from any of them; a conflicts
   * check or a custody packet carries none of those at the moment it is numbered, so offering the
   * part would only produce a refusal on the first draw.
   */
  readonly segmentKinds: readonly NumberSegmentKind[];
  /**
   * What keeps this run's counters separate from another run's in a SHARED counter table. Empty for
   * a run that owns its tables or the unprefixed keys; the consultation and intake runs ride the
   * matter tables and namespace theirs. Scope keys join rendered segment values with ':', and every
   * rendered value is folded into the URL-safe set (A-Z a-z 0-9 . _ ~ -), which contains no '/', so
   * no unprefixed scope key can forge a prefixed one, and the prefixes are distinct words so neither
   * can forge the other.
   */
  readonly scopePrefix: string;
  /**
   * The scheme to render from when the firm has configured none, or null to refuse.
   *
   * Only the matter run refuses. A matter number is the firm's own file numbering and there is no
   * defensible default — rendering one would stamp a shape the firm never chose onto a number that
   * is then frozen. Every other run has a default, because refusing to take an enquiry, open a
   * conflicts check or log a deed packet until somebody has visited the settings screen is the
   * worse failure.
   */
  readonly fallbackScheme: readonly NumberSegment[] | null;
}

/** A purpose whose shape is fixed by ruling: listed so the inventory is complete, never edited. */
export interface FixedNumberingPurposeDefinition extends PurposeCommon {
  readonly formulation: "fixed";
  /**
   * What renders, in one sentence a settings row can carry as its descriptor. WHY the firm does not
   * choose it is the user guide's to explain (docs/user/admin/numbering.md), not the screen's.
   */
  readonly fixedShape: string;
  /** What the first record of 2026 renders as. */
  readonly example: string;
}

export type NumberingPurposeDefinition =
  | SchemeNumberingPurposeDefinition
  | FixedNumberingPurposeDefinition;

// The parts a record numbered on its own — with no matter behind it — can use: text, the counter,
// and the day it was numbered. Everything else on the vocabulary is a fact about a matter.
const DATE_ONLY_KINDS: readonly NumberSegmentKind[] = ["literal", "counter", "year", "date_opened"];

/*
 * The consultation sequence is a SEPARATE sequence from the matter number, not a preview of it. A
 * firm's matter numbers are the spine of its file room, and a consultation that never becomes a
 * matter must not consume one — a gap in that run reads as a lost file. It renders "C2026-0001": a
 * leading C nobody can mistake for a matter number, the year, and a per-year counter — the year
 * segment is scoping, so the run restarts each January the way a firm's own file numbers do.
 */
export const DEFAULT_CONSULTATION_SCHEME: readonly NumberSegment[] = [
  { kind: "literal", text: "C" },
  { kind: "year", digits: 4, scoping: true },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 4, start: 1 },
];

/*
 * The intake sequence: the number an enquiry wears from the moment the firm writes it down. A
 * third sequence, not an early draw on either of the others, for exactly the reason the
 * consultation number is not an early draw on the matter number: most enquiries never become
 * consultations, and a consultation run pitted with declined enquiries cannot be told apart from
 * one with records missing. "I2026-0001": a leading I nobody can mistake for a matter number or a
 * consultation's C, the year, and a per-year counter.
 */
export const DEFAULT_INTAKE_SCHEME: readonly NumberSegment[] = [
  { kind: "literal", text: "I" },
  { kind: "year", digits: 4, scoping: true },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 4, start: 1 },
];

/*
 * The conflicts check sequence. A check used to render "CC-" and four digits from a firm-wide count
 * that never restarted. That run is the busiest a firm has: every intake, every new party, every
 * automatic re-check opens one, so a four-digit firm-wide count reads as a five- and then six-digit
 * number within a couple of years and stops looking like the reference the firm wrote on its intake
 * sheets. "CC2026-00001": the CC that says what kind of record it is, the year, and a per-year
 * counter wide enough that a firm running a hundred thousand checks in one year still reads the
 * width it chose. The year restarts the count, so the run never grows past the shape a person
 * expects; a wider value is rendered in full rather than wrapped, so nothing is ever refused.
 */
export const DEFAULT_CONFLICTS_CHECK_SCHEME: readonly NumberSegment[] = [
  { kind: "literal", text: "CC" },
  { kind: "year", digits: 4, scoping: true },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 5, start: 1 },
];

/*
 * The custody sequence: what a person writes on a physical label and reads over the phone.
 * "CUS-00001", firm-wide — a globally unique custody number is easier to say over the phone and
 * impossible to confuse, so the default does not restart the count. The shape is the one custodian
 * rendered from its own fixed record before the sequence joined this register, so nothing already
 * labelled changes.
 */
export const DEFAULT_CUSTODY_PACKET_SCHEME: readonly NumberSegment[] = [
  { kind: "literal", text: "CUS-" },
  { kind: "counter", padWidth: 5, start: 1 },
];

// See the prefix reasoning on `scopePrefix` above: '/' is outside the URL-safe set, and the two
// words are distinct.
export const CONSULTATION_SCOPE_PREFIX = "consultation/";
export const INTAKE_SCOPE_PREFIX = "intake/";

const DEFINITIONS: readonly NumberingPurposeDefinition[] = [
  {
    purpose: "matter",
    formulation: "scheme",
    title: "Matter Numbers",
    label: "matter number",
    subject: "matter",
    subjects: "matters",
    drawnWhen: "Drawn once, the moment a matter opens, and frozen from then on.",
    segmentKinds: NUMBER_SEGMENT_KINDS,
    scopePrefix: "",
    fallbackScheme: null,
  },
  {
    purpose: "consultation",
    formulation: "scheme",
    title: "Consultation Numbers",
    label: "consultation number",
    subject: "consultation",
    subjects: "consultations",
    drawnWhen:
      "Drawn when an enquiry becomes a consultation, from its own run, and kept beside the matter number once the matter opens.",
    segmentKinds: NUMBER_SEGMENT_KINDS,
    scopePrefix: CONSULTATION_SCOPE_PREFIX,
    fallbackScheme: DEFAULT_CONSULTATION_SCHEME,
  },
  {
    purpose: "intake",
    formulation: "scheme",
    title: "Intake Numbers",
    label: "intake number",
    subject: "enquiry",
    subjects: "enquiries",
    drawnWhen:
      "Drawn the moment an enquiry is written down, from its own run, and kept beside every number the file draws later.",
    segmentKinds: NUMBER_SEGMENT_KINDS,
    scopePrefix: INTAKE_SCOPE_PREFIX,
    fallbackScheme: DEFAULT_INTAKE_SCHEME,
  },
  {
    purpose: "conflicts_check",
    formulation: "scheme",
    title: "Conflicts Check Numbers",
    label: "conflicts check number",
    subject: "conflicts check",
    subjects: "conflicts checks",
    drawnWhen:
      "Drawn the moment a conflicts check is opened; every run of the check belongs to the same number.",
    segmentKinds: DATE_ONLY_KINDS,
    scopePrefix: "",
    fallbackScheme: DEFAULT_CONFLICTS_CHECK_SCHEME,
  },
  {
    purpose: "custody_packet",
    formulation: "scheme",
    title: "Custody Packet Numbers",
    label: "custody number",
    subject: "custody packet",
    subjects: "custody packets",
    drawnWhen:
      "Drawn when a packet is logged into custody, unless a number carried in from a paper register is recorded instead.",
    segmentKinds: DATE_ONLY_KINDS,
    scopePrefix: "",
    fallbackScheme: DEFAULT_CUSTODY_PACKET_SCHEME,
  },
  {
    purpose: "invoice",
    formulation: "fixed",
    title: "Invoice Numbers",
    label: "invoice number",
    subject: "invoice",
    subjects: "invoices",
    drawnWhen: "Drawn when a bill is finalized, never at draft.",
    fixedShape:
      "A five-digit count that never restarts, firm-wide or under the letterhead scope chosen when the bill is finalized.",
    example: "00001",
  },
  {
    purpose: "time_entry",
    formulation: "fixed",
    title: "Time Entry Numbers",
    label: "time entry number",
    subject: "time entry",
    subjects: "time entries",
    drawnWhen: "Drawn when an entry is captured, in capture order on its matter.",
    fixedShape: "The matter's own number, a dot, and a four-digit count per matter.",
    example: "2026-0001.0001",
  },
  {
    purpose: "communication",
    formulation: "fixed",
    title: "Call and Text Numbers",
    label: "communication number",
    subject: "call or text",
    subjects: "calls and texts",
    drawnWhen: "Drawn when a call or text is recorded.",
    fixedShape: "The day it happened, then a four-digit count for that day.",
    example: "2026-01-01-0001",
  },
];

/** Every purpose, in the order the settings screen lists them. */
export const NUMBERING_PURPOSES: readonly NumberingPurposeDefinition[] = DEFINITIONS;

/** The purposes a firm shapes with a scheme, in the same order. */
export const SCHEME_NUMBERING_PURPOSES: readonly SchemeNumberingPurpose[] = DEFINITIONS.filter(
  (definition): definition is SchemeNumberingPurposeDefinition =>
    definition.formulation === "scheme",
).map((definition) => definition.purpose);

/** What this purpose is. The one place any of its facts is answered. */
export function purposeOf(purpose: NumberingPurpose): NumberingPurposeDefinition {
  const definition = DEFINITIONS.find((candidate) => candidate.purpose === purpose);
  if (definition === undefined) throw new Error(`no numbering purpose ${purpose}`);
  return definition;
}

/** A purpose shaped by a scheme, or a thrown error for one that is fixed — the scheme paths ask this. */
export function schemePurposeOf(purpose: SchemeNumberingPurpose): SchemeNumberingPurposeDefinition {
  const definition = purposeOf(purpose);
  if (definition.formulation !== "scheme") {
    throw new Error(`numbering purpose ${purpose} is fixed and takes no scheme`);
  }
  return definition;
}

export function isSchemeNumberingPurpose(purpose: string): purpose is SchemeNumberingPurpose {
  return SCHEME_NUMBERING_PURPOSES.includes(purpose as SchemeNumberingPurpose);
}
