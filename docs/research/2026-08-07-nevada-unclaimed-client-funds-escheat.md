# Nevada — unclaimed client funds and escheat: primary-source findings

**Date:** 2026-08-07
**Scope:** What Nevada law requires of a law firm that holds client money in trust and cannot locate the person it belongs to — waiting periods, due diligence, where the money goes, reporting, and what the firm must retain as proof. Nevada only; nothing here supports an entry for any other jurisdiction.
**Status:** This is **research, not a spec and not a decision.** It exists to gate what may be encoded: the jurisdiction seam's contract is refuse-rather-than-guess, so a Nevada value is permitted only for a fact this document marks VERIFIED, and no encoded value resolves at all until an attorney has reviewed it.

> **NOT VERIFIED BY COUNSEL.** No statement in this document has been reviewed by a licensed
> attorney. It is a research record of what the published sources say, prepared to be handed to
> counsel — not legal advice, and not a basis for the platform to assert a compliance answer.

**Method:** Primary sources only as authority — the Nevada Revised Statutes (chapter 120A, the Uniform Unclaimed Property Act as adopted in Nevada), the Nevada Administrative Code (chapter 120A), the Nevada Rules of Professional Conduct, and the Nevada Supreme Court Rules, all as published by the Nevada Legislature at `leg.state.nv.us`; plus the enrolled session bills from the same publisher where the history mattered. Every operative claim carries the exact citation, a verbatim quote, and the date fetched. Secondary material — the State Bar of Nevada's remittance instructions and the State Treasurer's Holder Reporting Manual — is labelled **guidance, not law**, and is never the sole basis for an encoded value. The prior pass ([`2026-08-07-nevada-trust-accounting-rules.md`](2026-08-07-nevada-trust-accounting-rules.md)) caught the State Bar's own handbook printing repealed rules; this document applies the same discipline, and section 8 records where a secondary source and the statute text diverge.

**Currency of the Nevada Legislature pages fetched for this document (all fetched 2026-08-07):** NRS chapter 120A carries the publisher's stamp `[Rev. 4/15/2026 11:07:45 AM--2025]`; NAC chapter 120A carries `[Rev. 4/13/2026 12:37:55 PM]` with `[NAC-120A Revised Date: 7-13]`; the RPC and SCR pages carry the same `[Rev. 4/15/2026 ...--2025]` stamps recorded in the prior pass. All are compiled through the 2025 (83rd) regular session.

---

## 1. Summary — the answer in one paragraph, and the finding that reframes the question

**Nevada routes a law firm's unclaimed client trust funds to the State Bar's Clients' Security Fund, not to the state unclaimed property program.** Two instruments interlock to produce that answer. First, **NRS 120A.500(6)(f)** exempts "a trust account established on behalf of a client," clearly designated as such, from the presumption of abandonment "because of inactivity or failure to make a demand" — so the three-year dormancy machinery of the Uniform Unclaimed Property Act never engages against a designated client trust account. Second, **NRPC 1.15(f)** (effective April 19, 2021) supplies the affirmative mechanism: after **reasonable efforts** to locate and distribute (no less than regular _and_ certified mail, telephone, and email), a firm that still cannot find the owner **within five years of receipt of the property** _may_ — permissive, not mandatory — remit the funds to the **Clients Security Fund**, with a certification and supporting documentary evidence of the efforts, and a good-faith safe harbor against discipline. The State Treasurer's own Holder Reporting Manual confirms the routing in terms: IOLTA funds "can no longer be reported to Unclaimed Property." The firm remains an **ordinary holder under NRS 120A for everything outside the trust account** — an uncashed payroll check, a vendor credit, a client refund paid from the operating account — with the one-to-three-year dormancy periods, the annual before-November-1 report, the 60-to-120-day pre-report notice, and the seven-year post-report record duty that chapter 120A imposes on any Nevada business.

**The finding that reframes the question:** the platform's escheat question ("when do trust funds escheat to the state?") has a null answer in Nevada — designated client trust accounts do not escheat under NRS 120A at all, and the five-year Clients-Security-Fund path is _permissive_. What Nevada actually requires of the firm while funds sit unclaimed is the continuing NRPC 1.15 safekeeping regime plus "reasonable efforts to locate and to distribute" — a due-diligence duty with no completion deadline stated anywhere except the five-year gate on the _option_ to remit.

---

## 2. Statute (binding) — NRS chapter 120A, the Uniform Unclaimed Property Act in Nevada

All quotations in this section are from <https://www.leg.state.nv.us/NRS/NRS-120A.html>, fetched 2026-08-07, page stamp `[Rev. 4/15/2026 11:07:45 AM--2025]`. NRS 120A.010: "This chapter may be cited as the Uniform Unclaimed Property Act." The regime is **custodial, not true escheat** — the State takes custody and the owner's claim survives indefinitely (NRS 120A.590, 120A.640); the only true escheat in the chapter is United States savings bonds (NRS 120A.525).

