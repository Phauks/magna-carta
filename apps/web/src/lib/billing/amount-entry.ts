/*
 * Reading an amount somebody typed, and writing one back into a field.
 *
 * WHY THIS IS NOT `parseFloat(text) * 100`. That expression is wrong for amounts a firm types every
 * day: `1.15 * 100` is 114.99999999999999, and rounding it back hides the error only until the
 * amount is large enough that it does not. Every figure on this surface is a whole number of cents,
 * so the digits are read as digits — the part before the point and the part after it, each an
 * integer — and no float is ever involved.
 *
 * A REFUSAL SAYS WHAT IS WRONG. The parse answers either an amount or a sentence, because the
 * control that sends it has to be disabled with a reason rather than letting the server refuse
 * something the client could see was malformed.
 */

/** What a typed amount turned out to be. */
export type AmountReading =
  | { readonly kind: "amount"; readonly minor: number }
  | { readonly kind: "empty" }
  | { readonly kind: "refused"; readonly reason: string };

const AMOUNT_SHAPE = /^(\d{1,15})(?:\.(\d{1,2}))?$/;

/**
 * The whole cents a typed amount means.
 *
 * Currency symbols, thousands separators and surrounding space are stripped, because people paste
 * amounts out of other documents and refusing "$1,250.00" teaches nothing. What is not accepted is
 * a third decimal place: an amount finer than a cent is not an amount this ledger can hold, and
 * silently rounding it would charge a client a figure they did not type.
 */
export function readAmountMinor(text: string): AmountReading {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "") return { kind: "empty" };
  const match = AMOUNT_SHAPE.exec(cleaned);
  if (match === null) {
    return {
      kind: "refused",
      reason: "Enter an amount in dollars and cents, such as 1250.00.",
    };
  }
  const [, whole = "0", fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) {
    return { kind: "refused", reason: "That amount is larger than this ledger can hold." };
  }
  return { kind: "amount", minor: cents };
}

/**
 * An amount in minor units as a field's starting text: plain digits and a point, no symbol and no
 * separators, so what the field holds is exactly what the parse above reads back.
 */
export function amountFieldText(minor: number): string {
  const negative = minor < 0;
  const magnitude = Math.abs(Math.trunc(minor));
  const whole = Math.floor(magnitude / 100);
  const cents = magnitude % 100;
  return `${negative ? "-" : ""}${String(whole)}.${String(cents).padStart(2, "0")}`;
}

/**
 * The amount to send, bounded by a ceiling the surface can see.
 *
 * Applying more than a bill's own unpaid share is refused by the domain, by name; the ceiling is
 * shown and enforced here as well so the reader is never invited to press a control that cannot
 * succeed. Nothing is silently clamped: an amount over the ceiling is a refusal with the ceiling in
 * it, because quietly reducing what somebody typed is how a firm applies a figure it did not mean.
 */
export function readBoundedAmountMinor(
  text: string,
  ceilingMinor: number,
  ceilingText: string,
): AmountReading {
  const reading = readAmountMinor(text);
  if (reading.kind !== "amount") return reading;
  if (reading.minor === 0) {
    return {
      kind: "refused",
      reason: "An amount of nothing applies nothing. Enter what to apply.",
    };
  }
  if (reading.minor > ceilingMinor) {
    return { kind: "refused", reason: `More than the ceiling of ${ceilingText}.` };
  }
  return reading;
}

/**
 * A percentage share as the rate scale holds it: 33.33% is 3333.
 *
 * Same rule as money, for the same reason — the share of a recovery is read from its digits, never
 * multiplied through a float, because a contingency fee computed from a share that is one part in
 * ten thousand off is a fee the firm cannot defend.
 */
const SHARE_SHAPE = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

export function readShareE4(text: string): AmountReading {
  const cleaned = text.replace(/[%\s]/g, "");
  if (cleaned === "") return { kind: "empty" };
  const match = SHARE_SHAPE.exec(cleaned);
  if (match === null) {
    return { kind: "refused", reason: "Enter a share as a percentage, such as 33.33." };
  }
  const [, whole = "0", fraction = ""] = match;
  const scaled = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (scaled <= 0) return { kind: "refused", reason: "A share of nothing is not a contingency." };
  if (scaled > 10_000)
    return { kind: "refused", reason: "A share cannot exceed the whole recovery." };
  return { kind: "amount", minor: scaled };
}

/** A share at the rate scale as a field's text: 3333 reads back as 33.33. */
export function shareFieldText(shareE4: number): string {
  const whole = Math.floor(shareE4 / 100);
  const fraction = shareE4 % 100;
  return fraction === 0
    ? String(whole)
    : `${String(whole)}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}
