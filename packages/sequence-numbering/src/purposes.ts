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
 * drawn, which parts it may be built from, what decides the counter's scope, what keeps its
 * counters separate from another purpose's in a shared counter table, and what renders until the
 * firm chooses. Every purpose reads its active template from `numbering_scheme` (one active row per
 * purpose) and falls back to the default recorded here, so the one settings screen is the whole
 * inventory rather than the configurable half of it — the three runs that were once listed with a
 * fixed shape and a reason are schemes like the rest, each defaulting to exactly what it used to
 * render.
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

/**
 * The purposes whose shape the firm writes as a scheme — every one of them, since the owner's
 * ruling of 2026-09-19 that the last three fixed runs become the firm's to shape too. The type is
 * kept distinct from NumberingPurpose so a later run that genuinely cannot be shaped has somewhere
 * to sit without widening every call site.
 */
export type SchemeNumberingPurpose = NumberingPurpose;

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
  /**
   * What a panel creating one of these records shows before the save. `held`: the number itself,
   * kept for that panel and given back if it is cancelled, so the run keeps no gap
   * (./reservation.ts). `previewed`: what the next record would take, holding nothing — for a run
   * that must also stay in creation order, which giving a number back would break, and for a run
   * numbered in capture batches with no panel to hold for.
   */
  readonly draftNumber: "held" | "previewed";
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
   * WHAT DECIDES THE COUNTER'S SCOPE.
   *
   * `segments` — the scheme's own scoping parts, which is the general case and the safe one: the
   * scope key IS the joined rendered values of those parts, so two records in different scopes
   * differ in a part the number renders, and the rendered number cannot collide. A firm that drops
   * the year from such a scheme gets one firm-wide run rather than a collision.
   *
   * `owner` — the domain decides, and the caller passes the key: a time entry counts within its
   * MATTER (the matter's handle, which a renumber does not move), an invoice within the letterhead
   * chosen when the bill was finalized. Neither is a rendered value, so neither can be derived from
   * the template, and scoping marks mean nothing on those runs — the schema refuses them rather
   * than letting a firm set a switch that does nothing.
   */
  readonly scopeSource: "segments" | "owner";
  /**
   * OWNER-SCOPED RUNS ONLY: the part that tells one scope's numbers from another's, which such a
   * scheme must carry. An owner-scoped run gets no uniqueness from its template for free — two
   * matters both count 0001 — so the part naming the scope is what keeps the rendered numbers
   * apart, and the schema requires it. Null where the run has one scope until a firm deliberately
   * opens a second (the invoice run), where the refusal belongs at the moment the second scope is
   * opened rather than on every scheme.
   */
  readonly scopeDistinguishedBy: NumberSegmentKind | null;
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

export type NumberingPurposeDefinition = SchemeNumberingPurposeDefinition;

// The parts a record numbered on its own — with no matter behind it — can use: text, the counter,
// and the day it was numbered. Everything else on the vocabulary is a fact about a matter.
const DATE_ONLY_KINDS: readonly NumberSegmentKind[] = [
  "literal",
  "counter",
  "year",
  "month",
  "day",
  "date_opened",
];

// Everything a MATTER carries. Not its own number: a matter number built from a matter number is a
// definition that eats itself, and the run it would read from is this one.
const MATTER_KINDS: readonly NumberSegmentKind[] = NUMBER_SEGMENT_KINDS.filter(
  (kind) => kind !== "matter_number",
);

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

/*
 * The invoice sequence: a five-digit count that never restarts, which is what it rendered before
 * the firm could shape it, so nothing a firm has already sent changes. It never restarts because a
 * tax invoice's number is a run the firm's auditors read end to end, and a run that restarts each
 * January is two runs to reconcile.
 *
 * The count is per LETTERHEAD, chosen when the bill is finalized, not per anything the template
 * renders — so the scope is the caller's. A firm issuing on one letterhead has one scope and needs
 * nothing in its number to tell scopes apart; a firm that opens a second is refused at that moment
 * unless its scheme carries the office code, which is where the refusal can actually be acted on.
 */
export const DEFAULT_INVOICE_SCHEME: readonly NumberSegment[] = [
  { kind: "counter", padWidth: 5, start: 1 },
];

/*
 * The time entry sequence: the matter's own number, a dot, and a four-digit count within that
 * matter — "2026-0001.0042", which is what it rendered before the firm could shape it. An entry is
 * read against the matter it belongs to, so its number carries that matter's, and the count is per
 * matter: the scope is the matter's handle, which a renumber does not move, so a matter renumbered
 * after the fact keeps its entries' numbering dense.
 */
export const DEFAULT_TIME_ENTRY_SCHEME: readonly NumberSegment[] = [
  { kind: "matter_number" },
  { kind: "literal", text: "." },
  { kind: "counter", padWidth: 4, start: 1 },
];

/*
 * The call and text sequence: the day it happened, then a four-digit count for that day —
 * "2026-09-08-0042", which is what it rendered before the firm could shape it. The day is in the
 * number so a reader knows when the call was without a lookup, and the three date parts scope the
 * count, so a firm-wide run never reaches the five digits a year of traffic would otherwise take.
 *
 * The day is the UTC day of the instant, the platform's rule for the day of a recorded moment used
 * as a key (docs/conventions/dates.md): a number is a key before it is a sentence, and pinned to
 * UTC it reads the same in every office.
 */
export const DEFAULT_COMMUNICATION_SCHEME: readonly NumberSegment[] = [
  { kind: "year", digits: 4, scoping: true },
  { kind: "literal", text: "-" },
  { kind: "month", scoping: true },
  { kind: "literal", text: "-" },
  { kind: "day", scoping: true },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 4, start: 1 },
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
    draftNumber: "held",
    segmentKinds: MATTER_KINDS,
    scopeSource: "segments",
    scopeDistinguishedBy: null,
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
    draftNumber: "held",
    segmentKinds: MATTER_KINDS,
    scopeSource: "segments",
    scopeDistinguishedBy: null,
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
    draftNumber: "held",
    segmentKinds: MATTER_KINDS,
    scopeSource: "segments",
    scopeDistinguishedBy: null,
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
    draftNumber: "held",
    segmentKinds: DATE_ONLY_KINDS,
    scopeSource: "segments",
    scopeDistinguishedBy: null,
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
    draftNumber: "held",
    segmentKinds: DATE_ONLY_KINDS,
    scopeSource: "segments",
    scopeDistinguishedBy: null,
    scopePrefix: "",
    fallbackScheme: DEFAULT_CUSTODY_PACKET_SCHEME,
  },
  {
    purpose: "invoice",
    formulation: "scheme",
    title: "Invoice Numbers",
    label: "invoice number",
    subject: "invoice",
    subjects: "invoices",
    drawnWhen: "Drawn when a bill is finalized, never at draft.",
    // A bill can cover several matters, so it carries no one matter's client, office or area. The
    // office code renders the letterhead the bill was finalized under.
    draftNumber: "previewed",
    segmentKinds: ["literal", "counter", "year", "month", "day", "date_opened", "location_code"],
    scopeSource: "owner",
    scopeDistinguishedBy: null,
    scopePrefix: "",
    fallbackScheme: DEFAULT_INVOICE_SCHEME,
  },
  {
    purpose: "time_entry",
    formulation: "scheme",
    title: "Time Entry Numbers",
    label: "time entry number",
    subject: "time entry",
    subjects: "time entries",
    drawnWhen: "Drawn when an entry is captured, in capture order on its matter.",
    // No date parts, deliberately. A capture batch takes several entries on one matter from ONE
    // counter read, and a block renders its numbers from one context — so a date part would stamp
    // every entry in the batch with the day the batch was taken rather than the day each was
    // worked. The matter's own number already carries whatever date the firm put in it.
    draftNumber: "previewed",
    segmentKinds: ["literal", "counter", "matter_number"],
    scopeSource: "owner",
    scopeDistinguishedBy: "matter_number",
    scopePrefix: "",
    fallbackScheme: DEFAULT_TIME_ENTRY_SCHEME,
  },
  {
    purpose: "communication",
    formulation: "scheme",
    title: "Call and Text Numbers",
    label: "communication number",
    subject: "call or text",
    subjects: "calls and texts",
    drawnWhen: "Drawn when a call or text is recorded.",
    draftNumber: "held",
    segmentKinds: DATE_ONLY_KINDS,
    scopeSource: "segments",
    scopeDistinguishedBy: null,
    scopePrefix: "",
    fallbackScheme: DEFAULT_COMMUNICATION_SCHEME,
  },
];

/** Every purpose, in the order the settings screen lists them. */
export const NUMBERING_PURPOSES: readonly NumberingPurposeDefinition[] = DEFINITIONS;

/** The purposes a firm shapes with a scheme: every one of them, in the same order. */
export const SCHEME_NUMBERING_PURPOSES: readonly SchemeNumberingPurpose[] = DEFINITIONS.map(
  (definition) => definition.purpose,
);

/** What this purpose is. The one place any of its facts is answered. */
export function purposeOf(purpose: NumberingPurpose): NumberingPurposeDefinition {
  const definition = DEFINITIONS.find((candidate) => candidate.purpose === purpose);
  if (definition === undefined) throw new Error(`no numbering purpose ${purpose}`);
  return definition;
}

/** A purpose shaped by a scheme. Every purpose is, so this is `purposeOf` under the scheme paths' name. */
export function schemePurposeOf(purpose: SchemeNumberingPurpose): SchemeNumberingPurposeDefinition {
  return purposeOf(purpose);
}

export function isSchemeNumberingPurpose(purpose: string): purpose is SchemeNumberingPurpose {
  return SCHEME_NUMBERING_PURPOSES.includes(purpose as SchemeNumberingPurpose);
}
