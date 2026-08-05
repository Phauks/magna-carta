# Nevada — custody, delivery and lodging of wills: primary-source findings

**Date:** 2026-08-05
**Scope:** What Nevada law requires of a person (including an attorney) who holds a will, before and after the testator's death, and what that supports encoding in the custodian subsystem's jurisdiction-keyed deadline catalog.
**Status:** This is **research, not a spec and not a decision.** Nothing here is built. It exists to gate what may be encoded: the catalog's contract is refuse-rather-than-guess, so a Nevada entry is only permitted for a fact this document marks VERIFIED.
**Method:** Primary sources only — the official Nevada Revised Statutes and Nevada court rules as published by the Nevada Legislature at `leg.state.nv.us`, and the Nevada Rules of Professional Conduct from the same publisher. Every operative claim below carries the exact citation, a verbatim quote, the URL fetched, and the date fetched. Where a source could not be read, the claim is marked UNVERIFIED and no substitute paraphrase was accepted.

**Currency of every Nevada Legislature page fetched for this document:** each carries the publisher's revision stamp **`[Rev. 4/15/2026 ... --2025]`** — that is, compiled through the **2025 (83rd) regular session**. Section 8 explains what that stamp means for maintenance.

---

## 1. Summary — the answer in one paragraph

**Nevada gives a will-holder 30 days.** Under **NRS 136.050(1)**, any person having possession of a will must, within 30 days after learning that the testator has died, deliver it either to the clerk of the district court with jurisdiction **or** to the personal representative named in the will. The statute says "any person" — there is no attorney-specific rule and no attorney exemption, so an attorney holding a client's original will is squarely inside it. The sanction is **civil, not criminal**: NRS 136.050(3) makes a holder who neglects the duty without reasonable cause liable to every person interested in the will for the damages caused. A separate section, **NRS 136.060**, lets the court order production of a will alleged to be in a third person's hands, and a holder who refuses that order may be jailed until they produce it. Nevada has **no lifetime will-deposit statute** — nothing lets a testator lodge a will with a court for safekeeping before death (section 3). The requirement to lodge the _original_ will with a probate petition is a **local court rule**, not a statute (section 4).

**The single most important negative finding:** a web search for Nevada lifetime will deposit returns a confident summary asserting that "A will may be deposited by the testator or his agent with any court for safekeeping…" — **uniform-act language that Nevada has not enacted. It is not Nevada law.** It must not be encoded. Section 3 records the search that establishes the absence.

---

## 2. Statute (binding) — custody and delivery after death

### 2.1 NRS 136.050 — the operative deadline

**Citation:** NRS 136.050, "Delivery of will after death; liability for nondelivery; record of will; inspection of records."
**Source:** <https://www.leg.state.nv.us/NRS/NRS-136.html> (anchor `NRS136Sec050`), fetched 2026-08-05, page stamp `[Rev. 4/15/2026 11:12:16 AM--2025]`.
**Verified:** yes.

Verbatim, in full:

> 1.  Any person having possession of a will shall, within 30 days after knowledge of the death of the person who executed the will, deliver it to the clerk of the district court which has jurisdiction of the case or to the personal representative named in the will.
> 2.  Any person named as personal representative in a will shall, within 30 days after the death of the testator, or within 30 days after knowledge of being named, present the will, if in possession of it, to the clerk of the court.
> 3.  Every person who neglects to perform any of the duties required in subsections 1 and 2 without reasonable cause is liable to every person interested in the will for the damages the interested person may sustain by reason of the neglect.
> 4.  A will that is delivered or presented pursuant to subsection 1 or 2 becomes part of the permanent record maintained by the clerk of the court, whether or not a petition for the probate of the will is filed.
> 5.  A will that is part of the permanent record maintained by the clerk of the court becomes a court record open to inspection unless the will is sealed pursuant to Part VII of the Nevada Supreme Court Rules.

Source note as published: `[2:107:1941; 1931 NCL § 9882.02] + [3:107:1941; 1931 NCL § 9882.03] + [4:107:1941; 1931 NCL § 9882.04]—(NRS A 1999, 2263; 2015, 961)` — i.e. **last amended in 2015**.

What this settles, precisely:

| Question                 | Answer from the text                                                                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who owes the duty        | "**Any person** having possession of a will" — no professional qualifier, no attorney carve-out, no carve-out for a custodian holding under a written custody agreement.                                                                           |
| What triggers the clock  | "**knowledge of the death**" of the testator — knowledge, not the death itself. An unaware holder's clock has not started.                                                                                                                         |
| The deadline             | **30 days** after that knowledge.                                                                                                                                                                                                                  |
| Delivery target          | **Either** "the clerk of the district court which has jurisdiction of the case" **or** "the personal representative named in the will." The statute writes "or" — it is a choice.                                                                  |
| Second, distinct duty    | Subsection 2 binds a person **named as personal representative**: 30 days after the death **or** 30 days after learning of the nomination, present the will **to the clerk only** — the alternative target is not offered here.                    |
| Penalty                  | Civil liability to "every person interested in the will" for damages caused by the neglect, unless the neglect was "without reasonable cause" is negated — i.e. **reasonable cause is a defence**. No fine, no criminal penalty in this section.   |
| What happens on delivery | The will becomes part of the clerk's **permanent record whether or not** a probate petition is ever filed (subsection 4), and is then **open to public inspection** unless sealed under Part VII of the Nevada Supreme Court Rules (subsection 5). |

