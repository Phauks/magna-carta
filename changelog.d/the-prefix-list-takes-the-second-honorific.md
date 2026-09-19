---
category: Fixed
audience: public
---

**The honorific field takes a second pick.** It holds several on one comma-separated line and the
list narrows against the part after the last comma — which while somebody types is the word they are
typing and at rest was the honorific they had just chosen, so the list offered exactly the one entry
already held. The reading moved out of `honorific-field.svelte` into `$lib/names/honorific-line.ts`,
where `typedPart(query, typing)` makes a settled line narrow nothing and the pick sequence is pinned
step by step. Two smaller faults went with it: the rows now carry a per-pick sequence number in their
value, so the primitive's "clicking the row it already holds is a deselect" can never leave an act
unreported, and the empty string that deselect reports is no longer appended as a token — which used
to leave a dangling comma in somebody's stored name.

## Public

**The prefix and suffix lists take a second choice.** They hold several on purpose — "III, Esq.",
"M.D., Ph.D." — and once you had chosen one, no other could be picked: the list showed only the
entry you already had, and the only way to reach another was to take the first back off. Both lists
offer everything again after each choice.
