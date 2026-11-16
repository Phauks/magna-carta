/*
 * How the financial, productivity and operational presenters print a figure.
 *
 * Money goes through @magna-carta/money: the payload's minor units become a Money once, which
 * formats as text and gives the spreadsheet its number. Nothing here adds two figures. A zero prints
 * as a dash, so the figures that are there stand out in a row of buckets, and keeps its number so a
 * spreadsheet still sums the column.
 */
import { formatNumber } from "@magna-carta/design-system/formatters";
import { format, formatRate, fromMinor, spreadsheetNumber } from "@magna-carta/money/format";
import { currencyFromCode, rate, USD } from "@magna-carta/money/money";
import { figureCell, type ReportCell } from "./report-presentation.ts";

/** What an empty figure prints as. */
export const NOTHING_FIGURE = "-";

/** An amount the payload carried in minor units, as a cell. */
export function moneyCell(amountMinor: number): ReportCell {
  const value = fromMinor(amountMinor, USD);
  return figureCell(amountMinor === 0 ? NOTHING_FIGURE : format(value), spreadsheetNumber(value));
}

/** An amount as the text a summary tile prints. Zero prints as an amount here: a tile is never blank. */
export function moneyText(amountMinor: number): string {
  return format(fromMinor(amountMinor, USD));
}

/** An hourly rate the payload carried at scale 4 (4500000 is 450.00), as text. */
export function rateText(rateE4: number, currency: string): string {
  return formatRate(rate(rateE4, currencyFromCode(currency)));
}

/** A count, as a cell. */
export function countCell(count: number): ReportCell {
  return figureCell(count === 0 ? NOTHING_FIGURE : formatNumber(count), count);
}

/**
 * Minutes as hours to one decimal place: how a firm reads recorded time. The number beside the text
 * is the minutes as served, so a spreadsheet sums exactly what the report counted.
 */
export function hoursCell(minutes: number): ReportCell {
  return figureCell(minutes === 0 ? NOTHING_FIGURE : hoursText(minutes), minutes);
}

export function hoursText(minutes: number): string {
  return `${formatNumber(Math.round(minutes / 6) / 10)} h`;
}

/** A share given in basis points (10000 is all of it), as a percentage; null prints as a dash. */
export function shareCell(basisPoints: number | null): ReportCell {
  if (basisPoints === null) return NOTHING_FIGURE;
  return figureCell(shareText(basisPoints), basisPoints / 10000);
}

export function shareText(basisPoints: number): string {
  return `${formatNumber(Math.round(basisPoints / 100))}%`;
}

/** A caption the payload may not have: the record's own name, or what stands for its absence. */
export function captionOr(name: string | null, absent: string): string {
  return name ?? absent;
}

/** A plural noun phrase for a count: "1 bill", "11 bills". */
export function counted(count: number, singular: string, plural: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}