Two consequences worth carrying into design, both read directly off the text. First, **delivery is not the same as filing a probate petition** — subsection 4 says so expressly. A holder discharges the duty by handing the will over even where nobody probates it. Second, **delivering to the clerk publishes the will**; delivering to the named personal representative does not. That is a real client-facing consequence of which target the firm chooses, and it is a choice the statute leaves open.

### 2.2 NRS 136.060 — compelled production, and the only confinement sanction

**Citation:** NRS 136.060, "Order to produce will; penalty for failure to comply with order."
**Source:** <https://www.leg.state.nv.us/NRS/NRS-136.html> (anchor `NRS136Sec060`), fetched 2026-08-05.
**Verified:** yes.

Verbatim, in full:

> 1.  If it is alleged in any petition that the will of a decedent is in the possession of a third person, and the court is satisfied that the allegation is correct, an order must be issued and served upon the person having possession of the will, requiring that person to produce it at a time to be named in the order.
> 2.  Any person having the possession of a will who neglects or refuses to produce it in obedience to such an order may, by warrant from the court, be committed to the county jail, and be kept in close confinement until the person produces the will. The court may make all other necessary orders at chambers to enforce the production of the will.

This is a **court-ordered deadline, not a statutory one** — "at a time to be named in the order." It is therefore not catalogable as a fixed interval; it is a state the custodian record can be in (under a production order), with a date supplied by the order itself.

### 2.3 NRS 136.070 — a non-holder can still petition

**Citation:** NRS 136.070(2).
**Source:** <https://www.leg.state.nv.us/NRS/NRS-136.html> (anchor `NRS136Sec070`), fetched 2026-08-05.
**Verified:** yes.

> 2.  A personal representative named in a will, though not in possession of the will, may present a petition to the district court having jurisdiction, requesting that the person in possession of the will be required to produce it so that it may be admitted to probate and letters may be issued.

Relevant because it is the mechanism that feeds NRS 136.060: the route by which a firm holding a will learns it is subject to a production order.

### 2.4 No criminal statute for non-delivery

