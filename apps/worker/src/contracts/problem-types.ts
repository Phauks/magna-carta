// The problem-type URI registry: every RFC 9457 `type` URI the API
// emits is a key here (registry-first — stable URIs, one docs page each). A closed union: handing
// problemType() an unregistered key is a compile error, so a new problem type means a new row here.
//
// The value is a SECOND axis from the key, not redundant machinery: the key is the stable internal
// name callers reference (problemType("not-found")), the value is the URI slug emitted in the
// document. Today every value equals its key (the identity-map pin in problem.test.ts holds the
// two in sync), but keeping them separate gives headroom to remap one key to a different URI slug
// later — renaming a public slug without breaking internal callers, or vice versa — without
// collapsing the two roles into one.
export const PROBLEM_TYPES = {
  validation: "validation",
  unauthenticated: "unauthenticated",
  "permission-denied": "permission-denied",
  "not-found": "not-found",
  "idempotency-key-missing": "idempotency-key-missing",
  "idempotency-key-conflict": "idempotency-key-conflict",
  "idempotency-fingerprint-mismatch": "idempotency-fingerprint-mismatch",
  "rate-limited": "rate-limited",
  // A business resource clash (HTTP 409): a firm name already taken, a concurrent provisioning
  // that won the race. DISTINCT from the idempotency-* conflicts (those are key/payload clashes on
  // the idempotency record, not the business resource).
  conflict: "conflict",
  // An email / owner-email uniqueness violation (HTTP 422). A DISTINCT slug from `validation`
  // (which the app-level defaultHook owns for Zod request-shape failures): this is a semantic
  // uniqueness clash surfaced from a committed write, not a request-shape rejection.
  "email-in-use": "email-in-use",
  // An upload the firm's policy refuses (HTTP 422): a size over the cap, a blocked extension, or a
  // disallowed content type — checked at presign against the declared facts and re-checked against
  // the real bytes at the ingest gate. DISTINCT from `validation` (request-shape) — the request is
  // well-formed; the firm policy refuses its content.
  "upload-not-allowed": "upload-not-allowed",
  // A download of a version a re-scan flagged as malware (HTTP 409). Informed access: the file is not
  // hidden, but the raw download is gated until the member acknowledges the risk (acknowledgeMalware).
  "malware-flagged": "malware-flagged",
  // An unsupported format conversion (HTTP 422): the requested from→to format pair has no path in
  // the conversion graph — either the format is unknown or no engine covers the pair. DISTINCT from
  // `validation` (request-shape) — the request is well-formed; the registry has no path.
  "unsupported-conversion": "unsupported-conversion",
  // A decryption attempt that failed because the supplied password did not open the file (HTTP 400).
  // Generic — does not reveal whether the file or its format was otherwise valid; only that the
  // password was wrong. The client can retry with a different password without re-uploading.
  "wrong-password": "wrong-password",
  // A beta-channel activation rejected because the required consent acknowledgment was absent.
  // Distinct from `validation` (request-shape failures) — the request is well-formed; a business
  // rule gates the channel transition on explicit opt-in.
  "beta-consent-required": "beta-consent-required",
  // A custody packet logged without a Directory owner (HTTP 422). The register's structural
  // invariant: an original the firm holds for nobody it can name can never be released and never be
  // destroyed, so the write path refuses it rather than accepting a record it cannot act on.
  "custody-owner-required": "custody-owner-required",
  // A hold in force forbids the requested action (HTTP 409) — a release or a destruction. A hold
  // deliberately does not block a location move, so this never fires on one.
  "custody-hold-blocks-action": "custody-hold-blocks-action",
  // A location refused because moving it would put it inside its own subtree, or past the depth cap
  // (HTTP 422). DISTINCT from `validation`: the request is well-formed; the tree refuses the shape.
  "custody-location-cycle": "custody-location-cycle",
  // A location closed while it or its subtree still physically holds packets (HTTP 409). Closing it
  // anyway would orphan originals in a container nobody looks at any more.
  "custody-location-occupied": "custody-location-occupied",
  // The custody-number draw did not converge, or a manual number is already taken (HTTP 409).
  "custody-number-exhausted": "custody-number-exhausted",
  // A movement the register refuses on its own terms (HTTP 422): a second check-out of a packet
  // already out, a new movement on a released packet, a correction naming nothing, a borrower kind
  // with no borrower.
  "custody-invalid-movement": "custody-invalid-movement",
  // A release of an original stopped at the gate (HTTP 422): the movement does not name who collected
  // the property, or does not record the authority the release is made on and the identity check made
  // before it left, or the firm requires two signatories and only one signed. DISTINCT from
  // `validation` (request-shape) and from `custody-invalid-movement` (a state the register refuses):
  // the request is well formed and the state allows it — what is missing is the record that has to
  // exist first, and a client offers the caller a way to supply it rather than reporting an error.
  "custody-release-not-authorized": "custody-release-not-authorized",
  // A destruction request approved by the person who raised it, or by nobody identifiable (HTTP 422).
  // Destroying a client's original is a two-person action by construction: one person proposes it and
  // a DIFFERENT person agrees, and a workflow whose two halves can be the same person is one person
  // with an extra click. Enforced at the database as well as here, so it holds for a write path
  // nobody has built yet.
  "custody-approver-must-differ": "custody-approver-must-differ",
  // A destruction aimed at an item recorded as an irreplaceable original (HTTP 422). The one hard
  // policy in the register, and it carries NO override: no force flag, no privileged caller, no
  // second endpoint. It is encoded because it is not jurisdictional — no jurisdiction's rules produce
  // "destroy the client's original will because a timer expired". The only way past is for a person
  // to clear the flag on that specific object, which is a deliberate, audited change to a fact rather
  // than a way around a rule.
  "custody-intrinsic-value-not-destructible": "custody-intrinsic-value-not-destructible",
  // A destruction request that cannot take the action asked of it (HTTP 409): it has already been
  // refused, executed, or withdrawn, or execution was attempted before a second person approved it. A
  // decided request is re-raised rather than re-decided — rewriting a decision somebody already acted
  // on is the same falsification the append-only ledger forbids one row at a time.
  "custody-destruction-not-actionable": "custody-destruction-not-actionable",
  // A will-deposit duty that cannot be looked up (HTTP 422): no jurisdiction was recorded, or the
  // jurisdiction supplied has no verified rules encoded. Deliberately one problem type carrying two
  // distinct details, mirroring the trust catalog, because they are fixed differently: the first by
  // recording a fact about the firm, the second by researching a jurisdiction against its primary
  // text. Neither ever falls back to a baseline — statutory duties on a will are exactly where a
  // confidently wrong answer is one a firm will act on.
  "custody-jurisdiction-unavailable": "custody-jurisdiction-unavailable",
  // An observation recorded against, or a second close of, a physical count that has already
  // finished (HTTP 409). A finished count has produced a reconciliation somebody may have acted on,
  // and changing it afterwards is the same falsification the append-only sighting rows forbid one
  // row at a time. DISTINCT from `validation` (request-shape): the request is well formed and the
  // caller is entitled to make it — the count it names is over, so a client offers to open a new one.
  "custody-stocktake-closed": "custody-stocktake-closed",
  // A calendar window or deadline horizon wider than one read is allowed to be (HTTP 422). A
  // REFUSAL and deliberately not a silent clamp: a caller that asked for three years and quietly
  // received one cannot tell that from a firm with nothing recorded in years two and three, so the
  // page would be a wrong answer that looks like a right one. DISTINCT from `validation` — the
  // request is well-formed and the dates are real; the span is one the platform will not serve.
  "calendar-window-too-wide": "calendar-window-too-wide",
  // A deadline sourced from a statutory catalog when none is encoded (HTTP 422). The columns exist
  // and the shape is reserved, but no jurisdiction has verified rules encoded, and a deadline
  // claiming a catalog authority nobody consulted is exactly the false confidence that makes a
  // computed date worse than no date. Fixed by researching and verifying a jurisdiction, never by
  // the caller rewriting the request — which is why it is not `validation`.
  "calendar-deadline-catalog-unavailable": "calendar-deadline-catalog-unavailable",
  // A write against a deadline that is no longer open (HTTP 409): satisfying, editing, vacating, or
  // superseding one already satisfied, vacated, or superseded. A settled deadline is superseded by a
  // new one rather than re-decided, so both stay on the record.
  "calendar-deadline-settled": "calendar-deadline-settled",
  // An attempt to rename or recode an event type that ships with the platform (HTTP 422). A platform
  // type's name IS the shared vocabulary — a firm that wants different words adds its own type and
  // deactivates the shipped one, which changes nothing for anybody else.
  "calendar-platform-type-immutable": "calendar-platform-type-immutable",
  // An unexpected, unhandled server error (HTTP 500). The telemetry middleware's final catch maps
  // any escaped exception to this — the one error type the client cannot have caused, carrying only
  // the Error ID to quote.
  internal: "internal",
  // A feature that is known but not yet wired end-to-end (HTTP 501). Used for interim stubs where
  // the route schema and lane routing are in place but the backing implementation lands in a later
  // task. Clients should treat this like a transient error and retry after a deployment.
  "not-implemented": "not-implemented",
  // A template upload whose placeholders cannot be normalized (HTTP 422): an unclosed delimiter, a key
  // no merge field matches, a rendering the key's type does not support. DISTINCT from `validation`
  // (request-shape) — the request is well-formed; the uploaded document's authoring is not. Carries the
  // findings with their locations so the authoring surface can point at each one.
  "template-normalization-failed": "template-normalization-failed",
  // A template version that cannot be activated (HTTP 422): its bytes were flagged by the scan engine,
  // or macro content survived removal and the package could not be made safe to store. A registration
  // refusal, never a silent downgrade.
  "template-not-activatable": "template-not-activatable",
  // A template upload carrying macro content, registered without asking for the macros to be removed
  // (HTTP 422). Not an error in the document and not a scan verdict: a template is run against
  // privileged client data, so one carrying code is never stored, and removing the code rewrites the
  // firm's own document, so it is never done unasked. The problem carries what was found and names
  // both ways through — opt in to the removal, or upload a macro-free copy.
  "template-macro-consent-required": "template-macro-consent-required",
  // A template whose conditional, repeating, or computed-field expression does not check (HTTP 422):
  // a name no merge field matches, an operand type the operation does not take, a rendering the result
  // type does not support, an unbalanced block, or one past a declared bound. DISTINCT from
  // `template-normalization-failed`, which is about a placeholder's delimiters rather than about what
  // an expression means. Carries the part, the excerpt, and the character offset inside the expression.
  "template-expression-invalid": "template-expression-invalid",
  // An assembly whose expression could not produce a value from data that all resolved (HTTP 422): two
  // amounts in different currencies, a division that is not exact, a bound reached, or a condition
  // nobody can answer because the matter supplies no value for a field it reads. A refusal ALWAYS fails
  // the assembly — it never becomes false, never becomes blank, and never becomes a rounded guess,
  // because a missing clause is invisible to whoever reads the document. Reports WHICH expression and
  // WHY, never what any value held.
  "assembly-expression-refused": "assembly-expression-refused",
  // An assembly whose merge fields cannot be resolved (HTTP 422): the matter supplies no value for a
  // field declared to fail rather than render a blank. Names WHICH keys failed, never what they held.
  "merge-field-unresolvable": "merge-field-unresolvable",
  // A plain request reached an endpoint that only serves WebSocket subscriptions (HTTP 426). The
  // job-progress endpoints push transitions over a socket; the polling endpoint beside each one is
  // the answer for a client that cannot or does not want to upgrade, and the detail names it.
  "websocket-upgrade-required": "websocket-upgrade-required",
  // A trust movement larger than the client ledger's AVAILABLE balance (HTTP 409). Available is the
  // stored balance minus the active disputed-funds holds, so this fires on a ledger that still shows
  // a positive balance — a disputed portion under hold is not money the firm may pay out. DISTINCT
  // from `validation`: the request is well-formed and the amount is a real number; the money is not
  // there to move.
  "trust-insufficient-available": "trust-insufficient-available",
  // A trust movement the trust rules refuse on their own terms (HTTP 422): an entry that would mix
  // two clients' funds, a movement onto a roll-up rather than a matter leaf, a transfer whose two
  // ends are the same matter, a currency the account does not hold, or a payment method the account's
  // jurisdiction forbids. DISTINCT from `validation` (request-shape) — the request is well-formed;
  // the trust rules refuse what it asks for.
  "trust-movement-refused": "trust-movement-refused",
  // Something the LEDGER itself refuses about the entry a money route composed (HTTP 422): an
  // effective date that is not a calendar date or is in the future, a line amount that is not
  // positive, a currency that is not the account's, or an entry that does not balance. Shared by
  // every money route because the ledger's rules are the same underneath all of them, and DISTINCT
  // from the domain refusals beside it (`trust-movement-refused`, `billing-refused`): those are a
  // subsystem's own rules about what the movement means, this is the double-entry record refusing
  // to hold the entry at all.
  "ledger-entry-refused": "ledger-entry-refused",
  // A trust account whose office recorded no jurisdiction, or whose jurisdiction has no reviewed
  // rules encoded (HTTP 422). Deliberately one problem type carrying two distinct details, because
  // they are fixed differently: the first by recording the office's state, the second by researching
  // and reviewing that jurisdiction. Neither ever resolves to a baseline — a wrong silence about a
  // trust rule states a wrong fact to a lawyer who will act on it.
  "trust-jurisdiction-unavailable": "trust-jurisdiction-unavailable",
  // A disbursement request that has already been approved, rejected, or withdrawn (HTTP 409). A
  // settled request is never re-decided: the decision is one append-only row and the database
  // refuses a second. DISTINCT from `conflict` in that nothing is retryable — the caller reads the
  // decision that was already recorded, or submits a new request.
  "trust-disbursement-not-pending": "trust-disbursement-not-pending",
  // The member is not one who may make this decision about this disbursement request (HTTP 422):
  // approving or rejecting a request they submitted themselves in a firm that has other members who
  // can authorize a trust disbursement, or withdrawing somebody else's request. The two-person rule
  // is the point of the control, so this is not a permission failure — the member holds the
  // capability; they are the wrong person for this particular act.
  "trust-disbursement-authorization-refused": "trust-disbursement-authorization-refused",
  // A write against a reconciliation that has already closed (HTTP 409): a second close, a match, or
  // a withdrawal. Closing a reconciliation freezes the proof it attested to, and the frozen figures
  // never change afterwards — so a period redone later is a NEW reconciliation superseding the old
  // one, never an edit. DISTINCT from `conflict` in that nothing is retryable: the caller opens a
  // new reconciliation, or reads the one that was frozen.
  "trust-reconciliation-closed": "trust-reconciliation-closed",
  // Something the reconciliation has already accounted for (HTTP 409): a statement line or a ledger
  // entry that is already matched in this reconciliation, a match that was already withdrawn, or a
  // bank statement that has already been superseded by a correction. One line clears one entry, so
  // a second assertion about either end is refused rather than silently ignored — two active matches
  // would let a firm account for one real event twice and still appear to tie out.
  "trust-reconciliation-already-accounted-for": "trust-reconciliation-already-accounted-for",
  // A statement file that cannot be imported as it stands (HTTP 422): columns nothing recognized, a
  // file that changed between being previewed and being confirmed, or a file in which no row could
  // be read at all. DISTINCT from `validation` (request-shape) — the request is well-formed; the
  // FILE is what cannot be carried across, and the detail names the headers found, the fingerprint
  // that no longer matches, or how many rows were rejected. Nothing is ever stored from a file the
  // firm has not confirmed, and no date is ever reinterpreted under a convention nobody stated.
  "trust-statement-import-refused": "trust-statement-import-refused",
  // Something the trust rules refuse about a bank statement, a match, or a reconciliation on their
  // own terms (HTTP 422): a statement line dated outside the period it is filed under, a currency
  // the account does not hold, a statement with no lines, or a ledger entry that is not an
  // outstanding item on this account as of the period. DISTINCT from `validation` — the request is
  // well-formed; the record it describes is not one the rules permit.
  "trust-reconciliation-refused": "trust-reconciliation-refused",
  // A matter close refused by one of the rules the close hook runs (HTTP 409). Today the only such
  // rule is trust's: a matter whose client trust ledger still holds money, or carries an active
  // disputed-funds hold, does not close — a closed matter with somebody else's money in it is how
  // funds become unclaimed. DISTINCT from `conflict` (the matter is in the wrong lifecycle state,
  // which nothing but time fixes): here the matter is closable and something specific stands in the
  // way, so `errors[]` names each rule that refused and what clears it.
  "matter-close-refused": "matter-close-refused",
  // A billing change aimed at an invoice that is no longer a working document (HTTP 409): the
  // invoice has been finalized or voided, and its header, lines, and work-in-progress claims are
  // frozen at the database. DISTINCT from `conflict` because nothing about waiting or retrying
  // changes it — a finalized invoice is corrected by a credit note, which is a different operation
  // producing a second permanent record rather than editing the first.
  "billing-invoice-not-editable": "billing-invoice-not-editable",
  // Two drafts reached for the same unbilled time or cost entry and this one lost (HTTP 409). The
  // partial unique index on active claims is what arbitrates, so the loser learns it lost rather
  // than quietly composing a line over work that belongs to somebody else's bill. The remedy is to
  // look at the invoice that holds it, not to retry.
  "billing-work-already-claimed": "billing-work-already-claimed",
  // Finalization needs to know which of the firm's ledger accounts plays a posting role — the
  // receivable, fee income, advanced client costs — and that role has not been mapped (HTTP 422).
  // Deliberately a refusal rather than a guess: posting a real receivable into a plausible-looking
  // account puts money in the wrong place on the firm's balance sheet, and the detail names the
  // missing role and where to set it.
  "billing-account-role-unmapped": "billing-account-role-unmapped",
  // Something the billing rules refuse on their own terms (HTTP 422): a matter belonging to a
  // different client than the invoice bills, a matter with no client party to bill, non-billable
  // time, an empty invoice, or more claimed work than one finalize batch can carry. DISTINCT from
  // `validation` — the request is well-formed; what it asks for is not a bill the rules permit.
  "billing-refused": "billing-refused",
  // A required downstream service is absent or unreachable (HTTP 503): the worker cannot fulfil
  // the request because a backing worker service binding is not configured. Callers should retry
  // after a short delay; the condition resolves when the binding is activated at deploy time.
  "service-unavailable": "service-unavailable",
} as const;

export type ProblemTypeKey = keyof typeof PROBLEM_TYPES;

// The full `type` URI for a registered key — a template-literal type, not `string`, so the
// registry guarantee (only registered URIs are ever emitted) carries through to consumers.
export type ProblemTypeUri = `https://api.magnacarta.esq/problems/${ProblemTypeKey}`;

export function problemType(key: ProblemTypeKey): ProblemTypeUri {
  return `https://api.magnacarta.esq/problems/${PROBLEM_TYPES[key]}`;
}
