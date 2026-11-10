/*
 * The status register — the one place a status word is given its label, its tone and its meaning.
 *
 * WHY THIS IS DATA AND NOT A COMPONENT. Every surface that shows a status already has a component
 * for it: `Badge`, in its pale-tint register. What the surfaces were each inventing was the
 * VOCABULARY — which word, which colour, and what the word means on hover. A second chip component
 * would have solved the wrong half of the problem and created a new one, so this module ships the
 * vocabulary alone and the surfaces keep rendering `Badge`.
 *
 * ONE KEY SPACE, NOT ONE PER SURFACE. Draft appears in the workflow chain and in an invoice's
 * standing; Paid appears in an invoice's standing and on a charge that rides it. Those are the SAME
 * word and they carry the SAME tone wherever they appear, which is only true by construction if
 * there is exactly one entry for each. The vocabularies below are therefore ordered lists of keys
 * into this one map, never their own copies of it.
 *
 * HOW A SURFACE USES IT:
 *
 *   const entry = statusEntry("partially-paid");
 *   <Badge variant={entry.tone} title={entry.meaning}>{entry.label}</Badge>
 *
 * or, spreading the whole set of chip attributes at once:
 *
 *   <Badge {...statusBadgeAttributes("partially-paid")}>{statusEntry("partially-paid").label}</Badge>
 *
 * THREE RULES THIS MODULE EXISTS TO HOLD, none of which a surface may re-decide:
 *
 *   1. A withdrawn record renders through the chip ALONE. There is no strikethrough and no opacity
 *      dimming for `void` (or for `credited`) anywhere, which is why no entry here carries a row
 *      treatment of any kind: there is nothing for a surface to reach for.
 *   2. What a status MEANS rides the hover. `meaning` is a tooltip, never a sentence printed under
 *      the chip. The one printed statement in the product is a locked record's single lock line,
 *      which the record chain owns.
 *   3. One chip per row. The chip is workflow status; anything else a row wants to say about money
 *      or disposition says it in its own column.
 *
 * ADDING A STATUS: give it a row in STATUS_REGISTER and a place in the vocabulary that speaks it.
 * If the word already exists in another vocabulary, reuse the key rather than minting a second one.
 */
import type { BadgeVariant } from "../components/badge/index.ts";

/** Every status word the product speaks, across all six vocabularies. */
export type StatusKey =
  // The work-in-progress chain, shared by time entries, fees and costs.
  | "draft"
  | "submitted"
  | "approved"
  | "billed"
  | "void"
  // An invoice's derived standing. Draft and Void are the same words as the chain's.
  | "unpaid"
  | "partially-paid"
  | "paid"
  // A charge read off the invoice it rides. Paid is the same word as the invoice's.
  | "finalized"
  | "credited"
  // The file manager's safety verdict.
  | "error"
  | "warning"
  | "info"
  | "not-scanned"
  | "clean"
  // What the firm physically holds, and what has become of it.
  | "held"
  | "out"
  | "released"
  | "destroyed"
  | "lost"
  | "superseded"
  // A matter's own lifecycle. Active is the word the firm uses for a matter it is working; the
  // matters contract stores that state under the code `open`, which is a storage spelling and not a
  // word anybody reads.
  | "intake"
  | "consultation"
  | "active"
  | "on-hold"
  | "closed"
  // A member's standing in the firm. Two states and no third: a person the firm has added either
  // can reach the platform or cannot. The words say access rather than aliveness, because that is
  // the fact the roster is answering, and because a member who cannot sign in is still on the
  // roster, still the responsible attorney on the matters they carried, and still the author of
  // what they filed. "Inactive" would say the opposite of all three.
  | "member-has-access"
  | "member-no-access"
  // How a conflict hit stands. Only the unanswered one asks for anything.
  | "unanswered"
  | "cleared"
  | "waiver-obtained"
  | "wall-erected"
  | "representation-declined"
  // Where a request on the community board stands, and whether a question there has its answer.
  // Prefixed because "new", "future" and "completed" are ordinary words other vocabularies may want.
  | "community-new"
  | "community-future"
  | "community-planned"
  | "community-building-now"
  | "community-beta"
  | "community-completed"
  | "community-not-on-the-roadmap"
  | "community-duplicate"
  | "community-answered";

