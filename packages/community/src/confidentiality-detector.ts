// The format-only confidentiality detector. It looks at the SHAPE of text — strings shaped like case
// captions, docket or matter numbers, email addresses, phone numbers, and money beside a person's
// name — and never at any firm's data. Checking a post against the author's own directory would
// cross the per-firm boundary this package exists to stay outside of, so the detector accepts more
// false positives instead. That is affordable because a match only HOLDS the post for a human to
// read; it never rejects it, and the composer shows the author exactly which phrases tripped it.

export const FINDING_KINDS = [
  "case-caption",
  "docket-or-matter-number",
  "email-address",
  "phone-number",
  "money-beside-a-name",
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const FINDING_LABELS: Record<FindingKind, string> = {
  "case-caption": "a case name",
  "docket-or-matter-number": "a docket or matter number",
  "email-address": "an email address",
  "phone-number": "a phone number",
  "money-beside-a-name": "an amount next to a name",
};

export interface ConfidentialityFinding {
  readonly kind: FindingKind;
  readonly start: number; // offset into the text, inclusive
  readonly end: number; // offset into the text, exclusive
  readonly text: string;
}

const NAME_WORD = String.raw`[A-Z][A-Za-z'&.-]+`;
const NAME = String.raw`${NAME_WORD}(?:\s+(?:of|the|and|&|${NAME_WORD})){0,4}`;

const PATTERNS: readonly { kind: FindingKind; pattern: RegExp }[] = [
  // "Hendricks v. Lowell", "Smith vs Jones", "In re Estate of Marsh"
  {
    kind: "case-caption",
    pattern: new RegExp(String.raw`\b${NAME}\s+(?:v\.?|vs\.?)\s+${NAME}`, "g"),
  },
  { kind: "case-caption", pattern: new RegExp(String.raw`\bIn re\s+${NAME}`, "g") },
  // "2026-CV-0412", "1:24-cv-01234", "CV-2026-118", "PR-19-0042"
  {
    kind: "docket-or-matter-number",
    pattern: /\b(?:\d{1,2}:)?\d{2,4}-[A-Za-z]{1,5}-\d{2,7}\b|\b[A-Za-z]{1,5}-\d{2,4}-\d{2,7}\b/g,
  },
  // "matter 2291", "case no. 18-445", "docket #7781", "file number A-1003"
  {
    kind: "docket-or-matter-number",
    pattern:
      /\b(?:matter|case|docket|file|cause)\s*(?:no\.?|number|#)?\s*:?\s*(?=[A-Za-z0-9:-]*\d)[A-Za-z0-9][A-Za-z0-9:-]{2,}\b/gi,
  },
  { kind: "email-address", pattern: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  // North American numbers in their usual written shapes.
  {
    kind: "phone-number",
    pattern: /(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g,
  },
];

const MONEY = /\$\s?\d[\d,]*(?:\.\d{2})?/g;
const TWO_WORD_NAME = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/;
const MONEY_NAME_WINDOW = 40;

// The product's own vocabulary is capitalised too, and "Magna Carta" beside "$20" in a pricing
// question is not a client. Names that are the software's own are not counted as a person's name.
const PRODUCT_WORDS = /\b(?:Magna Carta|Trust Account|Client Portal|File Manager|Time Entry)\b/g;

export function detectConfidentialDetail(text: string): ConfidentialityFinding[] {
  const findings: ConfidentialityFinding[] = [];
  for (const { kind, pattern } of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      findings.push({
        kind,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      });
    }
  }
  for (const match of text.matchAll(MONEY)) {
    const windowStart = Math.max(0, match.index - MONEY_NAME_WINDOW);
    const windowEnd = Math.min(text.length, match.index + match[0].length + MONEY_NAME_WINDOW);
    const nearby = text.slice(windowStart, windowEnd).replace(PRODUCT_WORDS, "");
    if (TWO_WORD_NAME.test(nearby)) {
      findings.push({
        kind: "money-beside-a-name",
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      });
    }
  }
  return withoutOverlaps(findings);
}

// Two patterns can claim the same span ("case no. 2026-CV-0412" matches both number shapes). Keep the
// earliest-starting, longest finding and drop anything it covers, so the author sees each phrase once.
function withoutOverlaps(findings: ConfidentialityFinding[]): ConfidentialityFinding[] {
  const sorted = findings.toSorted((left, right) =>
    left.start === right.start ? right.end - left.end : left.start - right.start,
  );
  const kept: ConfidentialityFinding[] = [];
  for (const finding of sorted) {
    const previous = kept.at(-1);
    if (previous !== undefined && finding.start < previous.end) {
      continue;
    }
    kept.push(finding);
  }
  return kept;
}
