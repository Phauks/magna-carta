# The Nevada starter court-form library — design

**Date:** 2026-08-14
**Status:** Design proposed. **Owner decisions N1 through N5 in section 12 gate the build**; the implementation plan beside this file does not start until they are answered. No product code in this cycle.
**Scope:** What a shipped court form IS — its representation, its provenance, its currency, its review gate, its forum binding, and how a firm comes to hold one. The starter set's contents, proposed. The dictionary widening and the engine work the set depends on, named and sequenced. **Excludes:** any second jurisdiction, a clause library, questionnaire-driven assembly, and the interface (named as seams).
**White-paper home:** _Document Automation_, with _Core domain_ (matter types and the court record), _Directory_ (the court as an organisation) and _Trust accounting_ (the refusal posture this design copies) as the surrounding context.
**Governing decisions:** ADR-0011 (document automation as a first-class capability), ADR-0210 (the in-house OOXML merge), ADR-0211 (the template model and its versioning), ADR-0255 (the owner docket, which directed "a small provenance-tracked Nevada starter court-form library is curated"), ADR-0009 (the jurisdiction-configurable trust engine, whose refusal posture is reused here), ADR-0003 (tenancy), ADR-0077 (app-managed versions), ADR-0081 (the ingest chokepoint).
**Answers:** the document-automation design's owner flag **F2** ("Do we ship and maintain a curated library of jurisdiction court forms, or only fill firm-supplied fillable PDFs?"), answered by the owner as yes-for-Nevada in ADR-0255. This design says what that library is.
**Research it rests on:** [`docs/research/2026-08-14-nevada-court-form-sources-and-terms.md`](../research/2026-08-14-nevada-court-form-sources-and-terms.md). Every licensing and format claim below is sourced there; none is restated with new authority here.

---

## 1. The three findings that shape everything else

The owner's direction was a small, provenance-tracked Nevada starter library. Establishing what is actually true turned that from a content-entry task into a design task, because three facts collide.

**Finding one — the corpora a Nevada firm actually files are the ones with the worst reuse position.** The statewide, Supreme-Court-approved set (divorce, custody, guardianship, probate, protection orders — the forms "acceptable to file in any court in Nevada") is published under an express **"All content © Supreme Court of Nevada 2026"**. The Clark County family and civil sets, which a Las Vegas practice uses daily, are published by **a private nonprofit** under **"All content © Legal Aid Center of Southern Nevada 2026"**. Washoe County's terms could not be established at all. The only court source that asserts nothing is the appellate one — and appellate forms are the forms a firm files least often.

**Finding two — the format the courts publish in is the format the engine cannot read.** The statewide corpus is fillable PDF. The platform has an AcroForm fill engine in `crates/pdf-core` and **no template kind that can use it**: there is no `kind` discriminator on `document_template_version`, no AcroForm manifest, and no fill step on the assembly path. That work is planned and unbuilt. Meanwhile the appellate corpus IS `.docx` — and its `.docx` files are built from **legacy Word form fields** (`FORMTEXT`, `FORMCHECKBOX`, under `w:documentProtection w:edit="forms"`), which the normalizer does not recognize either. Section 3 sets out exactly what happens to one today, because it is worse than "unsupported".

**Finding three — the text of a statute is a different thing from a court's document, and Nevada prescribes a good deal of text.** NRS 155.020 sets out the Notice of Hearing on the Petition to Administer the Estate and the Notice to Creditors **verbatim** ("must be in substantially the following form"). NRS 162A.620 does the same for a statutory-form power of attorney; NRS 21 and NRS 40 carry others. The Nevada Legislature asserts no copyright in NRS. So there is a class of Nevada form content whose operative words the platform can reproduce with a citation, from a source that claims nothing, in a format the platform authors itself.

Those three findings force the design's central move. **The platform does not redistribute anybody's court document. It authors its own template from prescribed text and cites the authority.** Everything below follows from that, and owner flag **N1** is whether that move is accepted.

---

## 2. What a court form IS