/**
 * How a status shows itself.
 *
 * Almost every status is a `chip` — a `Badge` in the tone this register gives it. `mark` is the one
 * exception: a scanned, typed, clean file carries the filled circle-check and no chip at all,
 * because a column that says "Clean" on most of its rows says nothing at all. A mark still has a
 * label, which is its accessible name.
 */
export type StatusPresentation = "chip" | "mark";

export interface StatusEntry {
  /** The word itself, exactly as it is rendered. */
  label: string;
  /** The `Badge` variant this word wears. The pale-tint register; never a solid one. */
  tone: BadgeVariant;
  /** What the word means, for the hover. Never printed beneath the status. */
  meaning: string;
  /** Whether the word renders as a chip or as the bare mark. */
  presentation: StatusPresentation;
}

export const STATUS_REGISTER: Readonly<Record<StatusKey, StatusEntry>> = {
  draft: {
    label: "Draft",
    tone: "neutral",
    meaning: "Editable, and committed to nothing.",
    presentation: "chip",
  },
  submitted: {
    label: "Submitted",
    tone: "warning",
    meaning: "Waiting on review. Sending it back to draft reopens it for editing.",
    presentation: "chip",
  },
  approved: {
    label: "Approved",
    tone: "success",
    meaning: "Cleared for billing. Sending it back to draft reopens it for editing.",
    presentation: "chip",
  },
  billed: {
    label: "Billed",
    tone: "info",
    meaning: "Evidence on a finalized invoice. A correction is a credit note beside the bill.",
    presentation: "chip",
  },
  void: {
    label: "Void",
    tone: "danger",
    meaning: "Withdrawn. It stays on the record and carries no value.",
    presentation: "chip",
  },
  unpaid: {
    label: "Unpaid",
    tone: "warning",
    meaning: "Finalized, with no payment applied.",
    presentation: "chip",
  },
  "partially-paid": {
    label: "Partially Paid",
    tone: "info",
    meaning: "Some payment has been applied. A balance remains.",
    presentation: "chip",
  },
  paid: {
    label: "Paid",
    tone: "success",
    meaning: "Paid in full. No balance remains.",
    presentation: "chip",
  },
  finalized: {
    label: "Finalized",
    tone: "info",
    meaning: "On a finalized invoice that has not been paid.",
    presentation: "chip",
  },
  credited: {
    label: "Credited",
    tone: "danger",
    meaning: "Reversed by a credit note recorded beside the bill.",
    presentation: "chip",
  },
  error: {
    label: "Error",
    tone: "danger",
    meaning: "A signature match or a type mismatch.",
    presentation: "chip",
  },
  warning: {
    label: "Warning",
    tone: "warning",
    meaning: "Nothing to grade yet: no committed version to scan.",
    presentation: "chip",
  },
  info: {
    label: "Info",
    tone: "info",
    meaning: "Scanned clean, with no document type recorded.",
    presentation: "chip",
  },
  "not-scanned": {
    label: "Not scanned",
    tone: "neutral",
    meaning: "No scan has run on this file.",
    presentation: "chip",
  },
  clean: {
    label: "Clean",
    tone: "success",
    meaning: "Scanned clean, with a document type recorded.",
    presentation: "mark",
  },

  // What the firm physically holds, and what has become of it.
  held: {
    label: "Held",
    tone: "neutral",
    meaning: "In the firm's safekeeping, at the location the register names.",
    presentation: "chip",
  },
  out: {
    /*
     * "On loan", not "Out" and not "Checked out".
     *
     * THE PAIR IS WHAT HAS TO BE UNMISTAKABLE, NOT THE WORD ON ITS OWN. `out` and `released` are the
     * two states in which the property is not on the shelf, and they are opposites: a loan is the
     * firm's to get back and a release has ended the firm's custody for good. "Out" said neither,
     * and "Checked out" was read as the same event as "Released" — both just mean it left the
     * building until you already know the difference, which is exactly what a status must not
     * require. "On loan" carries the return in the word.
     *
     * It is still the domain's own noun rather than an invention: the ledger row for this state
     * records a BORROWER — `borrower_kind`, `borrower_name`, `due_back_on` — and what a borrower has
     * is a loan.
     */
    label: "On loan",
    tone: "warning",
    meaning:
      "On loan and coming back. The ledger names who has it and when it is due; the firm's custody has not ended.",
    presentation: "chip",
  },
  released: {
    label: "Released",
    tone: "info",
    // The contrast with a loan is the whole content of this word, so the meaning states the ending
    // rather than only the handing over.
    meaning:
      "Handed back for good, and the firm's custody has ended. The ledger records the authority it left on and who collected it.",
    presentation: "chip",
  },
  destroyed: {
    label: "Destroyed",
    tone: "danger",
    meaning: "Destroyed after a request and a separate approval. It does not come back.",
    presentation: "chip",
  },
  lost: {
    label: "Lost",
    tone: "danger",
    meaning: "Recorded as not found. It stays on the record until somebody records finding it.",
    presentation: "chip",
  },
  superseded: {
    label: "Superseded",
    tone: "neutral",
    meaning: "Replaced by a later instrument. The firm still holds it.",
    presentation: "chip",
  },

  // A matter's own lifecycle. Closed is archived-but-additive here — a closed matter can still
  // accrue record — so it reads quiet neutral and never destructive red, which would say the file
  // was destroyed rather than finished. Consultation is work the firm has not taken on yet, which is
  // information rather than progress; intake is quieter still, because nothing has been decided.
  intake: {
    label: "Intake",
    tone: "neutral",
    meaning:
      "An intake in flight: the firm is collecting what its procedure requires before it consults. It carries an intake number and no other.",
    presentation: "chip",
  },
  consultation: {
    label: "Consultation",
    tone: "info",
    meaning:
      "A prospective client's matter the firm has not taken on. It carries a consultation number, the intake number it came in under where it had one, and no matter number.",
    presentation: "chip",
  },
  active: {
    label: "Active",
    tone: "success",
    meaning: "Open work. The firm's next matter number was drawn when it opened, and is fixed.",
    presentation: "chip",
  },
  // On hold is the one lifecycle state that asks for attention: the firm stopped working the
  // matter for a reason somebody recorded, and the reason has not gone away. Warning, not danger:
  // nothing is wrong with the record, and the matter keeps its number.
  "on-hold": {
    label: "On Hold",
    tone: "warning",
    meaning:
      "The firm has paused its work, for a recorded reason, without closing the matter. It keeps its number and returns to Active when released.",
    presentation: "chip",
  },
  closed: {
    label: "Closed",
    tone: "neutral",
    meaning: "The work has ended. The record stays, and can still take entries against it.",
    presentation: "chip",
  },

  // A member's standing. Deliberately NOT the matter lifecycle's Active: one word cannot carry two
  // meanings in a register whose whole job is that a status word means one thing.
  "member-has-access": {
    label: "Has Access",
    tone: "success",
    meaning: "Signs in, and holds whatever their roles allow.",
    presentation: "chip",
  },
  "member-no-access": {
    label: "No Access",
    tone: "neutral",
    meaning:
      "Cannot sign in. They stay on the roster and keep every record they made: they are still the responsible attorney on the matters they carried.",
    presentation: "chip",
  },

  // How a conflict hit was answered. Only the UNANSWERED state is loud: grading a lawyer's
  // judgement is the one thing this register may not do, so every answer reads level with the
  // others and none of them is coloured as the better outcome.
  unanswered: {
    label: "Unanswered",
    tone: "warning",
    meaning: "Surfaced by a check and not yet answered by anyone.",
    presentation: "chip",
  },
  cleared: {
    label: "Cleared",
    tone: "neutral",
    meaning: "Answered: examined and found not to be a conflict.",
    presentation: "chip",
  },
  "waiver-obtained": {
    label: "Waiver Obtained",
    tone: "info",
    meaning: "Answered: the affected party consented to the representation.",
    presentation: "chip",
  },
  "wall-erected": {
    label: "Wall Erected",
    tone: "info",
    meaning: "Answered: the firm screened the conflicted people from the matter.",
    presentation: "chip",
  },
  "representation-declined": {
    label: "Representation Declined",
    tone: "neutral",
    meaning: "Answered: the firm did not take the work.",
    presentation: "chip",
  },
  "community-new": {
    label: "New",
    tone: "neutral",
    meaning: "Not reviewed by the Magna Carta team yet.",
    presentation: "chip",
  },
  "community-future": {
    label: "Future",
    tone: "neutral",
    meaning: "Reviewed and worth doing, but not scheduled.",
    presentation: "chip",
  },
  "community-planned": {
    label: "Planned",
    tone: "info",
    meaning: "Accepted and on the roadmap. There is no target date.",
    presentation: "chip",
  },
  "community-building-now": {
    label: "Building Now",
    tone: "accent",
    meaning: "Being built now.",
    presentation: "chip",
  },
  "community-beta": {
    label: "Beta",
    tone: "warning",
    meaning: "Built and available to firms on the beta channel.",
    presentation: "chip",
  },
  "community-completed": {
    label: "Completed",
    tone: "success",
    meaning: "Shipped to every firm.",
    presentation: "chip",
  },
  "community-not-on-the-roadmap": {
    label: "Not on the Roadmap",
    tone: "neutral",
    meaning: "Declined, with the reason the team gave.",
    presentation: "chip",
  },
  "community-duplicate": {
    label: "Duplicate",
    tone: "neutral",
    meaning: "Merged into another request, which carries its votes.",
    presentation: "chip",
  },
  "community-answered": {
    label: "Answered",
    tone: "success",
    meaning: "The person who asked marked a reply as the answer.",
    presentation: "chip",
  },
};

