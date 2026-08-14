# The Nevada starter court-form library — implementation plan

**Date:** 2026-08-14
**Status:** Plan. **Not started, and it does not start until owner flags N1 through N5 are answered.** Those five decide what gets built; the tasks below are written against the recommended answers and change shape if any answer changes.
**Design:** [`2026-08-14-nevada-court-form-library-design.md`](2026-08-14-nevada-court-form-library-design.md)
**Research:** [`../research/2026-08-14-nevada-court-form-sources-and-terms.md`](../research/2026-08-14-nevada-court-form-sources-and-terms.md)

---

## What each gating flag changes about this plan

| Flag                                 | If answered the other way                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **N1** — author from prescribed text | Redistribution instead of authoring makes stage C a fetch-and-convert task, deletes the authoring work, and adds a licence review to every file. Stages A, B, D and E are unchanged. |
| **N2** — the starter set             | Stage C is entirely this list. A different list is a different stage C and possibly a different stage B (different keys).                                                            |
| **N3** — who reviews                 | A per-firm acknowledgement adds a per-firm table, a route, and a surface — a sixth stage.                                                                                            |
| **N4** — fillable-PDF templates      | Yes adds the whole tail Part B (template kind, discovered manifest, confirmed binding, fill step, flatten policy) ahead of any family-law content, and roughly doubles the plan.     |
| **N5** — permission letters          | A granted permission adds `courtPublication`-basis entries to stage C. Nothing else moves.                                                                                           |

Two things are worth starting **before** the answers, because they are right regardless and both are small: **task E1** (the `FORMTEXT` hole, flag N11) and the permission letters themselves, which are a person writing two emails rather than an engineering task.

---

## Stage A — the shared provenance vocabulary

Behaviour-free. Done first because both later stages import it and doing it after means two `Provenance` types exist for a while, which is how one of them starts drifting.

- [ ] **A1 — `@magna-carta/legal-provenance`.** A new pure package holding `SourceTier`, `Provenance`, and `AttorneyReview` (with `profileRevision` renamed `reviewedRevision`). No runtime dependencies, no clock, no database. Its own `CLAUDE.md` stating what it is for and that it holds no domain vocabulary — a citation shape, and nothing about trust or forms.
- [ ] **A2 — `@magna-carta/trust-jurisdictions` imports and re-exports them.** The three type declarations are deleted from `src/types.ts` and re-exported from the new package so no consumer's import path changes. The rename to `reviewedRevision` touches `src/resolve.ts`, `src/data/nevada.ts` and the review tests. **The trust package's golden tests must pass unchanged in substance** — a diff to a golden fixture in this task is a defect, not an expected consequence.
- [ ] **A3 — build refs.** `node tooling/tsconfig-refs/index.mjs --check` clean; `pnpm install` before believing any typecheck, because a new package is exactly the case where a stale workspace link reads as a real break.

**Done when:** the trust suite is green with no fixture changes, and there is exactly one declaration of `Provenance` in the repository.

---

## Stage B — the facts a Nevada caption needs

The dictionary widening and the court identity. **This is the stage that gates the forms**, and it is bigger than the forms.

- [ ] **B1 — party contact facets.** Three rows in `MERGE_FACETS` (`addressBlock`, `telephone`, `emailAddress`) on the party kind, one arm each in `facetValue` in `src/directory-role-bindings.ts`, three rows per party subject in the golden key list. The party read already joins the Directory; these must ride it rather than adding a read — the batching rule is asserted by `test/resolve-batching.test.ts` and this is precisely the change that would break it. Absence is `placeholder` on all three: an address missing from a caption is something a human must fill in before filing.
- [ ] **B2 — the court identity.** Per flag N9, recommended in the Directory: a typed court record carrying jurisdiction, level, and reach (statewide, judicial district ordinal, or county). Additive; an untyped court organisation stays legal and resolves to "unknown", which is the state the forum check refuses on rather than passes on.
- [ ] **B3 — court facets.** `court.county` and `court.addressBlock` off the court read that already joins the court's Directory organisation. `court.county` is a stored fact of the court identity, not derived from an address string.
- [ ] **B4 — golden key list and the projection.** Every key added in B1 and B3 lands in `test/fixtures/shipped-keys.json` as a reviewed diff, and the merge-field catalog contract's fixture stays a checked projection of the real dictionary.

**Done when:** a Nevada caption's every fact has a key, the batching test still asserts one read per source, and a matter whose court is untyped reports the court's forum as unknown rather than as anything else.

---

## Stage C — the package and the starter content