### 2.1 Reference data in a package, adopted into a firm's own catalogue

**A shipped form is compiled reference data — an entry in `@magna-carta/court-forms`, not a row in any firm's database and not something provisioning writes.** The model is `@magna-carta/trust-jurisdictions`, deliberately and almost line for line: a pure package, no database handle, no clock, no network, holding what one jurisdiction publishes plus the provenance that proves it, with a resolver that answers or refuses.

Three reasons, in the order they bind.

**A correction must be a package release, never a migration against every tenant.** This is the sentence `trust-jurisdictions` already lives by, and a form is the same shape of fact: identical for every firm, wrong for every firm at once when it is wrong, and fixed by shipping a new version of the code. Seeding forms into per-firm databases would make "the statute was amended" a fan-out write across every tenant, which is the shape that goes wrong quietly at scale.

**Provisioning is deliberately five control-plane rows and a lazily-migrated per-firm database.** The self-serve provisioning design keeps first-firm cost at four API calls precisely so a rate-limited queue can absorb signups; adding N template registrations, N R2 writes and N normalization passes to that path would undo the property it was built for. And it would be writing content into firms that may never open the Documents area.

**A firm that never adopts a form should not be carrying one.** A starter library is an offer, not an endowment.

So: **the platform ships entries; a firm adopts one.** Adoption registers an ordinary `document_template` plus a first `document_template_version`, through `prepareTemplateVersion` and the same ingest chokepoint every other byte uses, with `templates:manage` as the permission. There is no second template store, no privileged path to `clean`, and after adoption the platform's copy and the firm's copy are two different objects.

### 2.2 The firm's copy is the firm's, and the platform never edits it

Two columns on `document_template` record where a template came from — `source_form_key` and `source_form_revision` — and that is the whole of the relationship. The firm may edit it, version it, rename it, archive it. The platform will never rewrite it, and there is no "sync" that could.

When the package later ships a corrected revision of a form a firm adopted, the firm's copy is **superseded, not replaced**: the firm is told, with what changed and why, and offered a one-click adopt-the-new-revision that lands as **a new version of the same template** — the existing version model, unchanged. Overwriting a template a paralegal has edited is the data-loss shape the assembly design already refused for assembled documents ("assembling onto an existing file as a new version is deliberately not slice-1 behaviour"), and it is refused here for the same reason.

This answers the question directly: a firm's own edits do not relate to the platform's copy at all. They diverge, on purpose, and the recorded `source_form_revision` is what makes the divergence explicable rather than invisible.

### 2.3 The catalogue is not a second file manager, and a form entry is not a document

The three-way distinction the document-automation design settled holds unchanged. A **template** is an assembly input in the template catalogue. An **example** or **precedent** is an ordinary matter file. A **shipped form** is a fourth thing and it is smaller than all of them: it is a description of a form plus the bytes of a template the platform authored, living in source control, becoming a template on adoption and nothing else. It gets no matter, no R2 object of its own in a firm's bucket until adoption, and no lifecycle.

---

## 3. What the engine can and cannot render, stated before the content is chosen

A form library is worth exactly what the engine can render. This section is the constraint the starter set is drawn inside.

### 3.1 What works today

`.docx` templates with `{{key}}` text delimiters; `{{#if}}` / `{{#unless}}` conditional blocks and `{{#each}}` repeats operating on whole paragraphs and whole table rows; `{{= }}` computed fields over the closed expression language; `:format` suffixes per value type; `sum` / `minimum` / `maximum` over a list source. **113 shipped merge keys**, including the ones a caption needs — `court.name`, `court.judge`, `case.number`, `case.division`, `case.department`, `case.filedOn`, `case.clientDesignation`, `case.opposingDesignation` — plus the estate subject (`estate.style`, `estate.shortStyle`, `estate.decedent`, `estate.dateOfDeath`, `estate.proceedingType`, `estate.lettersIssuedOn`), party display names with parts-aware renderings, `capacityLine`, five member subjects with bar numbers, recorded pronouns and the two grammar helpers, the letterhead logo as a real OOXML picture, and the six protected client identifiers behind the decrypt chokepoint. PDF output through the conversion edge, in the same job.

