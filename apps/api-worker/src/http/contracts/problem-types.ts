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
  // A bulk download of documents whose export copies are still being made (HTTP 409): more
  // versions the editor cut in the last moments than the request path will accept the changes of
  // on the spot. The copies are on the queue; the same request answers once they land.
  "export-copies-pending": "export-copies-pending",
  // An unsupported format conversion (HTTP 422): the requested from→to format pair has no path in
  // the conversion graph — either the format is unknown or no engine covers the pair. DISTINCT from
  // `validation` (request-shape) — the request is well-formed; the registry has no path.
  "unsupported-conversion": "unsupported-conversion",
  // An archive-browse of a file that is not a zip (HTTP 422): the sniffed type says other bytes, or
  // the bytes carry no readable zip end structures. DISTINCT from `validation` (request-shape) —
  // the request is well-formed; the file's content is not a browsable archive.
  "not-an-archive": "not-an-archive",
  // An archive-browse of a container that IS the archive it claims to be and whose contents this
  // application still cannot show (HTTP 422): a 7z whose own file list is encrypted, or one packed
  // with a coder no reader here covers. DISTINCT from `not-an-archive`, and the distinction is the
  // whole reason it exists: that one says the file is not an archive, which here would be false and
  // would send the reader looking for a fault in their own file. This one says the archive is
  // intact and the shortfall is ours or the password's.
  "archive-unreadable": "archive-unreadable",
  // The remote browser reached the target and could not finish rendering it (HTTP 422): the page
  // crashed, consumed too much memory, or did not become ready inside the wait — the conditions the
  // rendering service reports as an issue with the site. DISTINCT from `validation` (request-shape)
  // — the address was accepted and visited — and DISTINCT from `internal`, which would hand the
  // member an Error ID for a fault that is neither theirs nor the platform's. The capture is
  // attempted twice before this is reported, the second time with everything expensive turned off.
  "page-render-failed": "page-render-failed",
  // The firm's object storage is unprovisioned, or is recorded against a bucket this deployment
  // does not read through (HTTP 503, retryable once an operator has configured it). DISTINCT from
  // `internal` — the condition is known and named, so the reader is told what is misconfigured
  // rather than handed an Error ID for a fault they cannot act on.
  "storage-unavailable": "storage-unavailable",
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
  // A close that would freeze counts drawn from a reconciliation that hit its read cap (HTTP 409).
  // The frozen counts are the numbers a firm reports and nothing may drift under them afterwards, so
  // a partial answer is refused rather than recorded as a finding: packets past the cut were never
  // expected and so were never reported missing, which would understate missing originals silently
  // and permanently. Fixed by narrowing the count's scope or by abandoning it, which freezes nothing.
  // DISTINCT from `validation` — the request is well formed and the caller is entitled to make it.
  "custody-stocktake-truncated": "custody-stocktake-truncated",
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
  // A write against a note that has been withdrawn (HTTP 409): revising one, withdrawing one twice,
  // or reading the earlier versions of one. A withdrawn note's body has stopped rendering
  // everywhere, so appending to it would put new words behind a tombstone where nothing displays
  // them, and serving its history would be a way around the tombstone rather than an exception to
  // it. Withdrawing twice is refused because the first withdrawal's actor, instant and reason are
  // the record and are not rewritten. Not `validation`: the request was well formed and the note's
  // state is what refuses it.
  "note-retracted": "note-retracted",
  // A firm event given an event type from another category (HTTP 422). The two calendar scopes share
  // one type catalog and `category` is the only thing separating them, so typing the all-hands as a
  // "Hearing" would file a staff meeting as procedural history everywhere a surface groups by
  // category. Fixed by choosing a firm-category type, never by the caller rephrasing the request.
  "calendar-event-type-category-mismatch": "calendar-event-type-category-mismatch",
  // A booking against a resource that has been deactivated (HTTP 422). Soft-deactivation's meaning:
  // existing bookings keep resolving and the history stands; new bookings are refused. Fixed by
  // reactivating the resource or booking another one. DISTINCT from `validation` — the request is
  // well formed and the resource is real; it has been retired.
  "calendar-resource-inactive": "calendar-resource-inactive",
  // A resource name the firm already uses (HTTP 422). Two rooms called the same thing are one room
  // nobody can book on purpose, so the catalog holds names unique and this refusal names the
  // collision before the unique index aborts it.
  "calendar-resource-name-taken": "calendar-resource-name-taken",
  // A continuance asked of a setting that cannot take one (HTTP 409): it is already cancelled, or it
  // already has a successor in the chain. Continue the LATEST setting instead — the chain holds one
  // predecessor and one successor per setting, refused by the schema itself under racing writes.
  "calendar-event-not-continuable": "calendar-event-not-continuable",
  // A second related link between the same pair of events, in either direction (HTTP 422). 'related'
  // is undirected in meaning though stored directed, so A-to-B and B-to-A are the same fact twice.
  "calendar-duplicate-link": "calendar-duplicate-link",
  // A calendar sync setting refused on its merits (HTTP 422): a rule naming a subject that is not
  // an active event type, one the firm does not let leave, or a calendar the member's account does
  // not have or cannot write to. `errors` names the subject and which of those it was. DISTINCT
  // from `validation`: the request is well-formed and something it names cannot be used.
  "calendar-sync-setting-refused": "calendar-sync-setting-refused",
  // An attempt to delete a continuance link through the link routes (HTTP 422). A continuance link
  // is the record of what was continued from what — procedural history, minted only by the continue
  // operation and never removed; a related link is the only deletable kind.
  "calendar-continuance-link-immutable": "calendar-continuance-link-immutable",
  // A continuance chain deeper than the walk's bound (HTTP 422). A hearing continued a hundred
  // times is corrupt data, not litigation; the read refuses rather than walking it.
  "calendar-continuance-chain-too-deep": "calendar-continuance-chain-too-deep",
  // An asset given a type declared under a different class (HTTP 422). A firm filing a retirement
  // account under `vehicle` has made a data-entry error, not expressed a preference — the class
  // decides which structured columns exist, so the pairing has to hold. Also raised when a class's
  // attributes are supplied on an asset of another class, which is the same mistake from the other
  // end and is refused rather than silently dropped: attributes quietly discarded are facts a person
  // believes they recorded.
  "matter-asset-type-class-mismatch": "matter-asset-type-class-mismatch",
  // An attempt to change an asset's class after it was recorded (HTTP 409). A class change orphans
  // the attribute row and moves the asset to a different merge subject, so it is a delete-and-record
  // -again wearing an update. DISTINCT from `validation`: the request is well-formed and the class is
  // real; the change is one the register does not make.
  "matter-asset-class-frozen": "matter-asset-class-frozen",
  // Any attempt to edit or remove a recorded value (HTTP 409). No route offers one and the database
  // refuses it, so this exists so that a path written later fails by name rather than as an
  // unexplained abort. A wrong figure is fixed by recording a correction that names it.
  "matter-asset-valuation-append-only": "matter-asset-valuation-append-only",
  // An amount with no currency, a currency with no amount, or a correction restating a figure in a
  // different currency (HTTP 422). Money is minor units plus a currency and never a float, and no
  // total is computed across two currencies.
  "matter-asset-currency-mismatch": "matter-asset-currency-mismatch",
  // A request asking the register to hold a password, passphrase, seed or recovery phrase, private
  // key, personal identification number, or safe combination (HTTP 422). Its OWN type rather than
  // `validation` because the refusal is explainable and the explanation is the point: an encrypted
  // column is readable by anyone holding the decrypt permission, and for a self-custodied asset the
  // phrase IS the asset. The correct home is a sealed envelope in the safekeeping register.
  "matter-asset-credential-storage-refused": "matter-asset-credential-storage-refused",
  // Exhibits. An operation that needs a draft set on one that has been issued (HTTP 409): the
  // order, members and numbering of a set that went out are fixed, and the remedy is a superseding
  // set. The reverse — withdrawing or correcting on a draft — is its own slug, because the remedy
  // differs (edit the draft directly).
  "exhibit-set-issued": "exhibit-set-issued",
  "exhibit-set-not-issued": "exhibit-set-not-issued",
  // The set, or its membership, moved between the read and the write (HTTP 409): a member was
  // added or removed, a racing write took a position, or the set was issued or superseded first.
  // Read it again and redo the change.
  "exhibit-set-changed": "exhibit-set-changed",
  // A member-supplied reference name another exhibit on the matter already holds (HTTP 409).
  "exhibit-reference-name-taken": "exhibit-reference-name-taken",
  // The file is not on this matter, or has no clean version to attach or issue (HTTP 422).
  "exhibit-file-unavailable": "exhibit-file-unavailable",
  // A folder follow asked of a set built by hand, which follows no folder (HTTP 409).
  "exhibit-set-not-following": "exhibit-set-not-following",
  // A bulk entry carrying more rows than one commit takes (HTTP 422). A REFUSAL and never a
  // truncation: a caller that sent sixty rows and silently had fifty written cannot tell that from
  // fifty rows it never sent.
  "matter-asset-batch-too-large": "matter-asset-batch-too-large",
  // A document link naming a file filed under a different matter, or a document kind the register
  // does not carry (HTTP 422). A cross-matter link would put a deed in a case nobody could find it
  // from, and would show one matter's file in another matter's asset detail.
  "matter-asset-document-matter-mismatch": "matter-asset-document-matter-mismatch",
  // A balance recorded against a charge that secures a DIFFERENT asset (HTTP 422). A mortgage balance
  // filed under a house the mortgage does not charge makes the net equity of two assets wrong, and
  // neither of them looks wrong on its own — which is why this is refused at the write rather than
  // reported at the schedule.
  "matter-asset-encumbrance-not-on-asset": "matter-asset-encumbrance-not-on-asset",
  // A schedule asked for on a matter carrying more assets than one read returns (HTTP 422). A schedule
  // is read WHOLE — it is a document's worth of rows — so the answer is a refusal naming the register
  // list, which pages, rather than a truncation a firm could file without noticing.
  "matter-asset-schedule-too-large": "matter-asset-schedule-too-large",
  // A link to a safekeeping item that does not exist in this firm (HTTP 422). The link is what says
  // the firm holds the physical original of a scheduled thing, so a link to nothing asserts something
  // false rather than nothing at all.
  "matter-asset-unknown-custody-item": "matter-asset-unknown-custody-item",
  // An invitation that will not redeem, for ANY reason (HTTP 422). Deliberately ONE type with ONE
  // detail sentence covering every cause — an unknown code, a code that belongs to somebody else, a
  // wrong surname, a wrong date of birth, an invitation already redeemed, revoked or expired. The
  // three facts are stored as a single combined digest precisely so this handler cannot tell those
  // causes apart, but the wire shape has to hold the line too: a distinct type or a distinct detail
  // per cause would rebuild the oracle the storage shape was chosen to prevent, and "that code has
  // already been used" alone confirms to a stranger that a named person was invited to a named
  // firm. A real invitee who mistypes is helped by the surface offering the firm's contact, never by
  // the server naming the field.
  "invitation-not-redeemable": "invitation-not-redeemable",
  // A registration confirmation that will not complete (HTTP 422): the token is unknown, already
  // spent, or past its life. Same single-type discipline as the invitation above, for the same
  // reason — the branches differ only in ways that would tell a stranger something about somebody
  // else's sign-up.
  "registration-not-confirmable": "registration-not-confirmable",
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
  // An auto-file rule the platform will not create as asked (HTTP 422): a matter that is closed or
  // platform-owned, a thread-continuation rule named on a conversation nobody has filed to that
  // matter, a correspondent rule with no sender to match. DISTINCT from `validation` (request-shape)
  // — the request is well-formed, and what it asks for is a delegation the guardrails could never
  // act on, so accepting it would create a rule that silently never fires.
  "auto-file-rule-not-creatable": "auto-file-rule-not-creatable",
  // A rule asking to file without a person while the firm's ceiling is down (HTTP 422). Refused
  // outright rather than stored: a posture that cannot take effect reads to the member who set it as
  // a firm that has opted into unattended filing, which is exactly the thing no member may do alone.
  "auto-file-direct-filing-not-permitted": "auto-file-direct-filing-not-permitted",
  // The same rule already exists on this matter (HTTP 409) — same kind, same match value. Reported
  // rather than left to the unique index, and it names the existing rule so a caller that wanted it
  // resumed or re-promoted can act on the one already there.
  "auto-file-rule-duplicate": "auto-file-rule-duplicate",
  // A rule that is not in the state the requested transition takes (HTTP 409): resuming one that was
  // never suspended, suspending one already out of service, re-promoting a revoked one. Every
  // mutation statement is guarded on state and would otherwise change nothing while answering
  // success, which is the shape that leaves a firm believing it stopped a rule that is still filing.
  "auto-file-rule-not-actionable": "auto-file-rule-not-actionable",
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
  // A posture change that lost to the posture already standing (HTTP 409): the firm's authorization
  // policy is already what the caller asked for, or a concurrent change wrote the next version
  // first. Nothing is broken — the caller re-reads the current policy and decides whether a change
  // is still wanted against it. DISTINCT from `conflict` in carrying the policy vocabulary in its
  // detail.
  "trust-authorization-policy-conflict": "trust-authorization-policy-conflict",
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
  // A reconciliation whose reads hit their ceiling (HTTP 422): more outstanding book items than one
  // period can account for, or more unaccounted-for statement lines than one period can attest to.
  // The cap is detected rather than silent, and the answer is a refusal rather than a short list —
  // every figure a proof reports is derived from those lists and a close FREEZES them as the firm's
  // attestation, so a truncated read produces a confidently wrong number rather than an obviously
  // incomplete one. DISTINCT from `trust-reconciliation-refused`, which says the rules refuse the
  // record described: nothing here is improper, and the remedy the detail names is the caller's —
  // reconcile the earlier periods, or record the statement as several shorter ones.
  "trust-reconciliation-truncated": "trust-reconciliation-truncated",
  // Something the rules refuse about the FIRM'S OWN money in a trust account (HTTP 422): the account
  // keeps no bank-charge cushion because nobody opened one, the account is the pooled
  // interest-bearing kind the researched rules exempt from service charges (so there is no charge for
  // firm money to pay and putting it there would be commingling), or the entry is not one the
  // narrower firm-funds composition door admits. DELIBERATELY DISTINCT from
  // `trust-movement-refused`, which says the trust rules refused a movement of CLIENT money: that
  // sentence would be false here, and the firm's own cushion and client money never sharing a door is
  // the property this whole category is built to hold.
  "trust-firm-funds-refused": "trust-firm-funds-refused",
  // A bank service charge larger than the firm's own funds in the account (HTTP 409). A charge is
  // never borne by client money, so it is refused rather than absorbed, and the remedy is the
  // real-world one the detail names: the firm restores its own funds in the account and records the
  // charge again. DELIBERATELY DISTINCT from `trust-insufficient-available`, which says a CLIENT
  // ledger does not have the money — the exact false statement this category exists to prevent.
  "trust-firm-funds-insufficient": "trust-firm-funds-insufficient",
  // Something the rules refuse about an unclaimed-funds diligence file (HTTP 422): a ledger that
  // holds nothing for anybody to be unable to claim, a ledger tier that is not a client's matter
  // ledger, a window that is not a calendar date, or a closure naming a payment that is not a
  // disbursement from the ledger under review. DISTINCT from `validation` — the request is
  // well-formed; the record it describes is not one the rules permit.
  "trust-unclaimed-funds-refused": "trust-unclaimed-funds-refused",
  // The diligence file is not in a state this act can be performed against (HTTP 409): the client
  // ledger already carries an open review, or the review named has already been closed. One ledger
  // carries one open review because the certification a firm eventually signs is about the whole
  // search, and a closed review is a finished round — so the detail names the review that stands and
  // the caller either records on it or opens the next one. DISTINCT from `conflict` in carrying the
  // handle of the review that decided the outcome.
  "trust-unclaimed-funds-review-not-actionable": "trust-unclaimed-funds-review-not-actionable",
  // More client ledgers have been quiet since the stated date than one list can honestly present
  // (HTTP 422). The cap is detected rather than silent, and the answer is a refusal rather than a
  // short list: a firm working a truncated diligence list would believe it had worked the whole one.
  // The remedy is in the caller's hands — state a narrower window.
  "trust-dormant-list-truncated": "trust-dormant-list-truncated",
  // A matter close refused by one of the rules the close hook runs (HTTP 409). Today the only such
  // rule is trust's: a matter whose client trust ledger still holds money, or carries an active
  // disputed-funds hold, does not close — a closed matter with somebody else's money in it is how
  // funds become unclaimed. DISTINCT from `conflict` (the matter is in the wrong lifecycle state,
  // which nothing but time fixes): here the matter is closable and something specific stands in the
  // way, so `errors[]` names each rule that refused and what clears it.
  "matter-close-refused": "matter-close-refused",
  // The open side's mirror (HTTP 409): a consultation whose opening rules refused it — today, a
  // required step of the firm's intake procedure with no satisfying answer. `errors[]` names each
  // step that stands in the way and what answers it.
  "matter-open-refused": "matter-open-refused",
  // One rung earlier (HTTP 409): an intake whose graduation rules refused it — a required step of
  // the firm's intake procedure with no satisfying answer. `errors[]` names each step and what
  // answers it, so the desk and the status window re-answer the checklist already on screen.
  "matter-graduate-refused": "matter-graduate-refused",
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
  // A transfer of earned fees out of a client's trust ledger that the invoice evidence does not
  // permit (HTTP 422): the bill named is still a draft, it bills a different client than the one
  // whose money this is, it does not bill the matter the money sits against, or the amounts named do
  // not add up to the transfer. Money leaves trust for the firm only against a finalized bill, with
  // no override path — this is the operation where real-world trust violations happen and the
  // friction is the point. DISTINCT from `trust-movement-refused`, which is trust's own rules about
  // the movement (commingling, one client per entry, a forbidden method); this is the billing side
  // saying the fee has not been shown to be earned.
  "billing-earned-fee-refused": "billing-earned-fee-refused",
  // A transfer or payment larger than what that matter still owes on that bill (HTTP 409). The
  // per-(invoice, matter) balance is the ceiling, not the invoice total and not the money available
  // in trust: the ceiling a client ledger's funds must respect is that matter's own share. The
  // mirror of `trust-insufficient-available` on the other side of the same operation — there the
  // money is not there, here the debt is not — and it is a 409 for the same reason: a credit note or
  // another payment may have consumed the balance since the caller last looked.
  "billing-exceeds-unpaid-balance": "billing-exceeds-unpaid-balance",
  // A retainer replenishment ask raised while one is already open for the matter (HTTP 409). One
  // open ask per matter is the rule — a floor that stays crossed must not stack a new request on
  // every look — and the remedy is to resolve the open one, which is why this is a conflict rather
  // than a refusal on the merits.
  "billing-replenishment-already-open": "billing-replenishment-already-open",
  // An anonymous endpoint refused because the caller did not prove they are a person (HTTP 403):
  // no challenge solution was presented, or the one presented does not stand up. DISTINCT from
  // `permission-denied` (which is about a role a session holds) and from `unauthenticated` (which is
  // about a session at all): there is no account on either side of this, and the remedy is to solve
  // a fresh challenge rather than to sign in or to be granted anything.
  "human-verification-required": "human-verification-required",
  // A required downstream service is absent or unreachable (HTTP 503): the worker cannot fulfil
  // the request because a backing worker service binding is not configured. Callers should retry
  // after a short delay; the condition resolves when the binding is activated at deploy time.
  "service-unavailable": "service-unavailable",
  // The work committed, but the email it depends on could not be sent (HTTP 503). A SEPARATE type
  // from `service-unavailable` because the two lead somewhere different: that one says a backing
  // service is missing and there is nothing to do but wait, while this one says the one thing this
  // request owed a person — a mail carrying a token only they can receive — did not leave, and the
  // remedy is to ask again, which really does send a fresh one. A joining surface that could not
  // tell them apart would have to render the vaguer sentence for both.
  "mail-undeliverable": "mail-undeliverable",
  // The firm has not consented to sending its content to a third-party model provider at all (HTTP
  // 403). DISTINCT from `permission-denied`: the member's role is irrelevant — nobody in the firm can
  // use the assistant until an administrator opens the general AI-processing gate, and telling them
  // to ask for a role would send them looking in the wrong place.
  "magnus-firm-not-eligible": "magnus-firm-not-eligible",
  // The firm consents to model processing generally but has not turned the assistant on (HTTP 403).
  // A SECOND type rather than a shared one, because it is a different setting in a different place:
  // enabling inference for document drafting is not consenting to a free-form assistant, and a firm
  // switching the assistant off must not thereby disable every other AI feature.
  "magnus-not-enabled": "magnus-not-enabled",
  // The member has not accepted the current disclosure (HTTP 409). Not a 403: the member can clear it
  // themselves, and it also fires when the disclosure VERSION moved because what the assistant can
  // see or do changed — which re-prompts everybody by design.
  "magnus-acknowledgement-required": "magnus-acknowledgement-required",
  // A message over the per-turn size cap (HTTP 422). DISTINCT from `validation` (request-shape) — the
  // request is well-formed; the cap is what keeps a turn from being bulk content, and refusing names
  // the limit rather than silently truncating or shipping a deposition to a model provider.
  "magnus-turn-too-large": "magnus-turn-too-large",
  // The firm's daily message allowance is spent (HTTP 429). DISTINCT from `rate-limited` (a per-route
  // request limit that says nothing about cost): this is the firm's own spend ceiling, and it is
  // named so the firm knows which limit it reached and that it resets.
  "magnus-daily-ceiling-reached": "magnus-daily-ceiling-reached",
  // A message that cannot be edited or removed now (HTTP 409): it is an answer rather than a member's
  // message, it was already removed or set aside by an edit, or an answer is still being written in
  // the conversation. DISTINCT from `not-found`: the message exists and the member can see it, and
  // the detail says which of the three it is so the member knows whether waiting will help.
  "magnus-turn-unchangeable": "magnus-turn-unchangeable",
  // A load that would carry a review set past its document ceiling (HTTP 422). DISTINCT from
  // `validation` (request-shape) — the request is well-formed and the refusal carries two numbers a
  // caller acts on: how many documents the set holds and what its ceiling is. It is a REFUSAL rather
  // than a degradation on purpose: the alternative is a firm discovering at four hundred thousand
  // documents that its database is at its hard limit, which is an outage with no good exit.
  "discovery-ceiling-exceeded": "discovery-ceiling-exceeded",
  // A review set that no longer takes material (HTTP 409). A locked set still serves every read, and
  // a closed one has released its derived index for collection; neither is a request-shape problem
  // and neither is fixed by retrying.
  "discovery-review-set-closed": "discovery-review-set-closed",
  // A request to reopen a closed review set (HTTP 422). Its OWN type rather than a generic refusal,
  // because it is the request a firm will actually make and the answer has to explain itself: the
  // corpus under review is what was reviewed, and a set that could be reopened is a corpus whose
  // contents depend on when you looked at it.
  "discovery-review-set-reopen-refused": "discovery-review-set-reopen-refused",
  // A source a load names that the platform knows about and has not built (HTTP 422). Covers the
  // direct-collection lane and, until its lane lands, assistant transcripts. Named rather than
  // absent, because "we know exactly what you mean and have not built it" is a different answer from
  // "no such thing" and sends a firm somewhere different.
  "discovery-load-source-not-built": "discovery-load-source-not-built",
  // A load declared without saying whether assistant transcripts are in scope (HTTP 422). Its own
  // type because there is NO DEFAULT and there is deliberately not going to be one: a transcript is
  // the firm's own work product, and whether the firm's reasoning about a matter belongs in a corpus
  // is a decision a person makes visibly. A silent exclusion would be as much a decision made for
  // somebody as a silent inclusion.
  "discovery-transcript-scope-unstated": "discovery-transcript-scope-unstated",
  // Material a load selected that cannot enter a review set (HTTP 422): a version that is
  // quarantined or still pending its scan, or a selection reaching outside the review set's matter.
  // Refused BY NAME rather than skipped — a firm that selected fifty files and silently received
  // forty-eight review documents has a corpus it cannot certify the contents of.
  "discovery-selection-refused": "discovery-selection-refused",
  // A load asked to complete while its counts do not add up (HTTP 409): loaded is not processed plus
  // excepted. The reconciliation is the whole point of the exception report, so a load does not
  // reach `complete` while a document is in neither column — that document has fallen out of the
  // corpus with nobody able to tell.
  "discovery-load-not-reconciled": "discovery-load-not-reconciled",
  // A coding act asked to be taken back that will not be (HTTP 409): it has already been reversed, it
  // is still running, or it is itself an undo. Its own type because an undo is EXACT — it reverses
  // precisely the rows one act wrote — and "already reversed" and "still moving" are different
  // situations a caller resolves differently. Reversing twice would remove rows the first reversal
  // already attributed to somebody.
  "discovery-coding-act-not-undoable": "discovery-coding-act-not-undoable",
  // The last member being removed from a review set's access list (HTTP 422). The list is
  // fail-closed, so an empty one is a corpus nobody can reach — including whoever would repair it,
  // which makes it permanent short of a migration. Named rather than generic because the fix is
  // specific: add whoever should hold the corpus first.
  "discovery-access-list-would-be-empty": "discovery-access-list-would-be-empty",
  // A change to the coding panel that is refused (HTTP 422): deactivating a tag whose meaning
  // production and privilege logging resolve through, or deleting a seeded question. Neither is a
  // request-shape problem, and both have the same answer — rename it, because nothing ever matched
  // it by name.
  "discovery-coding-panel-refused": "discovery-coding-panel-refused",
  // The period a report was asked for is not one that can be answered (HTTP 422): the dates are not
  // calendar dates, the period ends before it starts, or the knowledge instant is not a UTC instant
  // or names a moment the platform has not reached. Its own type because the fix is a different
  // request rather than a different account or a different grant.
  "report-period-invalid": "report-period-invalid",
  // The period holds more of an account's activity than one document can carry (HTTP 422). Named
  // rather than answered short: a client ledger missing entries, or a journal missing a
  // disbursement, presented as complete is worse than a refusal, because a reader has no way to
  // tell. The remedy is in the message — produce the period in shorter parts.
  "report-period-too-large": "report-period-too-large",
  // The platform cannot produce this report for this account (HTTP 422), and the reason is a fact
  // somebody has to establish rather than a request to retry: no jurisdiction is recorded against
  // the account, nobody has encoded that jurisdiction's rules, no attorney has reviewed them, or the
  // account has more items outstanding than one reconciliation can account for. The detail carries
  // the refusing subsystem's own words, because each of those is fixed by a different person doing a
  // different thing.
  "report-cannot-be-produced": "report-cannot-be-produced",
  // A member administering their own membership (HTTP 403): changing the roles they hold, or
  // deactivating themselves. DISTINCT from `permission-denied`, which says the member lacks the
  // capability — here they hold it, and the refusal is about who the subject is. Self-promotion is
  // the reason the capability exists, and self-demotion is an accident rather than an act; both are
  // fixed by another administrator making the change, which is also what puts a second name in the
  // firm's audit log.
  "self-administration": "self-administration",
  // A change that would leave the firm with no active member who can administer its members (HTTP
  // 422) — deactivating the last such member, or taking that capability off them. The firm would
  // then be unable to invite, deactivate, or grant anything ever again, with no remedy inside the
  // product. Fixed by giving another active member that role first.
  "last-administrator": "last-administrator",
  // A role handle naming no role of this firm (HTTP 422). DISTINCT from `validation`, which refuses
  // a malformed handle: this one is well-formed and simply names nothing, so the caller's list of
  // roles is stale rather than wrong in shape.
  "unknown-role": "unknown-role",
  // A role set that breaks the sub-role rules (HTTP 422): a sub-role named without its parent, or
  // two sub-roles of one parent. The parent's row is what carries its permissions to the member, so
  // a Partner without Attorney would hold only what Partner adds; and Partner and Associate describe
  // one position, so holding both is a set nobody meant.
  "role-family": "role-family",
  // A meeting nothing can reach (HTTP 404): a handle naming no room, an event with no meeting on it,
  // an event that does not exist, and an event on a matter the member may not see. ONE type for all
  // four deliberately — a meeting is reachable only through its calendar event, so those are one
  // question, and answering them differently would make the route an existence oracle for a walled
  // matter: ask about an id, learn from the wording whether it is real.
  "meeting-not-found": "meeting-not-found",
  // A meeting that has already finished (HTTP 409). Terminal and its own type rather than a generic
  // conflict, because the remedy is to start a new meeting on the event rather than to retry this
  // one — the attendance under a meeting describes one gathering, and a second gathering is a second
  // room.
  "meeting-ended": "meeting-ended",
  // The room is at its ceiling and the next person is not coming in (HTTP 409). Named so the refusal
  // can say how many the room holds; counted over the stays that are still open, so somebody leaving
  // makes a seat.
  "meeting-room-full": "meeting-room-full",
  // Asked of a room the caller is not in (HTTP 409) — signaling on a meeting nobody opened an
  // attendance for. DISTINCT from `permission-denied`: the member may join this meeting, and the
  // remedy is to join it first rather than to be granted anything.
  "meeting-not-joined": "meeting-not-joined",
  // This deployment has no media routing credentials (HTTP 503), so there is nowhere for a
  // meeting's audio and video to go. A fact about the deployment rather than about the caller or
  // their firm, which is why it is not a 403: nobody here can fix it by being granted something.
  "meetings-not-configured": "meetings-not-configured",
  // A calendar act refused because the event's meeting is running (HTTP 409): people are in the room
  // right now. Its own type rather than the generic `conflict` because the remedy is a NAMED act the
  // caller can take — end the meeting, then cancel the event — and a surface that can read the type
  // can offer that act instead of restating a sentence. The opposite of `meeting-ended`: that one
  // says the gathering is over, this one says it has not finished.
  "meeting-in-progress": "meeting-in-progress",
  // A chat message nothing can reach (HTTP 404): a handle naming no message, and a message that
  // belongs to a different meeting from the one the caller was authorized against. One type for
  // both, on the reasoning `meeting-not-found` above states — a message is reachable only through
  // its meeting, so telling them apart would make the route an existence oracle for a room the
  // caller cannot see into.
  "meeting-message-not-found": "meeting-message-not-found",
  // A chat message longer than a message may be (HTTP 422). Its own type rather than the generic
  // `validation` because the remedy is a specific one a surface can act on — shorten it, or put the
  // long thing on the file as a document — and because a message silently truncated to fit would be
  // a record of something nobody said.
  "meeting-message-too-long": "meeting-message-too-long",
  // A FILE a meeting's chat cannot point at (HTTP 404): not on the meeting's matter, deleted, or a
  // meeting kept on no matter at all. Absent rather than forbidden, so a guessed handle learns nothing.
  "meeting-message-file-unavailable": "meeting-message-file-unavailable",
  // A POLL nothing can reach (HTTP 404) — a handle naming no poll, and a poll in another meeting, on
  // the chat message's reasoning.
  "meeting-poll-not-found": "meeting-poll-not-found",
  // A host closed it, so it takes no more answers (HTTP 409).
  "meeting-poll-closed": "meeting-poll-closed",
  // This member has already answered it, from this stay or an earlier one (HTTP 409). An answer
  // cannot be changed; a host who wants the room asked again opens a second poll.
  "meeting-poll-already-answered": "meeting-poll-already-answered",
  // Who answered what, asked of a poll that does not show names (HTTP 409). Refused rather than
  // answered with an empty page, which would read as "nobody answered".
  "meeting-poll-answers-not-attributed": "meeting-poll-answers-not-attributed",
  // A poll body — or an answer's choices — that is not one this poll accepts (HTTP 422). ONE type for
  // the question's length, the option count, an option's length and the choices, because they are
  // one validation of one body; the problem's `errors` names the field that failed.
  "meeting-poll-invalid": "meeting-poll-invalid",
  // A QUESTION from the queue nothing can reach (HTTP 404), on the chat message's reasoning.
  "meeting-question-not-found": "meeting-question-not-found",
  // A question longer than a question may be (HTTP 422) — refused rather than truncated.
  "meeting-question-too-long": "meeting-question-too-long",
  // The meeting's queue already holds as many questions as a queue may (HTTP 409).
  "meeting-question-limit-reached": "meeting-question-limit-reached",
  // The caller is not running this meeting (HTTP 403). A 403 rather than a 409 because it is an
  // authority question and retrying changes nothing; its OWN type rather than the chokepoint's
  // `permission-denied` because the member holds the permission and the remedy is different —
  // somebody has to hand them the room, or, where nobody is running it, they claim it. Authority
  // over a meeting is a grant on the meeting rather than a capability of a seat, and this is the
  // refusal that says so.
  "meeting-not-host": "meeting-not-host",
  // The door is shut (HTTP 409). A late arrival reads a sentence rather than meeting a silent
  // failure, and the meeting summary carries `locked` so a Join control can say so before the click
  // rather than after it. Fixed by a host unlocking the room, which is why it is neither an absence
  // nor a permission answer.
  "meeting-locked": "meeting-locked",
  // A host put this member out of this meeting (HTTP 409). Its own type because a surface has to
  // answer it differently from every other refusal: the way back is not to retry and not to ask for
  // anything, so the screen offers no Rejoin at all. It is the MEETING they are barred from and not
  // the event — a new meeting on the same event is a new room.
  "meeting-removed": "meeting-removed",
  // The lobby is full (HTTP 409) — the hundred-and-first arrival at a door a hundred people are
  // already waiting at. DELIBERATELY NOT `meeting-room-full`: the two ceilings answer different
  // questions and the remedies differ, so a surface that collapsed them would tell somebody to wait
  // for a seat when what is needed is a host looking at the list. A queue is also not somewhere a
  // firm should be able to accumulate rows without limit, which is why the number is much smaller
  // than the room's.
  "meeting-lobby-full": "meeting-lobby-full",
  // A host turned this member away at the door (HTTP 409), and they are arriving again. The twin of
  // `meeting-removed` — barred entry is one rule with two labels, and both bar the member for as
  // long as the meeting runs. Its own type because a screen has to say the right thing: one is
  // being put out of the room, the other is never having been let in.
  "meeting-not-admitted": "meeting-not-admitted",
  // A MEETING'S RECORDING, refused. Each is its own type because each has a different remedy a screen
  // can offer, and none of them is a permission answer.
  //
  // This deployment, or this firm, cannot record (HTTP 503): the firm has not switched recording on,
  // or the deployment has no media routing credentials, no sink signing key or no recorder bound. A
  // fact about configuration rather than about the caller — on the `meetings-not-configured`
  // precedent — so nothing anybody can be granted fixes it, and the Record control is not offered.
  "meeting-recording-not-configured": "meeting-recording-not-configured",
  // The room is already being recorded (HTTP 409). Two members pressing Record together is the
  // ordinary way to meet it, and the remedy is that what they wanted is already happening.
  "meeting-recording-already-running": "meeting-recording-already-running",
  // Nothing is being recorded (HTTP 409): somebody else stopped it, the meeting ended, or every track
  // was lost. Not a success, because the caller did not stop it and the screen should say so.
  "meeting-recording-not-running": "meeting-recording-not-running",
  // A meeting on a firm event (HTTP 422). A recording is filed into a matter and a firm event has none,
  // so there is nowhere to put it; the request is well-formed and the event is the wrong kind.
  "meeting-recording-needs-matter": "meeting-recording-needs-matter",
  // The room carries more audio tracks than one recording may hold (HTTP 409). Refused before the mark
  // lights, because a recording that started and then could not hold everybody would have told the
  // room something untrue; the remedy is a smaller room or a firm that raises its ceiling.
  "meeting-recording-too-many-tracks": "meeting-recording-too-many-tracks",
  // A MEETING'S SUMMARY, refused at the door of an act on it. Each has its own remedy a screen offers.
  //
  // The recording's transcript is not ready (HTTP 409), so there is nothing yet to summarize; the
  // remedy is waiting for the transcript, which the recording list says the state of.
  "meeting-transcript-not-ready": "meeting-transcript-not-ready",
  // The summary is not there to act on (HTTP 409): it is still being written, it was refused or failed,
  // or its transcript's filed document has been put in the trash, held by the scan or is gone — in which
  // case its words are withheld exactly as the transcript's are.
  "meeting-summary-not-ready": "meeting-summary-not-ready",
  // The action item has already been made into a task (HTTP 409) — by this member a moment ago or by a
  // colleague — and a second press must not put a second copy of one obligation on somebody's list.
  "meeting-summary-action-item-tasked": "meeting-summary-action-item-tasked",
  // A MEMBER'S PERSONAL ROOM. A link that names no room, or the room of somebody who has left the
  // firm (HTTP 404) — one answer for both, because the second is not the caller's business.
  "personal-room-not-found": "personal-room-not-found",
  // Opening or changing somebody else's room (HTTP 403): only its owner does either.
  "personal-room-not-owner": "personal-room-not-owner",
  // Moving a meeting onto a matter that cannot be moved there (HTTP 409): it is not a personal-room
  // session, it is on a matter already, or the caller is neither its room's owner nor running it.
  "meeting-move-refused": "meeting-move-refused",
  // Somebody else replaced the room's link or moved the session between the read and the write
  // (HTTP 409); what they did stands, and the remedy is to look again.
  "personal-room-changed": "personal-room-changed",
  // A MEETING GUEST'S LINK THAT CANNOT BE USED, said to somebody holding a correctly SIGNED one — which
  // only somebody the firm sent it to can hold, so each is specific and actionable. A token whose
  // signature does not verify never reaches any of these: it gets the reserved `not-found`, one flat
  // answer that says nothing about whether a meeting or a firm exists.
  //
  // Signed, but it matches no live invitation — the firm sent a newer link in its place (HTTP 410).
  "guest-link-not-valid": "guest-link-not-valid",
  // Past the instant computed when the link was minted (HTTP 410).
  "guest-link-expired": "guest-link-expired",
  // A host withdrew it (HTTP 410). The invitation row stays; the link does not work.
  "guest-link-revoked": "guest-link-revoked",
  // Spent at the door as many times as one link may be (HTTP 409).
  "guest-link-exhausted": "guest-link-exhausted",
  // A host asked to invite somebody the record cannot resolve to a Directory entity on the event with
  // an address the firm may use (HTTP 422). The remedy is in the Directory, not in retrying.
  "guest-not-invitable": "guest-not-invitable",
  // A playable copy was asked for of a version the converter cannot take at all (HTTP 422): not an
  // MP4, QuickTime or Matroska video, stored in a form it cannot read directly, or flagged by a scan.
  // DISTINCT from a copy the engine tried and could not make, which is a 200 with state unavailable.
  "playable-copy-not-a-candidate": "playable-copy-not-a-candidate",
  // The one-time link to the community board cannot be minted because this deployment holds no
  // COMMUNITY_HANDOFF_SECRET (HTTP 503). A fact about configuration, not about the member.
  "community-sign-in-not-configured": "community-sign-in-not-configured",
} as const;

export type ProblemTypeKey = keyof typeof PROBLEM_TYPES;

// The full `type` URI for a registered key — a template-literal type, not `string`, so the
// registry guarantee (only registered URIs are ever emitted) carries through to consumers.
export type ProblemTypeUri = `https://api.magnacarta.esq/problems/${ProblemTypeKey}`;

export function problemType(key: ProblemTypeKey): ProblemTypeUri {
  return `https://api.magnacarta.esq/problems/${PROBLEM_TYPES[key]}`;
}
