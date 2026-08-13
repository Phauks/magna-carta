// THE FORMAT-ONLY CONFIDENTIALITY DETECTOR.
//
// What it is for: a member can post something with a client in it. The two errors are not
// symmetric — a false positive costs that member a wait until somebody reviews their template
// question, and a false negative is a permanent, indexed-by-nobody-but-still-permanent disclosure
// of a client relationship. So the posture is to hide first and review after, and this detector is
// the third of the four things that raise a hide (the author is the first and by far the most
// frequent, any reader is the second, the operator is the last).
//
// WHAT IT MAY LOOK AT, AND THE HARD LINE.
//
// Shape only. It reads the text of the post it was handed and nothing else. It does not consult the
// author's own Directory, matter list, client list, or any other firm record — and that is not a
// simplification to be improved on later. Checking a post against the poster's own client names
// would be a read of one firm's business data from a cross-firm surface, which is the exact thing
// the board is built to be incapable of; the worker serving this board holds no per-firm binding,
// so the read is unavailable as well as forbidden. The consequence is accepted deliberately: format
// alone catches less and cries wolf more, and remove-first is what makes crying wolf affordable.
//
// It is also pure. No clock, no network, no storage — text in, findings out — so it can run inside
// the write that creates the post rather than behind a queue that might be draining slowly on the
// evening somebody pastes a caption.

import type { Category } from "./categories.ts";

export const CONFIDENTIALITY_SIGNALS = [
  "email_address",
  "phone_number",
  "case_caption",
  "matter_or_docket_number",
  "currency_beside_proper_noun",
] as const;

export type ConfidentialitySignal = (typeof CONFIDENTIALITY_SIGNALS)[number];

export interface ConfidentialityFinding {
  readonly signal: ConfidentialitySignal;
  // Where in the supplied text the match began, so a composer can point at it before the member
  // posts. Deliberately NOT the matched text: a finding travels into a moderation record and into
  // telemetry, and the matched substring is precisely the thing that must not be copied around.
  readonly index: number;
}

export interface ConfidentialityVerdict {
  readonly findings: readonly ConfidentialityFinding[];
  // True when the post must be hidden on arrival. Any single finding is enough — the detector does
  // not score, because a scoring threshold is a way of publishing the posts that scored just under
  // it.
  readonly shouldHide: boolean;
}

// Addresses at the platform's own hosts are how a member asks about email capture, forwarding, and
// the intake address, so they are not evidence of a client. Nothing else is carved out: a bar
// association's address in a signature block is still an address in a public post.
const PLATFORM_EMAIL_HOSTS = ["magnacarta.esq", "magna-carta.com"];

// An address anywhere in the text. Deliberately loose on the local part, because the failure that
// matters is missing one.
const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

// Telephone numbers in the shapes a person types them: grouped North American numbers with or
// without a country code and separators, and international numbers written with a leading plus.
// Requires separators or a leading plus so a bare run of digits — a version number, a row count, a
// statute section — is not a phone number.
const PHONE_NUMBER =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b|\+\d{1,3}[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4}){2,4}\b/g;

// A case caption: a capitalised word or initial on each side of a versus. Both the American and the
// English abbreviations, with or without the stop.
const CASE_CAPTION = /\b[A-Z][A-Za-z'’.-]*\s+(?:v\.?|vs\.?|versus)\s+[A-Z][A-Za-z'’.-]*/g;

