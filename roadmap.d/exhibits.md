# Exhibits and Exhibit Lists

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Exhibits -->

- id: exhibits
  name: Exhibits and exhibit lists
  scope: Matter-level exhibits, ordered per-document sets, labels computed from position, in-text references that follow a reorder, the freeze at issue, exhibit lists, and compiled exhibit packages.
  status: partial
  slices: 2-7-exhibits
  adrs: ADR-0273, ADR-0274
  spec: docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md
  evidence: The register, sets with computed labels, numbering and the freeze at issue are built in packages/exhibits with their API routes; in-text references, the exhibit list document, packages and every screen are not.
  audience: public
  public-name: Exhibits
  public-summary: Keep a matter's exhibits in order, and let every sentence that cites one renumber itself when the order changes.
  notes: Court e-filing, docket integration and trial-presentation software stay outside this capability, and so does any jurisdiction numbering-rules catalog — two departments of one Nevada courthouse currently direct incompatible schemes, so numbering ships as copyable presets rather than as rules.

- id: exhibits.register
  name: Exhibit register
  scope: A matter-scoped exhibit — a stable reference name, a title that may change daily, and a link to an ordinary matter file rather than bytes of its own.
  status: partial
  surface: awaiting-screen
  slices: 2-7-exhibits
  adrs: ADR-0273
  spec: docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md
  evidence: packages/exhibits (exhibit-service.ts, reference-name.ts) over the matter_exhibit table, served at /api/v1/matters/{matterId}/exhibits (apps/api-worker/src/http/routes/matters/exhibits.ts); no screen yet.
  notes: An exhibit never spans matters — one document used in two matters is two exhibits over one file, because the two matters have different access boundaries and different filings. A production's Bates range rides the exhibit as recorded provenance and is never computed from the label.

- id: exhibits.sets
  name: Exhibit sets and computed labels
  scope: An ordered membership for one document, with the label a pure function of position and the set's scheme while the set is a draft, and a pre-commit report of which citations a reorder is about to move.
  status: partial
  surface: awaiting-screen
  slices: 2-7-exhibits
  adrs: ADR-0273
  spec: docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md
  evidence: packages/exhibits (label.ts, label-moves.ts, member-service.ts, queries.ts) over exhibit_set and exhibit_set_member, served at /api/v1/matters/{matterId}/exhibit-sets (apps/api-worker/src/http/routes/matters/exhibit-sets.ts); draft labels are never stored (packages/exhibits/test/purity.test.ts); no screen yet.
  notes: A draft label is deliberately not a column — a fact that is a function of two other facts must not also be stored, because three renumber-sweep write paths are three chances to disagree with the function.

- id: exhibits.numbering
  name: Numbering schemes
  scope: Per-set noun, prefix, sequence (upper letter, lower letter, arabic, roman), starting ordinal, and the letter-overflow form, with starter schemes offered as copyable presets.
  status: partial
  surface: awaiting-screen
  slices: 2-7-exhibits
  spec: docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md
  evidence: packages/exhibits/src/scheme.ts and presets.ts: five sequences, both overflow forms, prefix and start-at as per-set values, and copyable presets at /api/v1/matters/{matterId}/exhibit-scheme-presets; no screen yet.
  awaiting-owner: Which letter form follows Z — doubled (AA, BB, CC) or bijective (AA, AB, AC). The surveyed trial-practice guidance says double letters and that is the recommendation, but a label goes into filed documents and is frozen onto the member row at issue, so changing the form after the first set has gone out is a migration over records nobody may rewrite. Beside it and unsettled: which starter presets ship, if any — the two candidates read from primary text are numbers-for-plaintiff with letters-for-defendant, and plaintiff-from-1 with defendant-from-500, and both are current practice in the same courthouse, so shipping both means shipping two conflicting readings of one court. Exhibits design flags E1 and E4.

