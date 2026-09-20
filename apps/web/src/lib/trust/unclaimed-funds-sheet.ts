/*
 * One diligence file, on paper.
 *
 * THIS IS THE ARTEFACT SOMEBODY ASKS FOR. A firm that reports unclaimed client money is asked, by a
 * state administrator or by the client's own counsel, to produce what it did to find the owner: the
 * ledger as it stood, every attempt in order, and how the round ended. The window is where that is
 * read; this is what leaves the building, so nothing on it is a hover, a chip or a link.
 *
 * IT SAYS NOTHING THE FILE DOES NOT HOLD. Every line comes off the review record, in the same words
 * the window shows, so the paper and the screen can never disagree about what the firm did.
 */
import type {
  PrintSheetDocument,
  PrintSheetSection,
} from "@magna-carta/design-system/print-sheet";
import { formatDate, formatInstant } from "@magna-carta/design-system/formatters";
import type { TrustUnclaimedFundsReview } from "./trust-api.ts";
import {
  contactChannelLabel,
  contactOutcomeLabel,
  matterHeading,
  reviewOutcomeLabel,
} from "./unclaimed-funds-vocabulary.ts";

/** What the sheet needs that the review record does not carry. */
export interface UnclaimedFundsSheetContext {
  readonly matterNumber: string | null;
  readonly matterTitle: string | null;
  /** How an amount reads, from the surface that already knows the currency. */
  readonly money: (amountMinor: number) => string;
  /** One member identifier as a name, where the firm's roster can say. */
  readonly memberName: (identifier: string) => string;
  readonly printedAt: Date;
}

/** A day as the paper prints one, or the words for a day the record does not hold. */
function dayOrAbsent(civilDate: string | null): string {
  return civilDate === null ? "Not recorded" : formatDate(civilDate);
}

/** Everything one printed diligence file says. */
export function unclaimedFundsReviewSheet(
  review: TrustUnclaimedFundsReview,
  context: UnclaimedFundsSheetContext,
): PrintSheetDocument {
  const sections: PrintSheetSection[] = [
    {
      id: "observation",
      title: "The Observation",
      kind: "fields",
      fields: [
        { label: "Balance", value: context.money(review.observedBalanceMinor) },
        { label: "Currency", value: review.currency },
        { label: "Earliest Receipt", value: dayOrAbsent(review.observedEarliestReceiptDate) },
        { label: "Last Activity", value: dayOrAbsent(review.observedLastActivityDate) },
        { label: "Opened By", value: context.memberName(review.openedBy) },
        { label: "Opened On", value: formatInstant(review.openedAt) },
      ],
    },
  ];

  if (review.note !== null) {
    sections.push({ id: "opening-note", title: "Opening Note", kind: "text", text: review.note });
  }

  sections.push({
    id: "attempts",
    title: "Attempts to Reach the Owner",
    kind: "history",
    events: review.attempts.map((attempt) => ({
      id: attempt.id,
      action: `${contactChannelLabel(attempt.channel)}: ${contactOutcomeLabel(attempt.outcome)}`,
      at: attempt.recordedAt,
      source: context.memberName(attempt.recordedBy),
      detail: [
        `Attempted on ${formatDate(attempt.attemptedOn)}`,
        attempt.contactUsed === null ? null : `Using ${attempt.contactUsed}`,
        attempt.note,
      ]
        .filter((part): part is string => part !== null)
        .join(". "),
    })),
  });

  const closure = review.closure;
  if (closure !== null) {
    sections.push({
      id: "closure",
      title: "How the Round Ended",
      kind: "fields",
      fields: [
        { label: "Outcome", value: reviewOutcomeLabel(closure.outcome) },
        {
          label: "Trust Movement",
          value: closure.trustMovementId ?? "None attached",
        },
        { label: "Closed By", value: context.memberName(closure.closedBy) },
        { label: "Closed On", value: formatInstant(closure.closedAt) },
      ],
    });
    if (closure.note !== null) {
      sections.push({ id: "closing-note", title: "Closing Note", kind: "text", text: closure.note });
    }
  }

  return {
    heading: "Unclaimed Funds Review",
    reference: context.matterNumber ?? undefined,
    subtitle: matterHeading(context.matterNumber, context.matterTitle),
    sections,
    footer: `Magna Carta · printed ${formatInstant(context.printedAt)}`,
  };
}
