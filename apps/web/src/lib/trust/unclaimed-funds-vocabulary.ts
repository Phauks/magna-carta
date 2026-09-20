/*
 * The words the unclaimed-funds surface uses, and the small judgments behind them.
 *
 * DORMANCY IS A COMPARISON, NOT A STATE, and the vocabulary has to keep saying so. Nothing here
 * calls a ledger "dormant" as though the platform had decided it: the reader states a day, and what
 * comes back is every ledger that has had no movement since then. So the field is named for the
 * question ("Quiet since") rather than for a status, and the sentence that stands before a day is
 * chosen asks for one instead of apologising for an empty list.
 *
 * THE CHANNELS AND THE OUTCOMES ARE SPELLED OUT, not abbreviated to their wire values. A record of
 * diligence is read years later by somebody outside the firm, and `record_review` means nothing to
 * them: the one channel that reaches nobody says in its own label that it is a review of the firm's
 * own records, which is also why it is the one channel that needs no address.
 *
 * A MATTER IS NAMED BY ITS NUMBER AND ITS TITLE, and by its identifier where the roster cannot say.
 * Same discipline as trust-member-names.ts holds for a member: rendering nothing would say the
 * ledger belonged to no matter, so the handle stands with a line saying why it is not a name.
 *
 * NOTHING HERE READS A RECORD APART. These are words. What a request carries, and what refuses one
 * before it is sent, is unclaimed-funds-requests.ts.
 */
import type { ChoiceOption } from "$lib/components/choice-picker.ts";
import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
import type { TrustContactChannel, TrustContactOutcome, TrustReviewOutcome } from "./trust-api.ts";

// ---- the window the reader states ---------------------------------------------------------------

/** The field that states the window. It is a question about movement, never a stored status. */
export const QUIET_SINCE_LABEL = "Quiet Since";

/** What the list says before a day has been chosen: there is nothing to read until there is one. */
export const QUIET_SINCE_UNANSWERED =
  "Choose a day to read the ledgers that have had no movement since then.";

/** What the list says once a day has been chosen and every ledger has moved since it. */
export const NO_DORMANT_BALANCES = "No ledger has been quiet since that day.";

/** What the read could not do, in the one line the section has room for. */
export const DORMANT_BALANCES_UNREADABLE =
  "The quiet ledgers could not be read, so none is shown. The ledgers themselves are unaffected.";

// ---- a matter, named ------------------------------------------------------------------------------

/** What a row shows for one matter, and what its hover says where the name is not the name. */
export interface MatterDisplay {
  readonly text: string;
  /** The hover, where there is something to explain. Absent once the matter is named. */
  readonly title: string | undefined;
}

/** What the hover says while the firm's matters are still being read. */
export const MATTER_NAME_READING = "Reading the firm's matters.";

/** What it says where the matter is not in what was read: the handle is standing in, not failing. */
export const MATTER_NAME_UNREADABLE =
  "This matter is not in the firm's matters as they were read, so its number is not shown.";

/** A matter as a reader says it: its number, then its title. */
export function matterHeading(matterNumber: string | null, matterTitle: string | null): string {
  if (matterNumber === null) return matterTitle ?? "";
  return matterTitle === null ? matterNumber : `${matterNumber} · ${matterTitle}`;
}

/**
 * One matter identifier as a number and a title where the roster can say, and as itself where it
 * cannot. `matters` is null while the roster read is in flight, which is a different sentence from
 * a roster that answered and does not hold this matter.
 */
export function matterDisplay(
  matterId: string,
  matters: readonly SheetMatter[] | null,
): MatterDisplay {
  if (matters === null) return { text: matterId, title: MATTER_NAME_READING };
  const matter = matters.find((candidate) => candidate.id === matterId);
  if (matter === undefined) return { text: matterId, title: MATTER_NAME_UNREADABLE };
  return { text: matterHeading(matter.matterNumber, matter.title), title: undefined };
}

// ---- the review standing a row carries -----------------------------------------------------------

/** What a ledger's Review row says where a diligence file is already open over it. */
export const REVIEW_STANDING_OPEN = "Open review";

/** What it says where none is: a real value, not a blank a reader has to interpret. */
export const REVIEW_STANDING_NONE = "None";

/** What that absence means, on the hover. */
export const REVIEW_STANDING_NONE_MEANING = "No diligence file is open over this ledger.";

/** What a Review row reads for a ledger, given the file open over it if there is one. */
export function reviewStandingLabel(openReviewId: string | null): string {
  return openReviewId === null ? REVIEW_STANDING_NONE : REVIEW_STANDING_OPEN;
}

// ---- opening a file -------------------------------------------------------------------------------

/**
 * What opening a file does to the money, stated in the panel that opens one.
 *
 * It is the fear the panel has to answer: a reader looking at a client's balance and a control
 * called Open Review has to know, before they press it, that nothing is being paid out.
 */
export const OPENING_MOVES_NO_MONEY =
  "Opening a file records that the firm is looking for the owner. It moves no money.";

/** What the observation IS: what the reader saw, kept as they saw it. */
export const OBSERVATION_MEANING =
  "The ledger as this read served it. It is stored with the file as what the reviewer acted on; the ledger itself may move afterwards.";

// ---- reaching the owner ----------------------------------------------------------------------------