### 2.1 Who and what the chapter reaches

**The Administrator is the State Treasurer.** NRS 120A.025: "'Administrator' means the State Treasurer in his or her capacity as the Administrator of Unclaimed Property."

**A law firm is a "holder" when it owes property to someone it cannot find.** NRS 120A.080 (source note `A ... 2019`):

> "Holder" means a person or business obligated, or assumed to be obligated, to hold for the account of, or deliver or pay to, the owner property that is subject to this chapter.

**"Property" is broad enough to cover money in any form.** NRS 120A.113(1)-(2) (source note `A 2019 ... 2021`), in relevant part:

> "Property" means tangible property described in NRS 120A.510 or a fixed and certain interest in intangible property that is held, issued or owed in the course of a holder's business ... The term includes, without limitation: (a) All income from or increments to the property. (b) Property that is referred to as or evidenced by: (1) Money, virtual currency or interest, or a payroll card, dividend, check, draft or deposit; (2) A credit balance, customer's overpayment, stored-value card, security deposit, refund, credit memorandum, unpaid wage, unused ticket ... or unidentified remittance; ...

Absent an exemption, money a lawyer holds for a client — settlement residue, an unclaimed refund, the amount behind an uncashed trust check — sits comfortably inside that definition. The exemption is the next section's subject.

### 2.2 NRS 120A.500 — the dormancy schedule, and the client-trust-account exemption

**The catch-all dormancy period is three years.** NRS 120A.500(1) (chapeau and the residual paragraph), verbatim:

> 1. Except as otherwise provided in subsections 6, 7 and 8, property is presumed abandoned if it is unclaimed by the apparent owner during the time set forth below for the particular property:
>
> ...
>
> (q) All other property, 3 years after the owner's right to demand the property or after the obligation to pay or distribute the property arises, whichever first occurs.

Two shorter periods matter to a firm's **operating-account** obligations: "(m) Any wages or other compensation for personal services, 1 year after the compensation becomes payable" and "(l) ... any property held by a court, government, governmental subdivision, agency or instrumentality, 1 year after the property becomes distributable."

**The exemption.** NRS 120A.500(6), verbatim and in full (source note: `Added to NRS by 2007, 757; A 2009, 1663; 2011, 2596; 2019, 3014; 2021, 77; 2023, 1052`):

> 6. The following property clearly designated as such must not be presumed abandoned because of inactivity or failure to make a demand:
>
> (a) An account or asset managed through a guardianship;
>
> (b) An account blocked at the direction of a court;
>
> (c) A trust account established to address a special need;
>
> (d) A qualified income trust account;
>
> (e) A trust account established for tuition purposes; and
>
> (f) A trust account established on behalf of a client.

Three readings of that text, each load-bearing:

- **The exemption is conditioned on designation** — "clearly designated as such." A Nevada lawyer's trust account is required to be so designated anyway: SCR 78(1)(a) compels accounts "clearly identified as 'trust' or 'escrow' accounts" (quoted in full in [`2026-08-07-nevada-trust-accounting-rules.md`](2026-08-07-nevada-trust-accounting-rules.md)). A properly maintained Nevada IOLTA satisfies the condition by construction; commingled or mislabelled funds may not.
- **The exemption attaches to the account, stated as a property category.** Funds sitting _in_ a designated client trust account are within it. A payment that has _left_ the trust account — a refund check drawn on the operating account, an uncashed payroll check — is not, and falls back into the subsection 1 schedule.
- **The shield is against abandonment "because of inactivity or failure to make a demand"** — precisely the two triggers the dormancy schedule runs on (subsection 3 defines "unclaimed" as no owner communication or indication of interest for the applicable period). No other abandonment trigger applicable to trust-account money appears in the chapter.

**Legislative history of paragraph (f), verified against the enrolled bills and session statutes** (all fetched 2026-08-07 from `leg.state.nv.us`):

| Session | Instrument                                                                         | What happened                                                                                                                                                                                                                                                                     |
| ------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2009    | SB 313 (75th Session), ch. 359 — Statutes of Nevada 2009, sec. 55 at pp. 1664-1665 | **Subsection 6 added**, new matter, including "(f) A trust account established on behalf of a client" (and a then-paragraph "(g) An account or fund established to meet the costs of burial"). The chapeau of subsection 1 gained "Except as otherwise provided in subsection 6". |
| 2011    | SB 136 (76th Session), ch. 425, sec. 8.5 — Statutes of Nevada 2011, pp. 2596-2598  | Subsection 6 carried unchanged; a subsection 7 added reducing 3-year periods to 2 years for holders reporting over $10 million.                                                                                                                                                   |
| 2019    | SB 44 (80th Session) — Statutes of Nevada 2019, p. 3014                            | Paragraph (g) (burial funds) deleted from subsection 6; (f) became the final paragraph.                                                                                                                                                                                           |
| 2023    | AB 55 (82nd Session) — Statutes of Nevada 2023, p. 1052                            | The $10-million/2-year subsection 7 **deleted** and replaced by the prepaid-funeral-contract rule; subsection 6 carried unchanged.                                                                                                                                                |

