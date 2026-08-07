---
slug: r2-object-matter-dimension
status: Accepted
area: Storage / tenancy
date: 2026-08-06
summary: "Every object a firm's bucket holds carries two dimensions in its R2 custom metadata: `matter` (the matter it belongs to, on matter-scoped objects only) and `object_class` (a closed vocabulary saying what the object is). The object KEY stays scope-free — `files/{fileId}/{versionId}` is opaque precisely so a rename or a matter reassignment moves no bytes — so the scope travels in the metadata instead, written at put time by the path that mints the object. On the one write path whose bytes never touch the Worker, the browser's presigned PUT, the metadata headers are covered by the signature, so an upload that omits the stamp is refused rather than landing an unscopeable object. Firm-level objects (download bundles, templates, letterheads, conversion artifacts, staged mail, and the content-addressed email original that one message filed onto three matters shares) carry the class and deliberately no matter, so `no matter` is a recorded answer rather than an omission. The `client` dimension named by the natural-language-search design is RESERVED and not written: the matter-to-client link has no reader and no populated data yet, and a dimension absent on every object is worse than no dimension because a filter on it matches nothing while appearing to work. Objects written before any of this are repaired by a nightly convergent sweep whose candidate query is an R2 listing rather than any new database state, and future write paths are held to the rule by a source-scan fitness function."
---

**The matter an object belongs to travels with the object, in R2 custom metadata, written at put time —
never derived from the key, and never left to be worked out later.**

**Context.** The R2 key is opaque and scope-free on purpose: `files/{fileId}/{versionId}` carries no
matter, no folder, and no name, which is what lets a rename, a move, or a matter reassignment cost
nothing but a row update. The matter is a column in the firm's own database, reachable only through the
firm-scoped data-access layer. That is right for everything inside the platform and wrong for everything
that meets the object without the database: a retrieval index reading the bucket, a storage report, an
operator answering a deletion request. The asymmetry that forces a decision now rather than later is the
cost curve — stamping at put time is free, and stamping after the fact means rewriting the metadata of
every object every firm has ever written. It is the same shape of argument that widened the search
corpus scope key before a second corpus kind existed.

**Decision.**

1. **Two dimensions, one home.** `@magna-carta/object-dimensions` owns the names, the closed object-class
   vocabulary, the two builders, and the readers. `matter` is stamped on objects that belong to exactly
   one matter; `object_class` is stamped on every object the platform writes. Values are identifier
   handles and vocabulary tokens, never content, and every value is server-derived — nothing from a
   request body reaches a dimension.

2. **A matter-scoped class is not expressible without a matter.** The builders are two functions over two
   class unions rather than one function with an optional matter, so "a working document with no matter"
   cannot be written by accident. Where a class can legitimately be either — a shipping label for a
   shipment that may or may not name a matter — it appears in both unions and the write path chooses.

3. **The stamp is non-optional on the presigned upload path.** A browser uploads straight to R2; the
   Worker only mints the credential. The dimension headers are therefore signed alongside the content
   type, so an upload that drops one fails the signature check at R2. The failure mode is a refused
   upload, which is strictly better than a stored object nothing can scope. The consequence is
   operational and is recorded in the runbook: the bucket's CORS `AllowedHeaders` must list them, or
   every browser upload fails at the preflight.

4. **Firm-level objects are stamped as firm-level, not left blank.** Download bundles (a selection may
   span matters), templates and letterheads (the firm's, drawn on by every matter), conversion artifacts
   (a firm-level tool, filed nowhere), staged inbound mail (not yet routed, and possibly never), and the
   content-addressed email original (one object behind filings on several matters — there is no single
   true answer, and the several answers live as links in the database where several fit). Each carries
   its class and no matter, so a reader can tell "this belongs to no matter" from "nobody stamped this".

5. **A copy inherits its source's scope; only its class changes.** Cutting a version out of a live
   working copy re-reads nothing from the database: the two are the same document, so the copy takes the
   source's matter and swaps `working-copy` for `working-document`. A second read could disagree with the
   object it is stamping, and a disagreement between an object and its own copy is exactly what this
   dimension exists to make impossible.

6. **`client` is reserved and not written.** The natural-language-search design names it as one of four
   index fields. The matter-to-client link (`matter_party` at role `client`) has no data-access reader
   and no populated data today, so stamping it would put an absent value on every object and add a query
   to every upload to do it. A filter on an always-absent dimension matches nothing while looking like it
   works, which is worse than the dimension not existing. It is reserved by name, a test proves nothing
   writes it, and when the link is wired it joins the stamp and the existing sweep fills it in for the
   corpus already stored — at no additional cost, because the sweep is already there. `confidentiality_scope`
   is reserved on the same terms, as are the `work-product`, `transcript`, and `received-material` classes.

7. **The backfill is a nightly sweep whose candidate query is the bucket, and it needs no schema change.**
   Asking the database which objects are unstamped is a question it cannot answer — it never knew. The R2
   listing carries each object's metadata, so the candidate test costs no extra request and no new column,
   no new table, and no cursor state. Convergence is structural rather than bookkept: each pass repairs up
   to a fixed per-firm budget and stops walking once it is spent, a repaired object is never a candidate
   again, and a failed rewrite leaves the object exactly as it was for tomorrow's pass — so the unstamped
   set falls by the smaller of the budget and what remains, every pass, until it is empty. An object whose
   file no longer exists is counted and left alone, and deliberately does not spend the budget, so an
   unresolvable orphan cannot starve the objects that can be repaired. The rewrite carries bytes, content
   type, and storage class across untouched.

8. **Future write paths are held to the rule mechanically.** A source-scan fitness function over the
   worker's sources fails any `put`, `createMultipartUpload`, or `presignPut` that carries no dimensions,
   with an inline `fitness:allow-no-dimensions` marker plus a reason as the only escape — the same
   discipline as the scan that rejects a `file_version` read with no status predicate. The scan proves
   itself against sources written to trip it, so an exclusion rule that grows until it swallows real
   writes fails rather than passing quietly.

**Consequences.** Adding a dimension later is a metadata rewrite of every object plus, for anything
indexing them, a full re-index; adding one now is a line in one module. The nightly sweep costs a listing
walk per firm per day once there is nothing to repair, which buys the second thing it is for: a firm whose
unstamped count stops being zero is a write path that forgot, surfaced the day it ships. The two response
bodies that hand a client a presigned upload URL gained the headers the client must send, which is a
contract change and is reflected in the emitted snapshot and the generated client. What is deliberately
NOT solved here is the object written by a service outside this repository — a search split is written by
the index engine, which this change cannot reach; when that engine is deployed, its write joins the same
rule.