That is a lot, and it is why a Nevada caption and a probate notice are expressible at all.

### 3.2 What does not work, in the order it hurts

**A fillable PDF cannot be a template.** No `kind` on `document_template_version`, no AcroForm manifest, no binding, no fill. The statewide Supreme-Court-approved corpus is therefore unreachable **whatever the licensing answer is**. Owner flag **N4** is whether that changes.

**A legacy Word form field binds nothing, and nothing says so.** This is the sharpest finding in the whole exercise and it deserves stating precisely. `mergeFieldNameOf` in `packages/document-assembly/src/normalize.ts` matches `MERGEFIELD` and returns `undefined` for every other field instruction, which are then "left exactly as authored" — correct for `PAGE`, `DATE` and `TOC`, which are Word's own fields. A `FORMTEXT` field falls in that same bucket. So a Nevada appellate `.docx` uploaded as a template today:

- **registers successfully** — no normalization failure, because there is no unclosed delimiter and no unknown key;
- **produces an empty manifest** — it declares no merge keys at all;
- **binds nothing** at assembly;
- **reports no absence**, because the absence model reports keys that failed to resolve and this template named none;
- **files a document containing the form's frozen help text** — "Click here to enter caption", "enter name of party/parties appealing", "date", "month", "year".

The safety net that exists for exactly this failure — the `unconvertedMergeFields` manifest entry, which records a `MERGEFIELD` nobody converted along with the frozen text it will print, "so registration reports it, the field inspector shows it, and every assembly reports it again" — **does not cover `FORMTEXT`**. That is a hole in the absence model, not a missing feature, and the reasoning that produced the `MERGEFIELD` treatment applies to it word for word. Owner flag **N11** proposes closing it with the identical posture: detect and report always, convert only on explicit opt-in.

**Document protection survives.** `w:documentProtection w:edit="forms"` is not in `SETTINGS_TAGS_IDENTIFYING` or `SETTINGS_TAGS_CUSTOM`, so the metadata scrub leaves it, and a document assembled from such a template is filed edit-restricted. That is arguably right for a court form and arguably wrong for a document a paralegal must finish by hand; it is at least a decision somebody should take rather than a side effect.

**Content controls are still a named seam.** Unchanged, and not needed here.

### 3.3 The facts a Nevada caption needs that the dictionary does not carry

Bound against the shipped key list, a Nevada district-court caption and the notices below need four things that do not exist:

| Missing                                            | Why the form needs it                                                                                                                                                                                                                                               | Where it would live                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `court.county` (and the judicial-district ordinal) | "IN THE EIGHTH JUDICIAL DISTRICT COURT ... IN AND FOR THE COUNTY OF CLARK" is the caption's first line. `court.name` is one string and cannot be decomposed.                                                                                                        | A typed court identity — section 5            |
| `court.addressBlock`                               | The clerk's address on a notice or certificate of mailing. The court is a Directory organisation whose address exists; no merge key exposes it.                                                                                                                     | A `court`-kind facet                          |
| `<party>.addressBlock`                             | A Nevada caption block carries the filer's address; a certificate of service carries each served party's. The office's address answers this for a represented client (`location.addressBlock`); nothing answers it for an opposing party or a self-represented one. | A party-kind facet, one row in `MERGE_FACETS` |
| `<party>.telephone`, `<party>.emailAddress`        | Same block. The member subjects carry `directDial` and `emailAddress`; the party subjects carry neither.                                                                                                                                                            | Party-kind facets                             |

The party ones are genuinely one row each in `src/catalog/facets.ts` — "adding a facet is ONE ROW, and every subject of that kind gains it" — plus one line in the party resolver and one row in the golden key list. The court ones are not, and section 5 is why.