/**
 * The four vocabularies, each an ORDERED list of keys into the register above.
 *
 * Order is the reading order a column filter, a legend and the record chain all take, so it is a
 * fact about the vocabulary rather than something each of them sorts for itself.
 */
export const STATUS_VOCABULARIES = {
  /** Time entries, fees and costs, as they move through the firm. */
  workflowChain: ["draft", "submitted", "approved", "billed", "void"],
  /** An invoice's standing, derived from what has been paid against it. */
  invoiceStanding: ["draft", "unpaid", "partially-paid", "paid", "void"],
  /** A charge, read off the invoice it rides. */
  chargeStanding: ["finalized", "paid", "credited"],
  /** The file manager's safety column, and the analysis severities that feed it. */
  safety: ["error", "warning", "info", "not-scanned", "clean"],
  /** What the firm physically holds, and what has become of it. */
  custody: ["held", "out", "released", "destroyed", "lost", "superseded"],
  /** A matter's own lifecycle, in the order a matter passes through it. */
  matterLifecycle: ["intake", "consultation", "active", "on-hold", "closed"],
  /** A member's standing in the firm: whether they can reach the platform at all. */
  memberStanding: ["member-has-access", "member-no-access"],
  /**
   * How a conflict hit stands. Unanswered leads because it is the only one that asks for
   * something; the four answers follow in no order of preference, because there is none.
   */
  conflictHit: [
    "unanswered",
    "cleared",
    "waiver-obtained",
    "wall-erected",
    "representation-declined",
  ],
  /** Where a community request stands, in the order a request moves through the pipeline. */
  communityRequest: [
    "community-new",
    "community-future",
    "community-planned",
    "community-building-now",
    "community-beta",
    "community-completed",
    "community-not-on-the-roadmap",
    "community-duplicate",
  ],
  /** Whether a community question has its accepted answer. */
  communityQuestion: ["community-new", "community-answered"],
} as const satisfies Readonly<Record<string, readonly StatusKey[]>>;