/** Every channel an attempt can be made through, in the order the panel offers them. */
export const TRUST_CONTACT_CHANNELS: readonly TrustContactChannel[] = [
  "regular_mail",
  "certified_mail",
  "telephone",
  "email",
  "record_review",
  "other",
];

/** What a channel is called, spelled out rather than abbreviated to its wire value. */
export function contactChannelLabel(channel: TrustContactChannel): string {
  switch (channel) {
    case "regular_mail":
      return "Regular mail";
    case "certified_mail":
      return "Certified mail";
    case "telephone":
      return "Telephone";
    case "email":
      return "Email";
    case "record_review":
      return "Review of the firm's own records";
    default:
      return "Other";
  }
}

/** What a channel means, where the label alone is not the whole answer. */
export function contactChannelMeaning(channel: TrustContactChannel): string | undefined {
  switch (channel) {
    case "certified_mail":
      return "Mail the carrier records the delivery of, which is what most states ask for.";
    case "record_review":
      return "Looking through what the firm already holds for an address or a number. It reaches nobody, so it needs none.";
    default:
      return undefined;
  }
}

/** The channels as a closed choice. */
export function contactChannelChoices(): readonly ChoiceOption[] {
  return TRUST_CONTACT_CHANNELS.map((channel) => ({
    value: channel,
    label: contactChannelLabel(channel),
    meaning: contactChannelMeaning(channel),
  }));
}

/** Every outcome an attempt can come to, in the order the panel offers them. */
export const TRUST_CONTACT_OUTCOMES: readonly TrustContactOutcome[] = [
  "no_response",
  "undeliverable",
  "reached",
  "declined",
  "wrong_contact",
  "other",
];

/** What an outcome is called. */
export function contactOutcomeLabel(outcome: TrustContactOutcome): string {
  switch (outcome) {
    case "no_response":
      return "No response";
    case "undeliverable":
      return "Undeliverable";
    case "reached":
      return "Reached";
    case "declined":
      return "Declined";
    case "wrong_contact":
      return "Wrong contact";
    default:
      return "Other";
  }
}

/** What an outcome means, where two of them are easy to read as one another. */
export function contactOutcomeMeaning(outcome: TrustContactOutcome): string | undefined {
  switch (outcome) {
    case "no_response":
      return "It reached somewhere and nobody answered.";
    case "undeliverable":
      return "It did not reach anywhere: the address or the number is no longer good.";
    case "wrong_contact":
      return "Somebody answered and it was not the owner.";
    default:
      return undefined;
  }
}

/** The outcomes as a closed choice. */
export function contactOutcomeChoices(): readonly ChoiceOption[] {
  return TRUST_CONTACT_OUTCOMES.map((outcome) => ({
    value: outcome,
    label: contactOutcomeLabel(outcome),
    meaning: contactOutcomeMeaning(outcome),
  }));
}

/** The field that names what was actually used to reach the owner. */
export const CONTACT_USED_LABEL = "Contact Used";

/** What that field wants, and the one channel that needs none. */
export const CONTACT_USED_HINT =
  "The address or the number the attempt actually used. A review of the firm's own records reaches nobody, so it is the one channel that needs none.";

/** What a failed read of the file says, in the one line the window has room for. */
export const REVIEW_UNREADABLE =
  "This file could not be read, so what it holds is not shown. The file itself is unaffected.";

// ---- ending a round --------------------------------------------------------------------------------

/** Every outcome a round of diligence can end on, in the order the panel offers them. */
export const TRUST_REVIEW_OUTCOMES: readonly TrustReviewOutcome[] = [
  "distributed_to_owner",
  "resolved_without_distribution",
  "not_dormant",
  "search_continues",
];

/** What an outcome is called. */
export function reviewOutcomeLabel(outcome: TrustReviewOutcome): string {
  switch (outcome) {
    case "distributed_to_owner":
      return "Distributed to the owner";
    case "resolved_without_distribution":
      return "Resolved without a distribution";
    case "not_dormant":
      return "Not dormant";
    default:
      return "The search continues";
  }
}

/** What each outcome means, because the four decide what the firm does with the money next. */
export function reviewOutcomeMeaning(outcome: TrustReviewOutcome): string {
  switch (outcome) {
    case "distributed_to_owner":
      return "The owner was found and paid, through the ordinary authorized path. This attaches that payment to the file.";
    case "resolved_without_distribution":
      return "The ledger was settled another way: the money was applied, returned or accounted for without a distribution to the owner.";
    case "not_dormant":
      return "The ledger was not unclaimed after all. The money stays where it is.";
    default:
      return "This round of diligence is over and the search is not. A later round opens a new file.";
  }
}

/** The outcomes as a closed choice. */
export function reviewOutcomeChoices(): readonly ChoiceOption[] {
  return TRUST_REVIEW_OUTCOMES.map((outcome) => ({
    value: outcome,
    label: reviewOutcomeLabel(outcome),
    meaning: reviewOutcomeMeaning(outcome),
  }));
}

/** The field that names the payment a distribution closes over. */
export const TRUST_MOVEMENT_LABEL = "Trust Movement";

/** What that field is asking for, and what closing does not do. */
export const TRUST_MOVEMENT_HINT =
  "The payment out that already posted through the ordinary authorized path. Closing the file attaches that movement to it and moves nothing itself.";

/** Why the field stands refused on the other three outcomes rather than disappearing. */
export const TRUST_MOVEMENT_NOT_ASKED =
  "Only a distribution to the owner attaches a payment. The other three outcomes close the file without one.";
