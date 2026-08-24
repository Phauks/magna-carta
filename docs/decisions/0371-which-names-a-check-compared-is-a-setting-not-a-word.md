---
number: 371
slug: which-names-a-check-compared-is-a-setting-not-a-word
status: Proposed
date: 2026-08-16
area: Conflicts
summary: "The set of name roles a conflicts check compares against stops being an implicit consequence of the strictness word and becomes an explicit firm setting, resolved with the rest of the scope and recorded verbatim on the check row. `ConflictsPolicy.balancedNameRoles` ships the deepening design's recommended default for owner flag F1 — current, former, maiden and alias — so the married-name change that was invisible at the default band is now found there, and answering F1 the other way is one setting edit rather than a release. over_inclusive always searches every role and is deliberately not configurable, which keeps the superset invariant true by construction whatever a firm configures. `aka` and `dba` stay over-inclusive-only, because the reading the default encodes is 'the same person under a name they previously held' and a trading style is not that. The check row also stops relying on the preset word for the rest of the story: `inputs_json.matching` records the name keys compared, the phonetic schemes that ran, and the resolved roles, so a reader of a years-old row does not need to know what the word meant that day. The flag stays OPEN — the mechanism is the contribution and the default is the design's recommendation, not an answer."
---

**A preset is a word whose meaning moves, and the log was relying on it.**

**Context.** `conflicts_check` records `strictness` — one of two words — and, until now, a reader had
to know what the code did with that word on the day the check ran to know which name rows were
compared. That is fine while the mapping never changes and fatal the first time it does, and the
matching-depth work changes it twice: it adds two match-key channels and a second phonetic encoder,
and it changes which name roles the balanced band reads.

The substantive question underneath is the deepening design's flag F1. A Directory keeps a person's
former, maiden and alias names as rows of their own, all in the conflicts corpus. Only the
over-inclusive band searched them, so at the band nearly every firm runs, **a party who married and
changed surname was invisible** — and the changed surname is the miss the practitioner literature
cites most often.

**Decision.** The resolved name-role set becomes a first-class part of scope:

- `ConflictsPolicy.balancedNameRoles` is a firm setting. Its shipped default is the design's
  recommendation for F1 — `current`, `former`, `maiden`, `alias` — so the married-name case is found
  at the default band, and a firm that wants the narrower reading changes a setting rather than
  waiting for a release.
- `over_inclusive` always searches every role and is **not** configurable. That is what keeps
  `over_inclusive` a strict superset of `balanced` by construction rather than by care: whatever set a
  firm configures for the narrower band, it is a subset of "all of them".
- `resolveScope` resolves the set and `runConflictsCheck` records it verbatim on the row, beside the
  name keys compared and the phonetic schemes that ran. `strictness` stays on the row as the
  human-facing preset name; it simply stops being the only evidence of what ran.
- A stored set that is corrupt, empty, or has had everything deselected falls back to the shipped
  default, and `current` is unioned back in unconditionally. A firm may widen or narrow which
  historical names are compared; a check that did not compare the name the party goes by today is not
  a conflicts check.

`aka` and `dba` are deliberately left out of the default even though they are also non-current name
rows. The reading this default encodes is "the same person under a name they previously held" — which
former, maiden and alias are, and which an organization's trading style is not. Including either is
one edit to a firm's setting, and the load profile and the matching tests both exercise `dba` as the
role the balanced band does not read.

**F1 is not answered by this.** The plan is written to build around the twelve open flags: build the
mechanism, ship the recommended default *as a setting*, record the setting in force on the row, and
hard-code nothing. That is what this is. The owner's answer, whenever it comes, is a configuration
change to a default — and because the resolved set is on every check row, a firm that changes its
answer can see exactly which of its historical checks ran under which reading.

**Consequences.** The shipped default at `balanced` widens, which is a real behaviour change: a former
or maiden name that was balanced-invisible now surfaces, and the load profile shows the balanced
person-subject candidate count rising with it. That is the direction this subsystem is allowed to move
without asking — recall over precision is the design's stated tie-breaker, and every candidate is
still shown to a reviewer rather than acted on. The narrowing direction is the one that needs an
answer, and it is now a settings row.
