---
category: Added
audience: internal
---

**`Smith & Jones LLP` and `Smith and Jones, L.L.P.` are now one name to a conflicts check. The name
half of conflicts search depth ships two derived match keys, the nickname catalogue registered and
empty, and the name roles a check compares against turned into a firm setting recorded on the row.
Beider-Morse does not ship, and the reason is a measurement rather than an opinion.**

The shipped matcher compared names four ways — blind-index identifier equality, an exact
`normalized_display` probe, Double Metaphone, and trigram overlap — and `normalizeName` is a frozen
contract stored across every firm, so what it misses has to close beside it rather than in it.

**Spelling.** `normalized_match_key` and `normalized_match_key_bare` are nullable columns on
`directory_name`, derived inside `insertNameStatement` from the row's own normalized display so none
of the eight name-writing paths can omit one. The first canonicalizes connector words and
legal-entity spellings and **keeps** the legal form, so an equality means one name written two ways —
**tier 2**, the same rung as an exact name. The second removes the legal form, so `Smith & Jones LLP`
and `Smith & Jones LLC` meet — **tier 3**, because one firm re-formed and two unrelated legal persons
look identical from there. No tier is widened and no CHECK is rebuilt; the signals name themselves in
`matched_fields_json`. Existing corpora are filled by a resumable, budgeted sweep on the daily cron —
no stored cursor, because the selection predicate is the outstanding work — with a fitness probe
reporting what is left.

**Which names a check compared is now a setting, not a word.** The resolved name-role set is
firm-configurable, recorded verbatim on the check row beside the name keys compared and the phonetic
schemes that ran, and its shipped default searches former, maiden and alias names at the balanced
band — so the party who married and changed surname is no longer invisible at the setting nearly every
firm runs. Over-inclusive still searches every role and is deliberately not configurable, which is
what keeps the superset invariant structural. The owner flag behind the default stays open; answering
it is now a settings edit rather than a release.

**Nicknames are registered and empty.** `Bob`/`Robert` is not a phonetic relationship and no algorithm
derives it. The table ships with no rows, and every check records `nickname_equivalence` as a source
it could not search — read from the catalogue rather than asserted, so the day a firm curates one the
log stops saying otherwise without anybody editing code.

**Beider-Morse was built, measured, and taken back out.** The recall is real: over a thirty-pair
cross-origin surname corpus it reaches seven pairs Double Metaphone structurally cannot
(`Nowak`/`Novak`, `Kowalczyk`/`Kovalchik`, `Wojcik`/`Voychik` among them). The only maintained
pure-TypeScript implementation is MIT with zero runtime dependencies, so golden rule 14 never came
into it. What stopped it is workerd: the library compiles its rule tables into regular expressions at
module load, which Node does in 16 ms and **workerd does in 20,377 ms** — measured on the first person
create with the channel wired up. That is past the CPU limit, the request never completes, and a lazy
dynamic import is worse (Workers forbid runtime module loading, and it hangs). So the channel is not
shipped, the table is not created, the dependency is not taken, and the follow-on now carries a
numeric flip condition instead of a hopeful one: an encoder whose tables cost workerd single-digit
milliseconds, which is the Rust/WASM port the design already nominated.

**A schema claim in the design is corrected on the way past.** `directory_name_phonetic_code`'s open
`scheme` CHECK is real, but its PRIMARY KEY is `(name_id, scheme)` — one code per name per scheme,
which fits Double Metaphone's two and not an encoder returning tens. Whenever a variable-output
encoder lands it needs a table keyed by the code; the rule is now written beside the table so the next
reader does not rediscover it.