**Verified negative.** The full text of NRS chapter 205 (Crimes Against Property) was fetched (<https://www.leg.state.nv.us/NRS/NRS-205.html>, 2026-08-05) and searched for any offence of concealing, suppressing, or destroying a will. The only section mentioning a will is **NRS 205.090** (forgery of "any … will, testament, codicil …"), which addresses falsification, not withholding. **So the exposure for late or non-delivery under NRS 136.050 is civil damages plus, once a court order exists, confinement under NRS 136.060(2) — nothing else was found.**

---

## 3. Statute (binding) — pre-death deposit: Nevada has none

**Finding: NEGATIVE, and stated affirmatively. Nevada provides no procedure for depositing a will with a court during the testator's lifetime.**

A negative claim needs its search recorded, because the honest basis for it is exhaustiveness, not a citation. What was searched, all on 2026-08-05:

1. **The whole of NRS Title 12 (Wills and Estates of Deceased Persons)** — every chapter fetched in full from `leg.state.nv.us/NRS/`: 132, 133, 133A, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156. Searched case-insensitively for `safekeeping`, `safe keeping`, `safe-deposit`, and `deposit(ed|s) the/a will`.
   **Hits: two, both in NRS chapter 133A (International Wills), and neither is a court deposit.** NRS 133A.070(3): "The authorized person shall ask the testator whether he or she wishes to make a declaration concerning the safekeeping of the will. If so, and at the express request of the testator, the place where the testator intends to have the will kept must be mentioned in the certificate provided for in NRS 133A.080." That records _where the testator says the will will be kept_; it creates no depository and imposes no duty on a court. The second hit is the same phrase inside the statutory certificate form at NRS 133A.080.
2. **NRS chapter 133 (Wills) section by section** — the chapter runs 133.020 through 133.340. There is no deposit section. The chapter's custody provisions are the qualified-custodian scheme for **electronic** wills only (section 5 below).
3. **NRS chapter 133A (International Wills)** — the chapter **ends at NRS 133A.120** ("Persons authorized to act in relation to international will"). It contains **no registry and no depository**: its sections cover the short title, definitions, validity, execution requirements, the certificate, the effect of the certificate, revocation, source and construction, and who may act. Nothing in it lets a will be filed anywhere.
4. **NRS chapters 246 (County Clerks) and 247 (County Recorders)** — fetched and searched; no will-deposit duty. Chapter 246 contains two incidental uses of the word "will" and no deposit function.
5. **Court rules** — the statewide District Court Rules (`CourtRules/DCR.html`), the Eighth Judicial District Court Rules (Clark County), and the Second Judicial District Court Rules (Washoe County), all fetched 2026-08-05 and searched for `safekeeping` and `deposit`. Every hit is about deposits of jurors' fees, depositions, or bonds. **No court rule establishes a will depository either.**

**Why absence is the honest answer, not a gap in the search.** A lifetime deposit procedure cannot exist without somewhere saying who receives the will, on what terms it is released, and to whom on death — text of exactly the kind that Uniform Probate Code states supply. Nevada's probate code is not the Uniform Probate Code. Searching the entire title that would have to house such a provision, plus the clerk and recorder chapters that would have to implement it, plus the court rules that would have to administer it, and finding nothing but the international-will _declaration of intended location_, is as close to a conclusive negative as a statutory search gets.

**Explicit warning for anyone re-doing this research.** A general web search for "Nevada deposit of will with court during lifetime" returns a fluent summary asserting that "A will may be deposited by the testator or his agent with any court for safekeeping pursuant to the rules of the court," that during the testator's lifetime it "must be delivered only to the testator or to a person authorized in writing," and that on death "the court shall notify any person designated to receive the will." **That text is not Nevada law.** What is verified is the negative: it was checked against the actual chapters and appears nowhere in the NRS. Its wording matches the Uniform Probate Code's will-deposit sections (§§ 2-515, 2-516) — **that attribution is an identification, not a verified citation**, since the uniform act itself was not fetched; nothing turns on it, because the operative point is that Nevada has not enacted the text wherever it comes from. It is exactly the failure mode the catalog's refuse-rather-than-guess contract exists to prevent, and it is recorded here so the same search does not mislead the next reader.

---

## 4. Court rule (binding locally, not statewide) — lodging the original will

**The probate statute does not require producing the original will. The local rules do.**

**NRS 136.090(1)** ("Petition for probate: Requirements; effect of defect", fetched 2026-08-05) enumerates what a petition **must state** — jurisdictional facts, whether the named personal representative consents, names and residences of heirs and devisees, character and estimated value of the estate property, the person for whom letters are requested and any felony conviction, any deceased devisee, and how the chosen district court is a convenient forum. **It says nothing about producing, attaching, or lodging the will itself.** The original-will requirement lives in judicial-district rules:

**Eighth Judicial District (Clark County) — EDCR Rule 4.40, "Petitions for probate of wills and/or codicils."**
Source: <https://www.leg.state.nv.us/CourtRules/EighthDCR.html>, fetched 2026-08-05, page stamp `[Rev. 4/15/2026 4:38:48 PM--2025]`. Verified.

> (a) When a petition for probate of a will and/or a codicil is filed and the original of the instrument being offered for probate is not already lodged with the clerk of the court, it must be lodged concurrently with the filing of the petition. If the instrument is holographic, a typewritten copy of the instrument must also accompany the petition. …
>
> (b) In addition to lodging the original instrument with the clerk of the court, copies of any documents offered for probate must be attached to the petition for examination by the probate commissioner.

**Second Judicial District (Washoe County) — Rule 57.7, "Petitions for probate of wills and/or codicils."**
Source: <https://www.leg.state.nv.us/CourtRules/SecondDCR.html>, fetched 2026-08-05, page stamp `[Rev. 4/15/2026 4:39:52 PM--2025]`. Verified.

> 1.  When a petition for probate of will and/or codicil is filed and the original of the document being offered for probate is not already filed with the filing office, it must be filed concurrently with the petition. If the will is holographic, a typewritten copy of the document must also accompany the petition. …
> 2.  In addition to filing the original document with the filing office, copies of any documents offered for probate must be attached to the petition for examination by the probate commissioner.

Note the phrase both rules share: "**not already lodged/filed**". That is the seam between this rule and NRS 136.050 — a will already delivered to the clerk under the 30-day duty is by then part of the clerk's permanent record (NRS 136.050(4)) and does not need lodging again.

**Design consequence: the lodging obligation is county-scoped, not state-scoped.** Nevada has eleven judicial districts; two were verified here, and they are the two that between them cover the overwhelming majority of Nevada probate filings. **Nothing in this document establishes what the other nine require** — see section 8.

Related statutory backstop, verified: **NRS 136.180** (proof of will by copy) and **NRS 136.230–136.240** (jurisdiction and petition for a lost or destroyed will) exist, which is why loss of an original is a recoverable but expensive event rather than a fatal one.

---

## 5. Statute (binding) — the electronic-will qualified custodian scheme

Nevada is one of the few states with a statutory custodian role for electronic wills, and it is directly on point for a product that would hold client wills. **This is custody by a private custodian; it is not a court deposit and is not an answer to section 3.** Recorded here because it is the nearest Nevada analogue and it imposes real duties.

**Definition.** NRS 132.286: "'Qualified custodian' means a person who meets the requirements of NRS 133.320." (Source: <https://www.leg.state.nv.us/NRS/NRS-132.html>, fetched 2026-08-05.) Verified.

**NRS 133.300(1)–(2)** — "A person must execute a written statement affirmatively agreeing to serve as the qualified custodian of an electronic will before he or she may serve in such a capacity." / "A qualified custodian may not cease serving in such a capacity until the requirements of NRS 133.310 have been met." Verified.

**NRS 133.320(1)** — the standing duties. Verbatim, in relevant part:

> A qualified custodian of an electronic will:
>
> (a) Must not be an heir of the testator or a beneficiary or devisee under the electronic will.
>
> (b) Shall consistently employ, and store electronic records of electronic wills in, a system that protects electronic records from destruction, alteration or unauthorized access and detects any change to an electronic record.
>
> (c) Shall store in the electronic record of an electronic will each of the following: (1) A photograph or other visual record of the testator and the attesting witnesses that was taken contemporaneously with the execution of the electronic will; (2) A photocopy, photograph, facsimile or other visual record of any documentation that was taken contemporaneously with the execution of the electronic will and provides satisfactory evidence of the identities of the testator and the attesting witnesses …; and (3) An audio and video recording of the testator, attesting witnesses and notary public, as applicable, taken at the time [each] placed his or her electronic signature on the electronic will …
>
> (d) Shall provide to any court that is hearing a matter involving an electronic will which is currently or was previously stored by the qualified custodian any information requested by the court pertaining to the qualifications of the qualified custodian and the policies and practices of the qualified custodian concerning the maintenance, storage and production of electronic wills.

**NRS 133.330(1)** — access control, including the death trigger:

> With regard to an electronic record of an electronic will, a qualified custodian shall provide access to or information concerning the electronic will or the certified paper original of the electronic will only to:
>
> (a) The testator or another person as directed by the written instructions of the testator; and
>
> (b) After the death of the testator, the nominated personal representative of the testator or any interested person.

**Note the asymmetry with NRS 136.050: NRS 133.330(1)(b) carries no deadline.** It is a duty to provide access on the occurrence of death, not a duty to act within an interval. The 30-day clock a custodian faces on death is the NRS 136.050 one.

**Deadlines that do exist in this scheme** (all verified from <https://www.leg.state.nv.us/NRS/NRS-133.html>, fetched 2026-08-05, and all lifetime-side, notice-to-testator periods rather than death-triggered duties):

- **NRS 133.310(2)(a)(2)** — a custodian resigning of its own motion must give "the testator 30 days' written notice that the qualified custodian has decided to cease serving in such a capacity and designating the successor qualified custodian"; **NRS 133.310(4)** lets the testator override that designation inside the same 30 days.
- **NRS 133.340(1)(b)** — converting an electronic will to a certified paper original without the testator's direction requires "30 days' written notice to the testator."
- **NRS 133.330(2)(a)** — destruction is permitted no earlier than "One year after notice of entry of an order admitting any will to probate"; paragraphs (c)–(d) permit destruction after "30 days' written notice to the testator" in the converted/revoked cases, and **NRS 133.330(4)** requires that "Before destroying an electronic will or an electronic revocation, the qualified custodian shall make reasonable efforts to provide to the testator the electronic record."
- **NRS 133.320(2)** — the service rule for all of the above: "if a qualified custodian or other person is required to provide written notice to a testator, notice shall be deemed to be provided if the qualified custodian or other person delivers written notice to the last known address of the testator."

Source notes: NRS 133.300, 133.310, 133.320, 133.330 and 133.340 were all added by the 2017 session and **amended in 2021**.

**One venue effect worth flagging.** NRS 136.185(1): an electronic will "may be proved and letters granted in the county in which the decedent was a resident at the time of his or her death **or the domicile or registered office of the qualified custodian exists**." Serving as a qualified custodian therefore drags venue toward the custodian's own location — a consequence of the role, not of the will.

---

## 6. Rules of Professional Conduct and bar guidance (labeled: not statute)

### 6.1 Binding — Nevada Rules of Professional Conduct

The NRPC are Nevada's Rule 1.15 analogue and are court rules, binding on Nevada lawyers, but they are **not the will statute** and do not set the delivery deadline.

**NRPC Rule 1.15, "Safekeeping Property," paragraph (a).**
Source: <https://www.leg.state.nv.us/CourtRules/RPC.html>, fetched 2026-08-05, page stamp `[Rev. 4/15/2026 4:39:35 PM--2025]`. Verified.

> (a) A lawyer shall hold funds or other property of clients or third persons that is in a lawyer's possession in connection with a representation separate from the lawyer's own property. All funds received or held for the benefit of clients by a lawyer or firm, including advances for costs and expenses, shall be deposited in one or more identifiable bank accounts designated as a trust account maintained in the state where the lawyer's office is situated, or elsewhere with the consent of the client or third person. **Other property in which clients or third persons hold an interest shall be identified as such and appropriately safeguarded. Complete records of such account funds and other property shall be kept by the lawyer and shall be preserved for a period of five years after termination of the representation.**

(Emphasis added; the emphasised sentences are the ones that reach an original will, which is "other property" rather than funds.) Rule 1.15(d) adds the delivery-on-request duty: "**upon request by the client or third person, shall promptly render a full accounting regarding such property**," preceded by "a lawyer shall promptly deliver to the client or third person any funds or other property that the client or third person is entitled to receive." Source note: `[Added; effective May 1, 2006; amended; effective April 19, 2021.]`

**NRPC Rule 1.16(d)** — the end-of-representation duty, same source, verified:

> (d) Upon termination of representation, a lawyer shall take steps to the extent reasonably practicable to protect a client's interests, such as giving reasonable notice to the client, allowing time for employment of other counsel, **surrendering papers and property to which the client is entitled** and refunding any advance payment of fee or expense that has not been earned or incurred. The lawyer may retain papers relating to the client to the extent permitted by other law.

**Nevada Supreme Court Rule 78(1)(b)** (same publisher, <https://www.leg.state.nv.us/CourtRules/SCR.html>, fetched 2026-08-05) sets a **five-year** preservation period for trust-account records "after final disposition of the underlying matter." Verified — noted because it is the only numeric retention period found in the current Supreme Court Rules, and it is about **financial records**, not documents.

**Nevada Supreme Court Rule 118** — "Appointment of counsel to protect client's interest" — verified from the same source. It lets the chief or presiding judge, on the state bar's application, appoint a disinterested attorney "to examine and inventory the attorney's files and to take such action as is necessary to protect the interests of the attorney and the attorney's clients" when an attorney has "been transferred to disability inactive status, abandoned their practice, resigned, died, or been suspended or disbarred." Source note: `[Added; effective February 15, 1979; amended; effective October 26, 2023.]` This is the Nevada answer to "what happens to the wills the firm holds if the firm stops existing," and it is a court-appointment mechanism, not an automatic transfer.

### 6.2 Non-binding guidance — State Bar of Nevada formal opinions

**Labeled clearly: these are ethics-committee opinions, not statutes and not court rules. They are persuasive guidance only.**

**Formal Opinion No. 28** (State Bar of Nevada, Standing Committee on Ethics and Professional Responsibility), "originally issued 11/19/02, conclusion amended 9/24/07."
Source: <https://nvbar.org/wp-content/uploads/opinion_28.pdf>, fetched 2026-08-05 (retrieved directly; the same URL returns HTTP 403 to a plain fetcher). Text verified from the PDF's own text layer.

The question and the answer that matter here, verbatim from the opinion:

> 5. If counsel returns non-reproducible documents in a matter to the client, may counsel destroy the balance of the file that is replicable if required? …

> 6. For both policyholder-clients and non-insurance defense clients, counsel is under an obligation to retain non-reproducible file items for the agreed period of retention and should provide the client with copies rather than non-replicable originals. Replicable file materials such as hardcopy of cases or documents retained in other files may be discarded when they are no longer necessary to the representation.

And on the retention period, verbatim:

> 5. For both policyholder-clients and non-insurance defense clients, counsel and client may agree to a period of file retention shorter than the presumptive seven years provided for by Nevada SCR 165(1). However, counsel must consult with the client, adequately explaining the risks of any shorter retention period and the selected retention period must be reasonable. The Committee believes that no retention agreement for a period of less than four years, the applicable limitations period for legal malpractice claims, can reasonably provide sufficient protection to the client …

**Important caveat, and it is why this opinion cannot be encoded as a rule.** The opinion's retention holding rests on **SCR 165**, an old Nevada Supreme Court Rule from the pre-2006 ethics regime. The **current** Supreme Court Rules compilation as published (<https://www.leg.state.nv.us/CourtRules/SCR.html>, fetched 2026-08-05) **contains no Rule 165** — the three-digit rules in that compilation run 100 through 122, and a full-text search for "Rule 165" returns nothing. The Nevada Rules of Professional Conduct replaced the SCR 150–203 ethics rules effective May 1, 2006, and **the current NRPC contain no general client-file retention period at all** (only NRPC 1.15(a)'s five-year record-keeping duty and SCR 78(1)(b)'s five-year trust-records duty). **So the "seven years" figure in Opinion 28 traces to a rule that no longer appears in the published rules. Treat it as historical guidance, not a live requirement, and do not encode it.**

**Formal Opinion No. 33** (02/09/06), listed by the State Bar under the subject "Safekeeping Property," with the Bar's own one-line summary on its opinions index: "A lawyer may, without client consent, store client files in an electronic format or on a server or other device that is not exclusively in the lawyer's c…" (truncated as published on the index page; source <https://nvbar.org/for-lawyers/ethics-discipline/ethics-opinions/>, fetched 2026-08-05).
**Status: UNVERIFIED as to its full text.** The opinion PDF (<https://nvbar.org/wp-content/uploads/opinion_33.pdf>) is a **scanned image with no text layer** (produced 2006-02-09 on a Xerox WCP 55; every page object is a `CCITTFaxDecode` image), and no optical character recognition was available here. Its subject and date are verified from the Bar's own index; **its holding is not, and nothing from it is encoded.** It is flagged because an opinion permitting electronic storage of client files bears directly on a cloud document platform and should be read properly before the custodian subsystem's storage design is finalised.

---

## 7. Catalog entries this supports

Each row is a candidate entry for the jurisdiction-keyed deadline catalog. **Only rows marked VERIFIED may be encoded.** Where the catalog needs a field the sources do not supply, the field says so rather than inventing a value.

### Entry NV-1 — the will-holder's delivery duty (the primary entry)

| Field            | Value                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Jurisdiction key | `US-NV` (statewide)                                                                                                                                                                        |
| Trigger event    | Duty holder acquires **knowledge of the testator's death** — not the death itself                                                                                                          |
| Duty holder      | Any person in possession of the will, expressly including an attorney or firm holding it in custody (statute says "any person"; no professional carve-out exists)                          |
| Deadline         | **30 days** from the trigger                                                                                                                                                               |
| Delivery target  | **Either** the clerk of the district court having jurisdiction **or** the personal representative named in the will — a genuine either/or, both discharge the duty                         |
| Penalty          | Civil liability to every person interested in the will for damages sustained by reason of the neglect; **defence:** neglect with "reasonable cause". No criminal penalty found             |
| Side effects     | Delivery to the clerk makes the will part of the permanent record whether or not probate is petitioned, and a public record unless sealed under Part VII of the Nevada Supreme Court Rules |
| Citation         | NRS 136.050(1), (3), (4), (5)                                                                                                                                                              |
| Verified on      | 2026-08-05, <https://www.leg.state.nv.us/NRS/NRS-136.html>, page compiled through the 2025 session                                                                                         |
| Status           | **VERIFIED**                                                                                                                                                                               |

### Entry NV-2 — the named personal representative's presentation duty

| Field            | Value                                                                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jurisdiction key | `US-NV` (statewide)                                                                                                                                                                                                                       |
| Trigger event    | **Earlier-satisfied of two:** the testator's death, **or** the duty holder's knowledge of being named personal representative                                                                                                             |
| Duty holder      | The person named as personal representative in the will, **if in possession of it**                                                                                                                                                       |
| Deadline         | **30 days** from either trigger                                                                                                                                                                                                           |
| Delivery target  | **The clerk of the court only** — the NV-1 alternative of delivering to the personal representative is, self-evidently, not offered here                                                                                                  |
| Penalty          | Same as NV-1: civil liability under NRS 136.050(3)                                                                                                                                                                                        |
| Citation         | NRS 136.050(2), (3)                                                                                                                                                                                                                       |
| Verified on      | 2026-08-05, <https://www.leg.state.nv.us/NRS/NRS-136.html>                                                                                                                                                                                |
| Status           | **VERIFIED** — but note the trigger is genuinely two-headed and the statute does not say which controls when both occur; encode both dates and take the earlier only if the catalog's semantics permit an explicitly conservative reading |

### Entry NV-3 — compelled production under court order

| Field            | Value                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jurisdiction key | `US-NV` (statewide)                                                                                                                                |
| Trigger event    | Service of a court order to produce, issued after a petition alleges the will is in a third person's possession                                    |
| Duty holder      | The person having possession of the will                                                                                                           |
| Deadline         | **Set by the order — "at a time to be named in the order."** Not a fixed statutory interval                                                        |
| Delivery target  | The court                                                                                                                                          |
| Penalty          | Commitment to the county jail by warrant, "kept in close confinement until the person produces the will"                                           |
| Citation         | NRS 136.060(1), (2)                                                                                                                                |
| Verified on      | 2026-08-05, <https://www.leg.state.nv.us/NRS/NRS-136.html>                                                                                         |
| Status           | **VERIFIED as to the duty; NOT ENCODABLE as a computed deadline** — model it as a state with an externally supplied due date, never as an interval |

### Entry NV-4 — lodging the original will with a probate petition (county-scoped)

| Field            | Value                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jurisdiction key | `US-NV-08` (Eighth Judicial District, Clark County) and `US-NV-02` (Second Judicial District, Washoe County) — **not statewide**                                |
| Trigger event    | Filing a petition for probate of a will or codicil                                                                                                              |
| Duty holder      | The petitioner                                                                                                                                                  |
| Deadline         | **Concurrent with filing**, unless the original is already lodged/filed with the clerk or filing office                                                         |
| Delivery target  | Eighth: "the clerk of the court". Second: "the filing office"                                                                                                   |
| Extra            | If the instrument is holographic, a typewritten copy must accompany the petition; copies of all documents offered must be attached for the probate commissioner |
| Penalty          | None stated in the rule                                                                                                                                         |
| Citation         | EDCR 4.40(a)–(b); Second Judicial District Court Rule 57.7(1)–(2)                                                                                               |
| Verified on      | 2026-08-05, <https://www.leg.state.nv.us/CourtRules/EighthDCR.html> and <https://www.leg.state.nv.us/CourtRules/SecondDCR.html>                                 |
| Status           | **VERIFIED for these two districts only.** Encoding this as `US-NV` statewide would be a fabrication — the other nine districts were not checked                |

### Entry NV-5 — no lifetime deposit

| Field                  | Value                                                                                                                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jurisdiction key       | `US-NV`                                                                                                                                                                                                                                                                            |
| Capability             | Deposit of a will with a court during the testator's lifetime                                                                                                                                                                                                                      |
| Value                  | **Not available in Nevada.** No statute or court rule provides for it                                                                                                                                                                                                              |
| Basis                  | Full-text search of all 26 chapters of NRS Title 12, NRS chapters 246 and 247, and the statewide plus Eighth and Second district court rules; only hits were the international-will _declaration of intended location_ at NRS 133A.070(3) and the certificate form at NRS 133A.080 |
| Trap to encode against | Uniform-act will-deposit language circulates in search results as though it were Nevada law. It is not                                                                                                                                                                             |
| Verified on            | 2026-08-05                                                                                                                                                                                                                                                                         |
| Status                 | **VERIFIED NEGATIVE** — encode as an explicit "not available" so the engine refuses rather than falls through to a default                                                                                                                                                         |

### Entry NV-6 — electronic-will qualified custodian obligations

| Field                | Value                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jurisdiction key     | `US-NV`                                                                                                                                                                                                                                                                                                                                                                                                               |
| Applies when         | The firm has executed a written statement agreeing to serve as qualified custodian of an **electronic** will (NRS 133.300(1)) — never by default                                                                                                                                                                                                                                                                      |
| Death-triggered duty | Provide access to the electronic will or its certified paper original to the nominated personal representative or any interested person, **on death, with no statutory deadline** (NRS 133.330(1)(b))                                                                                                                                                                                                                 |
| Lifetime deadlines   | 30 days' written notice to the testator to resign and designate a successor (NRS 133.310(2)(a)(2)), with a testator override inside the same 30 days (NRS 133.310(4)); 30 days' written notice to convert to a certified paper original absent the testator's direction (NRS 133.340(1)(b)); destruction no earlier than one year after notice of entry of an order admitting any will to probate (NRS 133.330(2)(a)) |
| Standing duties      | Storage system that "protects electronic records from destruction, alteration or unauthorized access and detects any change"; retention of the execution photograph, identity documentation, and audio/video recording; disqualification if an heir, beneficiary, or devisee; production of qualifications and practices to a court on request (NRS 133.320(1))                                                       |
| Notice mechanics     | Written notice to the testator's **last known address** is deemed provided (NRS 133.320(2))                                                                                                                                                                                                                                                                                                                           |
| Venue effect         | Serving as qualified custodian makes the custodian's domicile or registered office an alternative venue for proving the will (NRS 136.185(1))                                                                                                                                                                                                                                                                         |
| Citation             | NRS 132.286; NRS 133.300, 133.310, 133.320, 133.330, 133.340; NRS 136.185(1)                                                                                                                                                                                                                                                                                                                                          |
| Verified on          | 2026-08-05, <https://www.leg.state.nv.us/NRS/NRS-133.html>, <https://www.leg.state.nv.us/NRS/NRS-132.html>, <https://www.leg.state.nv.us/NRS/NRS-136.html>                                                                                                                                                                                                                                                            |
| Status               | **VERIFIED.** Note it is an opt-in role with real duties and a venue consequence — an owner decision, not an incidental feature                                                                                                                                                                                                                                                                                       |

### Entry NV-7 — professional-conduct backdrop (context, not a deadline)

| Field       | Value                                                                                                                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duty        | Identify client property as such and appropriately safeguard it; keep complete records of client property for **five years after termination of the representation**; promptly deliver property the client is entitled to receive; on termination, surrender papers and property to which the client is entitled |
| Citation    | NRPC 1.15(a), 1.15(d); NRPC 1.16(d)                                                                                                                                                                                                                                                                              |
| Also        | SCR 78(1)(b) — five-year preservation of **trust-account records** after final disposition. SCR 118 — court appointment of counsel to inventory files on an attorney's death, disability, abandonment, resignation, suspension, or disbarment                                                                    |
| Verified on | 2026-08-05, <https://www.leg.state.nv.us/CourtRules/RPC.html> and <https://www.leg.state.nv.us/CourtRules/SCR.html>                                                                                                                                                                                              |
| Status      | **VERIFIED**, but this is **not** a will-delivery deadline and must not be encoded as one. It belongs in the custodian subsystem's retention policy, not the deadline catalog                                                                                                                                    |

---

## 8. Maintenance note — how Nevada changes, and what to watch

**Legislative cadence — biennial, odd years.** Nev. Const. art. 4, § 2(1): "The sessions of the Legislature shall be biennial, and shall commence on the 1st Monday of February following the election of members of the Assembly, unless the Governor of the State or the members of the Legislature shall, in the interim, convene the Legislature by proclamation or petition." Section 2(2): "The Legislature shall adjourn sine die each regular session not later than midnight Pacific time at the end of the 120th consecutive calendar day of that session…" (Source: <https://www.leg.state.nv.us/Const/NvConst.html>, fetched 2026-08-05. Verified.)

So: **a regular session every two years, starting the first Monday of February in odd-numbered years and lasting at most 120 days.** The most recent was the 2025 session; the next regular session therefore begins the first Monday of February 2027, and **there is no scheduled window in which these statutes can change between now and then** except by special session convened under the same provision. That is the review cadence: **re-verify the Nevada entries once after each regular session adjourns sine die** — roughly early June of odd-numbered years — plus on notice of any special session.

**When a change takes effect.** NRS 218D.330(1): "Each law and joint resolution passed by the Legislature becomes effective on October 1 following its passage, unless the law or joint resolution specifically prescribes a different effective date." (Source: <https://www.leg.state.nv.us/NRS/NRS-218D.html>, fetched 2026-08-05. Verified.) **The default gap between adjournment and effect is therefore about four months** — a session that ends in June yields changes effective 1 October, which is ample time to re-verify and update the catalog between the two. Watch for the exception: bills that prescribe their own effective date, sometimes on passage and approval.

**Where amendments publish, and how to tell what a page reflects.** Session laws publish as the **Statutes of Nevada** (`leg.state.nv.us/Statutes/<session>/`), and each NRS section's source note cites them by year and page — NRS 136.050's note reads "(NRS A 1999, 2263; 2015, 961)", which is the fastest way to see when a section last moved. The codified NRS at `leg.state.nv.us/NRS/NRS-<chapter>.html` is authoritative for citation: **NRS 220.170(3)** — "Copies of Nevada Revised Statutes, as printed, published, revised, supplemented and certified in accordance with this chapter, constitute the official codified version of Statutes of Nevada and may be cited as prima facie evidence of the law in all of the courts of this state." (Source: <https://www.leg.state.nv.us/NRS/NRS-220.html>, fetched 2026-08-05. Verified.)

**The one mechanical check that answers "is my entry stale?"** Every NRS and court-rules page carries a revision stamp in its header of the form `[Rev. <date>--<session year>]`. Every page fetched for this document reads **`--2025`**. **When that trailing session year advances past 2025, the Nevada entries need re-verification**, and the section source notes tell you within seconds whether the specific sections moved. Court rules carry the same stamp and change on their own schedule — by Supreme Court order rather than by session — so the district-rule entry (NV-4) needs the same check independently of the statute entries.

**Two changes specifically worth watching for.** First, any amendment to **NRS 136.050** — the 30-day interval and the either/or delivery target are the whole of entry NV-1. Second, any amendment to the **NRS 133.300–133.340** custodian scheme, which is young (added 2017, amended 2021) and therefore likelier than the 1941-derived probate sections to move again.

---

## 9. What could not be verified

Recorded honestly, and none of it is encoded.

1. **State Bar of Nevada Formal Opinion 33's actual text.** The PDF is a 2006 scan with no text layer (`CCITTFaxDecode` images throughout) and no optical character recognition was available in this environment; a plain fetch of the URL also returns HTTP 403. Only the subject line and date, taken from the Bar's own opinions index, are verified. Its holding on electronic storage of client files is relevant to the storage design and should be read before that design is fixed.
2. **The State Bar's "Succession Planning in Nevada" (2025) guidance.** Downloaded successfully but its embedded fonts defeated text extraction here, so nothing from it is quoted or relied on. It may contain practical guidance about original wills held by a firm that closes; it was not readable.
3. **Nine of Nevada's eleven judicial districts.** Only the Eighth (Clark) and Second (Washoe) district rules were checked for the original-will lodging requirement. The statewide District Court Rules contain no such rule, so the other nine districts may impose it, may not, or may word it differently. **Entry NV-4 is therefore county-scoped by construction** — treating it as statewide would be a guess.
4. **Case law.** No Nevada Supreme Court decision construing NRS 136.050 was researched. Specifically unverified: what counts as "reasonable cause" for the subsection 3 defence, and whether "knowledge of the death" has been construed to include constructive knowledge. **Both bear on when a firm's clock starts, and neither is answered by the statutory text.** If the engine ever computes a due date from anything other than an explicitly recorded date of knowledge, this gap becomes load-bearing and needs a lawyer's answer.
5. **Whether any 2025-session bill amended these sections.** The pages fetched are compiled through the 2025 session, so any 2025 amendment is already reflected in the text quoted above — but the session's bill history was not separately reviewed, so no claim is made about what was proposed and failed. NRS 136.050's source note shows its last amendment as 2015, which is the affirmative evidence that the 2025 session did not touch it.
6. **Non-Nevada jurisdictions.** Nothing here supports a catalog entry for any other state. The uniform-act trap described in section 3 is precisely the risk of assuming otherwise.