**The rule this produces: a form whose keys the catalogue cannot supply is not shippable.** A package fitness test asserts that every key a shipped form's template names exists in the platform dictionary, with the same value type and the same absence behaviour the entry declares — the same property `test/fixture-projection.test.ts` gives the merge-field catalog contract, and for the same reason: a form describing fields the engine does not have is a second catalogue free to be wrong. An entry that needs a key nobody has built declares `blockedOnKeys` and **does not ship**; it is visible in the register as blocked, so the gap is a listed obligation rather than a silent omission.

---

## 4. Provenance, currency, and the review gate

### 4.1 The vocabulary is lifted, not re-invented

`@magna-carta/trust-jurisdictions` already has the vocabulary for "a compiled legal fact with a citation, a quote, a tier, the rule's own effective date, and the date somebody fetched it", and the attestation shape for "a named attorney reviewed this on this date against this revision". Writing a second `Provenance` and a second `AttorneyReview` would be precisely the drift the merge-field catalog contract's projection test exists to stop, one domain over.

So `Provenance`, `SourceTier` and `AttorneyReview` move into a small shared package, **`@magna-carta/legal-provenance`**, which `trust-jurisdictions` imports and re-exports. The move is mechanical and behaviour-free; the one rename it carries is `AttorneyReview.profileRevision` to `reviewedRevision`, because what is being reviewed is a jurisdiction profile in one package and a form entry in the other, and a field named after one of them would be wrong half the time.

What is **not** lifted is `FieldConfidence`. Its four members answer "how much is known about this rule", and a form does not have that shape — a form's uncertainty is about its **basis**, which is section 4.2.

### 4.2 What an entry records

```
CourtFormEntry
  key                  stable, permanent, never reused        e.g. "nevada.probate.notice-to-creditors"
  revision             content-derived, bumped on any change
  title                the form's own name
  basis                statutoryText | courtRule | courtPublication | firmDrafted   (4.3)
  authority            Provenance — citation, verbatim quote, sourceUrl, sourceTier,
                       authorityEffectiveDate, retrievedOn
  forum                the court this form is for, as values                        (section 5)
  caseTypes            the proceedings it belongs to
  attorneyReview       AttorneyReview | null — null means it does not resolve       (4.4)
  lastVerifiedOn       when a human last read the authority against this entry      (4.5)
  reverifyWithinDays   the declared re-verification interval
  template             the authored .docx bytes, committed
  declaredKeys         every merge key the template names
  blockedOnKeys        keys the dictionary cannot supply yet — non-empty means unshippable
  completedByHand      keys deliberately left for a human, with the reason
```

**A value without a verbatim quote is not shippable**, exactly as in the trust package: the reviewing attorney is checking the quote against the authority, and a form whose prescribed text cannot be quoted is a form they cannot review.

### 4.3 `basis` is the discriminant that makes an unsupportable claim unrepresentable

- **`statutoryText`** — the operative words are prescribed by statute and the entry quotes them. The template reproduces them and cites the section. This is the class the starter set is built from.
- **`courtRule`** — a rule states what the document must contain but prescribes no words (NRAP 3's notice-of-appeal contents, NRCP 5(b)'s certificate of service). The platform authors the words; the entry quotes the requirement, not a form.
- **`courtPublication`** — the content is a court's own published document. **Nothing of this basis ships without a written permission recorded on the entry**, and the type carries that permission as a required field rather than a note, so an entry of this basis without one does not compile. That is owner flag **N5**.
- **`firmDrafted`** — reserved and unused: a firm's own precedent is an ordinary template and does not belong in a shipped register. It exists in the union so that the compiler, not a convention, is what keeps one out.

### 4.4 Nothing resolves until an attorney has reviewed it, and Nevada ships NOT REVIEWED

`attorneyReview: null` means the form **cannot be adopted**. The adopt route refuses with `court-form-not-reviewed`, and the whole Nevada set ships that way. This is the trust package's rule verbatim, including the hard part: filling that field in is "an attestation by a named person on a stated date, not a flag".

Two refinements the form domain needs that the jurisdiction domain does not.