So the client-trust-account exemption has been continuous Nevada law since 2009 and survived every subsequent rewrite of the section.

### 2.3 What the chapter requires of a firm as an ordinary holder (non-trust property)

These duties bind the firm for covered property — they are quoted here because the firm _is_ a holder for its non-exempt obligations, and because they are what the Clients-Security-Fund path replaces for trust funds.

**Annual report, before November 1.** NRS 120A.560 (source note `A 2019 ... 2023`), subsections 1, 7, 14:

> 1. A holder of property presumed abandoned shall make a report to the Administrator concerning the property.
>
> ...
>
> 7. Except as otherwise provided in subsection 8, the report must be filed before November 1 of each year and cover the 12 months next preceding July 1 of that year.
>
> ...
>
> 14. Except as otherwise provided in subsection 15, the holder of property presumed abandoned shall, through a business portal established by the Administrator, electronically file the report and make the payment of the total amount due.

Report contents are prescribed by subsection 4 (description; owner name, last known address, social security or taxpayer identification number if known; the date the dormancy clock is measured from; anything else the Administrator prescribes by regulation).

**Pre-report notice to the owner — the statutory due diligence.** NRS 120A.560(9), (10), (11), (13), verbatim:

> 9. Except as otherwise provided in subsection 10, the holder of property presumed abandoned shall send written notice to the apparent owner, not more than 120 days or less than 60 days before filing the report, stating that the holder is in possession of property subject to this chapter if:
>
> (a) The holder has in its records an address for the apparent owner which the holder's records do not disclose to be invalid and is sufficient to direct delivery of first-class United States mail to the apparent owner; and
>
> (b) The value of the property is $50 or more.
>
> 10. If the property presumed abandoned is in the form of stocks, equity, retirement accounts or virtual currency and the property is valued at $1,000 or more, the holder of the property shall send the written notice required by subsection 9 in the form of certified mail.
> 11. If a holder is required to send written notice to the apparent owner pursuant to subsection 9 and the apparent owner has consented to receive delivery from the holder by electronic mail, as defined in NRS 41.715, the holder shall send the notice by first-class United States mail or certified mail, as applicable, to the apparent owner's last known mailing address, as described in paragraph (a) of subsection 9 and by electronic mail, unless the holder believes the apparent owner's electronic mail address is invalid.
>
> ...
>
> 13. The holder of property presumed abandoned shall file with the report an affidavit stating that the holder has complied with subsection 9.

The required contents of that notice are fixed by regulation — NAC 120A.050 (binding; adopted under NRS 120A.140 and 120A.560): owner's name, last known address, type of account or property, a partial account number or equivalent identifier, the amount, and "a statement that the property will be turned over to the State for custody if the apparent owner does not claim the property within the period set forth in the notice."

**Payment travels with the report.** NRS 120A.570(1): "...upon filing the report required by NRS 120A.560, the holder of property presumed abandoned shall pay, deliver or cause to be paid or delivered to the Administrator the property described in the report as unclaimed..."

**Good-faith delivery discharges the holder.** NRS 120A.590(2): "Upon payment or delivery of property to the Administrator, the State assumes custody and responsibility for the safekeeping of the property. A holder who pays or delivers property to the Administrator in good faith is relieved of all liability arising thereafter with respect to the property." Note the definition of good faith in 120A.590(1)(b) includes that "[t]he holder was not then in breach of a fiduciary obligation with respect to the property" — a clause with obvious bite for a lawyer-holder.

**Negative reports are required by regulation.** NAC 120A.035(1) (adopted `R162-09, eff. 8-13-2010`), verbatim:

> 1. A holder that is incorporated or located in this State or that conducts business in this State and determines that it is not in possession of property that must be reported, paid or delivered under chapter 120A of NRS shall file a report with the Administrator certifying that the holder has no unclaimed property to report.

Same deadline as the affirmative report (before November 1, covering the twelve months preceding July 1). A Nevada law firm is "located in this State"; on the regulation's face this annual filing binds the firm even in a year with nothing to report.

**Record retention after reporting: seven years.** NRS 120A.700(1) (source note `A 2021`), verbatim:

> 1. Except as otherwise provided in subsection 2, a holder required to file a report under NRS 120A.560 shall maintain the records containing the information required to be included in the report, and any records upon which the person wishes to rely for excluding information from the report, for 7 years after the holder files the report, unless a shorter period is provided by regulation of the Administrator.

