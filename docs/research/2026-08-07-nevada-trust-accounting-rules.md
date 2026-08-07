# Nevada — trust-accounting and IOLTA rules: primary-source findings

**Date:** 2026-08-07
**Scope:** What Nevada law requires of a lawyer who holds client money, and what that supports encoding in the trust subsystem's jurisdiction profile. Nevada only; nothing here supports an entry for any other jurisdiction.
**Status:** This is **research, not a spec and not a decision.** It exists to gate what may be encoded: the jurisdiction seam's contract is refuse-rather-than-guess, so a Nevada value is permitted only for a fact this document marks VERIFIED, and no encoded value resolves at all until an attorney has reviewed it.
**Method:** Primary sources only — the Nevada Rules of Professional Conduct and the Nevada Supreme Court Rules as published by the Nevada Legislature at `leg.state.nv.us`, which is the publisher the repository's earlier Nevada research used and the compilation Nevada courts cite. Every operative claim carries the exact citation, a verbatim quote, the URL, and the date fetched. Where a source could not be read, or where two sources disagree, the claim says so and nothing is encoded on it. State Bar of Nevada material is labelled as **guidance, not law**, and is never the sole basis for an encoded value.

**Currency of every Nevada Legislature page fetched for this document:** each carries the publisher's revision stamp **`[Rev. 4/15/2026 ... --2025]`** — compiled through the 2025 (83rd) regular session. Section 9 explains what that stamp means for maintenance.

---

## 1. Summary — and three corrections to what this repository already believed

Nevada's trust-accounting regime is **two documents, not one**. The ethics duty lives in **NRPC 1.15 ("Safekeeping Property")**; the operative account mechanics — approved institutions, overdraft notification, and the record-retention floor — live in the **Nevada Supreme Court Rules**, and the IOLTA regime lives in **SCR 216 through 221**. Rule numbers are not interchangeable between them, and the platform's rule for that (never hard-code a rule number) is why each encoded value below carries its own citation rather than a shared one.

Three corrections fall out of reading the current published text, and each one contradicts something already written down in this repository. They are the reason this document exists rather than a transcription of the existing catalog.

**Correction 1 — the governing recordkeeping rule is SCR 78, not SCR 78.5. SCR 78.5 was repealed.** The Supreme Court Rules table of changes records `78.5 ... R ... 8/22/19`. The approved-institution, overdraft-notification and five-year records duty now sit in **SCR 78**, whose own source note reads `[Amended; effective August 22, 2019.]` — the same date. Every existing reference in this repository's research to "SCR 78.5" points at a repealed rule. Section 3 quotes SCR 78 in full.

**Correction 2 — Nevada's records-retention period in NRPC 1.15(a) is FIVE years, not seven.** The current published NRPC 1.15(a) reads "preserved for a period of **five** years after termination of the representation", under a source note `[Added; effective May 1, 2006; amended; effective April 19, 2021.]`. The State Bar's own published handbook _Trust Accounting in Nevada_ (copyright 2019) reproduces the rule as "**seven** years" and tells lawyers to keep records for seven — because it predates the 2021 amendment. The approved trust-jurisdiction schema design's golden test likewise pins Nevada at "7 years". **Seven is the superseded figure.** Section 6 sets the two texts side by side.

**Correction 3 — Nevada mandates NO reconciliation, and certainly not a monthly three-way one.** The string `reconcil` appears **zero times** in the entire Nevada Rules of Professional Conduct and **zero times** in the entire Nevada Supreme Court Rules, both searched in full. The State Bar handbook does teach monthly reconciliation and attributes it to "SCR 217(4)(a)" — but SCR 217(4)(a) is the subsection directing a _depository institution_ to remit interest and transmit statements, and says nothing about reconciliation. The schema design's golden test pins Nevada at "monthly three-way". **No Nevada rule imposes it.** Section 5 shows the miscitation.

Corrections 2 and 3 both point the same way: the previously recorded Nevada values were taken, directly or indirectly, from the State Bar's 2019 handbook rather than from the rule text as it now stands. That is the uniform-act trap in a domestic register — a fluent, authoritative-looking secondary source restating a rule that has since moved.

---

## 2. Rule of Professional Conduct (binding) — NRPC 1.15, in full

**Citation:** Nevada Rules of Professional Conduct, Rule 1.15, "Safekeeping Property."
**Source:** <https://www.leg.state.nv.us/CourtRules/RPC.html>, fetched 2026-08-07, page stamp `[Rev. 4/15/2026 4:39:35 PM--2025]`. Retrieved twice by independent means (direct fetch and page conversion); the two agree character for character on the operative sentences.
**Verified:** yes.

Verbatim, in full:

> **Rule 1.15. Safekeeping Property.**
>
> (a) A lawyer shall hold funds or other property of clients or third persons that is in a lawyer's possession in connection with a representation separate from the lawyer's own property. All funds received or held for the benefit of clients by a lawyer or firm, including advances for costs and expenses, shall be deposited in one or more identifiable bank accounts designated as a trust account maintained in the state where the lawyer's office is situated, or elsewhere with the consent of the client or third person. Other property in which clients or third persons hold an interest shall be identified as such and appropriately safeguarded. Complete records of such account funds and other property shall be kept by the lawyer and shall be preserved for a period of five years after termination of the representation.
>
> (b) A lawyer may deposit the lawyer's own funds in a client trust account for the sole purpose of paying bank service charges on that account, but only in an amount necessary for that purpose.
>
> (c) A lawyer shall deposit into a client trust account legal fees and expenses that have been paid in advance, to be withdrawn by the lawyer only as fees are earned or expenses incurred.
>
> (d) Upon receiving funds or other property in which a client or third person has an interest, a lawyer shall promptly notify the client or third person. Except as stated in this Rule or otherwise permitted by law or by agreement with the client, a lawyer shall promptly deliver to the client or third person any funds or other property that the client or third person is entitled to receive and, upon request by the client or third person, shall promptly render a full accounting regarding such property.
>
> (e) When in the course of representation a lawyer is in possession of funds or other property in which two or more persons (one of whom may be the lawyer) claim interests, the property shall be kept separate by the lawyer until the dispute is resolved. The lawyer shall promptly distribute all portions of the funds or other property as to which the interests are not in dispute.
>
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
>
> [Added; effective May 1, 2006; amended; effective April 19, 2021.]

Five things this settles that the design has to respect.

| Question                | Answer from the text                                                                                                                                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Segregation             | Absolute, in (a): client property is held "separate from the lawyer's own property", and **advances for costs and expenses are expressly client funds** — so a cost advance goes to trust, not to operating.                                                                                                     |
| Where the account lives | "maintained in the state where the lawyer's office is situated, or elsewhere with the consent of the client or third person." This is the textual basis for deriving the jurisdiction from the office rather than letting a user pick it — and note the consent escape hatch, which the platform does not model. |
| Records retention       | **Five years after termination of the representation.** Note the clock: _termination of the representation_, which is not the same clock as SCR 78's (section 3).                                                                                                                                                |
| Advance fees            | (c) is unconditional: advance fees and expenses go **into** trust and come out **only as earned or incurred**.                                                                                                                                                                                                   |
| Disputed funds          | (e) requires the disputed portion to be **kept separate until resolved**, with prompt distribution of the undisputed remainder. This is the hold model's rule, and it is a duty to segregate rather than to move money.                                                                                          |

---

## 3. Supreme Court Rule (binding) — SCR 78, the records and overdraft regime

**Citation:** Nevada Supreme Court Rule 78, "Maintenance of trust funds in approved financial institutions; overdraft notification."
**Source:** <https://www.leg.state.nv.us/CourtRules/SCR.html>, fetched 2026-08-07, page stamp `[Rev. 4/15/2026 4:39:37 PM--2025]`.
**Verified:** yes.
**Source note as published:** `[Amended; effective August 22, 2019.]`

Verbatim, the subsections that bear on the platform:

> **Rule 78. Maintenance of trust funds in approved financial institutions; overdraft notification.**
>
> 1. Clearly identified trust accounts in approved financial institutions required.
>
> (a) Active members of the State Bar of Nevada and attorneys certified to practice under SCR 49.1 shall deposit all funds held in trust in this jurisdiction in accordance with SCR 217 into accounts clearly identified as "trust" or "escrow" accounts, referred to herein as "trust accounts," and shall take all steps necessary to inform the depository institution of the purpose and identity of the accounts. Funds held in trust include funds held in any fiduciary capacity in connection with a representation, whether as trustee, agent, guardian, executor, or otherwise. Lawyer trust accounts shall be maintained only in financial institutions approved by the state bar.
>
> (b) Every lawyer engaged in the practice of law in the State of Nevada shall maintain and preserve for a period of at least five years, after final disposition of the underlying matter, the records of the accounts, including checkbooks, canceled checks, check stubs, vouchers, ledgers, journals, closing statements, accountings, or other statements of disbursements rendered to clients or other parties with regard to trust funds, or similar equivalent records clearly and expressly reflecting the date, amount, source, and explanation for all receipts, withdrawals, deliveries, and disbursements of the funds or other property of a client, and make such records available to the state bar for inspection upon request.
>
> 2. Overdraft notification agreement required. A financial institution shall be approved as a depository for lawyer trust accounts if it files with the state bar an agreement, in a form provided by the state bar, to report to the state bar counsel whenever any properly payable instrument is presented against a lawyer trust account containing insufficient funds, irrespective of whether or not the instrument is honored. The state bar shall establish rules governing approval and termination of approved status for financial institutions. No trust account shall be maintained in any financial institution that does not agree to so report. Any such agreement shall apply to all branches of the financial institution and shall not be canceled except upon 30 days' notice in writing to the state bar.
> 3. Overdraft reports. The overdraft notification agreement shall provide that all reports made by the financial institution shall be in the following format:
>
> (a) In the case of a dishonored instrument, the report shall be identical to the overdraft notice customarily forwarded to the depositor, and should include a copy of the dishonored instrument, if such a copy is normally provided to depositors;
>
> (b) In the case of instruments that are presented against insufficient funds but which instruments are honored, the report shall identify the financial institution, the lawyer or law firm, the account number, the date of presentation for payment, and the date paid, as well as the amount of overdraft created thereby.
>
> 4. Timing of reports. A report of a dishonored instrument made to the state bar counsel under paragraph 3 shall be made simultaneously with a notice of dishonor given to the depositor, and within the time provided by law for notice of dishonor, if any. If an instrument presented against insufficient funds is honored, then the report shall be made within five banking days of the date of presentation for payment against insufficient funds.

