---
category: Added
---

**Template conditions, repeats, and calculations.** A Word template can now carry clauses that appear
only sometimes (`{{#if}}` / `{{#unless}}`), sections that repeat once per item (`{{#each}}`), and
worked-out values (`{{= expression}}`) — over a closed, total expression language that is checked at
registration rather than at assembly time. Conditions and repeats operate on whole paragraphs and whole
table rows, so list numbering and table banding survive a removed or repeated unit. Money arithmetic is
integer-exact through `@magna-carta/money`: division is not an operator, and `divideExact`,
`divideRounded`, `applyRate`, `percentOf`, and `allocate` each state their rounding, with banker's
rounding the only mode a template author sees and `allocate`'s parts summing exactly to the input.
Date math is over calendar dates in the matter's office time zone with end-of-month clamping. An
unresolved **condition** fails the assembly naming the field, because a missing clause is invisible; an
unresolved **calculation** renders a visible placeholder, the bias the absence model already takes. An
expression is never executable template-supplied code: there is no production for property traversal,
indexing, assignment, iteration, or a call to anything but a fixed helper allowlist, and the claim is
held honest by a seeded fuzz harness, a committed denied-construct corpus, an independent arithmetic
oracle, and one test per declared resource bound. First list-valued merge source, `matter.parties`,
resolved by one batched read for the whole collection.
