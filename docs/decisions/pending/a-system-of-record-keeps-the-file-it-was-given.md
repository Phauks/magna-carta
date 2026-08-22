---
slug: a-system-of-record-keeps-the-file-it-was-given
status: Proposed
area: Documents / File handling
date: 2026-08-22
summary: "Ingest stops refusing. Every upload that completes commits, and a safety or type finding becomes a property of a committed version rather than a reason to have no version at all — reversing the quarantine posture of ADR-0081 and the ingest half of ADR-0158's treatment menu. The owner's ruling: a file the user gave us is kept, and it is up to the user to deal with it; not saving it is the larger hazard. What still refuses is about the transfer or the platform's capacity, never the content — a truncated object, an abandoned session, and (if adopted) a presign-time quota. The five gate quarantines become rows in a new per-version `file_version_finding` table that records both sides of a disagreement, so a mismatched file finally states what it actually reads as; `flaggedTreatment` — today enforced in exactly one route — becomes the platform's single access gate and is extended to the offline checkout, the editor launch, the preview grant and the bulk bundle, so a firm that sets `block` keeps blocking behaviour everywhere while the file itself is kept. `quarantined` survives with one producer, the custody withdrawal, and `clean` is renamed `committed` because a status asserting safety over a row that may carry a signature match is a sentence that is false."
---

**A practice-management platform is a system of record first, and a system of record that discards
records on a heuristic is not one.** Ingest commits every upload that completes; safety and type
findings are properties of a committed version, and access — not storage — is where they are
enforced.

**Context.** ADR-0081 established quarantine ingest: one consumer reads the uploaded object once and
either commits the version or quarantines it, where a quarantined version is never promoted to
`current_version_id` and every read filters `status = 'clean'`, so the bytes are structurally
unreachable. Five conditions produce that outcome today — a size mismatch, a declared-versus-sniffed
type contradiction, a size or type breach of the firm's upload policy, and a `flagged` scan verdict
under the `block` treatment ADR-0158 made the default. Three of the five are judgments about content.

The owner has ruled that none of them may refuse the record:

> "If a user uploads a file, even if we think it has a security issue or is a different file type, it
> is still uploaded and committed. It is up to the user to deal with the file. Not saving the file
> would be a major hazard."

The reasoning is the basis of this decision, not a preference weighed against alternatives. For a law
firm, silently refusing to keep a client's document because a scanner disliked it is a worse failure
than holding a flagged one. The refusal is also invisible where it does the most damage: the ingest
chokepoint is shared by six producers, so today a quarantine verdict can destroy a client's emailed
attachment with no upload UI to report it, an expanded member of a production under a discovery
obligation, a document the platform itself generated and told the member it had filed, and — worst —
the return leg of an offline checkout, which is a member's work with no other home.

The platform's own stance was already inconsistent in the direction the ruling points.
`recordRescanVerdict` stamps a fresh `flagged` verdict onto an already-committed version without
moving the status or the current-version pointer, on the stated principle of "informed access, no
data loss"; `scanVerdictAdmitsParsing` in discovery keeps a flagged production document in the corpus
and in the manifest and simply lets no parser open it; and the inspectable-size short-circuit already
commits unconditionally rather than judging. Only the ingest gate destroyed the record, and only for
files that were bad on arrival rather than found to be bad later.

**Decision.**

**Every upload that completes commits.** The `quarantine` arm of `runIngest` is removed, along with
`quarantineVersionStatement` and its single caller. A flagged version becomes the file's current
version like any other, because the document the person uploaded is the document the matter must
show.

**What still refuses is about the transfer or the platform's capacity, never the content.** Two
questions draw the line. _Do we have a whole file?_ — a read byte count that disagrees with the size
R2 reports is a corrupt transfer, and committing it would put a row in the record asserting bytes
that were never delivered, so it still fails; a disagreement with the size the client _declared_ is
merely a wrong claim about a whole file, and becomes a finding. _Do the bytes exist yet?_ — a
presign-time policy refusal costs a retry and costs the firm nothing, while a post-upload refusal
costs the firm the file while the bytes sit in its bucket anyway. Every remaining structural refusal
therefore lives at presign, including a storage quota if one is adopted. An abandoned or expired
session still abandons its version; an unreadable object still retries. A deployed engine that never
answers stops dead-lettering into a permanently pending version and commits `unscanned` instead.

**A finding is data, not a lifecycle state.** A new per-firm `file_version_finding` table holds one
row per issue per version — a version can be a renamed executable, over the size cap, and carrying a
signature match at once, which one nullable `scan_detail` string cannot express and already loses
today. Each row carries a closed-list `kind`, a `category` (`safety`, `type`, `policy`, `integrity`,
`processing`), an engine token in `detail`, and the two sides of a disagreement in `expected` and
`observed`. That last pair is what finally answers the owner's second complaint: because
`quarantineVersionStatement` writes only the status and a reason string, a `type-mismatch` today
records that two types disagreed and records neither of them. A committed version records the sniffed
type by construction, and the finding asserts the disagreement rather than leaving a reader to
re-derive the container-equivalence rules in their head. Redaction is a hard constraint on the table:
engine identifiers, MIME types, byte counts, digests and extensions only — never a file name, a path,
an excerpt, or a matched byte range.

