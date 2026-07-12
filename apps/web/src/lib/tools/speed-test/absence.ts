/*
 * How this tool says a measurement was not taken.
 *
 * ONE marker, in ONE place. It has been an em dash (which said nothing twice, once the page also had
 * a sentence for absence), then nothing (which read as broken), then "N/A", and now a plain hyphen.
 * Every one of those changes should have been a single edit. Now it is.
 *
 * The spoken form is separate on purpose. A screen reader announcing "Download: hyphen" tells a
 * person nothing; it must hear a word. That is the same fact in a different medium, not a second
 * vocabulary, and it belongs only in `aria-*` attributes, never on screen.
 *
 * Nothing here may ever become "0". A measured zero is a result: packet loss of exactly 0% is the
 * best possible reading, and must never be confused with a measurement that did not happen.
 */

/** Shown wherever a measurement is missing. Change this line, change the page. */
export const ABSENT_MARKER = "-";

/** Announced wherever a measurement is missing. Only ever used inside `aria-*`. */
export const ABSENT_DESCRIPTION = "not measured";