Subsections 5 through 9 cover the lawyer's deemed consent to reporting, the certificate of compliance and the events that require an updated one, the institution's right to charge for producing reports, institutional immunity for a good-faith erroneous report, definitions, and suspension for non-compliance. They bind the lawyer and the bank, not the platform, and nothing is encoded from them.

**Two record-keeping facts with direct data-model consequences.**

The enumerated record list in 78(1)(b) is the answer to "what must the firm be able to produce": checkbooks, canceled checks, check stubs, vouchers, **ledgers, journals**, closing statements, and accountings or statements of disbursements — or equivalent records "clearly and expressly reflecting the **date, amount, source, and explanation** for all receipts, withdrawals, deliveries, and disbursements". That four-part minimum is what a movement record has to carry, and the built `trust_movement` row carries all four.

**Nevada does not require a record identifying which funds in the account are the lawyer's own.** Maryland does (Rule 19-407(a)(4)); the trust analysis cited that requirement as one motivation for a designated firm-funds leaf. Nevada's enumeration contains no such item. The leaf is therefore **permitted, not compelled**, by Nevada — which is section 8's subject.

**The retention clocks differ between the two rules and neither is redundant.** NRPC 1.15(a) runs five years from **termination of the representation**; SCR 78(1)(b) runs at least five years from **final disposition of the underlying matter**. Same number, different events. A matter can be finally disposed of long after the representation ends, or the reverse. Encoding a single "five years" without naming which clock would be a fabrication of precision, which is why the encoded value carries both citations and the platform's retention posture is a purge floor rather than a computed deletion date.

---

## 4. Supreme Court Rules (binding) — SCR 216 to 221, the IOLTA regime

All fetched from <https://www.leg.state.nv.us/CourtRules/SCR.html> on 2026-08-07, same page stamp. All verified.

### 4.1 SCR 216 — the foundation, and what the rule does NOT say

> **Rule 216. Creation of foundation.**
>
> 1. The board of governors, with the approval of the supreme court, shall designate a tax-exempt bar foundation for the purposes of providing legally related services to the poor, to the victims of domestic violence, and to children protected by or in need of protection of the juvenile court; promoting or providing law-related educational programs for members of the public; and providing similar programs which qualify for tax-exempt status by the United States Internal Revenue Service under I.R.C. section 501(c)(3) or any additions thereto or amendments thereof. To carry out these purposes, the bar foundation may utilize the income accrued from interest-bearing client's trust accounts (IOLTA funds) as authorized by Rules 216 through 221, and as the supreme court may otherwise order.
>
> (a) Ninety-six percent of IOLTA funds, after adequate reserves (as approved by the supreme court) and reasonable expenses, shall be disbursed to civil legal service providers approved by the Access to Justice Commission for the purposes of providing legally related services to the poor, to victims of domestic violence, and to children protected by or in need of protection of the juvenile court. The remaining four percent of IOLTA funds shall be spent as the bar foundation deems appropriate, keeping in mind the purpose set forth in this rule.
>
> (b) Among factors to be considered in disbursing the funds should be the geographic origin of the funds.
>
> [Added; effective May 27, 1983; amended; effective July 22, 2022.]

**The rule names no foundation.** It creates a designation power. The recipient is therefore a fact about the world that the rule text does not supply, and it has to come from the designating bodies. The **Nevada Bar Foundation** identifies itself as the designated tax-exempt foundation and IOLTA administrator, and the State Bar's IOLTA pages direct remittances to it. That is a **corroborated** fact, not a primary-rule fact, and section 7 records it as such.

### 4.2 SCR 217 — mandatory IOLTA, the rate floor, and the annual verification

