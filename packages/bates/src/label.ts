// One stamped Bates number: the prefix, then the number padded with zeros to `digits`. Padding is a
// floor and never a ceiling, so a number past its width grows a digit rather than wrapping.
export function batesLabel(prefix: string, number: number, digits: number): string {
  return `${prefix}${String(number).padStart(digits, "0")}`;
}

/** "SMITH000001 to SMITH000012", or the one label for a one-page range. */
export function batesRangeLabel(
  prefix: string,
  firstNumber: number,
  lastNumber: number,
  digits: number,
): string {
  const first = batesLabel(prefix, firstNumber, digits);
  return firstNumber === lastNumber
    ? first
    : `${first} to ${batesLabel(prefix, lastNumber, digits)}`;
}
