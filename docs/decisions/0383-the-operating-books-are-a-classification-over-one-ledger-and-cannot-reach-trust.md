---
number: 383
slug: the-operating-books-are-a-classification-over-one-ledger-and-cannot-reach-trust
status: Proposed
date: 2026-08-17
area: Financial Core
summary: "The firm's operating books are metadata on ledger_account — a code, a statement section, a system-account marker — over the one append-only ledger, not a second ledger; there is one posting primitive and a source scan asserts the general-ledger package composes no entry, line, or balance write of its own. The general journal is a third door onto that primitive and is the shape that would defeat everything trust built, because the ledger is account-agnostic by design and a balanced entry naming a matter leaf and an income account would post client money into fee income. So the journal is made incapable of naming a trust account rather than taught the trust rules: every line resolves through trust's OWN loadTrustAccountRoles and the whole entry refuses by name unless every line is outside trust, with a fitness query re-proving it over stored rows (it catches the account registered as trust after a journal posted to it, which no pre-check can). The same refusal binds the vendor-bill and bill-payment composers. A chart MAY and must classify a trust-registered account for statement presentation — a trust bank account is an asset and the client-trust liability is an equal liability, and omitting them hides the one relationship an examiner checks — but MAY NOT map one to any firm_account_role, MAY NOT re-section one (the two reserved trust sections are derived from trust's registration, not stored as a firm's choice), and MAY NOT re-type one. There is deliberately NO is-trust flag on ledger_account: registration is already stored in three places and a fourth would be free to disagree with them silently in the one direction that matters."
---

**The operating books are a classification laid over the one ledger, and nothing this slice adds may
reach an account trust registered.**

**Context:** the baseline schema shipped `ledger_account` with a comment saying the chart-of-accounts
product arrives later on this schema, and trust deliberately creates its bank leaf and client-liability
root through `createAccount` carrying no classification, on the reasoning that a numbering scheme
guessed early is one the real chart would have to migrate away from. So the chart has to be added over
accounts that already exist, some of which hold client money.

The hazard is not the classification. It is that a general journal entry — a person typing debits and
credits — is a new way to reach `postEntry` that has never existed. The ledger primitive is
account-agnostic by design and cannot acquire a concept of "trust" without becoming the trust engine,
so a journal entry naming a matter leaf and an income account would be balanced, leaf-only,
single-currency, correctly dated, and would post client money into fee income. Every existing path
into the ledger goes through a composer that owns its rules; this one would not.

**Decision:**

(1) **One ledger, one posting primitive.** The chart is four additive columns on `ledger_account`
(`code`, `statement_section`, `system_account`, `description`); the five-value `type` CHECK is not
widened and normal balance stays derived in its one home. `@magna-carta/general-ledger` composes no
`ledger_entry` or `ledger_line` insert and no `account_balance` update, asserted by a source scan that
lands before the first line of service code and cannot pass vacuously.

(2) **The journal cannot name a trust account.** `composeGeneralJournalEntry` resolves every line
through **trust's own** `loadTrustAccountRoles` and refuses the whole entry
(`journal-entry-touches-trust`) unless every line resolves to `outside`. It is the inverse of a rule
trust owns, computed from trust's resolver rather than reimplemented — so a new tier of trust account
is refused the day it exists, with no edit here. A locally written "is this account trusty?" predicate
would be a second answer, and the day the two disagreed the journal would be the one that let money
through. The same refusal binds the vendor-bill and bill-payment composers.

(3) **A fitness query re-proves it over stored rows.** It catches the sequence a pre-check cannot: an
ordinary account journalled against, then registered as a trust bank leaf.

(4) **The chart classifies trust accounts and never maps them.** Trust's accounts are presented in two
reserved sections that net to zero, **derived from trust's registration rather than stored as a firm's
choice**, so the chart admin surface cannot move a client-trust liability into other income. No
`firm_account_role` row may name a trust-registered account: refused at configuration by name, proved
by a fitness query, and — if both were absent — refused by trust's guard at composition for every path
except the journal, which is why the first two exist.

(5) **No `is_trust` flag on `ledger_account`.** Registration is already stored on
`trust_account.bank_ledger_account_id`, `trust_account.client_liability_account_id`, and
`trust_ledger_node.ledger_account_id`. A denormalized flag would be a fourth answer, free to go stale
in exactly the direction that matters — a `0` on a real trust leaf. The read is a join, owned by
`packages/trust/src/statements.ts` so it stays inside the schema-name-sync net, and the dependency edge
runs `general-ledger` → `trust` exactly as billing's already does. Trust states in its own contract
that the chart is not its concern, so the cycle is closed by a rule already written down.

**Considered and rejected:** **A flag on `assertTrustComposition` that lets the journal through** — it
would put the exception inside the one function billing and the payments rail inherit no-commingling
from, leaving every future caller one boolean away from moving client money. The bank-charge carve-out
already established that the answer is a second, narrower door, never a relaxed first one, and a
journal needs no door at all. **Teaching the ledger primitive about trust** — it would become the trust
engine, and the account-agnostic primitive is what lets trust, billing, costs, and the operating books
share one set of rows. **Excluding trust accounts from the chart entirely** — they are real
`ledger_account` rows with real balances, and a balance sheet without them understates both sides.
Builds on **ADR-0008**, **ADR-0032**, and **ADR-0072**.
