import type { JurisdictionProfile } from "../types.ts";

// Nevada's trust-accounting rules, transcribed from the state's own published rule text.
//
// SOURCES, and they are the only ones any value here rests on:
//   Nevada Rules of Professional Conduct   https://www.leg.state.nv.us/CourtRules/RPC.html
//   Nevada Supreme Court Rules             https://www.leg.state.nv.us/CourtRules/SCR.html
// Both fetched 2026-08-07, both stamped [Rev. 4/15/2026 --2025].
//
// The full research record — every verbatim quote, the searches that establish the negatives, and
// the two places where the State Bar's own published handbook is out of date — is
// docs/research/2026-08-07-nevada-trust-accounting-rules.md. Read it before changing a value here.
//
// THREE THINGS A READER WILL OTHERWISE GET WRONG, because the widely circulated Nevada material
// says otherwise and is stale:
//
//   1. The account-mechanics rule is SCR 78. SCR 78.5 was REPEALED on 22 August 2019 and its
//      content moved into SCR 78 on the same date. Material citing SCR 78.5 predates that — which
//      includes SCR 217(1) and NRPC 7.5A, both of which still contain the dangling cross-reference.
//   2. Records retention under NRPC 1.15(a) is FIVE years, not seven. Seven is the pre-2021 text.
//   3. Nevada mandates NO reconciliation. The string "reconcil" does not occur anywhere in the
//      Nevada Rules of Professional Conduct or the Nevada Supreme Court Rules. Guidance attributing
//      a monthly reconciliation duty to SCR 217(4)(a) miscites it: that subsection directs the
//      DEPOSITORY INSTITUTION to remit interest, and says nothing about reconciling anything.

const RULES_OF_PROFESSIONAL_CONDUCT_URL = "https://www.leg.state.nv.us/CourtRules/RPC.html";
const SUPREME_COURT_RULES_URL = "https://www.leg.state.nv.us/CourtRules/SCR.html";
const RETRIEVED_ON = "2026-08-07";

