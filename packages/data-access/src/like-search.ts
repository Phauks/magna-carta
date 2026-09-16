/*
 * Matching text a reader typed, as a SQL `LIKE` pattern.
 *
 * ONE HOME, because this is a correctness rule and not a formatting preference. `%` and `_` are
 * wildcards to SQLite and ordinary characters to a person: a production named `100%_final`, a
 * message about a 50% split, a matter titled `Estate_of_Vance` — each of those, pasted into a
 * search box unescaped, turns every following character into a match-anything and quietly returns
 * rows nobody asked for. A backslash typed by a reader does the same to the escape itself.
 *
 * There were two copies of this rule before this module existed (the discovery review reads and the
 * communications log), written months apart and agreeing by luck rather than by construction. A
 * third would have been written the next time a screen grew a search, and the first of the three to
 * get the next correction would have been the only one to carry it.
 *
 * NOTHING ELSE IS NORMALIZED. No case folding, no accent stripping, no stemming: the match rule
 * stays something a reader can guess rather than something they have to learn, which is the rule
 * every search in this product already matches by. (SQLite's `LIKE` is case-insensitive for ASCII
 * of its own accord, and that is the whole of the case handling anywhere here.)
 *
 * EVERY PATTERN THIS BUILDS MUST BE USED WITH `ESCAPE '\'` BESIDE IT. The escape character is not a
 * default — a `LIKE ?` with no `ESCAPE` clause treats the backslashes this adds as literal text to
 * match, so the pattern would be strictly worse than not escaping at all. `LIKE_ESCAPE_CLAUSE`
 * below is the clause itself, so a caller can interpolate it rather than retype it.
 */

/**
 * The `ESCAPE` clause that every pattern from `likePattern` requires. Interpolate it directly after
 * the `LIKE ?` it belongs to:
 *
 * ```ts
 * `title LIKE ? ${LIKE_ESCAPE_CLAUSE}`
 * ```
 */
export const LIKE_ESCAPE_CLAUSE = "ESCAPE '\\'";

/**
 * A reader's term as a contains-pattern, with their own text escaped.
 *
 * The term is the reader's TEXT, never their instruction: they get no way to write a wildcard, by
 * design, because a search box that silently accepts pattern syntax is one where a stray character
 * changes the answer and nothing says so.
 */
export function likePattern(term: string): string {
  return `%${escapeLikeTerm(term)}%`;
}

/**
 * A reader's term with the three characters `LIKE` reads as syntax neutralized, and no wildcards
 * added. For a caller building its own shape (a prefix match, say) rather than a contains-match.
 */
export function escapeLikeTerm(term: string): string {
  return term.replaceAll(/[\\%_]/gu, (character) => `\\${character}`);
}

/**
 * A search term trimmed to what is worth asking, or undefined when there is nothing to ask.
 *
 * Every search-bearing read faces the same two non-questions — the parameter absent, and the
 * parameter present but blank — and a read that treats a blank term as a real one returns nothing
 * at all, which reads to a member as "your record is empty" rather than "you searched for nothing".
 * Answering it once here is what keeps the two indistinguishable at every call site.
 */
export function askableTerm(search: string | undefined): string | undefined {
  const trimmed = search?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