**Review is per form, not per library.** A jurisdiction profile is reviewed as a whole because its values are one body of rules read together. Forms are revised one at a time by different authorities on different schedules, so a library-wide review would be invalidated by any single amendment and would put a reviewer in front of everything again to release one correction.

**A review binds a content-derived revision, and amending the entry re-closes the gate.** Same mechanism, same reason: a review of superseded text is not a review, and deriving the revision from the entry's content means an amendment that forgets to bump the date still closes the gate.

**An unreviewed form is listed, not hidden.** It appears in the register with its state and its citation, and it is unadoptable. Hiding it would answer "do you have a Nevada notice to creditors?" with "no" when the true answer is "yes, awaiting review", and the count of what is awaiting review is exactly the thing that should be visible to the person who can clear it.

### 4.5 Staleness is our obligation, expressed as a check that fails

No Nevada source emits a machine-readable currency signal, so a shipped form goes stale silently by default. Two clocks, kept distinct because different people fix them:

- **Authority currency** — `lastVerifiedOn` plus `reverifyWithinDays`. A repository fitness function, in the shape `lint:ledger-staleness` already has, **fails** when an entry is past due. It is a build-time obligation on the people who maintain the library, not a runtime state a firm sees.
- **Review currency** — `isReviewCurrent`, the trust package's function by another name: a review naming an earlier revision no longer covers the entry, and the form stops being adoptable until it is reviewed again.

A firm that already adopted a form is unaffected by either — their template is theirs. What they get is the supersession notice of 2.2.

---

## 5. A form declares its forum, and a mismatch is a refusal

### 5.1 The values

Every entry carries the court it is for, as data:

```
forum: {
  state: "NV"
  courtLevel: "supremeCourt" | "courtOfAppeals" | "districtCourt" | "justiceCourt" | "municipalCourt"
  reach:  { kind: "statewide" }
        | { kind: "judicialDistrict", ordinal: 1..11 }
        | { kind: "county", countyFips: string }
}
caseTypes: readonly string[]
```

This is the owner's question answered as asked: a wrong-court filing becomes **expressible as a refusal** rather than left to a naming convention or a folder. A Second Judicial District form assembled onto an Eighth Judicial District matter is a typed mismatch, not a document somebody notices at the clerk's window.

### 5.2 Where it is checked, and where it is not

**Adoption is unconstrained.** A firm may hold any template it likes; the catalogue is firm-level and carries no matter data.

**Assembly is where the check lives**, because assembly is the matter-rooted act, and it produces three distinct refusals rather than one:

| Situation                                         | Refusal                                  | Who fixes it, and how                                |
| ------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| The matter records no court at all                | `court-form-no-court-recorded`           | Whoever opens the matter, by recording the court     |
| The matter records a court whose forum is unknown | `court-form-forum-unknown`               | Whoever maintains the Directory, by typing the court |
| The matter's court and the form's forum disagree  | `court-form-forum-mismatch`, naming both | Whoever picked the template                          |

Three refusals rather than one, on the trust package's discipline: "each is fixed by a different person doing a different thing." Collapsing them would produce a message that tells nobody what to do.

**The middle row is a refusal, not a pass.** This is deliberate and it is the load-bearing half. The tempting alternative — "we do not know the court's forum, so let it through" — is a fallback, and the whole posture this design inherits is that there is no fallback: `court-form-forum-unknown` refuses for want of data and names the repair. A silent pass would make the forum binding decorative on exactly the matters where the data is thin.

### 5.3 The check needs a court identity that does not exist

`matter_court_case.court_entity_id` points at `directory_organization`, which carries `legal_name`, `display_name`, `status`, `merged_into_id` and `needs_review` — and nothing that says it is a court, let alone which one. So today, **every** matter would land in the `court-form-forum-unknown` row, and the forum binding would be a check that always refuses.

That is honest but useless, so the court identity is **build work this design schedules ahead of the forms that depend on it**, not a seam it names and walks away from. The shape is owner flag **N9**; the recommendation is that it belongs in the Directory, because a court is an organisation a firm meets across many matters and its identity should be recorded once rather than per matter. What it must carry is the minimum the forum check compares against: jurisdiction, level, and reach.

