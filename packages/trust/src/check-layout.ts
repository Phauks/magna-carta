// WHERE THINGS PRINT ON A CHECK. Pure: no database, no clock. The trust package validates a saved
// stock with it, and the web app imports it to draw the layout editor and compose the PDF, so the
// rule that keeps ink out of the MICR band is one rule in one place.
//
// Every distance is an integer in thousandths of an inch ("mils"). Check paper is specified in
// inches, and an integer cannot drift the way a float does after a few hundred nudges.

/** A personal-size business check on letter stock: 8.5 by 3.5 inches. */
export const CHECK_WIDTH_MILS = 8_500;
export const CHECK_HEIGHT_MILS = 3_500;

/**
 * The bottom 0.625 inch of the check, where the bank's routing, account and check numbers are
 * printed in magnetic ink. Any other ink there makes the bank's reader reject the check.
 */
export const MICR_BAND_HEIGHT_MILS = 625;
export const MICR_BAND_TOP_MILS = CHECK_HEIGHT_MILS - MICR_BAND_HEIGHT_MILS;

export const LETTER_WIDTH_MILS = 8_500;
export const LETTER_HEIGHT_MILS = 11_000;

/** One point is 1/72 inch. */
export const MILS_PER_POINT = 1_000 / 72;

/** The largest whole-page shift a stock may carry, either way. Past this the stock is wrong. */
export const MAX_SHIFT_MILS = 500;

export const CHECK_FIELD_KINDS = [
  "date",
  "payee",
  "amount",
  "amount_words",
  "memo",
  "matter",
  "check_number",
] as const;
export type CheckFieldKind = (typeof CHECK_FIELD_KINDS)[number];

export const CHECK_FIELD_LABELS: Readonly<Record<CheckFieldKind, string>> = {
  date: "Date",
  payee: "Payee",
  amount: "Amount",
  amount_words: "Amount in words",
  memo: "Memo",
  matter: "Matter",
  check_number: "Check number",
};

export const CHECK_PAGE_LAYOUTS = [
  "check_top",
  "check_middle",
  "check_bottom",
  "three_per_page",
] as const;
export type CheckPageLayout = (typeof CHECK_PAGE_LAYOUTS)[number];

export const CHECK_PAGE_LAYOUT_LABELS: Readonly<
  Record<CheckPageLayout, { readonly title: string; readonly detail: string }>
> = {
  check_top: { title: "Check on top, two stubs", detail: "Most common for law firm trust stock" },
  check_middle: { title: "Check in the middle", detail: "Stub above and below" },
  check_bottom: { title: "Check on the bottom", detail: "Two stubs above" },
  three_per_page: { title: "Three checks per page", detail: "No stubs" },
};

export const CHECK_FIELD_ALIGNMENTS = ["start", "end"] as const;
export type CheckFieldAlignment = (typeof CHECK_FIELD_ALIGNMENTS)[number];

export interface CheckField {
  readonly kind: CheckFieldKind;
  /** The box's left edge, from the check's left edge. */
  readonly xMils: number;
  /** The box's top edge, from the check's top edge. */
  readonly yMils: number;
  readonly widthMils: number;
  readonly sizePoints: number;
  readonly align: CheckFieldAlignment;
}

/** A box is as tall as one line of its text: the size and a quarter. */
export function fieldHeightMils(sizePoints: number): number {
  return Math.round(sizePoints * 1.25 * MILS_PER_POINT);
}

/** Where the text's baseline sits below the box's top. */
export function fieldBaselineMils(sizePoints: number): number {
  return Math.round(sizePoints * 1.0 * MILS_PER_POINT);
}

export const MIN_FIELD_SIZE_POINTS = 7;
export const MAX_FIELD_SIZE_POINTS = 16;
export const MIN_FIELD_WIDTH_MILS = 300;

/**
 * Why one field cannot be placed where it is, or null when it can. The refusal names the reason in
 * a sentence a person can act on; the editor shows the field in red and the sentence beside the
 * Save button's refusal, never under the field.
 */
export function checkFieldProblem(field: CheckField): string | null {
  const label = CHECK_FIELD_LABELS[field.kind];
  if (
    !Number.isInteger(field.xMils) ||
    !Number.isInteger(field.yMils) ||
    !Number.isInteger(field.widthMils)
  ) {
    return `${label} has a position that is not a whole number of thousandths of an inch.`;
  }
  if (field.sizePoints < MIN_FIELD_SIZE_POINTS || field.sizePoints > MAX_FIELD_SIZE_POINTS) {
    return `${label} text size must be between ${MIN_FIELD_SIZE_POINTS} and ${MAX_FIELD_SIZE_POINTS} points.`;
  }
  if (field.widthMils < MIN_FIELD_WIDTH_MILS) {
    return `${label} is narrower than 0.3 inch.`;
  }
  if (field.xMils < 0 || field.yMils < 0 || field.xMils + field.widthMils > CHECK_WIDTH_MILS) {
    return `${label} runs off the edge of the check.`;
  }
  if (field.yMils + fieldHeightMils(field.sizePoints) > MICR_BAND_TOP_MILS) {
    return `${label} reaches into the MICR band at the bottom of the check, where nothing may print.`;
  }
  return null;
}

/**
 * Where a person with ordinary trust stock would put each field. A new stock starts here, so it
 * prints correctly before anybody moves anything; the positions follow the common layout of a
 * business check (date upper right, payee and amount box on one line, words below, memo lower left).
 */