- id: exhibits.references
  name: In-text exhibit references
  scope: A reference in a matter document that cites the exhibit's identity and renders its label, inserted from a picker rather than typed, resolved when the document is produced.
  status: planned
  slices: 2-7-exhibits
  spec: docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md
  evidence: The design settles the reference as a fourth placeholder form outside both the merge dictionary and the expression language, with a closed catalog of rendering forms and a failure policy that fails the assembly rather than rendering a placeholder; the plan puts the token in the assembly engine and the picker on the shipped merge-field picker and chip patterns. No token, no resolver and no index exists.
  awaiting-owner: Whether the platform offers to detect the plain-text "Exhibit C" references already sitting in a firm's existing documents and propose bindings for them. It is genuinely useful on a firm's back catalogue and it is a scan over privileged prose, so the recommendation is yes, proposal-only, never applied without a person accepting it one at a time, and only inside a document a member already has open. A no means the feature works only for references authored through the picker, and a firm's existing prose stays unbound forever. Exhibits design flag E8.

- id: exhibits.issue
  name: Issued-set freeze
  scope: A member records that a set went out — filed, served, exchanged or lodged — and every label, title, version and position on it freezes; withdrawal and supersession are what remain possible afterwards.
  status: partial
  surface: awaiting-screen
  slices: 2-7-exhibits
  adrs: ADR-0274
  spec: docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md
  evidence: packages/exhibits issue, withdrawal, correction and supersession services, with freeze triggers in packages/database/drizzle/per-firm/20261114T002009_exhibits.sql, served by apps/api-worker/src/http/routes/matters/exhibit-set-issue.ts; no screen yet.
  awaiting-owner: Two questions about how strict an issued set is, and both decide a build. Whether issuing is truly irreversible, with a superseding set as the only remedy — the recommendation — or whether an issued-in-error reversal exists, which is a second way for a frozen label to become unfrozen and therefore a second way the whole invariant can fail. And whether a member may correct an issued member's recorded title or underlying file at all: recommended yes, narrowly, audited and never renumbering, because the alternative leaves a firm unable to fix its own record of what it filed. Exhibits design flags E2 and E6.
  notes: The platform has no court e-filing integration and does not pretend to observe a filing, so issuing is a recorded human assertion. A withdrawn exhibit keeps its label forever and no later exhibit reuses it.

- id: exhibits.list
  name: Exhibit list
  scope: The live table of a set on the matter, and the filed exhibit-list document assembled from a starter template over a new exhibits collection in the merge dictionary.
  status: planned
  slices: 2-7-exhibits
  spec: docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md
  evidence: The design specifies both renderings and the collection-only dictionary source that closes the expression language's first open question; the plan builds the source and the assembled list. Neither the table nor the source exists, and packages/document-assembly carries no exhibits collection.
  notes: The starter template prints the Offered, Objection and Admitted columns blank, because that is what a court hands the clerk; recording what happened in them is a separate capability.

- id: exhibits.package
  name: Compiled exhibit package
  scope: One PDF per set — the list, then a regenerated separator page and the exhibit itself for each member, bookmarked — built as an asynchronous job and landing as an ordinary matter file.
  status: planned
  slices: 2-7-exhibits
  adrs: ADR-0142
  spec: docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md
  evidence: Specified on the shipped asynchronous job shape and paginating through the shipped Bates engine in crates/pdf-core; no coordinator, no queue consumer and no separator template exists.
  awaiting-owner: Whether a compiled package paginates itself by default, and in which corner. The Nevada rule read for this design requires exhibits over ten pages to be numbered in the lower right — which is exactly where a page produced in discovery already carries its Bates stamp — and no reliable detector for an existing stamp exists, so a false negative overprints a number that was already served and a false positive drops pagination a rule requires. Defaulting on makes the common filing correct and risks overprinting; defaulting off makes every package a member has to remember to configure. Exhibits design flag E5.
  notes: A separator page is never stored as a matter document — it exists only inside a package and is regenerated from the label every build, because a stored separator page is a stale label waiting to be filed.

- id: exhibits.admission-tracking
  name: Trial admission tracking
  scope: Recording what happened to an exhibit in the courtroom — offered, objected to, admitted — against the exhibit set.
  status: deferred
  spec: docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md
  evidence: Parked by the exhibits design, which prints the three columns blank on the starter list template and declines to smuggle courtroom outcomes in as three more columns on a set; no model and no surface exists.
  awaiting-owner: Whether recording admission at trial is in scope as a later capability at all. The design assumes it stays out: it has a different audience and its own evidentiary weight, and a half-kept record of what a court admitted is worse than none. A yes makes it a capability with its own model rather than three columns bolted to an exhibit set. Exhibits design flag E7.
