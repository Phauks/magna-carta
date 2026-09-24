# Feature-ledger fragments — the roadmap's source of truth

**Single home for:** the feature-ledger fragment format. One file per product **area** (mirroring the white paper's areas); each file holds a flat list of feature/sub-feature **nodes** with a status. `roadmap-build` (follow-up slice; design in [`docs/specs/2026-07-14-docs-sync-routine-design.md`](../docs/specs/2026-07-14-docs-sync-routine-design.md)) renders the set into `ROADMAP.md` (human tree view + a small hand-authored narrative header) and `roadmap.json` (machine view — the future interactive/public roadmap consumes this, never the Markdown).

**Division of homes (no duplication):** the [white paper](../docs/Magna-Carta-White-Paper.md) owns the narrative — what each feature is and why. `status.d/` owns slice-stage tracking (execution units). This ledger owns exactly one new fact per node: **how complete the capability is**, plus links. `scope:` is a one-line index entry, not a design description.

## Maintenance rules

- **Docs-in-commit:** a PR that ships or advances a feature flips its node's `status` (and `evidence`) in the same commit — the same definition-of-done rule as changelog fragments. The flip is the whole change: the rendered register is never committed on a branch (below).
- **Fragments persist** (like `status.d/`, unlike `changelog.d/`): nodes are never consumed, only updated. Ids are **stable forever** — never renumbered, never reused; a renamed feature keeps its id.
- **Append new capabilities as new nodes** — the ledger grows over time; a promise that will not be kept is flipped to `cut` with a note, not deleted.
- One file per area keeps parallel branches from colliding; two streams rarely ship into the same area at once.
- The weekly docs-sync routine audits merges that advanced a feature without flipping its node, and proposes the flip.

## Node format

A file starts with `# <Area Title>` and an HTML comment, then a flat list of blocks (blank line between). Hierarchy is encoded in the dotted `id`, not by indentation — parsing stays dependency-free:

```markdown
- id: documents.pdf.redaction
  name: PDF redaction
  scope: True content-removing redaction via the rasterize route
  status: shipped
  slices: 2-5-pdf-services-e-signature-core
  adrs: ADR-0134
  spec: docs/specs/2026-06-30-pdf-redaction-design.md
  evidence: crates/pdf-core redaction module + worker route
  audience: public
  notes: Text-preserving surgery route shipped separately
```

| Key              | Required  | Meaning                                                                                     |
| ---------------- | --------- | ------------------------------------------------------------------------------------------- |
| `id`             | yes       | Dotted kebab-case path; the segment count is the tree depth; stable forever                 |
| `name`           | yes       | Short display name                                                                          |
| `scope`          | yes       | One factual line — an index entry, not prose                                                |
| `status`         | yes       | See vocabulary below                                                                        |
| `slices`         | no        | Comma-separated `status.d/` slugs this capability's build is tracked under                  |
| `adrs`           | no        | Comma-separated `ADR-NNNN` (must exist in `docs/decisions/`)                                |
| `spec`           | no        | One `docs/specs/` path; must exist. Research goes in `evidence` or `notes`, not here        |
| `evidence`       | no        | One line naming the artifact that justifies the status (package, crate, route)              |
| `surface`        | see below | `screen` · `awaiting-screen` · `internal` — whether a person can reach it                   |
| `audience`       | no        | `public` publishes the node to the public roadmap; `internal` (the default) does not        |
| `public-name`    | no        | The name users see; defaults to `name`. Set it when the internal name is builder vocabulary |
| `public-summary` | no        | One sentence of user language. **Required whenever `audience: public`** — never defaulted   |
| `awaiting-owner` | no        | One line: the question blocking this capability on an owner decision. Presence is the flag  |
| `notes`          | no        | One line of qualification                                                                   |

## Reach — the fact `status` cannot hold

`status` says how complete a capability is. It has never been able to say whether anybody can get to
it, and the two are not the same question: **a backend nobody can open and a screen somebody uses
every day are both `shipped`.** Read as one number, that overstates the product by exactly the amount
of interface that has not been built — which on this program is most of it. `surface:` records the
second fact.

| Value             | Meaning                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `screen`          | A person can open this in the application today, on a page that exists                    |
| `awaiting-screen` | The capability works; the interface is the only thing missing. This is the interface debt |
| `internal`        | No user surface by nature — a port, a table, a queue, a fitness function, a migration     |

**Required on every leaf whose status is `shipped`, `partial` or `in-build`; refused everywhere
else.** A roll-up parent takes no value — its reach is its children's, and a parent carrying its own
would be free to disagree with all of them. A node with nothing built takes none either: there is
nothing to reach, which its status already says. `pnpm run lint:roadmap` holds both directions.

It is a recorded key rather than something derived, and that was measured before it was added:
across 754 nodes, prose in `notes` carried a usable signal on 63, and an `evidence:` path naming a
screen on 14 of the 359 leaves with code behind them. Deriving it would have been inventing the other 302.

**`awaiting-screen` when torn.** The failure this key exists to prevent is overstating reach, and
`awaiting-screen` never overstates: it claims working code and no way in. Reserve `internal` for
things that are genuinely finished without a screen and always will be.

## The rendered view

[`docs/now.md`](../docs/now.md) and [`docs/now.html`](../docs/now.html) — **the build register**, as a
document and as a self-contained page — are rendered from this ledger by `vp run register-build` and
are never hand-edited: every node, at its real status, with the counts over the whole set. **They are
rendered on `main`, never on a branch**: the per-merge assembly workflow renders them when a merge
lands, and the weekly docs-sync routine is the fallback while that workflow has no minutes. A branch
edits the ledger and stops — `vp run register-build` refuses to write off the trunk (`--preview`
shows the render without committing it), and `pnpm run lint:roadmap` fails a branch that carries
the rendered files. They used to be rendered on every branch that flipped a node, and every two such
branches then rewrote the same whole document and conflicted on it.
[`docs/decisions-open.html`](../docs/decisions-open.html) — **the decision desk** — is rendered by the
same command from the `awaiting-owner` nodes: every question the program is waiting on, gathered with
somewhere to write the answer and a block to paste the answers back. `pnpm run lint:roadmap` fails
on `main` (and with `--rendered`, anywhere) when any of the three differs from a fresh render, so a
capability that ships moves in the register on the `status` flip alone, and a question that is
settled leaves the desk when its key does. What
each rendering is for:
[`docs/conventions/documentation.md`](../docs/conventions/documentation.md). Design:
[`docs/specs/2026-08-13-public-roadmap-design.md`](../docs/specs/2026-08-13-public-roadmap-design.md).

**A node holds one status and forgets the last one, so the register's history is reconstructed from
git.** The same build re-parses this ledger as it stood at every past commit that touched
`roadmap.d/` on the trunk and keeps the counts in
[`docs/register-history.json`](../docs/register-history.json), which the register renders as _Where
we have been_. An ordinary run reads only the commits that file does not already hold — normally
one — so it stays cheap; a commit whose ledger does not parse under the current schema is recorded
as unread with the parser's reason and rendered as a hole, never estimated. After changing the
parser or the status vocabulary, run `vp run register-build --rebuild-history` (or
`node tooling/doc-fragments/build-register-history.mjs --rebuild`) so commits that have become
readable join the series.

## The gate against the repository

`pnpm run lint:roadmap` holds the rendered documents to the ledger. It cannot tell whether the
**ledger** is true, so `pnpm run lint:ledger-staleness` holds the ledger to the repository: every path
a node names must resolve, every `slices` entry must be a `status.d/` fragment, every `adrs` entry
must be an `ADR-NNNN` with a file, a node whose status asserts there is no code may not point at code
no other node accounts for, and a parent may not claim less than its own children. One rule needs no
filesystem at all: a `not-started` node whose slice fragment reports `built:` under way, with a
**sibling** already shipped under that same slice, is two committed documents contradicting each
other — and it is the only rule that can see a node which describes its own absence in prose without
naming a path. Deliberately quiet — eight exact rules, no guessing at prose — and a node the tree
genuinely cannot match carries `ledger-staleness:allow — <reason>` in its `notes`. Design and the
rules rejected for firing on correct nodes:
[`docs/specs/2026-08-14-feature-ledger-staleness-detection.md`](../docs/specs/2026-08-14-feature-ledger-staleness-detection.md).

**An absence claim is not required to name a path.** Writing _"no code"_ or _"no messaging port
defined"_ in `evidence` is correct and stays correct: a capability that was never built has no
location to name, and an invented path would be a fiction no rule can check. Requiring one was
measured at 96 hits over 708 nodes and rejected, along with the narrower ledger-against-itself form
that reads absence claims about other areas — the measurements and the five stale nodes that form
found by hand are in the design linked below. **Naming the path when there is one is still worth
doing**, because that is what puts a claim inside reach of rules 1, 2 and 4; it is an invitation,
not a gate.

**Nine statuses, nine columns.** The register never bands statuses together. Collapsing them was
tried and withdrawn: `partial` (a shipped backend with no screen on it) and `in-build` (being
written right now) rendered under one heading, which is the largest loss of signal this source can
suffer.

## The public view, written and not published

A second rendering exists for people using the product — grouped into horizon bands, publishing only
nodes marked `audience: public` and only the sentence written for that purpose. **It is not written
to disk.** There are no users yet, so it has no audience, and a document nobody reads is a document
nobody keeps honest. The renderer, the keys below and the artifact schema in
`@magna-carta/product-updates` are all kept ready and are all still linted, so the copy is sound on
the day the product has readers.

**A human writes the durable half of a public entry; the machine derives the volatile half.** You
choose whether a node is public and what its sentence says — both facts that rarely change. The
band it appears in comes from `status` on every run, because that is the fact that moves and
therefore the one that must never be typed twice.

**Prefer opting in the parent, not the leaf.** A parent's status is a genuine roll-up, so its
`shipped` means the whole capability including its screen; a leaf's `shipped` often means a backend
exists that nobody can use yet, and publishing that as Completed is a lie the assembler would tell
for you. Pick the node at the level a reader thinks in.

**Public copy rules, enforced by the lint:** no decision numbers, slice or phase numbers, file
paths, package names, emoji, years or quarters. There is deliberately no date field anywhere in this
schema — a nullable one gets populated, and then it is a promise.

The area file may carry `<!-- public-group: ... -->` under its schema comment: the heading users see
for that area. It defaults to the file's `# Title`, which is often builder vocabulary.

Status maps to a public band as follows. The band names are the community board's own status
vocabulary, so a request card and a roadmap entry never say the same thing two ways.

| Status                                   | Public band        |
| ---------------------------------------- | ------------------ |
| `shipped`                                | Completed          |
| `in-build`, `partial`                    | Building Now       |
| `planned`, `designed`                    | Planned            |
| `researching`, `not-started`, `deferred` | Future             |
| `cut`                                    | Not on the roadmap |

## Status vocabulary

| Status        | Meaning                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| `shipped`     | The artifact exists on `main` (backend-only counts, with a note, until UI is promised) |
| `partial`     | Parent node whose children mix shipped and not — or a capability delivered in part     |
| `in-build`    | Active work on a branch/worktree right now                                             |
| `designed`    | Accepted design spec exists; no code                                                   |
| `planned`     | Implementation plan exists; build not started                                          |
| `researching` | A named open research workstream                                                       |
| `not-started` | Promised in the white paper; no artifact or spec yet                                   |
| `deferred`    | Explicitly parked by a decision (say which, in `notes` or `adrs`)                      |
| `cut`         | Explicitly dropped by a decision — kept for the record, never deleted                  |

**Initial population (2026-07-14):** extracted from the white paper and statused against the [verified baseline](../docs/maintenance/reports/2026-07-14-baseline.md); statuses are evidence-backed drafts pending owner review in the setup PR.
