/*
 * The period ledger's own decisions: whose time is being read, and what the strip under it says.
 *
 * The surface is composition; this is the part of it worth holding still in a test. Two questions
 * live here and nowhere else — which timekeepers a reader may ask about (which is a permission
 * question with a real refusal behind it), and how a period's totals read once they are text.
 *
 * WHOSE TIME IS A SERVER QUESTION, NOT A FILTER. Narrowing a loaded page to one person's rows and
 * narrowing the READ to one person are different answers whenever the record runs past a page: the
 * first shows one page's worth of that person's time and calls it their week. So the choice made
 * here changes what is asked for, and the surface re-reads when it changes.
 */
import { formatDuration } from "@magna-carta/design-system/formatters";
import type { GridFigure } from "@magna-carta/design-system/data-table";
import type { FirmMemberSummary } from "$lib/members/members-api.ts";
import type { PeriodTotals } from "./time-figures.ts";

/** The capability that lets a member read time that is not their own. */
export const VIEW_FIRM_TIME_PERMISSION = "time:viewFirm";

/**
 * One option on the whose-time control.
 *
 * `timekeeperUserId` is null for the whole firm, which is the value the listing itself takes — the
 * option and the request say the same thing, so nothing translates between them.
 */
export interface TimekeeperChoice {
  /** Stable across re-renders and usable as a select's value: "everyone", or the user handle. */
  readonly identifier: string;
  readonly label: string;
  readonly timekeeperUserId: string | null;
}

export const EVERYONE_CHOICE: TimekeeperChoice = {
  identifier: "everyone",
  label: "Everyone",
  timekeeperUserId: null,
};

/**
 * What the whose-time control offers.
 *
 * A member without the capability is offered themselves and nothing else — not a disabled list of
 * colleagues, which would be an inventory of what they cannot have. A member with it gets the whole
 * firm first, then themselves, then everybody else by name: the firm leads because a supervisor
 * opening this surface is asking about the firm, and their own name is the one they will reach for
 * second.
 *
 * The session's own row is drawn from the roster where the roster carries it, so the reader's name
 * reads the same as everybody else's; before the roster lands, "Me" stands in rather than a blank.
 */
export function timekeeperChoices(
  members: readonly FirmMemberSummary[],
  sessionUserId: string | null,
  maySeeFirmTime: boolean,
): readonly TimekeeperChoice[] {
  const mine: TimekeeperChoice[] =
    sessionUserId === null
      ? []
      : [
          {
            identifier: sessionUserId,
            label:
              members.find((member) => member.userId === sessionUserId)?.displayName ?? "My time",
            timekeeperUserId: sessionUserId,
          },
        ];
  if (!maySeeFirmTime) return mine;
  const others = members
    .filter((member) => member.status === "active" && member.userId !== sessionUserId)
    .map((member) => ({
      identifier: member.userId,
      label: member.displayName,
      timekeeperUserId: member.userId,
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label));
  return [EVERYONE_CHOICE, ...mine, ...others];
}

/** The choice a stored or typed identifier names, or the fallback where it names nothing. */
export function choiceByIdentifier(
  choices: readonly TimekeeperChoice[],
  identifier: string,
): TimekeeperChoice | undefined {
  return choices.find((choice) => choice.identifier === identifier);
}

/** A span of minutes in both literacies, as every duration on the product renders. */
function hours(minutes: number): string {
  return formatDuration(minutes).text;
}

/**
 * The strip under the table, as text.
 *
 * Hours lead and money follows, because a period is read in hours: "how much did I record this
 * week" is asked before "what is it worth". The billable figure carries the non-billable beside it
 * rather than instead of it — internal time is work, and a strip that reported only what bills
 * would quietly teach a firm that the rest of the week did not happen.
 *
 * A VOID IS NAMED RATHER THAN NETTED. Where the period holds one, the count says so, so a reader
 * who counts the rows and does not get the same number has the reason in front of them.
 */
export function periodFigureReading(
  totals: PeriodTotals,
  money: (amountMinor: number) => string,
): readonly GridFigure[] {
  return [
    {
      identifier: "recorded",
      label: "recorded",
      value: hours(totals.recordedMinutes),
      caption:
        totals.voidCount === 0
          ? "Every hour on the record for this period, billable and not."
          : `Every hour on the record for this period, billable and not. ${String(totals.voidCount)} voided ${totals.voidCount === 1 ? "entry counts" : "entries count"} toward nothing.`,
    },
    {
      identifier: "billable",
      label: "billable",
      value: hours(totals.billableMinutes),
      caption: "The hours a client can be charged for.",
    },
    {
      identifier: "non-billable",
      label: "non-billable",
      value: hours(totals.nonBillableMinutes),
      caption: "The hours recorded as the firm's own. Real work; nobody is charged for it.",
    },
    {
      identifier: "unbilled",
      label: "unbilled",
      value: money(totals.unbilledAmountMinor),
      caption: "Billable value no finalized invoice has taken up yet.",
    },
    {
      identifier: "billed",
      label: "billed",
      value: money(totals.billedAmountMinor),
      caption: "Billable value a finalized invoice has taken up.",
    },
  ];
}
