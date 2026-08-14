# Nevada — who publishes court forms, in what format, and on what terms

**Date:** 2026-08-14
**Scope:** Which bodies publish Nevada court forms, what each publishes, in what file format, and what each source says about reuse. Nevada only. Nothing here supports a claim about any other state.
**Status:** This is **research, not a spec and not a decision.** It exists to gate what may be shipped. The design it feeds is [`docs/specs/2026-08-14-nevada-court-form-library-design.md`](../specs/2026-08-14-nevada-court-form-library-design.md).
**Method:** Each source was fetched directly and its own words recorded. A term is reported as **stated** only where the publisher states it; where a publisher is silent, this document says **silent** and does not convert silence into permission. Legal conclusions about copyright are **not** drawn here — the doctrine questions are listed in section 6 and belong to counsel.

---

## 1. Summary — the one sentence that changes the design

**The two Nevada sources whose forms a firm most wants both assert copyright in their own name, and the one source that asserts nothing publishes in the only format the assembly engine can render.**

- The statewide, Supreme-Court-approved corpus (divorce, custody, guardianship, probate, name change, protection orders) is published as **fillable PDF** under an express **"All content © Supreme Court of Nevada 2026"**.
- The Clark County family and civil corpora are published by **a private nonprofit** under an express **"All content © Legal Aid Center of Southern Nevada 2026"**.
- The appellate corpus at `nvcourts.gov` is published as **`.docx`** and carries **no copyright notice and no terms-of-use page** — silence, which is not a licence.
- The Nevada Revised Statutes carry **no copyright notice**, and several statutes prescribe a form's operative text **verbatim** ("must be in substantially the following form"). That text, not a court's document, is the material with the cleanest reuse position and the material a template can be authored from.

That last point is the design's hinge: the question "may we ship a Nevada form" splits into two very different questions depending on whether the thing being shipped is **a court's published document** or **the text a statute prescribes**.

---

## 2. Source-by-source

### 2.1 Nevada Appellate Courts — appellate practice forms and pro se appellate forms

|                  |                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Publisher**    | Supreme Court of Nevada and Court of Appeals (Nevada state courts)                                                                                                                                                                                                  |
| **URLs**         | <https://nvcourts.gov/supreme/appellate_practice_forms> · <https://nvcourts.gov/supreme/self_help_pro_se_appellate_forms>                                                                                                                                           |
| **Fetched**      | 2026-08-14                                                                                                                                                                                                                                                          |
| **Format**       | **`.docx`**, with two forms in PDF (the two motion-for-stay forms)                                                                                                                                                                                                  |
| **Stated terms** | **None found.** The pages carry a `copyright-section` element that renders empty; the footer offers only "Privacy Policy", "Site Map", "ADA Assistance" and a cookie notice. No terms-of-use page, no licence, no permission statement, no attribution requirement. |

**What it publishes** (both pages, deduplicated): Notice of Appeal · Case Appeal Statement · Docketing Statement for Civil Appeal · Docketing Statement for Criminal Appeal · Certificate of Service · Certificate of Compliance for Briefs · Certificate of Compliance for Rules 40, 40A and 40B · Certificate of No Transcript Request · Certified Transcript Request · Rough Draft Transcript Request · Notice of Completion and Delivery of Transcript · Notice of Withdrawal of Appeal (civil, criminal, and pro se variants) · Stipulation to Dismiss Appeal · Streamlined Request for Extension of Time to File Brief · Affidavit in Support of Motion to Proceed in Forma Pauperis · Informal Brief Form for Pro Se Parties.

**What the files actually are, and why it matters.** Three were downloaded and opened (`Notice_of_Appeal_Form.docx`, `Certificate_of_Service_Form.docx`, `Case_Appeal_Statement_Form.docx`). They are ordinary OOXML packages carrying **legacy Word form fields** — `w:fldChar` complex fields whose instruction text is `FORMTEXT` or `FORMCHECKBOX`, each with a `w:ffData` block and a bookmark name (`Text1`, `Text2`, …) — inside `word/settings.xml` carrying `<w:documentProtection w:edit="forms" w:enforcement="1"/>`. There are **zero** content controls (`w:sdt`) and **zero** `MERGEFIELD` constructs. The visible text in the field results is the author's help text ("Click here to enter caption", "enter name of party/parties appealing", "date", "month", "year").

