---
category: Security
---

**Telemetry's redact-by-default posture now holds on the counter path and against non-string values.**
The event allowlist was structural for field NAMES but not for field VALUES: a declared field typed
`FieldValue` could still be handed an object by any call site that reached the builder through `any`,
and `JSON.stringify` then wrote that object into the log line with every nested key intact — past the
allowlist, and past the scrubber, which only ever walked strings. Values are now forced back to a flat
primitive at the same boundary as the keys; anything else is replaced outright rather than serialised,
and the Workers logger raises a `telemetry.unloggable` counter naming the event and field so the call
site is visible instead of silent. As a side effect, a `bigint` or a symbol in a field can no longer
throw inside `JSON.stringify` and take the emit down with it.

`Logger.count()` was the other door, and it was unguarded end to end: free-form metric names and
free-form dimension values reached Analytics Engine with no allowlist, no scrub, and no tripwire — the
cheapest way to get privileged content into the dataset, and the one nothing would have caught. The
queue consumer's `costs.recovery.unhandled_topic` counter was already passing a value straight off a
queue message. Counters now go through a **metric catalog** (`@magna-carta/telemetry/metrics`), the
counter-side twin of the event catalog: each metric declares its ordered dimension keys, blobs are laid
out from that declaration, dimension values are scrubbed, and anything undeclared — a metric or a
dimension key — is dropped rather than guessed at, against a tripwire counter. A fitness scan over
every `apps/*/src` and `packages/*/src` fails a `count()` call site naming a metric the catalog does
not declare, or building a metric name by interpolation.

Declaring the dimension keys fixes a second, quieter problem: the Analytics Engine column contract used
to be whichever order each call site happened to write its object literal in. Reordering two keys in a
literal — an edit no reviewer would question — silently re-labelled every column of that metric in the
dataset. The layout is now one declared fact.

The scrub backstop also stopped missing the shapes people actually write. Its denylist caught an
unbroken run of nine or more digits, so a card number typed the way a payment form asks for it —
`4111 1111 1111 1111` — and any phone number at all passed through verbatim with the tripwire silent,
in `messageHead`, the one free-text field in the catalog and the one carrying a user's own words.
Separated 12-to-19-digit groups and phone numbers (dashes, dots, spaces, parenthesised area codes,
country codes) are now scrubbed and tripped.

Finally, the scrubber's minted-handle exemption no longer restates the token length and alphabet that
`@magna-carta/identifiers` owns; it and the package's own per-entity validators both build their
patterns from one exported fragment, so changing the token shape cannot leave a stale copy behind that
starts mangling Error IDs.
