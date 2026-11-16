/*
 * The Matter Billing Guide, arranged for a screen and a file: how many matters are billed under each
 * kind of fee agreement, then every open and held matter with its agreement, the agreement's terms
 * and the rates recorded against the matter or its client.
 *
 * Every figure is the payload's. The tiles are its counts; the terms are stated in the words the
 * matter's own fee agreement panel uses (`$lib/billing/fee-agreement.ts`), and a share at the rate
 * scale becomes a percentage there, by formatting alone.
 */
import { formatDate, formatNumber } from "@magna-carta/design-system/formatters";
import { ARRANGEMENT_KIND_LABELS, arrangementTerms } from "$lib/billing/fee-agreement.ts";
import {
  completenessLine,
  type ReportPresentation,
  type ReportSummaryTile,
} from "./report-presentation.ts";
import { captionOr, moneyText, rateText } from "./report-cells.ts";
import { matterCaption, NO_CLIENT, NO_OFFICE } from "./financial-presenters.ts";
import type {
  MatterBillingGuide,
  MatterBillingGuideRow,
  MatterBillingRate,
} from "./report-reads.ts";

/** What a matter with no agreement recorded shows in the Arrangement column and on its tile. */
export const NO_ARRANGEMENT = "None recorded";

const RATE_TIER_WORDS: Record<MatterBillingRate["tier"], string> = {
  matter: "this matter",
  client: "the client",
};

function arrangementText(row: MatterBillingGuideRow): string {
  return row.arrangement === null ? NO_ARRANGEMENT : ARRANGEMENT_KIND_LABELS[row.arrangement.kind];
}

/** The terms in force, and the amendment already recorded to follow them, if there is one. */
function termsText(row: MatterBillingGuideRow): string {
  const terms = arrangementTerms(row.arrangement, moneyText);
  if (row.nextArrangement === null) return terms;
  const next = row.nextArrangement;
  return `${terms} From ${formatDate(next.validFrom)}: ${ARRANGEMENT_KIND_LABELS[next.kind]}, ${arrangementTerms(next, moneyText)}`;
}

function ratesText(rates: readonly MatterBillingRate[]): string {
  if (rates.length === 0) return "-";
  return rates
    .map(
      (rate) =>
        `${rateText(rate.rateE4, rate.currency)} an hour for ${RATE_TIER_WORDS[rate.tier]} (${rate.rateCardName})`,
    )
    .join("; ");
}

function countTile(label: string, count: number): ReportSummaryTile {
  return { label, value: formatNumber(count), detail: null, tone: "plain" };
}

/**
 * Matter Billing Guide: the matters counted by kind of agreement, then every open and held matter
 * on its own row, sortable, in the order the payload lists them.
 */
export function presentMatterBillingGuide(report: MatterBillingGuide): ReportPresentation {
  const totals = report.totals;
  const summary: ReportSummaryTile[] = [
    countTile(ARRANGEMENT_KIND_LABELS.hourly, totals.hourlyCount),
    countTile(ARRANGEMENT_KIND_LABELS.flat_fee, totals.flatFeeCount),
    countTile(ARRANGEMENT_KIND_LABELS.contingency, totals.contingencyCount),
    countTile(ARRANGEMENT_KIND_LABELS.retainer, totals.retainerCount),
    countTile(NO_ARRANGEMENT, totals.noneRecordedCount),
    {
      label: "Matters",
      value: formatNumber(totals.matterCount),
      detail: null,
      tone: "total",
    },
  ];
  return {
    title: "Matter Billing Guide",
    subtitle: `As it stands on ${formatDate(report.asOfDate)}`,
    stamp: report.statement,
    reproducible: false,
    completeness: report.completeness,
    summary,
    sections: [
      {
        id: "matters",
        title: "Matters",
        headers: ["Matter", "Client", "Office", "Arrangement", "Terms", "Rates"],
        rows: report.matters.map((matter) => [
          matterCaption(matter),
          captionOr(matter.clientName, matter.clientEntityId ?? NO_CLIENT),
          captionOr(matter.locationName, NO_OFFICE),
          arrangementText(matter),
          termsText(matter),
          ratesText(matter.rates),
        ]),
        sortable: true,
        subordinateColumns: [2],
        aside: completenessLine(report.completeness),
        whenEmpty: "No matter is open or on hold.",
      },
    ],
  };
}