> **Rule 217. Creation and maintenance of interest-bearing trust accounts.** A member of the state bar or the member's law firm shall create or maintain an interest-bearing trust account for clients' funds that are nominal in amount or to be held for a short period of time in any banking, credit union, or savings and loan association that is in compliance with the following provisions:
>
> 1. An interest-bearing trust account established pursuant to this rule may be established with any state bar-approved bank, credit union, or savings and loan association authorized by federal or state law to do business in Nevada, located in Nevada and insured by the Federal Deposit Insurance Corporation or the Federal Savings and Loan Insurance Corporation or other financial institution approved by the state bar pursuant to Rule 78.5 of these rules. Funds in each interest-bearing account shall be subject to withdrawal upon request and without delay.
> 2. Interest minimum standards. The Nevada Supreme Court Access to Justice Commission shall review and set twice annually the rate(s) of interest payable upon any interest-bearing trust account and make the rate(s) public at least 30 days prior to the effective date.
>
> (a) The minimum rate shall be 0.70 percent.
>
> (b) Higher rates offered by the institution are permissible so long as there is no impairment of the right to withdraw or transfer principal immediately without penalty.
>
> 3. Fees prohibited. Accounts under this rule shall be exempt from service charges and fees.
> 4. Reporting. A member of the state bar or the member's law firm establishing such account shall:
>
> (a) Direct the depository institution to:
>
> (1) remit interest or dividends, as the case may be, on the average monthly balance in the account or as otherwise computed in accordance with an institution's standard accounting practice at least monthly, to the designated tax-exempt foundation pursuant to Rule 216;
>
> (2) transmit with each remittance in an electronic format to be specified by the designated tax-exempt foundation a statement that shall include:
>
> (i) the name of the member of the state bar or the member's law firm for whom the remittance is sent;
>
> (ii) the rate of interest applied;
>
> (iii) the account number for each account;
>
> (iv) the average amount on deposit for each account;
>
> (v) the rate and type of interest or dividends remitted;
>
> (vi) the average account balance for the monthly period for which the report is made; and
>
> (3) transmit to the depositing member of the state bar or the member's law firm at the same time a report showing the amount paid to the designated tax-exempt foundation; and
>
> (b) Establish and follow reasonably prudent procedures to verify, at least annually, that each account maintained under this rule is on deposit with an institution currently listed by the designated tax-exempt foundation as operating in compliance with the Interest Minimum Standards set forth in subsection 2 above. Member verification shall be reported to the state bar, by completing and submitting a form provided with the annual membership fee statements.
>
> 5. Exceptions. If the member or the member's law firm does not maintain an office within 20 miles of a complying financial institution pursuant to subsection 6:
>
> (a) The minimum interest standards set forth in subsection 2 (a)-(c) are waived; and
>
> (b) The reporting requirements of subsection 4(a)(ii) are partially waived such that the member must direct the depositing institution to report at least quarterly, electronically if possible, to include at a minimum the name of the member of the state bar or the member's law firm for whom the remittance is sent and the rate of interest applied.
>
> Notice of waiver shall be reported by the member or member's law firm annually on a form to be provided by the state bar with annual membership fee statements.
>
> 6. List of complying financial institutions. The designated tax-exempt foundation shall maintain an accurate and up-to-date list of all financial institutions as defined in subsection 1 above, which are in compliance with the Interest Minimum Standards set forth in subsection 2 above. This list shall be provided to the state bar by the designated tax-exempt foundation, posted on the state bar's website and published in other media from time to time to facilitate members' compliance with this rule.
> 7. Non-compliance; assessment/suspension. Active members who fail to meet the requirements of this rule shall be notified of their non-compliance, in writing, by the state bar. Upon the expiration of 30 days from the date the state bar sends the member notice of non-compliance, said non-compliant member shall be:
>
> (a) Assessed $200, payable within 30 days to the designated tax-exempt foundation pursuant to Rule 216; and
>
> (b) Suspended from membership in the state bar, but may be reinstated upon filing verification of compliance on a form to be provided by the state bar.
>
> Supplying false information in response to the requirements of this rule shall subject the member to appropriate disciplinary action.
>
> [Added; effective May 27, 1983; amended; effective October 5, 2019.]

**IOLTA is mandatory in Nevada.** The opening words are "shall create or maintain", and the consequence of not doing so is a $200 assessment and suspension. That is not an opt-out regime.

**Three internal defects in the published text, recorded because a reader will hit them.** Subsection 5(a) waives "the minimum interest standards set forth in subsection 2 (a)-(c)", but subsection 2 has only (a) and (b). Subsection 5(b) waives "the reporting requirements of subsection 4(a)(ii)", but 4(a) is numbered (1)-(3), not with roman numerals; the roman numerals belong to 4(a)(2). And subsection 1 routes institutional approval through "Rule 78.5 of these rules" — **a rule repealed on 22 August 2019**, six weeks before this rule was itself amended on 5 October 2019. None of the three is encodable, and none is the platform's to resolve; they are recorded so that a later reader does not conclude the transcription is wrong.

### 4.3 SCR 219, 220, 220.5, 221 — earnings and the eligibility judgment

> **Rule 219. Availability of earnings to client.** Upon request of a client, when economically feasible, earnings shall be made available to the client on deposited trust funds which are neither nominal in amount nor to be held for a short period of time.
>
> [Added; effective May 27, 1983.]

> **Rule 220. Availability of earnings to attorney.** No earnings from clients' funds may be made available to a member of the state bar or the member's law firm except as disbursed through the designated Bar Foundation for services rendered.
>
> [Added; effective May 27, 1983.]

> **Rule 221. Determination of whether funds are eligible.** The determination of whether a client's funds are nominal in amount or to be held for a short period of time rests exclusively in the sound judgment of each member of the state bar, and no charge of ethical impropriety or other breach of professional conduct shall attend the member's good faith exercise of judgment in that regard.
>
> [Added; effective May 27, 1983.]

**SCR 221 is the clearest judgment-standard in the Nevada set, and the engine must not pretend to make the call.** "Rests exclusively in the sound judgment of each member of the state bar" is an express allocation of the decision away from any rule and, by extension, away from any software that would apply one. Nevada states no dollar threshold and no duration. The correct encoding is a value of kind _lawyer judgment_ that renders the standard with its citation and **never routes funds**. Anything else — a default threshold, a suggested figure, a "most firms use" hint — would be the platform exercising a judgment the rule assigns to the lawyer.

Rule 220.5 requires annual audited financial statements from the bar foundation to the supreme court. It binds the foundation, not the firm; nothing is encoded from it.

---

## 5. What Nevada does NOT require — the verified negatives

A negative claim needs its search recorded, because the honest basis for it is exhaustiveness rather than a citation.

### 5.1 No reconciliation requirement of any kind

