---
category: Added
audience: internal
---

**Reversibility becomes route metadata, and the first census it produced answers a question the
platform could not answer before: of the thirty-three things it deletes, what puts each one back?**
`RouteMeta` carries `reversal` — one of `restoration`, `inverse`, `restatement`, `compensating` or
`none`, the first three naming the operation that does it and `none` obliged to carry the reason
nothing does. `defineOpenAPIRoute` refuses a DELETE that declares nothing, and a conformance fitness
function checks the cross-references over the emitted document: a declaration reading "files.restore
puts it back" is worth exactly as much as `files.restore` existing, and a surface rendering that
sentence has no way to find out that it does not.

**Twenty of the thirty-three are `inverse`, which nobody expected.** More than half of what the
platform calls deletion is not deletion — it is detaching, unlinking, revoking, clearing: a statement
about a relationship, fully reversible by the route that made it, and in several cases already worded
that way in the route's own description. None of those needs a confirmation dialog, and several have
one.

**Twelve are `none`, and reading their reasons sorts them into three groups.** Irreversible by design
and correctly so (the assistant's erasure instrument, a revoked auto-file rule kept so every message
it placed can still name it, a terminal recovery job). Irreversible because there is nothing to
restore (the two custom-field hard deletes, which refuse to run unless the field holds no values).
And **irreversible by omission** — `notes.deleteNote`, whose own design rules that no hard delete
should exist; `tasks.deleteTask`; `custody.deactivateItemType`; `emails.unlink`;
`templates.deleteFieldMapping`; `downloads.remove`; and the sharpest of them,
`matterAssets.deleteAsset`, whose route description says "a firm that removed a house by mistake this
morning wants it back this afternoon" and whose schema keeps the row — with no route that clears the
flag, so the sentence is aspirational.

That third group was a suspicion and is now a list.

**The gate starts at DELETE rather than at every mutating method**, deliberately: 349 mutating
operations declared in one pass would be 349 guesses, and deletion is where the question is asked
most and was answered least — thirty-three deletions against five reversals of any kind. Widening it
is its own slice, and the two that most want declaring next are the void family
(`timeEntries.void` → `timeEntries.unvoid` is a restoration the platform already has) and the
ledger's compensating pairs, which is where that arm earns its place.

The declaration is emitted as `x-mc-reversal` and carried into the generated client, because the
point is that a dialog's recoverability line stops being a string in a Svelte file and becomes the
rendering of the route's own declaration — so "It moves out of the list and stays recoverable" cannot
drift from what delete actually does.