Verbatim, the Notice of Appeal's body as it renders (field results shown in place):

> IN THE ⟦FORMTEXT⟧ JUDICIAL DISTRICT COURT OF THE STATE OF NEVADA IN AND FOR THE COUNTY OF ⟦FORMTEXT⟧
> INDICATE FULL CAPTION: ⟦Click here to enter caption⟧
> NOTICE OF APPEAL
> Notice is hereby given that ⟦enter name of party/parties appealing⟧, ⟦enter party designation i.e. plantiff/respondent⟧ above named, hereby appeals to the Supreme Court of Nevada from the ⟦enter the name of the judgment(s) or order(s) being appealed⟧ entered in this action on the ⟦date⟧ day of ⟦month⟧, 20⟦year⟧.

(The misspelling of "plaintiff" is the court's, reproduced here exactly because a transcription that silently corrects a source is a transcription nobody can check.)

### 2.2 State of Nevada Self-Help Center — the statewide, Supreme-Court-approved corpus

|                  |                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Publisher**    | Supreme Court of Nevada. The page states "This site made possible by a grant from the Nevada Bar Foundation."                                                           |
| **URL**          | <https://selfhelp.nvcourts.gov/>                                                                                                                                        |
| **Fetched**      | 2026-08-14                                                                                                                                                              |
| **Format**       | **Fillable PDF.** File names carry the convention `<name>-pdf-fillable.pdf`.                                                                                            |
| **Stated terms** | **"All content © Supreme Court of Nevada 2026"** — an express copyright assertion in the site footer. No licence, no permission statement, no reuse terms alongside it. |

**Approval, in the publisher's own words** (`/self-help/getting-started/court-forms-fees-and-waivers/basics-of-court-forms`, fetched 2026-08-14):

> The forms on this site are all approved by the Nevada Supreme Court and are acceptable to file in any court in Nevada.

The same page is explicit that the other Nevada corpora are narrower:

> **Clark County Family Law Self-Help Center**. The Family Law Self-Help Center forms have been approved for use in the Family Court in Clark County.
> **Clark County Civil Law Self-Help Center**. The Civil Law Self-Help Center forms have been approved for use in the civil and justice courts in Clark County.
> **Washoe County Self-Help Center**. The Washoe County Self-Help Center forms have been approved for use in the Washoe County courts.

And about anything else:

> There is no guarantee that any other form you find and use will be accepted by your local court.

**Form categories:** divorce · custody, paternity and child support · legal separation · annulment · name change · guardianship · probate · adoption and termination of parental rights · miscellaneous · motions and oppositions · temporary protection orders. Translated forms are offered in Spanish, Tagalog, Chinese and Vietnamese.

**What the files actually are.** `divorce-complaint-kids-pdf-fillable.pdf` was downloaded (1.30 MB, `%PDF-1.6`). It carries **one `/AcroForm`**, **no `/XFA`**, no encryption, and 42 visible text-field names taken from the form's own vocabulary — `Visitation`, `Summer`, `MothersDay`, `FathersDay`, `ChildBirthday`, `Easter`, `Thanksgiving`, `Christmas`, `Vacation`, `Parent`, `Children`. The absence of XFA matters: the fill engine in `crates/pdf-core` reads AcroForm, so the format is mechanically fillable **once a PDF template kind exists**. The field names are the form's own text and could not be trusted to lex as merge keys, which is exactly the discovered-manifest problem already named for firm-supplied fillable forms.

**Caution recorded, because it will be hit again.** `selfhelp.nvcourts.gov` sits behind a challenge that returns HTTP 202 and a `sgcaptcha` redirect after a handful of requests from one address. A crawl of this site is not a thing to build; every retrieval in this document was hand-paced, and two attempts were rate-limited before succeeding.

### 2.3 Clark County Family Law Self-Help Center

|                  |                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Publisher**    | **Legal Aid Center of Southern Nevada, Inc.** — the site says so in its own footer: "This website was designed and is maintained by Legal Aid Center of Southern Nevada, Inc., a private, nonprofit, 501(c)(3) organization that operates the Family Law Self-Help Center through a contract with Clark County, Nevada." |
| **URL**          | <https://www.familylawselfhelpcenter.org/forms>                                                                                                                                                                                                                                                                          |
| **Fetched**      | 2026-08-14                                                                                                                                                                                                                                                                                                               |
| **Format**       | PDF                                                                                                                                                                                                                                                                                                                      |
| **Stated terms** | **"All content © Legal Aid Center of Southern Nevada 2026"** — an express copyright assertion by a **private party**, not by a court.                                                                                                                                                                                    |

**Coverage:** divorce · custody, paternity and child support · separate maintenance · annulment · motions and oppositions · name change · guardianship · adoption and termination of parental rights · domestic partnership · miscellaneous · domestic-violence protection orders, plus Spanish, Tagalog, Chinese and Vietnamese sets.

This is the corpus a Clark County family practice uses daily, and it is the one whose reuse position is worst: a nonprofit's asserted copyright in documents it drafted, published under a county contract. Nothing about the government-edicts question in section 6 reaches a private drafter's work on the face of it.

### 2.4 Clark County Civil Law Self-Help Center

Same publisher, same footer, same assertion (**"© Legal Aid Center of Southern Nevada 2026"**, fetched 2026-08-14 at <https://www.civillawselfhelpcenter.org/>). Coverage: evictions and housing · squatters and removals · small claims · harassment and protection · lawsuits for money · judgments for money · probate · foreclosure mediation · guardianship.

### 2.5 Second Judicial District Court, Washoe County

|                  |                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Publisher**    | Second Judicial District Court (a Nevada district court)                                                                                                                                                           |
| **URL**          | <https://www.washoecourts.com/Main/FormsAndPackets>                                                                                                                                                                |
| **Format**       | PDF (packets and single forms)                                                                                                                                                                                     |
| **Stated terms** | **NOT ESTABLISHED.** The forms index was not retrieved in this pass; `https://www.washoecourts.com/SelfHelp` returned 404 and the working index path was taken from a third-party guide rather than read directly. |

Two facts about it are recorded from other sources and are corroborated rather than verified: the Nevada Supreme Court Law Library's guide describes these as "Forms approved for use in the Second Judicial District Court", and the court's Resource Center sells forms at $1.00 and packets at $3.00 in person while offering the same material free online. **A court that charges for a paper copy of a form is a court whose reuse terms are worth reading before anything is copied**, and they have not been read. Nothing from this source may be shipped on the strength of this document.

### 2.6 Nevada Revised Statutes — statutory forms

|                  |                                                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Publisher**    | Nevada Legislature, Legislative Counsel Bureau                                                                                                                                                     |
| **URL**          | <https://www.leg.state.nv.us/NRS/>                                                                                                                                                                 |
| **Fetched**      | 2026-08-14; every chapter page carries the publisher's stamp `[Rev. 4/15/2026 ...--2025]`                                                                                                          |
| **Format**       | HTML statute text                                                                                                                                                                                  |
| **Stated terms** | **No copyright notice anywhere on the chapter pages fetched** (NRS 21, 40, 146, 155, 162A, 220). NRS chapter 220 governs the compilation, printing and sale of NRS and asserts no copyright in it. |

Several statutes prescribe a form's operative text **verbatim**. Two, quoted in full because they are the cleanest starter content this research found:

**NRS 155.020(3)** — notice of the hearing on the petition to administer the estate. The statute reads "The notice of the hearing upon the petition to administer the estate must be in substantially the following form:" and then sets out:

> NOTICE OF THE HEARING UPON THE PETITION TO ADMINISTER THE ESTATE
> Notice is hereby given that ................................ has filed in this court a petition for probate and for letters testamentary, or for letters of administration, of the estate of ................................, deceased, and a hearing has been set for the .......... day of the month of................, of the year......, at .......... (a.m. or p.m.) at the courthouse of the above-entitled court. All persons interested in the estate are notified to appear and show cause why the petition should not be granted.
> Dated ....................................

**NRS 155.020(4)** — notice to creditors. "The notice must be in substantially the following form:"

> NOTICE TO CREDITORS
> Notice is hereby given that the undersigned has been appointed and qualified by the (giving the title of the court and the date of appointment) as personal representative of the estate of ................................, deceased. All creditors having claims against the estate are required to file the claims with the clerk of the court within .......... (60 or 90) days after the mailing or the first publication (as the case may be) of this notice.
> Dated ....................................

Source note on NRS 155.020: `[284:107:1941; 1931 NCL § 9882.284]—(NRS A 1961, 408; 1975, 1779; 1985, 2037; 1987, 782; 1995, 2577; 1997, 1493; 1999, 2359; 2001, 164; 2003, 885; 2025, 2316)` — last amended in the 2025 session, which is the currency signal to re-check rather than the page's revision stamp.

**Others confirmed present, not transcribed here:** NRS 162A.620 ("A document substantially in the following form may be used to create a statutory power of attorney") and the companion advance-directive and related forms later in that chapter; NRS 21 carries three prescribed forms including the notice on a writ of execution for the recovery of money; NRS 40 carries a justice-court form.

**What "substantially the following form" means for the design** is a question, not an answer: it plainly permits deviation, and the size of the permitted deviation is a judgment a Nevada lawyer makes. It is recorded here so that a template author does not treat the statute's blanks as a fixed layout.

---

## 3. What is published where, at a glance

| Source                         | Publisher kind    | Format                  | Accepted where                        | Terms as published                             |
| ------------------------------ | ----------------- | ----------------------- | ------------------------------------- | ---------------------------------------------- |
| `nvcourts.gov` appellate forms | State court       | **`.docx`** (2 PDFs)    | Supreme Court and Court of Appeals    | **Silent** — no notice, no terms page          |
| `selfhelp.nvcourts.gov`        | State court       | Fillable PDF (AcroForm) | "any court in Nevada"                 | **© Supreme Court of Nevada 2026**             |
| `familylawselfhelpcenter.org`  | Private nonprofit | PDF                     | Clark County Family Court             | **© Legal Aid Center of Southern Nevada 2026** |
| `civillawselfhelpcenter.org`   | Private nonprofit | PDF                     | Clark County civil and justice courts | **© Legal Aid Center of Southern Nevada 2026** |
| `washoecourts.com`             | State court       | PDF                     | Second Judicial District Court        | **Not established**                            |
| `leg.state.nv.us/NRS`          | Legislature       | HTML statute text       | n/a — it is the prescribed text       | **Silent, and no notice anywhere**             |

---

## 4. Currency — how each source moves

- **Statutory forms move by legislative session.** The operative signal is the statute's own bracketed source note (NRS 155.020 was last touched in 2025), not the page's `[Rev. ...]` stamp, which tracks the compilation. This is the same distinction the Nevada trust-accounting research already recorded for court rules, and it holds here for the same reason.
- **Court forms move by court order, on no calendar.** A form revised by an administrative order changes without any statute changing, and nothing on the publisher's page announces it — the appellate `.docx` files carry no version stamp in their visible text and their `docProps` are not a reliable revision signal for a redistributed copy.
- **Approval is not currency.** "Approved by the Nevada Supreme Court" says a form was blessed; it does not say when, and it does not say the blessing survives the next rule amendment.

The consequence for any shipped library is that **re-verification has to be a scheduled obligation on us**, expressed as a check that fails, rather than a note in a document. No source in this list emits a machine-readable currency signal.

---

## 5. Format versus what the engine can render

Recorded here because it decides what a starter library can contain at all, independent of the licensing answer.

| Corpus               | Format                                                                            | Renderable by the assembly engine today                                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appellate forms      | `.docx` with legacy `FORMTEXT` / `FORMCHECKBOX` fields under `documentProtection` | **No.** The normalizer recognizes `{{key}}` delimiters and `MERGEFIELD` instructions; every other field instruction is left exactly as authored. A `FORMTEXT` field binds nothing, appears in no manifest, and is reported by no absence. |
| Statewide self-help  | Fillable PDF (AcroForm, no XFA)                                                   | **No.** There is no `pdfForm` template kind, no AcroForm manifest, and no fill step on the assembly path.                                                                                                                                 |
| Clark County corpora | PDF                                                                               | **No**, same reason.                                                                                                                                                                                                                      |
| Statutory text       | HTML                                                                              | **Not applicable** — a template is authored from it, and an authored `.docx` using `{{key}}` delimiters is exactly what the engine does render.                                                                                           |

---

## 6. Questions this research does not answer, and must not

These are legal judgments. They are listed so they are asked of counsel rather than assumed by a build.

1. **Does the government-edicts doctrine reach a court-approved form?** _Georgia v. Public.Resource.Org_, 590 U.S. 255 (2020), holds that works produced by legislators and judges in the course of their official duties are uncopyrightable. Whether a fill-in-the-blank form promulgated by a court's administrative office is such a work, or is instead an ordinary compilation the court may own, is not settled by anything read here. Note that federal works are outside copyright by statute (17 U.S.C. § 105) and **state works are not** — so the federal-forms intuition does not transfer.
2. **Does an express "© Supreme Court of Nevada" notice change the analysis?** A notice is an assertion, not an adjudication, but it is also the publisher's stated position and the thing a firm would be acting against.
3. **A nonprofit's drafting under a county contract.** Legal Aid Center of Southern Nevada's forms are not obviously anyone's edict. The question is whether the county contract places them anywhere else.
4. **"Substantially the following form."** How far a template may depart from prescribed statutory text before it stops satisfying the statute.
5. **Is reproducing the prescribed text of a statute in a template a use of the statute or of the court's document?** This is the question the design leans on hardest, and it wants an explicit answer.
6. **Whether permission is obtainable and worth seeking.** Both copyright-asserting publishers are reachable and both exist to make these forms used. A written permission would convert the largest and most useful corpora from unshippable to shippable, and asking costs a letter.

Until 1 through 5 are answered by counsel, this document supports shipping **only** material authored from statutory text under section 2.6, and supports shipping **nothing** from sections 2.2 through 2.5.

---

## 7. What was retrieved, and how

Every retrieval below was made on 2026-08-14.

| Retrieved                                                                                            | Result                                   |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `selfhelp.nvcourts.gov/self-help/getting-started/court-forms-fees-and-waivers/basics-of-court-forms` | 200, read in full                        |
| `selfhelp.nvcourts.gov/forms/*` (three category pages)                                               | 202 challenge — **not read**             |
| `selfhelp.nvcourts.gov/images/divorce/divorce-complaint-kids-pdf-fillable.pdf`                       | 200 after back-off, structure inspected  |
| `nvcourts.gov/supreme/appellate_practice_forms`                                                      | 200, read in full, file links enumerated |
| `nvcourts.gov/supreme/self_help_pro_se_appellate_forms`                                              | 200, read in full, file links enumerated |
| Three appellate `.docx` forms                                                                        | 200, opened and inspected                |
| `familylawselfhelpcenter.org/forms`                                                                  | 200, read in full including footer       |
| `civillawselfhelpcenter.org`                                                                         | 200, footer read                         |
| `washoecourts.com/SelfHelp`                                                                          | 404 — **forms index not read**           |
| `leg.state.nv.us/NRS/NRS-155.html`, `-146`, `-162A`, `-021`, `-040`, `-220`                          | 200, read                                |

Nothing in this document rests on a search-engine summary. Where only a summary was available — the Washoe County terms, the Nevada Supreme Court Law Library's characterization of them — the claim is labelled as not established.