**Searched:** the complete text of the Nevada Rules of Professional Conduct (<https://www.leg.state.nv.us/CourtRules/RPC.html>, 150,229 characters) and the complete text of the Nevada Supreme Court Rules (<https://www.leg.state.nv.us/CourtRules/SCR.html>, 627,927 characters), both fetched 2026-08-07 and searched case-insensitively for `reconcil`, `three-way`, and `triple`.

**Hits: zero, in both documents, for all three terms.**

**No Nevada rule requires a trust-account reconciliation.** Not monthly, not quarterly, not three-way, not at all. The obligation the rules do impose is a records obligation — SCR 78(1)(b)'s "clearly and expressly reflecting the date, amount, source, and explanation" — which reconciliation is a means of satisfying rather than an independent duty.

**The trap, and where it came from.** The State Bar's handbook _Trust Accounting in Nevada_ states, verbatim:

> SCR 217(4)(a) requires you to do monthly reconciliations of your client trust bank accounts to make sure that your records match the bank's records.

SCR 217(4)(a) is quoted in full in section 4.2 above. It directs the _depository institution_ to remit interest at least monthly to the foundation and to transmit a statement with the remittance. It imposes no duty on the lawyer to reconcile anything. **The handbook's citation does not support its claim.** The handbook's advice is sound practice and the platform's reconciliation feature is worth having; what cannot be done is encoding "monthly, three-way, required" as a Nevada rule with SCR 217(4)(a) as the authority, because that citation would not survive an examiner reading it.

The approved trust-jurisdiction schema design lists Nevada in its golden tests as "(7 years, monthly three-way)". **Both halves of that expectation are wrong against the current primary text**, and the golden test would have locked in the error.

### 5.2 No prohibited disbursement methods

**Searched:** both documents above, for `cash withdrawal`, `payable to Cash`, `automated teller`, `ATM`, `debit card`, and `overdraft protection`.

**Hits in the rule text: none of these terms appears in NRPC 1.15 or in SCR 78 or SCR 216-221 as a prohibition.** Nevada's black-letter rules do not ban cash withdrawals from a trust account, do not ban ATM or debit-card access, do not ban checks payable to Cash, and do not ban overdraft protection.

The State Bar handbook does advise, verbatim, that a client trust bank account:

> Should NOT have ATM access. ATM access should be distinguished from "online" banking.

That is **guidance in a handbook, not a rule**, and the restriction bucket is precisely where a wrong silence is dangerous in the _other_ direction — encoding a ban Nevada has not enacted would refuse a lawyer a method the rules permit, and would do it in the platform's own voice. The correct encoding is an explicitly recorded silence, which resolves the restriction OFF, with the handbook's recommendation carried as prose so a firm can still see it and may opt in. A firm may always be stricter than its jurisdiction; the platform may not be stricter on the jurisdiction's behalf.

### 5.3 No treatment of payment-processor or credit-card fees

**Searched:** both rule documents and the State Bar handbook for `credit card`, `processing fee`, `merchant`, `surcharge`, and `processor`. **No hit addresses how a card-processing fee interacts with a trust deposit.**

This is a researched silence in the three sources consulted, not a settled finding about Nevada law — an ethics opinion or a Board of Governors position may exist that was not reached here. It is recorded as unresearched-beyond-these-sources and therefore **does not resolve**. The platform's own fees-never-touch-trust rule is enforced structurally for every firm regardless, so the absence of a Nevada value costs nothing operationally.

---

## 6. The State Bar handbook — useful, and stale in two places

**Source:** _Trust Accounting in Nevada_, published by the State Bar of Nevada, **copyright 2019**, ISBN 978-1-929815-08-1, adapted from the State Bar of California's Client Trust Accounting Handbook (2016) and the New Jersey Office of Attorney Ethics' recordkeeping outline. Fetched 2026-08-07 from <https://nvbar.org/wp-content/uploads/Trust-Accounting-in-Nevada-1.pdf> (69 pages). A second State Bar file, <https://nvbar.org/wp-content/uploads/Trust-Accounts-Master-Rule-217-Update.pdf> (66 pages), is titled "2018 Edition", also copyright 2019, and carries the same substantive text.
**Status: GUIDANCE, NOT LAW.** The handbook says so itself: "It should not, however, be construed as legal advice."

**It is the best practical Nevada material available** — worked examples of client ledgers, an account journal, month-end adjustment forms, and a full reconciliation walkthrough. It is exactly the shape of the records SCR 78(1)(b) demands, and it is worth reading before designing the client-ledger and trust-journal reports.

**It is stale in two places, and both are load-bearing.**

**Retention.** The handbook reproduces NRPC 1.15(a) as:

> Complete records of such account funds and other property shall be kept by the lawyer and shall be preserved for a period of seven years after termination of the representation.

and advises:

> RPC 1.15 requires you to keep trust accounting records for seven years after final disposition of the underlying matter.

The **current** rule (section 2, source note amended effective April 19, 2021) says **five years after termination of the representation**. The handbook is a 2019 publication quoting the pre-2021 text; its reproduction also stops at paragraph (e) and lacks paragraphs (f) and (g), which the same 2021 amendment added. The handbook's own advisory sentence additionally conflates the two clocks, attributing SCR 78's "final disposition of the underlying matter" trigger to RPC 1.15.

The handbook is even internally inconsistent about it, in adjacent bullets:

> Like bank-created records, SCR 78.5(b) requires you to retain these records for a minimum of five years after final disposition of the underlying matter.
>
> However, RPC 1.15(a) requires attorneys to preserve "complete records" of account funds and other property for a period of seven years after the termination of representation.

**Rule numbering.** The handbook's rule appendix is headed "SCR 78.5. Maintenance of trust funds in approved financial institutions; overdraft notification." and it cites SCR 78.5 throughout, including "your duty under SCR 78.5(5)". SCR 78.5 was repealed on 22 August 2019 — the same year the handbook was published — and the rule is now **SCR 78**. The text the handbook reproduces is substantively the same; only the number moved.

**Consequence for the encoding.** Nothing in the profile takes the handbook as its authority. Where the handbook and the rule text disagree, the rule text wins and the disagreement is recorded. Where the handbook says something the rules do not (monthly reconciliation, no ATM access), it is carried as prose guidance and never as a value the engine computes on.

---

## 7. Facts that are true but not in the rule text

Recorded separately because their source tier is different, and because the schema's provenance model exists exactly to keep this distinction visible.

**The designated foundation is the Nevada Bar Foundation.** SCR 216 creates a designation power and names nobody (section 4.1). The Nevada Bar Foundation publishes that it is the designated tax-exempt foundation and the IOLTA administrator, the recipient of remitted interest, and the third-party beneficiary of the trust account; the State Bar of Nevada's IOLTA pages direct lawyers to it. Consulted 2026-08-07 via <https://nevadabarfoundation.org/iolta/> and <https://nvbar.org/for-lawyers/resources/iolta/>; both hosts return HTTP 403 to a plain fetcher, so this rests on search-surfaced content from those official hosts rather than on a page this document retrieved and read in full.
**Source tier: corroborated. Not primary.** It is encoded because the IOLTA field is unusable without a recipient and the fact is not seriously in doubt, but it is flagged for the reviewing attorney as the one encoded value whose authority is not a rule.

**Advance flat fees are not earned on receipt.** _In re Discipline of Hardeep Sull_, Supreme Court of Nevada, docket No. 86781, en banc, holds that "Fees paid in advance of legal services being performed are not earned upon receipt"; that when a lawyer receives an advance of fees, "that fee must be placed in a Rule 1.15-compliant trust account, to be disbursed to the lawyer only after the fee has been earned"; and that "Use of the term 'flat fee' or 'fixed fee' does not transform [an] arrangement into a fee that is 'earned when paid.'"
**Status: CORROBORATED, with an unresolved discrepancy.** The quotations are from <https://caselaw.findlaw.com/court/nv-supreme-court/116513012.html> (fetched 2026-08-07), which dates the opinion 22 August 2024; a Justia listing for the same docket number gives the citation as 141 Nev. Adv. Op. No. 43 and places it in 2025. The official opinion at `nvcourts.gov` was not retrieved (the Justia page returns HTTP 403 and the court's advance-opinion index was not read through to the document). **The date and citation are therefore unverified and nothing is encoded on this case.** It is recorded because it closes the flat-fee question the existing catalog flagged as needing verification, and because it points the same way as NRPC 1.15(c) — which is the authority the encoded advance-fee value actually rests on.

**No IOLTA account bears service charges.** SCR 217(3), primary and verbatim: "Accounts under this rule shall be exempt from service charges and fees." This is section 8's problem.

---

## 8. The firm-funds bank-charge carve-out — the rule, and why it is NOT wired

This is the piece the owner conditionally confirmed as "Bank fees are allowed. Permits this." The rule text is set out here beside what the platform would have to do to act on it.

**The rule, verbatim, in full.** NRPC 1.15(b):

> A lawyer may deposit the lawyer's own funds in a client trust account for the sole purpose of paying bank service charges on that account, but only in an amount necessary for that purpose.

**The owner's reading is correct on the point it addresses.** Nevada permits it. The rule is permissive ("may"), purpose-limited ("for the sole purpose of paying bank service charges on that account"), and amount-limited by a functional test ("only in an amount necessary for that purpose"). That is the classic carve-out, and it matches the trust analysis's description of what the designated firm-funds leaf is for.

**Four ways the rule text does not settle what the built `firm_funds` leaf would need.** The instruction was to stop on this piece and flag rather than adapt silently, and each of these is a place where wiring the leaf would require inventing something Nevada does not say.

**One — Nevada states no cap, and the cap it does state is not a number.** "Only in an amount necessary for that purpose" is a standard applied after the fact to a known schedule of charges, not a ceiling a database can hold. The built account model bounds a leaf with `max_balance_minor`, an integer. There is no integer in Nevada's rule to put there, and choosing one — a month of charges, a year's, a round figure — would be the platform legislating. Leaving it unbounded is defensible, but it means the leaf enforces nothing, and the analysis explicitly left "whether it carries a maximum bound" as an owner decision rather than a research question. **Nevada does not answer it. It remains open.**

**Two — in Nevada the carve-out has almost no application to the account it would sit in.** SCR 217(3): "Accounts under this rule shall be exempt from service charges and fees." An IOLTA account — the pooled account SCR 217 compels for nominal or short-term funds, and the account most Nevada firms hold — bears no service charges, so there is nothing for the lawyer's own funds to pay. The carve-out bites only on a **non-IOLTA** trust account. The platform's `trust_account` table carries no IOLTA discriminator, so the engine cannot tell which kind of account it is being asked about and therefore cannot tell whether the permission applies at all. Wiring the leaf without that discriminator would enable, on every Nevada trust account, a deposit that is pointless on most of them.

**Three — enabling it means changing the one guard that owns no-commingling.** The composition guard refuses any posting to a firm-funds node outright (`firm-funds-node-not-enabled`, "the firm-funds carve-out is not enabled; firm money cannot enter a trust account"). That guard is the structural owner of no-commingling and fees-never-touch-trust for the whole platform, and billing and the payments rail inherit the rule by calling it. Punching a permitted hole in it is a change to the single most invariant-heavy code path in the subsystem, and it is not a change a jurisdiction rule alone should authorise.

**Four — the three-way proof would silently stop tying out.** The client side of the reconciliation is the sum of the matter leaves. The trust analysis's own description of the client side is "the sum of every client or matter leaf under that account's parent, **plus the firm-funds leaf**". The built proof does not know about firm funds — and the built schema hangs a firm-funds node with a null parent, outside the client roll-up, which is a different shape from the "leaf under the same trust account parent" the analysis described. The moment a firm-funds balance is non-zero, book and client disagree by exactly that balance, and the proof reports a `book-to-client` discrepancy — the very signal that is supposed to mean _something reached the ledger without going through the composition guard_. Enabling the carve-out without teaching the proof about it would poison the alarm.

**Nevada also does not require the record the leaf exists to produce.** SCR 78(1)(b)'s enumeration has no equivalent of Maryland's requirement to identify the lawyer's own funds in the account. So Nevada supplies a permission and no obligation, which is the weakest possible mandate for building the structure.

**What is done instead.** The rule is encoded as a **prose invariant field carrying its verbatim text and citation, and nothing branches on it.** A firm's reviewing attorney sees exactly what NRPC 1.15(b) permits, beside a platform that does not yet act on it, and the composition guard keeps refusing. That is the honest state: the permission is recorded, the machinery is not built, and no user is told the platform supports something it does not.

---

## 9. Maintenance — how Nevada's rules change, and what to watch

**Court rules move by court order, not by legislative session.** This matters because the repository's earlier Nevada research established the legislature's biennial cadence for the NRS, and **that cadence does not govern here**. NRPC 1.15 was amended effective 19 April 2021; SCR 78 effective 22 August 2019; SCR 217 effective 5 October 2019; SCR 216 effective 22 July 2022. None of those dates aligns with a legislative session. Amendments arrive by Supreme Court order (the ADKT docket) on their own schedule, and a rule can change at any time.

**The mechanical staleness check.** Every page carries a revision stamp of the form `[Rev. <date>--<session year>]`; both pages fetched for this document read `--2025`. That stamp advances with the legislature and is therefore **not** a reliable signal for court rules. The reliable signal is the **bracketed source note at the foot of each rule**, which names the effective date of its last amendment. The encoded profile stores those effective dates alongside each citation for exactly this reason: re-verification is a comparison of two dates, not a re-reading of the text.

**Review cadence: annually, and on notice of any relevant ADKT order.** Two specific things to watch. First, any amendment to NRPC 1.15 — the five-year retention figure, the paragraph (b) carve-out, and the paragraph (f) unclaimed-funds mechanism are three encoded values in one rule. Second, whether the dangling cross-references get repaired: SCR 217(1) and NRPC 7.5A both still route through the repealed SCR 78.5, and the order that fixes them may move other things.

**One caution for whoever re-runs this.** The State Bar's handbook is the first result for almost every Nevada trust-accounting search, it is authoritative-looking, it is published by the body that disciplines Nevada lawyers, and on the two most encodable numbers in the subject it is **out of date**. Read the rule.

---

## 10. Profile entries this supports

Each row is a candidate value for the Nevada jurisdiction profile. **Only rows marked VERIFIED may carry a machine-readable value**, and no row resolves at all until an attorney has reviewed the profile.

| Field                                       | Value                                                                                         | Confidence                                                                 | Authority                                                                                                                                       | Status                                                                                                                                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recordsRetention`                          | 5 years                                                                                       | HIGH                                                                       | NRPC 1.15(a) (from termination of the representation) and SCR 78(1)(b) ("at least five years", from final disposition of the underlying matter) | **VERIFIED.** Two clocks, one number; both citations carried. Supersedes the "7 years" figure, which is the pre-2021 text                                                                                                                     |
| `reconciliation`                            | not required                                                                                  | NOT_ADDRESSED                                                              | zero occurrences of `reconcil` in the complete NRPC and SCR                                                                                     | **VERIFIED NEGATIVE.** Rigor bucket: the platform's own reconciliation stays available and encouraged; what is refused is the claim that Nevada mandates it                                                                                   |
| `prohibitedDisbursementMethods`             | none                                                                                          | NOT_ADDRESSED                                                              | no method prohibition in NRPC 1.15 or SCR 78 / 216-221                                                                                          | **VERIFIED NEGATIVE.** Restriction bucket: resolves OFF on a recorded silence. The handbook's ATM advice is carried as prose and is opt-in                                                                                                    |
| `interestOnLawyerTrustAccount`              | mandatory; Nevada Bar Foundation; remit at least monthly; 0.70 percent floor                  | HIGH on mandatory / cadence / rate; **corroborated only** on the recipient | SCR 217 opening ("shall create or maintain"), 217(2)(a), 217(4)(a)(1), 217(7); recipient from the Foundation and State Bar, not from SCR 216    | **VERIFIED except the recipient name**, which SCR 216 does not state — flagged for the reviewing attorney                                                                                                                                     |
| `interestThreshold`                         | lawyer's judgment                                                                             | MEDIUM, `judgmentStandard`                                                 | SCR 221 ("rests exclusively in the sound judgment of each member of the state bar")                                                             | **VERIFIED, and permanently non-binding.** Renders the standard, never routes funds. Further research cannot promote this                                                                                                                     |
| `overdraftNotification`                     | required; report to state bar counsel; 5 banking days when honored against insufficient funds | HIGH                                                                       | SCR 78(2), 78(3), 78(4)                                                                                                                         | **VERIFIED.** Note the reporting duty is the bank's, not the firm's                                                                                                                                                                           |
| `unclaimedFunds`                            | Clients Security Fund; 5 years from receipt; diligence required; permissive                   | HIGH                                                                       | NRPC 1.15(f) and (f)(3)                                                                                                                         | **VERIFIED, with a type-fit problem:** Nevada's remittance is "**may** remit", and its five years runs from **receipt of the property**, not from a dormancy determination. The schema's `UnclaimedFunds` type models neither. See section 11 |
| `annualCompliance`                          | required; annual; on the annual membership fee statement                                      | HIGH                                                                       | SCR 217(4)(b)                                                                                                                                   | **VERIFIED**                                                                                                                                                                                                                                  |
| `advanceFeeTreatment`                       | into trust; withdraw only as earned or incurred                                               | HIGH                                                                       | NRPC 1.15(c), and NRPC 1.15(a) expressly including "advances for costs and expenses"                                                            | **VERIFIED** on the rule text alone. The flat-fee corollary is corroborated by _Sull_ but is not the authority                                                                                                                                |
| `processorFees`                             | —                                                                                             | NOT researched beyond three sources                                        | —                                                                                                                                               | **NOT ENCODED.** Does not resolve                                                                                                                                                                                                             |
| `segregation` (prose invariant)             | absolute                                                                                      | HIGH                                                                       | NRPC 1.15(a)                                                                                                                                    | **VERIFIED.** Enforced for every firm regardless; carried for citation                                                                                                                                                                        |
| `disputedFunds` (prose invariant)           | keep separate until resolved; distribute the undisputed portion promptly                      | HIGH                                                                       | NRPC 1.15(e)                                                                                                                                    | **VERIFIED.** This is the hold model's rule                                                                                                                                                                                                   |
| `firmFundsForBankCharges` (prose invariant) | permitted; sole purpose; only the amount necessary; no cap stated                             | HIGH on the rule                                                           | NRPC 1.15(b), read with SCR 217(3)                                                                                                              | **VERIFIED as to the rule; DELIBERATELY NOT WIRED.** Section 8                                                                                                                                                                                |

---

## 11. What could not be verified, and what does not fit

Recorded honestly. None of it is encoded.

1. **The Nevada Bar Foundation's designation, from a primary instrument.** SCR 216 names no foundation, and the board-of-governors designation order approved by the supreme court was not located. Both `nvbar.org` and `nevadabarfoundation.org` return HTTP 403 to a plain fetcher, so the fact rests on search-surfaced content from those hosts. It is the one encoded value whose authority is not a rule, and the reviewing attorney should confirm it.

2. **The date and citation of _In re Discipline of Sull_.** Two secondary sources disagree (22 August 2024 versus 141 Nev. Adv. Op. No. 43, 2025) and the official opinion was not retrieved. Nothing is encoded on the case.

3. **Payment-processor and surcharge treatment.** Not addressed in NRPC 1.15, SCR 78, SCR 216-221, or the State Bar handbook. A State Bar ethics opinion may address it; the opinions index was not worked through for this document. Carried as unresearched, and it does not resolve.

4. **Whether the platform's structure satisfies "complete records".** SCR 78(1)(b) enumerates records and NRPC 1.15(a) requires "complete records". Whether a particular software implementation discharges that duty is a legal judgment about a product, and it is exactly what the attorney-review gate is for. Nothing in this document asserts it.

5. **Two type-fit problems in the approved schema design, both surfaced by Nevada and neither resolved here.**

   The design's `UnclaimedFunds` carries `destination`, `dormancy`, `diligenceRequired`, `reclaimable`, and `deMinimisMinor`. Nevada's NRPC 1.15(f) is **permissive** — "the lawyer or firm **may** remit the funds" — and the design has no field for whether remittance is compelled or merely allowed. Encoding Nevada as though remittance were mandatory would state a duty the rule does not impose. Nevada's period also runs from **receipt of the property**, which is not a dormancy clock at all: money received five years ago and actively disputed last week is inside the five years by the rule's own measure. `dormancy: "P5Y"` would therefore be measured from the wrong event. Both are recorded on the field and the value is encoded with its clock named rather than silently reshaped.

   The design's `Reconciliation` type is `{ required: boolean; cadence: "monthly" | "quarterly"; threeWay: boolean }`. A jurisdiction that requires nothing has no cadence, and `required: false` with an invented cadence is exactly the kind of wrong claim the type model exists to prevent. Nevada's reconciliation field carries no value at all, which is what a recorded silence means.

6. **Nine of the eleven judicial districts, and every local rule.** Only statewide instruments were read. Nothing here establishes a local trust-accounting requirement, and none is encoded.

7. **Non-Nevada jurisdictions.** Nothing in this document supports a value for any other jurisdiction. The existing narrative catalog covers the other 55 at varying confidence and cites SCR 78.5 for Nevada — a repealed rule — which is a reason to treat every unreviewed entry in it as a research lead rather than a finding.