export type StatusVocabulary = keyof typeof STATUS_VOCABULARIES;

/** One status word, by key. */
export function statusEntry(key: StatusKey): StatusEntry {
  return STATUS_REGISTER[key];
}

/** The words of one vocabulary, in reading order, as whole entries. */
export function statusVocabulary(vocabulary: StatusVocabulary): readonly StatusEntry[] {
  return STATUS_VOCABULARIES[vocabulary].map(statusEntry);
}

/**
 * The attributes a `Badge` takes for a status, ready to spread. `variant` carries the tone and
 * `title` carries the meaning, which is what puts the explanation on the hover instead of on the
 * surface. The label is deliberately not in here: it is the badge's child, not an attribute.
 */
export function statusBadgeAttributes(key: StatusKey): { variant: BadgeVariant; title: string } {
  const entry = statusEntry(key);
  return { variant: entry.tone, title: entry.meaning };
}

/**
 * Whether showing this status beside the given heading would say the same word twice.
 *
 * A record with no number yet is NAMED by its standing, so "Draft Bill" plus a Draft chip states
 * draft twice in one glance. The chip is dropped exactly there and kept in every state where it
 * adds a fact, so a finalized invoice still shows Unpaid, Partially Paid or Paid. The rule lives
 * here rather than in each window because a surface that has to remember it will not.
 */
export function statusRepeatsHeading(key: StatusKey, heading: string): boolean {
  const words = new Set(heading.toLowerCase().split(/[^a-z]+/i));
  return statusEntry(key)
    .label.toLowerCase()
    .split(" ")
    .every((word) => words.has(word));
}
