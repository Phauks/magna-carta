---
number: 292
slug: the-projection-layer-writes-nothing
status: Proposed
date: 2026-08-13
area: Reports
summary: "Read-only is made a checkable property rather than an intention, through four independent mechanisms. (1) `@magna-carta/reporting` is a pure package that composes nothing: a purity fitness function modelled on packages/custodian/test/purity.test.ts scans its own sources and rejects any INSERT/UPDATE/DELETE/REPLACE literal, any import of EffectWrite, composeEffectBatch, run-domain-effect or commitEffectBatch, and any import from a domain package whose name begins compose/issue/post/place/apply/open/close/finalize — with a non-vacuity assertion so it cannot pass by scanning nothing. (2) Every read route under /api/v1/reports/* is a GET through the existing chokepoint, and the conformance test asserts the namespace declares exactly one non-GET route. (3) A new reports:* permission namespace grants reads only, with a registry assertion that no reports: key appears in any write path's guard, so a future route cannot borrow one; the keys are seeded to Owner and Admin alone, on the reasoning that split trust:firmFunds off trust:manage — an aggregate across every matter and client is a different exposure from a per-matter read. (4) The one write is named and outside the package: producing an audit pack writes an append-only report_production row, an outbox message, and a File Manager version holding the artifact, all composed by the route and the queue consumer through the ordinary chokepoint with the ordinary audit trail. Stating mechanism 4 is the point — a reporting surface that could not file its own output could not produce evidence, and 'read-only' without that sentence would be a slogan."
---

**Nothing in the reporting package can write, and the one write the surface performs is named,
small, and somebody else's.**

**Context:** "A reporting surface should not be able to write" is the kind of claim that is true on
the day it is written and quietly false two slices later, when a report grows a cache, a
last-generated stamp, or a convenience that marks an invoice as reviewed. The rule has to be
enforced by something that fails a build, not by a heading in a design document. This repository
already has the shape for it: the custodian stocktake's purity scan, and billing's source scan
asserting that no billing file composes a `trust_*` statement.

**Decision:** Four independent mechanisms.

**One — the package composes nothing.** `@magna-carta/reporting` exports assembly functions and
`select…Statement` builders and imports no composer. `test/purity.test.ts` scans the package's own
sources for an `INSERT`, `UPDATE`, `DELETE FROM` or `REPLACE` literal; for an import of `EffectWrite`,
`composeEffectBatch`, `run-domain-effect`, or `commitEffectBatch`; and for any import from a domain
package whose name begins `compose`, `issue`, `post`, `place`, `apply`, `open`, `close`, or
`finalize`. It asserts it has sources to check, so it cannot pass vacuously — the failure mode the
custodian scan's own non-vacuity assertion exists to prevent.

**Two — the routes are GETs.** Every read route in the reports namespace is a GET through the slice
0·5 chokepoint. The conformance test asserts the namespace declares exactly one non-GET route (the
production enqueue) and that every other route carries only a `reports:` read key.

**Three — the keys grant nothing else.** A new `reports:` namespace — `trustCompliance`, `financial`,
`productivity`, `operational`, `produce` — with a registry assertion that no `reports:` key appears
in any write path's guard. Seeded to Owner and Admin alone. A separate namespace rather than reuse of
`trust:read` or `billing:read`, on the reasoning that split `trust:firmFunds` off `trust:manage`: a
member who may read one client's trust balance is not thereby a member who may read the firm's whole
receivable position, and a report about people (`reports:productivity`) is a different grant from a
report about money.

**Four — the one write, stated out loud.** Producing an audit pack writes an append-only
`report_production` row, one outbox message, and — when the queue consumer finishes — a File Manager
version holding the artifact, whose SHA-256 content hash the File Manager computes at write. All
three are composed by the route and the consumer, through the ordinary chokepoint, with the ordinary
audit trail. The reporting package still writes nothing.

**Considered and rejected:** **A read-only database binding** — attractive, and D1 offers no such
handle today; the `SqlDatabase` interface is already shaped to accept a `D1DatabaseSession` so a
read-replication session can be threaded through later, and that is worth doing when it exists, but
it is a performance mechanism that happens to restrict writes rather than a guarantee to rest on.
**Reusing `trust:read` and `billing:read`** — cheaper, and it makes a firm-wide aggregate reachable
by everyone who may read one matter, which is a different exposure wearing the same key.
**Letting the reporting package file its own artifact** — it would put a write inside the package the
purity scan protects, to save one indirection, and the scan is worth more than the indirection.
**Leaving mechanism 4 unstated** — the surface would be described as read-only while performing three
writes, which is exactly the kind of claim that erodes trust in every other claim in the design.

**Consequences:** A future contributor who adds a write to the reporting package fails a test that
names the file. The one write the surface genuinely needs is visible, audited, and append-only, and
the produced artifact — immutable, content-hashed, retrievable byte-for-byte — is what makes the
whole thing capable of producing evidence in the first place.