---

## 6. What is in the starter set

Bounded by section 3 (the engine renders `.docx` from `{{key}}` delimiters), section 4.3 (`basis`, and nothing of `courtPublication` basis without permission), and section 3.3 (the dictionary). What survives all three is small, and small is what the owner asked for. **Owner flag N2 is this list**; it is what gets built, so it is the owner's rather than mine.

**Tier one — statutory text, shippable on the strength of the research already done.**

1. **Notice of Hearing on the Petition to Administer the Estate** — NRS 155.020(3), prescribed verbatim. Binds `estate.decedent`, `court.name`, `court.county`, `case.number`, and a hearing date the firm supplies. The estate subject already exists in the dictionary, which is why probate is the easiest place to start rather than a coincidence.
2. **Notice to Creditors** — NRS 155.020(4), prescribed verbatim. Binds `estate.decedent`, the court's title, the date of appointment (`estate.lettersIssuedOn`), and the sixty-or-ninety-day election, which is a conditional block rather than a blank.

**Tier two — court rule states the contents, the platform authors the words.**

3. **A Nevada district-court caption block.** Not a form: the reusable heading every district-court filing carries, expressed once and correctly — judicial district, county, the parties in their recorded designations, case number, department. It is the single highest-value item in this list because it is what a firm rebuilds by hand in every template it authors, and it is pure layout plus keys.
4. **Certificate of Service** — NRCP 5(b) states what must be certified and prescribes no words. Binds the served parties as a repeating block over `matter.parties`, which is the collection the repeat machinery already reads once.
5. **Notice of Appeal** — NRAP 3 states the contents. The appellate court publishes a `.docx`; the platform authors its own from the rule rather than copying it, which is the whole point of N1.

**Explicitly out of tier one and two, and why:** everything family-law. The statewide set is fillable PDF (blocked by N4) and copyright-asserted (blocked by N5); the Clark County set is a private nonprofit's asserted work. That is the largest gap in this library and it is honest to name it as the gap rather than to fill it with something weaker.

**Adjacent and deliberately excluded:** the NRS 162A.620 statutory-form power of attorney. It is prescribed text, it is clean, and it is not a court form — putting it in a court-form library because it was nearby is how a register stops meaning anything.

---

## 7. What the product may say, and what it may not

The owner's question — whether "the platform ships a legal form" is a representation the firm should be making at all — is answered no, in this form: **the platform never represents that a form is correct, current, or sufficient for a filing.** What it represents is narrower and checkable.

- Every entry shows its **authority citation and verbatim quote**, so a lawyer can check the template against the statute in one glance rather than trusting it.
- Every entry shows **who reviewed it and when**, or shows that nobody has and refuses.
- Every entry shows **when its authority was last verified**.
- The template reproduces prescribed text and **says which section it reproduces**, in the entry — not in the assembled document, which carries no process reference of any kind.
- User documentation states plainly that the filing lawyer is responsible for the document, in the same voice the asset register's documentation uses when it says "It is not a court form."

The refusal posture does the rest of the work. A form nobody has reviewed does not look the same as one that has been: it cannot be adopted at all, which is a stronger statement than a badge, and it is the property the trust package established for exactly this reason.

---

## 8. The API and permission surface

No new namespace. The library is read by anybody who can manage templates and adopted by the same permission that registers one.