- [ ] **C1 — `@magna-carta/court-forms`, the contract.** `src/types.ts` carrying `CourtFormEntry`, `FormBasis` (the four-member union of section 4.3, with `courtPublication` requiring a recorded permission so an entry without one does not compile), `Forum`, and the register shape. `src/registry.ts` with `findCourtForm` / `encodedJurisdictionCodes`, one entry: Nevada. `src/resolve.ts` with the adoptability gate and `isReviewCurrent`. Pure, synchronous, no database, no clock, no network. Its own `CLAUDE.md`.
- [ ] **C2 — the authored templates.** One committed `.docx` per entry in the approved set, authored against the statute's or rule's own words, using `{{key}}` delimiters and the block vocabulary. **Built programmatically and reviewed once**, on the fixture discipline the assembly package's own tests use, so the bytes in source control are readable as a diff rather than opaque.
- [ ] **C3 — the entries.** One `CourtFormEntry` per form: citation, verbatim quote, source tier, the authority's own effective date, the retrieval date, forum, case types, declared keys, `attorneyReview: null`. **Nevada ships NOT REVIEWED**, and filling that field in is not part of this task.
- [ ] **C4 — the fitness tests.** Entry well-formedness; the key projection against the real dictionary; every template parses and normalizes without a failure against the real normalizer; the committed golden list of form keys and forums.
- [ ] **C5 — `lint:court-form-staleness`.** Fails on an entry past `reverifyWithinDays` and on a review that no longer covers the entry's revision. Wired into the same gate `lint:ledger-staleness` runs in.

**Done when:** the register lists the approved set, every entry refuses adoption, and CI fails if any entry goes stale.

---

## Stage D — adoption, and the forum refusals

- [ ] **D1 — the read routes.** `GET /api/v1/court-forms` and `GET /api/v1/court-forms/{formKey}`, `templates:manage`, firm-scoped, through the one chokepoint with `RouteMeta` on both. Unreviewed entries are listed with their state, not filtered out.
- [ ] **D2 — adopt.** `POST /api/v1/court-forms/{formKey}/adopt`, audited, idempotency required. Registers an ordinary `document_template` plus a first version through `prepareTemplateVersion` and the existing ingest chokepoint — **no privileged path to `clean`**. Refuses `court-form-not-reviewed` and `court-form-blocked-on-keys`.
- [ ] **D3 — provenance columns.** `source_form_key` and `source_form_revision` on `document_template`, additive, nullable. They record where a template came from and nothing else; nothing reads them to decide behaviour.
- [ ] **D4 — the three forum refusals on the assembly path.** `court-form-no-court-recorded`, `court-form-forum-unknown`, `court-form-forum-mismatch`, each a distinct problem type, each raised where the assembly already resolves the matter's court record, and each tested against a matter constructed to produce exactly that one. **The unknown case refuses**; a test asserts it, because the natural regression is to let it pass.
- [ ] **D5 — supersession.** The register answers, per adopted template, whether the platform holds a newer revision. Notify and offer; adopt-as-a-new-version reuses the existing version route. **No automatic rewrite of a firm's template anywhere in this task.**
- [ ] **D6 — worker suite.** Chokepoint contract per route, adoption idempotency, an adopted template assembling end to end, and the three refusals.

**Done when:** a firm can adopt a reviewed form and cannot adopt an unreviewed one, and a wrong-court assembly is a named refusal rather than a document.

---

## Stage E — independent of the gating flags

- [ ] **E1 — legacy Word form fields (flag N11).** The normalizer learns `FORMTEXT` and `FORMCHECKBOX` on the exact `MERGEFIELD` posture: detected and recorded on the manifest **always**, with the field's bookmark name, the part it sits in, and the frozen result text it will print; converted to brace form **only** on an explicit opt-in flag. A template carrying them registers either way, and every assembly reports them, so the silent-empty-form failure of the design's section 3.2 becomes a visible absence. Worth doing whatever happens to N1 through N5, because a firm will upload a Nevada `.docx` regardless.
- [ ] **E2 — the two permission letters (flag N5).** To the Supreme Court of Nevada and to Legal Aid Center of Southern Nevada. Not engineering work; recorded here so it is not forgotten and so the answer arrives before stage C needs it.
- [ ] **E3 — document protection, decided.** Whether an assembled document keeps `w:documentProtection w:edit="forms"`. Open question 2 in the design; a one-line answer either way, and currently a side effect rather than a choice.

---

## Sequencing

```
A (vocabulary)  ──►  B (keys + court identity)  ──►  C (package + content)  ──►  D (adopt + refusals)
E1, E2, E3 run in parallel and gate nothing
```

A gates C because C imports it. B gates C because a form whose keys do not exist does not ship. C gates D because there is nothing to adopt. Nothing in A, B or E depends on the gating flags; **C and D do, entirely.**

## What must never end up on the request hot path

Stated so a later change cannot quietly move it: reading a template's bytes, normalizing at adoption, and the OOXML work behind registering the adopted version. Adoption is a mutating route and does real work; it follows the existing template-registration path's placement rather than inventing a new one.

## Load profile

Per the accretion rule this adds no new benchmark. The register is a read over a compiled array of tens of entries and is not a measured operation. Adoption is a template registration, which the `documentAutomation` volume profile already measures.
