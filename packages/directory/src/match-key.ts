import { normalizeName } from "./normalize-name.ts";

/**
 * A SECOND key beside `normalized_display`, never a change to it.
 *
 * `normalizeName` is a frozen contract: its output is stored on every `directory_name` row across
 * every firm and is load-bearing for merge, entry-time duplicate detection, and the exact-name
 * comparison the conflicts matcher scores at tier 2. Changing it would mean re-indexing the whole
 * fleet. So the spelling problem it cannot solve is solved beside it instead.
 *
 * The problem is concrete. `Smith & Jones LLP` normalizes to `smith jones llp` — the ampersand is
 * punctuation and is stripped. `Smith and Jones, L.L.P.` normalizes to `smith and jones l l p`.
 * Those are the same firm written two ways and the two strings are not equal, so a conflicts check
 * that holds one and searches for the other finds it only through trigram overlap, buried under
 * every other name in the corpus sharing a three-character window. Two derived keys close it:
 *
 *   normalizedMatchKey      — connector words and legal-entity spellings canonicalized, the legal
 *                             form PRESERVED. An equality here means the same name written two
 *                             ways, which the conflicts matcher scores at tier 2.
 *   normalizedMatchKeyBare  — the same, with the legal form REMOVED. `Smith & Jones LLP` and
 *                             `Smith & Jones LLC` meet here and nowhere else: one firm re-formed,
 *                             or two unrelated legal persons, and the engine's job is to raise the
 *                             question rather than answer it. Scored a tier lower.
 *
 * Both are layered on `normalizeName`'s output rather than on the raw string, so everything the
 * frozen transform guarantees — NFC, case-fold, diacritic strip, punctuation to space — still holds
 * and neither key can drift away from the corpus it is stored beside.
 */

// The canonical spelling of each legal-entity form, keyed by the token sequence that arrives after
// `normalizeName` has run. Punctuation is already gone by then, which is why `L.L.P.` shows up here
// as the three tokens `l l p` rather than as a string with dots in it.
//
// Longest sequence wins, so `limited liability company` canonicalizes to `llc` rather than matching
// `limited` and leaving `liability company` behind. Adding a form is one entry.
//
// The value is deliberately the abbreviation rather than the long form: it is the shortest spelling
// that is still unambiguous, and it is what a firm's own letterhead almost always uses.
export const LEGAL_ENTITY_FORMS: ReadonlyArray<{
  readonly tokens: readonly string[];
  readonly canonical: string;
}> = Object.freeze([
  { tokens: ["limited", "liability", "partnership"], canonical: "llp" },
  { tokens: ["limited", "liability", "company"], canonical: "llc" },
  { tokens: ["professional", "limited", "liability", "company"], canonical: "pllc" },
  { tokens: ["professional", "corporation"], canonical: "pc" },
  { tokens: ["limited", "partnership"], canonical: "lp" },
  { tokens: ["public", "limited", "company"], canonical: "plc" },
  { tokens: ["l", "l", "p"], canonical: "llp" },
  { tokens: ["l", "l", "c"], canonical: "llc" },
  { tokens: ["p", "l", "l", "c"], canonical: "pllc" },
  { tokens: ["p", "c"], canonical: "pc" },
  { tokens: ["l", "p"], canonical: "lp" },
  { tokens: ["p", "l", "c"], canonical: "plc" },
  { tokens: ["incorporated"], canonical: "inc" },
  { tokens: ["corporation"], canonical: "corp" },
  { tokens: ["company"], canonical: "co" },
  { tokens: ["limited"], canonical: "ltd" },
  { tokens: ["llp"], canonical: "llp" },
  { tokens: ["llc"], canonical: "llc" },
  { tokens: ["pllc"], canonical: "pllc" },
  { tokens: ["plc"], canonical: "plc" },
  { tokens: ["inc"], canonical: "inc" },
  { tokens: ["corp"], canonical: "corp" },
  { tokens: ["ltd"], canonical: "ltd" },
  { tokens: ["co"], canonical: "co" },
  { tokens: ["pc"], canonical: "pc" },
  { tokens: ["lp"], canonical: "lp" },
]);

// Every canonical spelling, for the bare key's removal pass.
const CANONICAL_FORMS: ReadonlySet<string> = new Set(
  LEGAL_ENTITY_FORMS.map((form) => form.canonical),
);

// Sequences are tried longest-first so a prefix never wins over the phrase that contains it.
const FORMS_BY_LENGTH = [...LEGAL_ENTITY_FORMS].sort((a, b) => b.tokens.length - a.tokens.length);

// The connector `and`. `normalizeName` turns `&` into a space and drops it entirely, so an ampersand
// and the word it stands for cannot be unified by mapping one onto the other — the ampersand is
// already gone by the time either key is computed. Dropping the word instead is what makes
// `smith jones llp` and `smith and jones llp` the same key.
//
// Only an INTERIOR occurrence is dropped, because that is the position a connector occupies. A name
// that begins or ends with the word is using it as a name part, and removing it there would be
// rewriting somebody's name rather than normalizing a spelling.
const CONNECTOR = "and";

// A leading definite article carries no distinguishing information — `The Acme Corporation` and
// `Acme Corporation` are one organization — and firms record it inconsistently.
const LEADING_ARTICLE = "the";

function canonicalizeTokens(tokens: readonly string[]): string[] {
  const out: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const matched = FORMS_BY_LENGTH.find(
      (form) =>
        index + form.tokens.length <= tokens.length &&
        form.tokens.every((token, offset) => tokens[index + offset] === token),
    );
    if (matched !== undefined) {
      out.push(matched.canonical);
      index += matched.tokens.length;
      continue;
    }
    out.push(tokens[index] as string);
    index += 1;
  }
  return out;
}

function keyTokens(raw: string): string[] {
  const normalized = normalizeName(raw);
  if (normalized.length === 0) return [];
  const canonical = canonicalizeTokens(normalized.split(" "));
  const withoutArticle =
    canonical.length > 1 && canonical[0] === LEADING_ARTICLE ? canonical.slice(1) : canonical;
  return withoutArticle.filter(
    (token, index) => !(token === CONNECTOR && index > 0 && index < withoutArticle.length - 1),
  );
}

// The match key: the frozen normalization with connector words and legal-entity spellings
// canonicalized, and the legal form kept. An equality here says two records spell one name two ways.
export function normalizedMatchKey(raw: string): string {
  return keyTokens(raw).join(" ");
}

// The bare key: the match key with every legal-entity form removed, so a partnership and a limited
// company carrying the same name meet.
//
// Removing the form can empty the key — an organization recorded as `The Company` is nothing but an
// article and a form — and an empty key would silently match every other emptied key in the corpus,
// which is a channel producing hits that mean nothing. So an emptied bare key falls back to the
// match key, where the two names have to agree on something before they meet.
export function normalizedMatchKeyBare(raw: string): string {
  const tokens = keyTokens(raw);
  const bare = tokens.filter((token) => !CANONICAL_FORMS.has(token));
  return (bare.length > 0 ? bare : tokens).join(" ");
}