// Matter and docket numbers, in the three shapes that dominate: a federal-style docket with a
// division prefix (`1:24-cv-00123`), a hyphenated year-and-type-and-sequence number
// (`2024-CV-01234`, `24-PR-0087`), and an explicitly labelled number (`Case No. 2024-1234`,
// `Matter #10482`). A bare year is not a match, and neither is a bare integer.
const MATTER_OR_DOCKET_NUMBER =
  /\b\d{1,2}:\d{2}-[A-Za-z]{2,4}-\d{3,6}\b|\b(?:19|20)?\d{2}-[A-Za-z]{2,5}-\d{3,7}\b|\b(?:case|matter|docket|file|claim)\s*(?:number|no\.?|#)\s*[A-Za-z0-9][A-Za-z0-9-]{2,}/gi;

// A currency amount. The signal is the amount NEXT TO A NAME, not the amount on its own: "the
// invoice total shows $1,234.00 in the wrong column" is a product report, and "$1,234.00 to
// Henderson" is a payment to somebody.
const CURRENCY_AMOUNT = /[$£€]\s?\d[\d,]*(?:\.\d{2})?/g;

// A capitalised word that is not a sentence opener and is not one of the words a product question
// legitimately capitalises. Used only in the neighbourhood of a currency amount.
const PROPER_NOUN_NEAR_CURRENCY = /(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}\b/;

// How far either side of a currency amount counts as "adjacent". A payee usually sits within a
// short clause of the figure; a whole paragraph away is a different sentence about a different
// thing.
const CURRENCY_ADJACENCY_WINDOW = 40;

// Words that are capitalised in ordinary product prose and must not, on their own, turn a figure
// into a payment. Not an exhaustive list of safe words — a list like that cannot exist, which is
// why the detector still cries wolf and why remove-first is what makes that affordable. It holds
// two things: the words that open an English sentence, and the vocabulary of this product.
const PRODUCT_VOCABULARY = new Set([
  "The",
  "This",
  "That",
  "These",
  "Those",
  "There",
  "Their",
  "They",
  "Our",
  "Your",
  "When",
  "What",
  "Where",
  "Why",
  "How",
  "Which",
  "Who",
  "But",
  "And",
  "For",
  "Can",
  "Could",
  "Should",
  "Would",
  "Does",
  "Did",
  "Has",
  "Have",
  "Was",
  "Were",
  "After",
  "Before",
  "Since",
  "Every",
  "Some",
  "Any",
  "One",
  "Two",
  "Both",
  "Each",
  "Only",
  "Also",
  "Still",
  "Then",
  "Now",
  "Here",
  "Magna",
  "Carta",
  "Trust",
  "Billing",
  "Invoice",
  "Invoices",
  "Matter",
  "Matters",
  "Directory",
  "Discovery",
  "Custodian",
  "Calendar",
  "Portal",
  "Reports",
  "Search",
  "Desktop",
  "Mobile",
  "Windows",
  "Mac",
  "Word",
  "Excel",
  "Outlook",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]);

function findEmailAddresses(text: string): ConfidentialityFinding[] {
  const findings: ConfidentialityFinding[] = [];
  for (const match of text.matchAll(EMAIL_ADDRESS)) {
    const host = (match[1] ?? "").toLowerCase();
    if (PLATFORM_EMAIL_HOSTS.some((platform) => host === platform || host.endsWith(`.${platform}`)))
      continue;
    findings.push({ signal: "email_address", index: match.index });
  }
  return findings;
}

function findSimple(
  text: string,
  pattern: RegExp,
  signal: ConfidentialitySignal,
): ConfidentialityFinding[] {
  const findings: ConfidentialityFinding[] = [];
  for (const match of text.matchAll(pattern)) {
    findings.push({ signal, index: match.index });
  }
  return findings;
}

function findCurrencyBesideProperNoun(text: string): ConfidentialityFinding[] {
  const findings: ConfidentialityFinding[] = [];
  for (const match of text.matchAll(CURRENCY_AMOUNT)) {
    const start = Math.max(0, match.index - CURRENCY_ADJACENCY_WINDOW);
    const end = Math.min(text.length, match.index + match[0].length + CURRENCY_ADJACENCY_WINDOW);
    const before = text.slice(start, match.index);
    const after = text.slice(match.index + match[0].length, end);
    if (hasProperNoun(before) || hasProperNoun(after)) {
      findings.push({ signal: "currency_beside_proper_noun", index: match.index });
    }
  }
  return findings;
}

function hasProperNoun(fragment: string): boolean {
  // Walk every capitalised word in the fragment rather than stopping at the first, so a sentence
  // whose only capital is "Trust" does not mask a payee two words later.
  const candidates = fragment.match(new RegExp(PROPER_NOUN_NEAR_CURRENCY.source, "g")) ?? [];
  return candidates.some((candidate) => !PRODUCT_VOCABULARY.has(candidate));
}

// The whole detector. `title` and `body` are scanned as one text so a caption split across the two
// is still a caption; the returned indexes are into that concatenation, which is what a composer
// highlighting the problem needs anyway.
export function detectConfidentialitySignals(input: {
  readonly title: string;
  readonly body: string;
  // Accepted and deliberately unused: the detector's behaviour must not vary by category. A
  // per-category relaxation would put the loosest rule on the category most likely to attract a
  // ledger balance, and every category here is a product area, so none of them is safer than
  // another. The parameter exists so a caller cannot silently believe it is being honoured.
  readonly category?: Category;
}): ConfidentialityVerdict {
  const text = `${input.title}\n${input.body}`;
  const findings = [
    ...findEmailAddresses(text),
    ...findSimple(text, PHONE_NUMBER, "phone_number"),
    ...findSimple(text, CASE_CAPTION, "case_caption"),
    ...findSimple(text, MATTER_OR_DOCKET_NUMBER, "matter_or_docket_number"),
    ...findCurrencyBesideProperNoun(text),
  ].sort((left, right) => left.index - right.index);
  return { findings, shouldHide: findings.length > 0 };
}