Note the second clause: the seven years also covers records the holder relies on **for excluding** property from a report — the paper trail for "this item was not abandoned" — and NRS 120A.690(6) lets the Administrator _estimate_ a liability against a holder whose records are insufficient.

**Penalties.** NRS 120A.730: interest at 18 percent per annum on late-reported or late-delivered property (subsection 1); a civil penalty of $200 per day capped at $5,000 (subsection 2); for willful failure, $1,000 per day capped at $25,000 plus 25 percent of the value (subsection 3); and mandatory waiver of penalties "if the holder acted in good faith and without negligence" (subsection 5).

**No aggregate reporting and no minimum threshold appear in the statute.** The chapter contains no de-minimis floor for _reporting_ (the $50 figure in 120A.560(9) gates only the pre-report _notice_), and no provision permitting small items to be reported in aggregate. The Treasurer's manual states the same administratively (section 6).

---

## 3. Rule of Professional Conduct (binding) — NRPC 1.15(f) and (g), the operative mechanism for trust funds

**Citation:** Nevada Rules of Professional Conduct, Rule 1.15, "Safekeeping Property," paragraphs (f) and (g).
**Source:** <https://www.leg.state.nv.us/CourtRules/RPC.html>, fetched 2026-08-07 (independently of the prior pass; the two fetches agree character for character). Source note: `[Added; effective May 1, 2006; amended; effective April 19, 2021.]` — paragraphs (f) and (g) arrived with the 2021 amendment.
**Verified:** yes.

Verbatim, in full:

> (f) A lawyer or law firm with unclaimed or unidentified funds in a client trust account shall take reasonable efforts to locate and to distribute the funds to the owner. If the lawyer or firm cannot after reasonable efforts locate or distribute the unclaimed or unidentified funds to an owner within five years of receipt of the property, then the lawyer or firm may remit the funds to the Clients Security Fund except as otherwise provided by law. The Clients Security Fund shall grant remitted funds and shall not hold funds for future recovery.
>
> (1) "Unclaimed funds" are monies that a lawyer or firm is holding in a client trust account that should be distributed to a client or third party.
>
> (2) "Unidentified funds" are monies for which the lawyer or firm cannot identify an owner.
>
> (3) Reasonable efforts to locate the owner of unclaimed funds shall include, but not be limited to, no less than regular and certified mail to the owner's last known address, telephone, and email. The board of governors may establish additional requirements for client contact or identification of funds. A lawyer or firm must certify and provide supporting documentary evidence of the lawyer's or firm's reasonable efforts to locate the owner before remitting such funds to the Clients Security Fund.
>
> (4) A lawyer's or firm's remittance to the Clients Security Fund under this paragraph (f) shall not constitute misconduct or grounds for discipline if the member or firm exercised reasonable efforts to locate and distribute the property and remitted the property to the Clients Security Fund in good faith.
>
> (g) An attorney appointed pursuant to Rule 118 may, after due diligence to identify client funds and locate clients, remit any amount of funds in the lawyer's trust account to the Clients Security Fund.

Six things the text settles:

| Question                          | Answer from the text                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is there a duty at all?           | Yes — "**shall** take reasonable efforts to locate and to distribute." The duty is the searching, not the remitting.                                                                                                                                                                                                    |
| Is remitting mandatory?           | **No.** "may remit" — the five-year mark opens a door; nothing in the rule ever compels walking through it.                                                                                                                                                                                                             |
| What is the clock, and from when? | Five years **"of receipt of the property"** — not from a dormancy determination, not from last owner contact, not from the end of the representation.                                                                                                                                                                   |
| What is the diligence floor?      | "no less than regular **and** certified mail to the owner's last known address, telephone, **and** email" — conjunctive, all channels. The board of governors may add requirements.                                                                                                                                     |
| What proof is demanded?           | Certification **plus supporting documentary evidence** of the efforts, delivered before remitting.                                                                                                                                                                                                                      |
| Can the money come back?          | Not from the Fund: "The Clients Security Fund **shall grant** remitted funds and **shall not hold funds for future recovery**." The remittance is terminal — an owner who later surfaces has no recourse against the Fund (contrast NRS 120A custody, where the owner's claim against the State survives indefinitely). |

**The escape clause "except as otherwise provided by law"** is the seam between this rule and NRS 120A. For a designated Nevada client trust account, NRS 120A.500(6)(f) means chapter 120A provides nothing "otherwise" — the exemption and the rule point the same way. Where the clause could bite is property a court order, another statute, or **another state's** unclaimed property law disposes of differently; section 8 flags the multistate case as genuinely unsettled.

**Rule 118 context for paragraph (g).** SCR 118, "Appointment of counsel to protect client's interest" (source note `[Added; effective February 15, 1979; amended; effective October 26, 2023.]`), is the receivership mechanism — a disinterested attorney appointed when a lawyer dies, disappears, is disbarred, or abandons a practice. Paragraph (g) gives that appointee a broader remittance permission ("any amount") on "due diligence" without the five-year gate — the wind-down valve for orphaned trust accounts.

---

## 4. Supreme Court Rule (binding) — SCR 85, the Clients' Security Fund itself

**Citation:** Nevada Supreme Court Rule 85, "Board of governors authorized to establish clients' security fund."
**Source:** <https://www.leg.state.nv.us/CourtRules/SCR.html>, fetched 2026-08-07. Source note: `[Amended; effective July 1, 2021.]`
**Verified:** yes.

Verbatim, subsection 1:

> 1. Establishment. The board of governors shall maintain, from dues paid by members of the state bar, voluntary contributions and any other sources which may become available, a clients' security fund for the purpose of providing reimbursement, in whole or in part, as a matter of grace and not of right, to persons who have sustained loss by reason of a dishonest act of a member of the state bar, acting in his or her capacity as an attorney and counselor at law, in the nature of defalcation or embezzlement of money or the wrongful taking or conversion of money, property or other things of value, and shall provide for the administration of such fund.

The Fund is the State Bar's client-protection fund — reimbursement "as a matter of grace and not of right" for losses to dishonest lawyers. NRPC 1.15(f) makes it, additionally, the destination for unclaimed trust funds ("and any other sources which may become available" is the textual hook on the SCR 85 side). Note the amendment dates: SCR 85 was amended effective July 1, 2021, ten weeks after NRPC 1.15(f) took effect on April 19, 2021 — the two halves of the same reform.

**The ADKT order number for the April 19, 2021 amendment was not verified.** The effective date comes from the rule's own source note. Corroborating context only: the State Bar Board of Governors' published minutes of December 1, 2020 (`nvbar.org`) record a motion "to petition the Supreme Court seeking to amend Nevada Rule of Professional Conduct" for "the remittance of unclaimed or unidentified property in a lawyer's client account." The docket number itself was not located and nothing depends on it.

---

## 5. State Bar guidance (not law) — the remittance procedure

**Source:** "Instructions for Remitting Unclaimed/Unidentified Funds" and the "Unclaimed/Unidentified Funds Remittance Report & Certification," State Bar of Nevada Clients' Security Fund, <https://nvbar.org/wp-content/uploads/NV-Unclaimed-Unidentified-Funds-Form.pdf>, and the State Bar's page <https://nvbar.org/for-lawyers/ethics-discipline/for-lawyers-ethics-discipline-unclaimed-unidentified-funds/>, both fetched and read in full 2026-08-07.
**Status: GUIDANCE, NOT LAW** — but it is the board-of-governors procedure that NRPC 1.15(f)(3) expressly authorizes ("The board of governors may establish additional requirements"), which gives it more standing than ordinary bar commentary.

The procedure, as published:

1. **Classify** the money as unclaimed (owner known, unreachable or unresponsive) or unidentified (owner unknown).
2. **Certify five years of reasonable efforts.** The instructions gloss the rule's floor in two ways worth quoting: reasonable efforts to _identify_ the owner "[i]ncludes a review of transactional records, client ledgers, case files, fee records and any other relevant documents or records"; reasonable efforts to _locate_ include the rule's mail/telephone/email floor "**or any efforts similar to those that would be undertaken when attempting to locate a person for service of process. A greater outlay of time and expense may be warranted when larger amounts of money are at issue.**" (Proportionality to amount is the Bar's gloss; the rule text does not state it.)
3. **Submit** the Remittance Report & Certification with corroborating documents and a check payable to the State Bar of Nevada Client Security Fund (3100 W. Charleston Blvd., Ste. 100, Las Vegas, NV 89102). The form itemizes each owner: amount, full name, last known address, date of last service, nature of representation, and the efforts made; unidentified funds are itemized as amount plus "any information regarding funds."
4. **Retain the acknowledgment letter** the Fund sends back "for no less than five (5) years."

The certification the signer executes includes, verbatim from the form:

> I understand that lawyers must maintain records related to the ultimate disposition of unclaimed or unidentifiable funds in Nevada client trust accounts in accordance with the recordkeeping requirements and minimum five (5) year retention period required pursuant to NRPC 1.15, and further, that these records must be made available for production to the State Bar of Nevada Clients' Security Fund or the Office of Bar Counsel in a timely manner upon a request or demand by either agency ...
>
> I understand that the attorney or client may NOT seek reimbursement from the state bar if claims come forward in the future.

and warns that false information "may subject me to prosecution and penalties under NRS 199.145" (the criminal false-statement statute).

**One older formal ethics opinion bears on the subject.** State Bar of Nevada Standing Committee on Ethics and Professional Responsibility, **Formal Opinion No. 3 (May 22, 1987)**, summarized on the State Bar's opinion index (fetched 2026-08-07): a legal services corporation "may not as part of its retainer agreement contract with its clients to receive all money in trust fund accounts not claimed by the client within 3-year period," though it may provide that amounts under $1 at file close become the corporation's. The firm cannot contract its way into keeping unclaimed client money — guidance, pre-dating the 2021 rule, pointing the same direction the rule now codifies.

---

## 6. Administrator guidance (not law) — the State Treasurer's position

**Source:** _Nevada Holder Reporting Manual_, "Fiscal year 2024," Office of the Nevada State Treasurer, Unclaimed Property Division, <https://www.nevadatreasurer.gov/uploadedFiles/treasurer.nv.gov/content/Unclaimed_Property/Forms/Holder/Holder_Reporting_Manual.pdf>, fetched and read 2026-08-07.
**Status: administrative guidance, not law** — but it is the Administrator's own published reporting instruction, which makes it the authoritative statement of how the program in fact treats attorney trust funds.

On IOLTA, verbatim (from the "What's New" section):

> Nevada Rule of Professional Conduct 1.15(f) provides direction to lawyers and law firms on what to do with unclaimed or unidentified funds in their Nevada client trust accounts. Consistent with SCR 78 and NRPC 1.15(f), if a lawyer or law firm has made reasonable but unsuccessful efforts to disburse funds from their IOLTA account to the rightful owner, those funds may be remitted to the State Bar of Nevada's Clients' Security Fund after a term of five years. ... **These funds may no longer be reported as abandoned property to Nevada Unclaimed Property.**

and again in the body:

> Funds held in an IOLTA pertaining to abandoned property can no longer be reported to Unclaimed Property. See Nevada Supreme Court Rule 1.15 for details on handling these properties.

(The second passage miscites the RPC as a "Nevada Supreme Court Rule" — a labelling slip, flagged in section 8; the substance is consistent.)

On the general reporting mechanics the manual confirms, administratively, what the statute implies: "**Nevada does not allow properties to be reported in aggregate.** Each property must be listed individually on a report, regardless of the value. As a reminder, Nevada requires all properties, regardless of value to be reported. **There is no minimum threshold to report.**" It also states that holders include "attorneys, CPAs, medical professionals," that due diligence "[m]ust be performed within 60 — 120 days prior to submitting a report," that recouping due-diligence expenses (postage, employee hours) is not permitted, and it repeats the NAC 120A.035 negative-report duty for Nevada businesses.

The manual's phrase "may **no longer** be reported" reflects a real regime change: before the 2021 rule there was no Clients-Security-Fund path, and holder-side practice for attorney trust funds was unsettled against the 2009 statutory exemption. Since April 2021 the two authorities and the Administrator all point one way.

---

## 7. The seven sub-questions, answered with tiers

Tier key: **LAW** = required by statute, regulation, or court rule; **GUIDANCE** = State Bar or Administrator publication; **PRACTICE** = common practice with no Nevada authority located; **UNSETTLED** = genuinely open.

**(1) Dormancy period for attorney trust funds before escheat.** **LAW: there is none — the premise fails in Nevada.** NRS 120A.500(6)(f) exempts designated client trust accounts from the abandonment presumption, so no dormancy period ever runs against them and nothing escheats to the State. The five years in NRPC 1.15(f) is not a dormancy period: it runs **from receipt of the property**, and what it gates is the _permission_ to remit to the Clients Security Fund, not any obligation. For the firm's **non-trust** property the ordinary schedule applies: one year for wages (120A.500(1)(m)), three years for the catch-all (1(q)), measured per paragraph, with subsection 8's earlier-of-knowledge-of-death override for several categories.

**(2) Are IOLTA/trust funds covered property under NRS 120A, and is there an attorney carve-out?** **LAW: covered by the definition, exempted by NRS 120A.500(6)(f).** "Property" (120A.113) would reach the money; subsection 6(f) — "a trust account established on behalf of a client," clearly designated as such — takes it out of the presumption. The carve-out is not attorney-specific on its face (it says "client," not "lawyer"), but a lawyer's designated trust account is its clearest case, and the Administrator reads it exactly that way (section 6). Continuous since 2009 (SB 313).

**(3) Required due diligence before remitting.** **LAW (for the trust path):** NRPC 1.15(f) — reasonable efforts to locate and distribute, floored at regular **and** certified mail to the last known address, telephone, **and** email (1.15(f)(3)), certified with supporting documentary evidence before remitting. **GUIDANCE:** the Bar adds record-review steps (transactional records, client ledgers, case files, fee records), a service-of-process analogy, and proportionality to amount. **LAW (for the non-trust path):** written notice 60-120 days before the report for property of $50 or more with a mailable address (120A.560(9)); certified mail for stocks/equity/retirement/virtual currency of $1,000 or more (subsection 10); supplemental email where consented (subsection 11); notice contents per NAC 120A.050; compliance affidavit filed with the report (subsection 13).

**(4) Remittance mechanism and holder-reporting obligations.** **Trust funds — GUIDANCE on LAW's frame:** the Remittance Report & Certification form, corroborating documents, and a check to the State Bar of Nevada Client Security Fund; no deadline, because remitting is optional; no aggregate/threshold concept. **Non-trust property — LAW:** electronic report and payment through the Administrator's business portal before November 1 covering the twelve months preceding July 1 (120A.560(7), (14); 120A.570(1)); annual **negative report** in empty years (NAC 120A.035); no minimum threshold and no aggregate reporting (statutory silence; stated flatly by the manual); late reporting draws 18 percent interest plus per-day civil penalties (120A.730), with mandatory waiver for good faith without negligence.

**(5) Interaction with RPC 1.15 safekeeping while funds sit unclaimed.** **LAW:** every NRPC 1.15 duty continues for the full period — the funds stay in the designated trust account (1.15(a)), per-client records continue (1.15(a); SCR 78(1)(b)), and the locate-and-distribute duty of 1.15(f) is itself a safekeeping duty. Nothing in Nevada's rules permits moving unclaimed funds out of trust anywhere except to the owner or (after five years, optionally) the Fund. Disputed funds are a different rule — 1.15(e) requires keeping the disputed portion separate until resolution, and an active dispute is hard to square with "unclaimed" (the parties are claiming it); this document does not conflate the two. Whether decade-old unclaimed balances remain "nominal in amount or ... held for a short period of time" for IOLTA-eligibility purposes is committed exclusively to the lawyer's judgment by SCR 221 and is not the platform's call.

**(6) Can unclaimed funds ever go to the State Bar or a client-protection fund instead of the state?** **LAW: that is the primary Nevada path, not an alternative.** NRPC 1.15(f) sends them (permissively) to the Clients Security Fund established under SCR 85; the Treasurer's program declines them (section 6). The remittance is terminal — "shall grant remitted funds and shall not hold funds for future recovery" — and the Bar's certification makes the signer acknowledge no future reimbursement. The good-faith safe harbor (1.15(f)(4)) protects the remitting lawyer from discipline, but nothing in the rule addresses a later-appearing owner's civil position, and the certification's terminality is the reason the five-year search record matters.

**(7) Records the firm must keep after remitting.** **LAW:** NRPC 1.15(a) — complete records preserved five years after termination of the representation; SCR 78(1)(b) — account records at least five years after final disposition of the underlying matter (two different clocks, both quoted in [`2026-08-07-nevada-trust-accounting-rules.md`](2026-08-07-nevada-trust-accounting-rules.md)); NRPC 1.15(f)(3) — the certification and supporting documentary evidence of the search exist as records by construction. **GUIDANCE:** the Bar instructs keeping the Fund's acknowledgment letter at least five years, and its certification recites that disposition records "must be made available for production" to the Fund or Bar Counsel on demand. **LAW (non-trust path):** seven years after filing the NRS 120A.560 report, including records relied on to _exclude_ property (120A.700(1)).

---

## 8. Where sources conflict, and the traps

1. **A web-search summary asserted the $10-million/2-year acceleration as current law. It is not.** The clause existed (added by SB 136 in 2011) and was deleted by AB 55 in 2023; the current compiled text contains no such provision (searched: `million`, `2 years` — no relevant hit). A search engine's confident restatement of a superseded subsection is this file's instance of the trap the will-custody research documented: the summary reads as authority and is wrong against the current text.
2. **The Treasurer's manual miscites the RPC.** "See Nevada Supreme Court Rule 1.15" — Rule 1.15 is a Rule of Professional Conduct, not a Supreme Court Rule, and the SCR numbering (SCR 78, 85, 118, 216-221) is a different instrument. Substantively harmless here; cite-checking it matters because the prior pass showed Nevada rule numbers migrating between exactly these two instruments.
3. **The State Bar's 2019 handbook does not know paragraph (f) exists.** _Trust Accounting in Nevada_ (copyright 2019) reproduces NRPC 1.15 only through paragraph (e) — it predates the April 19, 2021 amendment entirely, on top of the two staleness defects the prior pass recorded (seven-year retention; SCR 78.5). Anything it implies about unclaimed funds is pre-2021 and must not be relied on.
4. **A timing gap in the authorities, 2009-2021.** The statutory exemption (2009) preceded the Clients-Security-Fund mechanism (2021) by twelve years; in the interval, trust funds were exempt from the presumption yet had no rule-sanctioned destination. Historical only — but it explains why older Nevada practice materials describe remitting attorney funds to the unclaimed property program, and why such descriptions are now wrong.
5. **The repository's existing narrative catalog is right on this one.** [`trust-rules/group-2-IA-NV.md`](trust-rules/group-2-IA-NV.md) states the RPC 1.15(f) mechanism correctly (five years, Clients' Security Fund, permissive, good-faith safe harbor) but does not record the NRS 120A.500(6)(f) exemption or the holder duties for non-trust property; this document supersedes it for Nevada unclaimed-funds facts.
6. **The multistate case is genuinely unsettled and was not researched.** NRS 120A.530 takes custody by the owner's last-known address, and the priority rules for competing state claims come from federal common law; a client whose last-known address is in another state may be owed treatment under _that_ state's unclaimed property act, which Nevada's exemption does not bind — and NRPC 1.15(f)'s "except as otherwise provided by law" leaves room for exactly that. No other state's law was examined. Nothing may be encoded for the cross-border case.

---

## 9. What could not be verified

1. **The ADKT docket number** for the April 19, 2021 amendment to NRPC 1.15. Effective date verified from the rule's source note; the order itself was not retrieved. (Corroboration only: the December 1, 2020 Board of Governors minutes record the petition being approved.)
2. **Whether the board of governors has adopted "additional requirements" under NRPC 1.15(f)(3)** beyond the published instructions and form. The form is the only procedure located; a standing board policy, if one exists, was not found.
3. **Effective dates of the individual session amendments** (e.g., whether SB 313's sections took effect July 1 or October 1, 2009). The enrolled bills' effective-date sections were not read through; the compilation's page citations are used instead. Nothing encodable turns on the intra-year date.
4. **The cross-border/other-state treatment** (section 8, item 6). Not researched; does not resolve.
5. **Any State Bar formal ethics opinion post-dating the 2021 amendment** on unclaimed funds. The opinion index (fetched 2026-08-07) lists none on the subject newer than the safekeeping opinions of 2005-2017; Formal Opinion No. 3 (1987) is the only one that addresses unclaimed trust balances, and only as summarized on the index page — the full opinion PDF was not retrieved.
6. **NAC 120A.035's application in practice to law firms with only exempt (trust) property.** The regulation's text reaches any Nevada business; whether the Division expects negative reports from firms holding nothing but IOLTA funds was not confirmed with the Division. The regulation text is what it is; the enforcement posture is unknown.

---

## 10. What this means for the trust subsystem

Implications only — no design, and nothing below is an instruction to build.

- **The Nevada `unclaimedFunds` value the prior pass encoded is confirmed, and its two recorded type-fit caveats are now grounded in the full statutory picture.** Destination Clients Security Fund; five years **from receipt**; diligence floored at regular-plus-certified mail, telephone, and email; **permissive** remittance. The schema's `UnclaimedFunds` shape still models neither permissiveness nor a from-receipt clock (it assumes a dormancy clock), and this document adds a third mismatch: `reclaimable` must be capable of expressing **false** — the Fund "shall not hold funds for future recovery," which is the opposite of the custodial model the field name assumes.
- **An escheat/remittance feature for Nevada is a workflow with no deadline.** There is nothing to count down to: the platform can surface "five years since receipt, owner not located" as an _eligibility_ signal and support the certification, but any "Nevada requires remittance by [date]" framing would assert a duty that does not exist.
- **What the platform can genuinely support is the five-year evidence trail.** The remittance gate is certification plus supporting documentary evidence of every locate attempt (regular mail, certified mail, telephone, email, record review) across up to five years. A contact-attempt log attached to a trust balance — attempt type, date, address used, outcome — is exactly the artifact NRPC 1.15(f)(3) and the Bar's form demand, and it is cheap to record at the time and impossible to reconstruct later.
- **Receipt date is the load-bearing datum.** The five years runs from receipt of the property. The built trust ledger already timestamps every movement; the implication is that an unclaimed-funds view must reach the _original receipt_ movement, not the last activity — a different query than dormancy.
- **The trust/non-trust boundary is also a compliance boundary.** The same dollars owed to the same person are Clients-Security-Fund property while in the trust account and NRS 120A property once paid out of a non-trust account. Any future unclaimed-property feature that covers firm operating obligations (uncashed payroll or vendor checks) is a _different regime_ — November-1 reports, 60-to-120-day notices, negative reports, seven-year retention — and must not share logic or copy with the trust path.
- **Account designation is now known to carry statutory weight.** "Clearly designated as such" (NRS 120A.500(6)) means the trust-account naming/designation the platform records is not cosmetic — it is a condition of the exemption. Worth carrying as a prose note beside the account-designation facts already encoded from SCR 78(1)(a).
- **The maintenance surface is three instruments on two cadences.** NRS 120A moves with the biennial odd-year legislature (watch the exemption in 120A.500(6) and the report mechanics in 120A.560); NRPC 1.15 and SCR 85 move by court order on the ADKT docket at any time. The prior pass's date-comparison maintenance rule covers both; this document adds NRS 120A and NAC 120A to the pages whose stamps get compared.
