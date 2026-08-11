---
slug: discovery-transcript-scope-and-permission-namespace
status: Accepted
area: Discovery
date: 2026-08-06
summary: "THE TRANSCRIPT CONTROL IS A REQUIRED FIELD WITH NO DEFAULT IN EITHER DIRECTION, and that is the whole of the ratified work-product ruling made structural: every discovery load declares `transcriptScope` as `include` or `exclude`, the column is NOT NULL with no default, and a declaration that omits it is refused — because a silent exclusion decides as much for somebody as a silent inclusion would, it just fails in the other direction, and a firm that believed transcripts were in scope would find out after producing. The scope is stored on the LOAD rather than inferred from what arrived, so the manifest can state what the corpus was DRAWN FROM and not only what landed in it, and it is carried on EVERY lane's declaration — not only the two lanes that could reach a transcript — because a record that sometimes carries the scope and sometimes does not is a record whose silence means two different things. `include` is refused BY NAME until the lane that resolves transcripts exists, the same device the unbuilt direct-collection lane uses, because the two honest alternatives are both worse: silently dropping an include produces a corpus that does not match the declaration, and pretending to honour it produces a manifest claiming a sweep that never happened. DISCOVERY IS ITS OWN PERMISSION NAMESPACE, and the namespace IS the access rule the design asked for: a review set is reachable from a `discovery:*` grant and from nothing else — never from matters:*, never from files:*, never from being on the matter team — because material produced by another party may be attorney's-eyes-only under a protective order. Three keys rather than the house read/manage pair, because loading is genuinely a third capability: it brings another party's untrusted material into the firm's own corpus, consumes the review set's ceiling, and is the one discovery operation whose cost is set from outside the firm; a contract reviewer working under a protective order holds discovery:read and neither of the others, and that configuration has to be expressible before anyone needs it. The per-review-set access LIST the design recommended is NOT built here and is named for the review surface: a list nothing renders is a list nothing enforces, and the namespace separation is the part that has to exist before the first review set can be created. The occurrence table's columns are renamed from the design's `duplicate_of_review_document_id` to `primary_review_document_id` + `duplicate_review_document_id`, because 'duplicate_of' on the row that IS the duplicate reads backwards to half of everyone. And the platform-wide widening of the custodian-vocabulary gate that the tool's own comment scheduled for this slice is REFUSED as written: the shipped Custodian register legitimately owns the bare word as its subsystem name in prose, its package specifier (@magna-carta/custodian), and its route (/custodian), so the widening would have required either renaming a shipped subsystem for no defect or a gate riddled with exemptions, which is a gate that stops biting."
---

**The transcript include/exclude control is a required field with no default; discovery is its own
permission namespace, and that namespace is the access rule.**

**Context:** The owner's ratified ruling on assistant transcripts (the F4b answer) reframed them from
correspondence to **work product**: protected, deletable, archivable, discoverable like email, "but
the search/discovery should allow for if it should be included or not". That control requirement
binds the discovery review-set load design, which this slice builds. Separately, the discovery design
asked that review-set access not be implied by matter access, and recommended a per-review-set access
list defaulting to the matter team.

**Decision:**

1. **`transcriptScope` is required on every load declaration, with no default in either direction.**
   The column is `NOT NULL` with no default; the contract type demands the field; a body that omits
   it is refused by name. Neither `exclude` nor `include` is supplied on the declarer's behalf,
   because a silent exclusion is as much a decision made for somebody as a silent inclusion — it
   simply fails in the other direction, and a firm that believed transcripts were in scope would
   discover otherwise after producing.

2. **The scope is stored on the load, and carried on every lane.** Recorded rather than inferred from
   what arrived, so the manifest can state what the corpus was drawn from and not only what landed in
   it. Carried on all four lanes rather than only on the two that could reach a transcript, because a
   load record that sometimes carries the scope and sometimes does not is a record whose silence means
   two different things.

3. **`include` is refused by name until the lane exists.** The same device the unbuilt
   `direct-collection` lane uses. The two alternatives are both worse: silently dropping an include
   produces a corpus that does not match what the loader declared, and pretending to honour it
   produces a manifest claiming a sweep that never happened.

4. **`discovery:read`, `discovery:manageReviewSets`, `discovery:load` — its own namespace, three
   keys.** The namespace separation IS the "matter access does not imply review-set access" rule,
   enforced at the chokepoint rather than by convention. Three keys because loading is a third
   capability: it brings another party's untrusted material into the firm's corpus and consumes the
   review set's ceiling. All three seed to Owner/Admin, Attorney, and Paralegal and to neither Billing
   nor Read-only; a firm removing two of them leaves a contract reviewer with read alone.

5. **The per-review-set access list is named for the review surface, not built here.** A list nothing
   renders is a list nothing enforces, and it needs the surface that shows a firm who can see what.
   The namespace separation is the part that must exist before the first review set is created.

6. **The occurrence columns are renamed** to `primary_review_document_id` and
   `duplicate_review_document_id`.

7. **The custodian-vocabulary gate stays scoped to the discovery trees.** The widening its own comment
   scheduled for this slice is refused as written.

**Considered and rejected:** _defaulting `transcriptScope` to `exclude`_ (the safe-looking default is
still a decision made silently for a person, and the ruling is that a transcript enters by a visible
choice — in either direction); _making the field optional_ (identical to defaulting, with the
decision moved into a reader's head); _accepting `include` and dropping it_ (a corpus that does not
match its own declaration); _accepting `include` and recording it as honoured_ (a manifest claiming a
sweep that did not happen — the one thing the manifest exists to make impossible); _carrying the
control only on the internal lanes_ (silence would then mean "not applicable" on two lanes and "not
stated" on the others); _a single `discovery:manage` key_ (loading and organizing are different
capabilities and a protective order is exactly when a firm needs to separate them); _folding discovery
under `matters:*` or `files:*`_ (the whole point is that matter access must not carry an
attorney's-eyes-only production); _building the per-review-set access list now_ (nothing renders it,
so nothing would exercise it); _widening the vocabulary gate platform-wide_ (the shipped Custodian
register owns the bare word as its subsystem name in prose, its package specifier, and its route, so
the widening meant renaming a shipped subsystem for no defect, or a gate with so many exemptions it
would stop biting).

**Consequences:** every discovery load record states, for all time, whether the firm's own work
product was in scope for it, and the manifest can say so to a court; a firm that wants transcripts in
a corpus will be told by name that the lane is not built rather than being quietly given a corpus
without them; the review surface inherits an unbuilt per-review-set access list as a named obligation
rather than an assumed one; and the custodian-vocabulary gate's stale comment is corrected in the
same commit, so the next reader is not sent to do a widening that was already found to be wrong.
