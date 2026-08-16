---
category: Added
audience: internal
---

**Natural-language document search, built whole and switched off — every gate closed, no instance in
existence, and the one part that could answer a question deliberately absent.**

A firm can now be given a search that takes an ordinary question against a matter and returns
passages of its own documents. None can yet, and that is the shape of the work rather than a
shortfall: everything the feature needs exists except the adapter that calls the managed index, which
waits on evidence rather than on effort.

**The gate is a gate on a gate.** `search.naturalLanguageEnabled` defaults off, and the write path
refuses to open it unless the firm has accepted the **current version** of a written disclosure —
recorded firm-level, with who accepted it and when. When the feature ever changes what it copies or
what it can do, the version moves, every firm's acceptance stops matching, and they are asked again
without anybody remembering to ask. The setting change, its audit row, and the message that
provisions the instance ride one transaction, so there is no state where a firm's gate is open with
no provisioning in flight.

**The disclosure refuses two things rather than hedging them.** Data residency for the managed store
is not something the platform can specify or verify, so it offers no guarantee and tells a firm with
a residency obligation not to enable the feature. Deletion of the managed index is a request whose
completeness the platform cannot demonstrate, so the statement says exactly that — the platform
deletes the extracted text it wrote, from storage it owns, and can enumerate the catalog to show it,
and stops there. Neither sentence is a caveat on a promise; they are the absence of a promise.

**What can reach the index is an allow-list with one entry.** The instance is pointed at a derived
text feed, never at a firm's bucket — a bucket holds received productions, mid-edit working copies,
conversion artifacts and index splits, and pointing an index at it would put an opposing party's
production into a search of the firm's own working files. The feed writer runs from one place, the
existing search index job, as a **second consumer of the extraction already computed there**: the
bytes are read once and parsed once, and the keyword split and the feed both read that one result.
A test asserts the extraction runs exactly once.

**A matter left out has its copies deleted, not merely stopped.** Once a firm opts in every matter is
fed — a search covering only the matters somebody remembered to tick has invisible gaps, and a lawyer
who finds nothing concludes there is nothing. The escape hatch enqueues deletion of that matter's
feed objects, because an exclusion that only stopped new writes would leave the material that
prompted it sitting in the index.

**Deletion is planned from the catalog and never from a bucket listing**, so an object the catalog
does not know about is a reported inconsistency rather than a silent miss; reconciliation runs as
part of every teardown and its result is recorded.

**The meter keeps measurement and estimate in different objects**, structurally, so a renderer cannot
show them alike: query counts and fed bytes are exact because the platform makes every call and
writes every byte, the ingestion figure is derived from fed bytes at a ratio stored on the row, and
managed storage is a **named gap** rather than a zero, because no per-firm figure is published and a
guess presented as a meter is a future billing dispute.

**Not built: the retrieval adapter and its route.** The design's central claim is that the metadata
filter is a recall optimization and read-time re-authorization is the boundary — but the route still
must not ship until the filter's semantics have been observed against a real instance, because a
filter that fails open, or that is accepted and silently ignored, cannot bear even the optimization's
weight. Both ports resolve, through the production resolvers, to typed unavailable outcomes; an
absent binding reports `instance-not-provisioned` rather than an empty success, which would be
indistinguishable from a corpus in which nothing matched.

Fitness tests assert what a later edit could quietly undo: no generation call anywhere, no
public-endpoint enablement anywhere, the port's input has no slot a caller-supplied filter could
arrive in, the feed writer emits exactly one object class and cannot emit a reserved one, and the
instance configuration constant is the only place the metadata schema is spelled — because changing
that schema re-indexes every document in every firm's instance.