export const STANDARD_CHECK_FIELDS: readonly CheckField[] = [
  { kind: "date", xMils: 6_250, yMils: 780, widthMils: 1_550, sizePoints: 11, align: "start" },
  { kind: "payee", xMils: 1_150, yMils: 1_330, widthMils: 5_150, sizePoints: 11, align: "start" },
  { kind: "amount", xMils: 7_000, yMils: 1_330, widthMils: 1_250, sizePoints: 11, align: "end" },
  {
    kind: "amount_words",
    xMils: 450,
    yMils: 1_780,
    widthMils: 6_900,
    sizePoints: 10,
    align: "start",
  },
  { kind: "memo", xMils: 700, yMils: 2_560, widthMils: 3_600, sizePoints: 10, align: "start" },
];

/**
 * Read a field list from stored or submitted JSON, or null when it is not one. The shape only:
 * whether the fields may be placed where they are is `checkFieldListProblem`'s question.
 */
export function parseCheckFields(value: unknown): readonly CheckField[] | null {
  if (!Array.isArray(value)) return null;
  const fields: CheckField[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== "object" || entry === null) return null;
    const candidate = entry as Record<string, unknown>;
    const { kind, xMils, yMils, widthMils, sizePoints, align } = candidate;
    if (
      typeof kind !== "string" ||
      !(CHECK_FIELD_KINDS as readonly string[]).includes(kind) ||
      typeof align !== "string" ||
      !(CHECK_FIELD_ALIGNMENTS as readonly string[]).includes(align) ||
      typeof xMils !== "number" ||
      typeof yMils !== "number" ||
      typeof widthMils !== "number" ||
      typeof sizePoints !== "number"
    ) {
      return null;
    }
    fields.push({
      kind: kind as CheckFieldKind,
      xMils,
      yMils,
      widthMils,
      sizePoints,
      align: align as CheckFieldAlignment,
    });
  }
  return fields;
}

/**
 * Why a whole field list cannot be saved, or null. Each kind appears at most once, every field
 * passes `checkFieldProblem`, and the four fields a check is not a check without are present.
 */
export function checkFieldListProblem(fields: readonly CheckField[]): string | null {
  const seen = new Set<CheckFieldKind>();
  for (const field of fields) {
    if (seen.has(field.kind)) return `${CHECK_FIELD_LABELS[field.kind]} is placed twice.`;
    seen.add(field.kind);
    const problem = checkFieldProblem(field);
    if (problem !== null) return problem;
  }
  for (const required of ["date", "payee", "amount", "amount_words"] as const) {
    if (!seen.has(required))
      return `A check needs the ${CHECK_FIELD_LABELS[required].toLowerCase()}.`;
  }
  return null;
}

/** Where each check (and each voucher stub) starts down a letter page, for one page layout. */
export function checkPagePositions(layout: CheckPageLayout): {
  readonly checks: readonly number[];
  readonly stubs: readonly number[];
} {
  switch (layout) {
    case "check_top":
      return { checks: [0], stubs: [3_667, 7_333] };
    case "check_middle":
      return { checks: [3_667], stubs: [0, 7_333] };
    case "check_bottom":
      return { checks: [7_500], stubs: [0, 3_667] };
    case "three_per_page":
      return { checks: [0, 3_667, 7_333], stubs: [] };
  }
}

// ---- amount in words -------------------------------------------------------------------------------

const ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion"];

function underOneThousand(value: number): string {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) {
    if (rest < 20) parts.push(ONES[rest] as string);
    else {
      const tens = TENS[Math.floor(rest / 10)] as string;
      const ones = rest % 10;
      parts.push(ones === 0 ? tens : `${tens}-${ONES[ones]}`);
    }
  }
  return parts.join(" ");
}

/**
 * The amount as a check writes it out: "Three thousand and 00/100". Whole dollars in words, cents as
 * a fraction of a hundred, first letter capital. Refuses an amount below one cent or of a trillion
 * dollars or more, neither of which is a check.
 */
export function amountInWords(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor >= 100_000_000_000_000) {
    throw new RangeError(
      "a check amount is a whole number of cents from 1 to under a trillion dollars",
    );
  }
  const { dollars, cents } = dollarsAndCents(amountMinor);
  // Read the dollars three digits at a time from the right, as they are spoken.
  const groups: string[] = [];
  for (let end = dollars.length, scale = 0; end > 0; end -= 3, scale += 1) {
    const group = Number(dollars.slice(Math.max(0, end - 3), end));
    if (group > 0) {
      const scaleWord = SCALES[scale] as string;
      groups.unshift(
        scaleWord === "" ? underOneThousand(group) : `${underOneThousand(group)} ${scaleWord}`,
      );
    }
  }
  const words = groups.length === 0 ? "zero" : groups.join(" ");
  const sentence = `${words} and ${cents}/100`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * The whole dollars and the cents of an amount, as the digits a check prints. Read off the digits of
 * the minor-unit integer rather than computed, so a check prints exactly what is stored.
 */
function dollarsAndCents(amountMinor: number): { dollars: string; cents: string } {
  const digits = String(amountMinor).padStart(3, "0");
  return { dollars: digits.slice(0, -2).replace(/^0+(?=\d)/, ""), cents: digits.slice(-2) };
}

/** The amount in figures as a check prints it: two asterisks, then "3,000.00". */
export function amountInFigures(amountMinor: number): string {
  const { dollars, cents } = dollarsAndCents(amountMinor);
  return `**${dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}