**Access, not storage, is the gate, and `flaggedTreatment` is the mechanism.** The setting already
exists, already carries `block` / `informed-access` / `allow-and-flag`, already re-reads at request
time so a policy change needs no re-ingest, and already implements the acknowledgement ceremony and
the audited override. What it lacks is coverage — it is enforced in exactly one route. It is extended
through a single shared `resolveVersionAccess` decision to the offline checkout (which presigns a GET
of the bytes today with no verdict check at all), the editing session launch (where WOPI refuses only
_after_ the session exists), the preview grant (which under `block` hands back a download link that
will 403), and the bulk bundle (which has no verdict predicate whatever). A firm that sets `block`
must still get blocking behaviour everywhere: the file is kept, not served. A bundle never omits a
flagged entry silently under any treatment — a production that drops a document without saying so is
a certification problem, not a convenience.

**`quarantined` survives with one producer, and `clean` is renamed.** The custody withdrawal stays:
a version whose stored bytes no longer hash to the value recorded at commit is un-committed, because
the row's assertions describe content that is gone, and leaving it committed would put a hash on the
record the bytes do not answer to. That is the only surviving path out of a committed state. With
that, `status = 'clean'` on a row that may carry a live signature match is a sentence that is false
and will be read as true by the next person who writes a query — so the states are renamed
`committed` and `withdrawn` under expand-contract, using the existing status-predicate fitness
function to enumerate every site.

**Migration distinguishes the two populations.** Versions quarantined by an ingest gate are
rehabilitated: the object is the bytes the uploader sent, nothing was ever measured
(`committed_at`, `size_bytes`, `content_sha256` and `sniffed_content_type` are all NULL), and
completing a version that never finished is not a mutation of a committed one. They re-enter through
the existing re-drive shape, commit, meter — removing a standing source of reconciliation drift,
since a quarantined object is unmetered until the daily sweep corrects for it — and become current
only where the monotonic pointer bump allows. Custody withdrawals are not rehabilitated; they gain a
`content-drift` finding so they appear on the analysis surface with an honest explanation instead of
being invisible.

**Malware is held, not neutralized, and the design says so.** A firm's bucket will hold objects with
live signature matches, reachable by presigned URL wherever the treatment permits. What contains it:
R2 objects are inert, a flagged version is never rendered inline, and every parser that touches
version bytes is an outbound-disabled Container or memory-safe WebAssembly. What does not: a
presigned URL is an unrevocable bearer capability for its TTL, and under `informed-access` or
`allow-and-flag` known-bad bytes land on the firm's own workstations, transferring that risk to the
firm's endpoint protection. The audited `file.downloaded_malware_acknowledged` row is the honest
deliverable, not a claim of containment. **Nothing is ever purged** — no sweep, no retention rule, no
verdict triggers destruction, consistent with ADR-0081's standing rule that quarantined files are
evidence.

**Wiring the re-scan sweep is part of this decision, not a follow-up.** Today nothing re-examines the
corpus: the weekly re-scan cron described in the File Manager notes is not attached to any trigger,
`listUnscannedCommittedVersions` has no caller outside the load-profile harness, and the only
re-examination is the access-triggered re-scan — so a file nobody opens is never looked at again.
That is tolerable while a flagged file never commits and is not tolerable after this. The sweep must
run, and it must enumerate `flagged` versions behind the firm's current engine as well as `unscanned`
ones, because a signature-database update is exactly when a false positive can be cleared or a clean
file can stop being one.

**A new fitness function guards the gate.** A source scan fails any route that resolves a version's
`r2_key` for delivery without going through `resolveVersionAccess`. Without it, the coverage above
decays the first time somebody adds a route — which is how three of the four gaps this decision
closes came to exist.

**Considered and rejected.** _Keeping the scan refusal and reversing only the type and policy gates_
— it preserves the exact failure the owner named, since a scanner's false positive on a client's
document is the case that matters most. _A `held` lifecycle state distinct from `committed`_ — a
fourth state re-creates the problem: every read would have to learn about it, and the ones that
forgot would hide the file again, which is quarantine with a new name. _Deleting flagged bytes after
a retention window_ — destruction of evidence, blocked by holds anyway, and directly contrary to the
ruling. _Recording findings only in the audit log_ — the audit trail is append-only history, not a
queryable current-state surface, and the analysis screen the owner asked for needs to filter and
count. _Keeping the stored status tokens and renaming only in the type layer_ — the SQL is where the
misreading happens, and half a rename leaves two vocabularies free to disagree.

**Consequences.** The File Manager's first invariant is rewritten: the status gate remains and its
fitness function is unchanged, but a committed version's findings gate access rather than storage,
and that second half needs enforcement of its own. `current_version_id` stops being clean-by-
construction and becomes committed-by-construction; nothing may infer safety from the pointer. The
file read models take a breaking contract change (`status` values, plus a finding count), so the
OpenAPI snapshot, the generated client and the SPA's status handling move in one commit. Storage
grows by everything previously refused, which makes a quota the next question rather than an
optional one. Seven owner questions are left open and numbered in the spec — the default treatment
for a newly committed flagged file and whether a flagged document's text may be indexed are the two
that change behaviour for every firm at once.

Design: [`docs/specs/2026-08-22-always-commit-ingest-design.md`](../../specs/2026-08-22-always-commit-ingest-design.md).
Supersedes the quarantine-on-content posture of **ADR-0081** and the ingest half of **ADR-0158**'s
treatment menu (its access half is retained and extended). Builds on **ADR-0147** (raw engine facts,
app-side verdict) and **ADR-0077** (version immutability); touches **ADR-0082** (bulk download) and
**ADR-0029** (inline preview).
