---
category: Changed
audience: internal
---

**Twelve feature-ledger nodes carried a status that asserts no code, over code.** The vocabulary
defines `deferred` as explicitly parked by a decision and `designed` as an accepted design spec with
no code; a capability with three modules, two tables and seven routes is neither. These are factual
claims the tree refutes, and they move on the same ground the evidence sentences moved on in the
previous pass. The register's headline shifts with them: Done 260 to 264, Part-built 103 to 111,
Ahead 218 to 209, Parked 43 to 40, over an unchanged 624 units of work.

| Node                                  | Was          | Now       |
| ------------------------------------- | ------------ | --------- |
| `custodian.stocktake`                 | `deferred`   | `partial` |
| `custodian.retention-destruction`     | `designed`   | `partial` |
| `custodian.will-reminders`            | `deferred`   | `partial` |
| `documents.conversion.office`         | `planned`    | `shipped` |
| `documents.conversion.searchable-pdf` | `not-started`| `shipped` |
| `documents.pdf.manipulation`          | `not-started`| `shipped` |
| `locations.usage.custodian`           | `designed`   | `shipped` |
| `locations.usage.documents-billing`   | `not-started`| `partial` |
| `notifications.digest`                | `deferred`   | `partial` |
| `platform.time-model.zone-context`    | `not-started`| `partial` |
| `product-updates.artifact`            | `not-started`| `partial` |
| `user-docs.admin-docs`                | `not-started`| `partial` |

**Three were found in this pass rather than the last one, all by the same search.**
`documents.pdf.manipulation` read "No merge/split/rotate/flatten module in `crates/pdf-core/src`" —
all four are built, three in `generate.rs` and form flattening in `forms.rs`, and every one is
exposed at the WASM edge. It read `not-started` because it looked for a module of its own; there is
not one, and `documents.pdf.generate` already claimed the same file.
`documents.conversion.searchable-pdf` read "no text-layer writer in `crates/pdf-core`" —
`searchable.rs` is exactly that, wired through `containers/ocr`'s `/ocr/searchable` and a registry
edge. `platform.time-model.zone-context` read "no zone column in `packages/locations/src`", a fact
two other areas had already been corrected on.

**Shipped versus partial was decided by scope coverage, not by deployment.** The two container
engines are `shipped` because `documents.conversion.raster` is, on identical evidence and an equally
undeployed image; inventing a distinction between them would be a new inconsistency rather than a
corrected one. Every leaf that gained a built status gained a `surface:`, all `awaiting-screen`
except `product-updates.artifact`, which is a build step and a KV publish and has no user surface by
nature.

**Six parked nodes said why they were parked without saying which decision parked them**, which
`deferred` and `cut` are required to carry. All six turned out to be parked in a document that names
them — ADR-0054, ADR-0059, or a white-paper topic — so each now cites it.

## The blind spot, measured

The previous pass reported that rule 1 skips any path a has-code node already claims, so a `partial`
area root naming `packages/custodian` immunises every `deferred` child beneath it. Three candidate
rules were measured against three states of the ledger and **none of them can close it.**

- **Tighten rule 1's accounting to be at-least-as-specific** (a strict ancestor no longer accounts
  for a path). Against the ledger as it stood when all twelve wrong statuses were live: **6 hits, all
  six false positives, and none of the twelve.** Against the post-evidence-sweep ledger: 10 hits, 2
  true. The reason is structural — the rule's only input is the node's own prose, and a mis-statused
  node's prose is the sentence that is wrong. It says "no such thing exists" and therefore names no
  path, so no path-keyed rule can see it at any precision.
- **The absence-about-a-resolving-path shape** ("no X in `packages/Y`"): **22 hits, 3 true.**
- **Widening rule 7 (`sliceAlreadyDelivered`) past `not-started`**: `deferred` alone gives 1 hit and
  1 false positive; the full widening to `deferred`, `designed` and `planned` gives **10 hits and 10
  false positives** — the reports sub-slices, the matter-assets tail, and the discovery clustering
  node, every one of them correctly pre-code. That is worse than the +2 the rule's own header already
  measured and rejected, and it is rejected here on the same terms.

What is worth doing instead is smaller and honest about which job it does. **A regression guard, not
a detector:** a node whose `evidence` or `notes` says something landed while its status says nothing
is built. Measured across three ledger states: **0 hits before the drift was found, 6 hits and no
false positives in the window where the evidence had been corrected and the status had not, 0 after
this change.** It cannot find drift nobody has noticed — its recall on that is zero by construction —
but it makes the specific mistake the previous pass made twelve times impossible to commit again.

And one number that bounds every slice-keyed rule: **220 of 265 pre-code and parked nodes carry no
`slices:` tag at all**, so rule 7 is blind to eighty-three per cent of them whatever its status
filter. Tagging is a cheaper lever than a rule, and it is the one that would move that number.

**The rest needs a human pass on a cadence.** Both the areas swept so far were read by a person
against the code, and both found drift running one way: nodes describing work that has since landed.
That is a reading job, and the docs-sync routine is where it belongs.