| Route                                      | Permission         | Resource | Audited | Idempotency | Notes                                                                                                                                                  |
| ------------------------------------------ | ------------------ | -------- | ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/court-forms`                  | `templates:manage` | firm     | no      | none        | The register: every entry with its basis, authority, forum, review state, and whether it is adoptable. Unreviewed entries are listed with their state. |
| `GET /api/v1/court-forms/{formKey}`        | `templates:manage` | firm     | no      | none        | One entry, with the quote and the declared keys.                                                                                                       |
| `POST /api/v1/court-forms/{formKey}/adopt` | `templates:manage` | firm     | yes     | required    | Registers the template. Refuses `court-form-not-reviewed`, `court-form-blocked-on-keys`.                                                               |

Adoption is idempotency-required for the reason every mutating template route is: a retried adopt must not mint two templates. Problem types are additive registry entries: `court-form-not-reviewed`, `court-form-blocked-on-keys`, `court-form-no-court-recorded`, `court-form-forum-unknown`, `court-form-forum-mismatch`.

The forum refusals are raised on the **assembly** path, not here, and they extend the existing assembly failure vocabulary rather than starting a second one.

---

## 9. Interface seams

The owner designs the interface. Three seams, named:

1. **The form register** — the list, filterable by case type, showing basis, authority, review state and adoptability. The place a firm discovers what exists and what is awaiting review.
2. **Adopt** — one action, landing on the firm's own template in the template library, which is a surface that already exists.
3. **The supersession notice** — "the platform has a newer revision of a form you adopted; here is what changed", with adopt-as-a-new-version as the action and no automatic anything.

---

## 10. Test strategy

The risk is concentrated in the register being wrong about itself, so the tests are fitness functions over the data rather than behaviour tests over code.

**In the package, pure.** Every entry is internally consistent: a `statutoryText` basis carries a quote; a `courtPublication` basis carries a permission; an entry with a non-empty `blockedOnKeys` is not adoptable. **Every declared key exists in the real merge-field dictionary** with the value type and absence behaviour the entry claims — the projection property, borrowed whole. Every template's bytes parse as a valid OOXML package and normalize without a failure, against the real normalizer, so a form that would fail at registration fails in our suite instead of a firm's. **A key is permanent**: a committed golden list, on the model of `test/fixtures/shipped-keys.json`, so a form key that disappears or changes forum is a failing test naming it.

**Staleness, in CI.** `lint:court-form-staleness` fails on an entry past its re-verification interval, and on a review that no longer covers the entry's revision.

**In the worker suite, under Miniflare.** The chokepoint contract per route; adoption idempotency; that adopting an unreviewed form is refused; that an adopted template is an ordinary template that assembles; and the three forum refusals, each asserted separately against a matter constructed to produce exactly that one.

---

## 11. Risks

**The permission letters may go unanswered, and then the library stays small forever.** Both copyright-asserting publishers exist to make these forms used, so the ask is not adverse — but it is a dependency on somebody else replying, and the honest planning assumption is tier one and two only.

**The court identity is a bigger change than the library.** Typing courts touches the Directory, and the forum check is worthless without it. Sequencing it first is right and it means the library's first visible increment is further away than "two probate notices" suggests.

**"Substantially the following form" is a judgment we are not making.** The template reproduces the statute's words; how far a firm may depart is the firm's call, and the design must not imply the platform has fixed it.

**A form that assembles cleanly can still be the wrong form.** Forum matching catches the wrong court. It does not catch the wrong proceeding, a superseded local rule, or a judge's standing order. The library's value is provenance and currency, not correctness, and every surface has to keep saying so.

**Legacy form fields will arrive whether or not we build for them.** A firm handed a Nevada `.docx` will upload it, and today it registers silently and binds nothing (3.2). That is true independent of this library, which is why N11 is a flag rather than a task inside it.

---

## 12. Owner decisions required

**Numbered in the N series** so an answer cannot be mistaken for an answer to another design's flags. **N1 through N5 gate the build — the implementation plan does not start until they are answered**, because each one decides _what gets built_ rather than how.

### Build-gating

| Flag   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **N1** | **Does the platform author its own templates from prescribed text, or redistribute the courts' published documents?** Recommended: author, always. It narrows the copyright question to text a statute prescribes, it produces templates in the one form the engine renders, and it is the reason a starter set is possible at all. Redistribution is the cheaper-looking path and it takes on somebody else's asserted rights in every file. **This decides whether the work is research-and-authoring or fetch-and-repackage.** |
| **N2** | **What is in the starter set?** Section 6 proposes five items: two NRS-prescribed probate notices, a district-court caption block, a certificate of service, and a notice of appeal. Adding anything family-law depends on N4 and N5. **This is the content, so it is the deliverable.**                                                                                                                                                                                                                                          |
| **N3** | **Who reviews, and is the platform's review enough?** Recommended: a named Nevada-licensed attorney reviews each entry and the attestation ships in the package; a firm needs no second acknowledgement, because refusing to adopt an unreviewed form is already the stronger gate. The alternative — a per-firm acknowledgement before first use — is defensible and costs a table, a route and a surface.                                                                                                                       |
| **N4** | **Do we build fillable-PDF template support so the statewide corpus is reachable at all?** The forms most Nevada firms actually file are fillable PDFs, and the platform has the fill engine and no template kind to use it. Building it is the planned tail work (a `kind` discriminator, a discovered manifest, human-confirmed binding, the fill step) and carries its own open flag on whether a filled form files flattened. Without it, no family-law form can ever be in this library whatever N5 says.                    |
| **N5** | **Do we write to the Supreme Court of Nevada and to Legal Aid Center of Southern Nevada asking permission?** Both assert copyright expressly; both publish these forms to be used. A written permission converts the two largest corpora from unshippable to shippable and costs two letters. Until one exists, no entry of `courtPublication` basis compiles.                                                                                                                                                                    |

### How, not what

| Flag    | Decision                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **N6**  | **The re-verification interval.** Recommended 180 days, failing CI. Shorter is more work on us; longer risks a firm adopting text amended two sessions ago.                                                                                                                                                                                                                                                |
| **N7**  | **Supersession behaviour.** Recommended: notify and offer, never rewrite. The alternative — auto-adopting a corrected revision as a new version — is defensible for a firm that has not edited its copy, and indefensible for one that has, and telling them apart reliably is not free.                                                                                                                   |
| **N8**  | **Forum-mismatch severity at assembly.** Recommended: refusal, with the three distinct codes. The alternative is a declared absence with a reason, which lets the document out.                                                                                                                                                                                                                            |
| **N9**  | **Where the court identity lives.** Recommended: the Directory, as a typed court record on the organisation. The alternative is columns on `matter_court_case`, which is cheaper and re-records the same court on every matter.                                                                                                                                                                            |
| **N10** | **Is the package jurisdiction-keyed from day one?** Recommended: yes, `@magna-carta/court-forms` with Nevada as the one encoded jurisdiction and everything else explicitly not-encoded — the trust corpus's shape, and the shape that makes a second state additive.                                                                                                                                      |
| **N11** | **Legacy Word form fields.** Recommended: the normalizer learns `FORMTEXT` and `FORMCHECKBOX` with the exact `MERGEFIELD` posture — detected and manifested always, converted only on explicit opt-in — so a Nevada `.docx` a firm uploads stops binding nothing silently. This is a defect this design surfaced rather than a feature it needs, and it is worth fixing whatever happens to N1 through N5. |

---

## 13. Open questions

1. **What a "case type" is, precisely.** The forum binding carries `caseTypes`, and the platform's matter types are a firm's own free-text catalogue. Matching a shipped form's proceeding against a firm's matter type is the same normalized-token problem the party-role sources solved, and it should reuse that answer rather than invent a second one — but it needs a look at what firms actually name matter types before it is settled.
2. **Whether the assembled output of a form template should stay edit-restricted.** Document protection survives the scrub (3.2). For a filed court form that may be right; for a document a paralegal must finish it is not.
3. **Whether a shipped form should ever carry its own instructions** — the "how to fill this in" prose the self-help centers publish alongside their forms is a large part of their value, and it is also the part most clearly authored rather than prescribed.
4. **Whether the register belongs in the build register.** A shipped form is a capability of sorts, and `docs/now.md` renders capabilities from the feature ledger. Five forms is not five nodes; whether the library is one node or one node per tier is a judgment about what a reader of the register wants.