export const NEVADA_PROFILE: JurisdictionProfile = {
  jurisdictionCode: "US-NV",
  name: "Nevada",
  revision: "2026-08-07",

  // NOT REVIEWED. Nothing in this profile resolves until a licensed attorney has read the values
  // against the rule text and recorded that here. This is not a placeholder to be filled in to make
  // a test pass: an unreviewed profile that resolved would put the platform's voice behind a
  // compliance answer no lawyer has stood behind.
  attorneyReview: null,

  typed: {
    recordsRetention: {
      confidence: "HIGH",
      value: {
        years: 5,
        // Two rules, one number, DIFFERENT EVENTS. A matter can be finally disposed of long after
        // the representation ends, or the reverse, so neither citation is redundant and neither
        // alone gives a date. Both are carried and the platform's retention posture is a purge
        // floor rather than a computed deletion date.
        clocks: [
          { trigger: "termination of the representation", citation: "NRPC 1.15(a)" },
          { trigger: "final disposition of the underlying matter", citation: "SCR 78(1)(b)" },
        ],
      },
      note: "Five years under both rules, measured from two different events. SCR 78(1)(b) says 'at least five years', so it is a floor rather than a period.",
      provenance: {
        citation: "Nev. R. Prof. Conduct 1.15(a); Nev. Sup. Ct. R. 78(1)(b)",
        quote:
          "Complete records of such account funds and other property shall be kept by the lawyer and shall be preserved for a period of five years after termination of the representation. / Every lawyer engaged in the practice of law in the State of Nevada shall maintain and preserve for a period of at least five years, after final disposition of the underlying matter, the records of the accounts",
        sourceUrl: RULES_OF_PROFESSIONAL_CONDUCT_URL,
        sourceTier: "primaryOfficial",
        ruleEffectiveDate: "2021-04-19",
        retrievedOn: RETRIEVED_ON,
      },
    },

    // A RECORDED SILENCE, and one of the most consequential findings about Nevada. Searching the
    // complete text of both rule sets for "reconcil", "three-way" and "triple" returns nothing.
    // Nevada imposes a RECORDS duty (SCR 78(1)(b)) that reconciliation is a way of satisfying; it
    // imposes no reconciliation duty of its own, at any cadence. The platform's reconciliation
    // feature stays available and worth using — what is refused is the claim that Nevada compels it.
    reconciliation: {
      confidence: "NOT_ADDRESSED",
      note: "No Nevada rule requires a trust-account reconciliation. Zero occurrences of 'reconcil' in the complete Nevada Rules of Professional Conduct and the complete Nevada Supreme Court Rules. State Bar guidance recommends a monthly reconciliation and attributes it to SCR 217(4)(a), which is the subsection directing the depository institution to remit interest and imposes no duty on the lawyer.",
      provenance: {
        citation:
          "Nev. R. Prof. Conduct 1.15; Nev. Sup. Ct. R. 78, 216-221 (no reconciliation provision)",
        sourceUrl: SUPREME_COURT_RULES_URL,
        sourceTier: "primaryOfficial",
        retrievedOn: RETRIEVED_ON,
      },
    },

    interestOnLawyerTrustAccount: {
      confidence: "HIGH",
      value: {
        mandatory: true,
        // SCR 216 creates a designation power and NAMES NOBODY. The recipient is therefore the one
        // value in this profile whose authority is not a rule — see the note, and the flag in the
        // research record.
        recipient: "Nevada Bar Foundation",
        remitCadence: "monthly",
        minimumRateDescription:
          "0.70 percent minimum, reviewed and set twice annually by the Nevada Supreme Court Access to Justice Commission",
      },
      note: "Mandatory: SCR 217 opens 'shall create or maintain', and non-compliance draws a $200 assessment and suspension under SCR 217(7). THE RECIPIENT IS NOT IN THE RULE — SCR 216 empowers the board of governors, with supreme court approval, to designate a tax-exempt bar foundation and does not say which. 'Nevada Bar Foundation' comes from the Foundation's and the State Bar's own IOLTA pages, not from the rule text.",
      provenance: {
        citation:
          "Nev. Sup. Ct. R. 217, 217(2)(a), 217(4)(a)(1), 217(7); recipient from State Bar of Nevada and Nevada Bar Foundation IOLTA program materials",
        quote:
          "A member of the state bar or the member's law firm shall create or maintain an interest-bearing trust account for clients' funds that are nominal in amount or to be held for a short period of time ... The minimum rate shall be 0.70 percent. ... remit interest or dividends, as the case may be, on the average monthly balance in the account ... at least monthly, to the designated tax-exempt foundation pursuant to Rule 216",
        sourceUrl: SUPREME_COURT_RULES_URL,
        sourceTier: "corroborated",
        ruleEffectiveDate: "2019-10-05",
        retrievedOn: RETRIEVED_ON,
      },
    },

    // The clearest judgment standard in the Nevada set. SCR 221 puts the call "exclusively" with the
    // lawyer, so this resolves ADVISORY and must never route funds: the engine renders the standard
    // and asks. Nevada states no dollar figure and no duration, and inventing either — even as a
    // suggestion — would be the platform exercising a judgment the rule withholds from it.
    interestThreshold: {
      confidence: "MEDIUM",
      mediumKind: "judgmentStandard",
      value: {
        kind: "lawyerJudgment",
        standard:
          "whether the client's funds are nominal in amount or to be held for a short period of time",
      },
      note: "Permanent. No further research promotes this: the rule assigns the determination to the lawyer and protects a good-faith exercise of it from discipline. SCR 219 is the consequence — on client request, when economically feasible, earnings go to the client on funds that are neither nominal nor short-term.",
      provenance: {
        citation: "Nev. Sup. Ct. R. 221; see also Nev. Sup. Ct. R. 219",
        quote:
          "The determination of whether a client's funds are nominal in amount or to be held for a short period of time rests exclusively in the sound judgment of each member of the state bar, and no charge of ethical impropriety or other breach of professional conduct shall attend the member's good faith exercise of judgment in that regard.",
        sourceUrl: SUPREME_COURT_RULES_URL,
        sourceTier: "primaryOfficial",
        ruleEffectiveDate: "1983-05-27",
        retrievedOn: RETRIEVED_ON,
      },
    },

    // A RECORDED SILENCE, and the direction it fails matters. Nevada's black-letter rules ban no
    // disbursement method — not cash withdrawal, not automated-teller or debit access, not a check
    // payable to Cash, not overdraft protection. State Bar guidance advises against automated-teller
    // access, and that is guidance rather than law. Encoding a ban Nevada has not enacted would
    // refuse a lawyer a method the rules permit, in the platform's own voice. A firm that wants the
    // stricter posture opts into it: a firm may always be stricter than its jurisdiction, and the
    // platform may never be stricter on the jurisdiction's behalf.
    prohibitedDisbursementMethods: {
      confidence: "NOT_ADDRESSED",
      note: "No method prohibition in NRPC 1.15 or in SCR 78 or SCR 216-221. State Bar guidance advises that a client trust bank account 'Should NOT have ATM access' — a recommendation in a handbook, not a rule, and available to a firm as an opt-in restriction rather than as a Nevada requirement.",
      provenance: {
        citation:
          "Nev. R. Prof. Conduct 1.15; Nev. Sup. Ct. R. 78, 216-221 (no method prohibition)",
        sourceUrl: RULES_OF_PROFESSIONAL_CONDUCT_URL,
        sourceTier: "primaryOfficial",
        retrievedOn: RETRIEVED_ON,
      },
    },

    overdraftNotification: {
      confidence: "HIGH",
      value: {
        required: true,
        notifyBody: "State Bar of Nevada bar counsel",
        // The duty is the BANK's, not the firm's, and that changes what the platform can usefully
        // do with this: a firm cannot be prompted to file a report it does not owe. What it can be
        // told is that its trust account must sit in an institution that has filed the agreement.
        reportedBy: "financialInstitution",
        reportWithinBankingDays: 5,
      },
      note: "Approval of a depository is conditioned on the institution filing a reporting agreement, and no trust account may be held at an institution that has not. The five banking days apply to an instrument presented against insufficient funds that is HONORED; a dishonored instrument is reported simultaneously with the notice of dishonor.",
      provenance: {
        citation: "Nev. Sup. Ct. R. 78(2), 78(3), 78(4)",
        quote:
          "A financial institution shall be approved as a depository for lawyer trust accounts if it files with the state bar an agreement, in a form provided by the state bar, to report to the state bar counsel whenever any properly payable instrument is presented against a lawyer trust account containing insufficient funds, irrespective of whether or not the instrument is honored. ... If an instrument presented against insufficient funds is honored, then the report shall be made within five banking days of the date of presentation for payment against insufficient funds.",
        sourceUrl: SUPREME_COURT_RULES_URL,
        sourceTier: "primaryOfficial",
        ruleEffectiveDate: "2019-08-22",
        retrievedOn: RETRIEVED_ON,
      },
    },

    unclaimedFunds: {
      confidence: "HIGH",
      value: {
        destination: "Clients Security Fund",
        // PERMITTED, not required: the rule says the lawyer "may remit". Encoding this as a duty
        // would put a deadline on a firm that has none.
        remittance: "permitted",
        waitingPeriod: "P5Y",
        // NOT a dormancy clock. The five years run from RECEIPT OF THE PROPERTY, so money received
        // five years ago and actively disputed last week is outside the period by the rule's own
        // measure. Measuring from a dormancy determination instead would expire on the wrong day.
        waitingPeriodRunsFrom: "receipt of the property",
        diligenceRequired: true,
      },
      note: "Diligence is enumerated and is a precondition: no less than regular and certified mail to the last known address, telephone, and email, with the firm certifying and documenting its efforts before remitting. A good-faith remittance after reasonable efforts is expressly not misconduct. The Clients Security Fund grants remitted funds and does not hold them for future recovery, so remittance is not reversible.",
      provenance: {
        citation: "Nev. R. Prof. Conduct 1.15(f), 1.15(f)(3), 1.15(f)(4)",
        quote:
          "A lawyer or law firm with unclaimed or unidentified funds in a client trust account shall take reasonable efforts to locate and to distribute the funds to the owner. If the lawyer or firm cannot after reasonable efforts locate or distribute the unclaimed or unidentified funds to an owner within five years of receipt of the property, then the lawyer or firm may remit the funds to the Clients Security Fund except as otherwise provided by law. The Clients Security Fund shall grant remitted funds and shall not hold funds for future recovery.",
        sourceUrl: RULES_OF_PROFESSIONAL_CONDUCT_URL,
        sourceTier: "primaryOfficial",
        ruleEffectiveDate: "2021-04-19",
        retrievedOn: RETRIEVED_ON,
      },
    },

    annualCompliance: {
      confidence: "HIGH",
      value: {
        required: true,
        cadence: "annual",
        instrument: "verification form supplied with the annual State Bar membership fee statement",
      },
      note: "The verification is that each interest-bearing trust account is held at an institution currently listed as complying with the interest minimum standards. Failing it draws the SCR 217(7) assessment and suspension.",
      provenance: {
        citation: "Nev. Sup. Ct. R. 217(4)(b)",
        quote:
          "Establish and follow reasonably prudent procedures to verify, at least annually, that each account maintained under this rule is on deposit with an institution currently listed by the designated tax-exempt foundation as operating in compliance with the Interest Minimum Standards set forth in subsection 2 above. Member verification shall be reported to the state bar, by completing and submitting a form provided with the annual membership fee statements.",
        sourceUrl: SUPREME_COURT_RULES_URL,
        sourceTier: "primaryOfficial",
        ruleEffectiveDate: "2019-10-05",
        retrievedOn: RETRIEVED_ON,
      },
    },

    advanceFeeTreatment: {
      confidence: "HIGH",
      value: {
        advanceFeesHeldInTrust: true,
        withdrawableWhen: "as fees are earned or expenses incurred",
      },
      note: "Unconditional, and NRPC 1.15(a) reinforces it by counting 'advances for costs and expenses' among the funds that must be deposited in trust. Nevada therefore has no earned-on-receipt category by rule; the Supreme Court has separately held that labelling a fee 'flat' or 'fixed' does not make it earned when paid, but the encoded value rests on the rule text and not on the decision.",
      provenance: {
        citation: "Nev. R. Prof. Conduct 1.15(c); see also 1.15(a)",
        quote:
          "A lawyer shall deposit into a client trust account legal fees and expenses that have been paid in advance, to be withdrawn by the lawyer only as fees are earned or expenses incurred.",
        sourceUrl: RULES_OF_PROFESSIONAL_CONDUCT_URL,
        sourceTier: "primaryOfficial",
        ruleEffectiveDate: "2021-04-19",
        retrievedOn: RETRIEVED_ON,
      },
    },

    // NOT RESEARCHED, which is a different thing from a silence and refuses rather than resolving.
    // NRPC 1.15, SCR 78, SCR 216-221 and the State Bar's trust-accounting handbook were searched and
    // none addresses how a card-processing fee interacts with a trust deposit — but a State Bar
    // ethics opinion may, and the opinions index was not worked through. Costing nothing
    // operationally is why it can stay unresearched: the platform enforces fees-never-touch-trust
    // structurally for every firm, so no Nevada value is needed to get the behaviour right.
    processorFees: {
      confidence: "GAP",
      note: "Not addressed in NRPC 1.15, SCR 78, SCR 216-221, or the State Bar of Nevada trust-accounting handbook. The State Bar ethics-opinions index has not been searched, so this is unresearched rather than silent, and it refuses to resolve.",
    },
  },

  cited: {
    segregation: {
      confidence: "HIGH",
      summary:
        "Client and third-person property is held separate from the lawyer's own, in an identifiable trust account in the state where the lawyer's office is situated (or elsewhere with consent). Advances for costs and expenses are expressly client funds.",
      provenance: {
        citation: "Nev. R. Prof. Conduct 1.15(a)",
        quote:
          "A lawyer shall hold funds or other property of clients or third persons that is in a lawyer's possession in connection with a representation separate from the lawyer's own property. All funds received or held for the benefit of clients by a lawyer or firm, including advances for costs and expenses, shall be deposited in one or more identifiable bank accounts designated as a trust account maintained in the state where the lawyer's office is situated, or elsewhere with the consent of the client or third person.",
        sourceUrl: RULES_OF_PROFESSIONAL_CONDUCT_URL,
        sourceTier: "primaryOfficial",
        ruleEffectiveDate: "2021-04-19",
        retrievedOn: RETRIEVED_ON,
      },
    },

    // The rule behind the hold model: a duty to SEGREGATE the disputed portion, not to move it.
    disputedFunds: {
      confidence: "HIGH",
      summary:
        "Where two or more persons — possibly including the lawyer — claim an interest, the property is kept separate until the dispute resolves, and the undisputed portion is distributed promptly.",
      provenance: {
        citation: "Nev. R. Prof. Conduct 1.15(e)",
        quote:
          "When in the course of representation a lawyer is in possession of funds or other property in which two or more persons (one of whom may be the lawyer) claim interests, the property shall be kept separate by the lawyer until the dispute is resolved. The lawyer shall promptly distribute all portions of the funds or other property as to which the interests are not in dispute.",
        sourceUrl: RULES_OF_PROFESSIONAL_CONDUCT_URL,
        sourceTier: "primaryOfficial",
        ruleEffectiveDate: "2021-04-19",
        retrievedOn: RETRIEVED_ON,
      },
    },

    // THE BANK-CHARGE CARVE-OUT. Nevada permits it. The platform does NOT act on it, and the rule is
    // carried here for citation precisely so that the permission and the unbuilt machinery are
    // visible in the same place. The composition guard in @magna-carta/trust/composition-guard keeps
    // refusing every posting to a firm-funds node.
    //
    // Four things the rule does not settle, each of which would have to be invented to wire it:
    //
    //   - NO CAP. "Only in an amount necessary for that purpose" is a standard applied after the
    //     fact to a known schedule of charges, not an integer a bound can hold. Choosing a figure
    //     would be the platform legislating.
    //   - ALMOST NO APPLICATION. SCR 217(3): "Accounts under this rule shall be exempt from service
    //     charges and fees." A pooled interest-bearing account bears no service charges, so there is
    //     nothing for the lawyer's own funds to pay. The carve-out bites only on a non-pooled trust
    //     account, and the trust account record carries no discriminator that would tell them apart.
    //   - IT WOULD MEAN CHANGING THE ONE GUARD that owns no-commingling for the whole platform, and
    //     which billing and the payments rail inherit by calling it.
    //   - THE THREE-WAY PROOF WOULD STOP TYING OUT. The client side is the sum of the matter leaves;
    //     a non-zero firm-funds balance would show up as a book-to-client disagreement, which is the
    //     signal reserved for something having reached the ledger without passing the guard.
    //
    // Nevada also does not require the record a firm-funds leaf would produce: SCR 78(1)(b)'s
    // enumeration has no equivalent of the requirement, found in some other states, to identify
    // which funds in the account are the lawyer's own. Nevada supplies a permission and no
    // obligation.
    firmFundsForBankCharges: {
      confidence: "HIGH",
      summary:
        "Permitted: the lawyer's own funds may be deposited in a client trust account for the sole purpose of paying that account's bank service charges, and only in the amount necessary. No dollar cap is stated. Read with SCR 217(3), which exempts pooled interest-bearing trust accounts from service charges and fees, so the permission has little application to an account of that kind.",
      provenance: {
        citation: "Nev. R. Prof. Conduct 1.15(b); read with Nev. Sup. Ct. R. 217(3)",
        quote:
          "A lawyer may deposit the lawyer's own funds in a client trust account for the sole purpose of paying bank service charges on that account, but only in an amount necessary for that purpose.",
        sourceUrl: RULES_OF_PROFESSIONAL_CONDUCT_URL,
        sourceTier: "primaryOfficial",
        ruleEffectiveDate: "2021-04-19",
        retrievedOn: RETRIEVED_ON,
      },
    },

    requiredRecords: {
      confidence: "HIGH",
      summary:
        "Checkbooks, canceled checks, check stubs, vouchers, ledgers, journals, closing statements, and accountings or statements of disbursements rendered to clients or other parties — or equivalent records clearly and expressly reflecting the date, amount, source, and explanation for every receipt, withdrawal, delivery, and disbursement — produced to the State Bar for inspection on request.",
      provenance: {
        citation: "Nev. Sup. Ct. R. 78(1)(b)",
        quote:
          "the records of the accounts, including checkbooks, canceled checks, check stubs, vouchers, ledgers, journals, closing statements, accountings, or other statements of disbursements rendered to clients or other parties with regard to trust funds, or similar equivalent records clearly and expressly reflecting the date, amount, source, and explanation for all receipts, withdrawals, deliveries, and disbursements of the funds or other property of a client, and make such records available to the state bar for inspection upon request.",
        sourceUrl: SUPREME_COURT_RULES_URL,
        sourceTier: "primaryOfficial",
        ruleEffectiveDate: "2019-08-22",
        retrievedOn: RETRIEVED_ON,
      },
    },
  },
};
