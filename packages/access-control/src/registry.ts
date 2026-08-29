// Branded permission string. The brand is compile-time only — erased at runtime, so it costs nothing
// on the wire. A Permission IS assignable to string (it flows into database rows and audit logs);
// a raw string is NOT assignable to Permission without going through isPermission/assertPermission.
declare const permissionBrand: unique symbol;
export type Permission = string & { readonly [permissionBrand]: true };

// The platform permission registry: one namespace per subsystem, `<subsystem>:<action>`.
// Grows one block per subsystem slice; the fitness tests cross-check every referenced key against this.
export const PERMISSIONS = [
  "firm:manageMembers", // invite/deactivate members, assign roles
  // Reading WHO is on the firm — the roster a screen needs to put a name to a colleague. Split off
  // firm:manageMembers deliberately: adding a person to the firm and knowing who is already in it
  // are different acts, and a member who may not invite anybody still has to be able to see that the
  // matter in front of them is Ms Okafor's. The read carries no contact details, no permissions and
  // no credential state — a display name, the member's status, the roles they hold, and whether a
  // professional profile has been written — so holding it discloses nothing beyond what any
  // colleague already learns from a hallway.
  "firm:readMembers", // read the firm's member roster: display name, status, roles, profile presence
  "firm:provision", // reserved: platform-level firm creation (guarded by secret this slice)
  "firm:reportIncident", // file a diagnostic incident (slice 0·6) — seeded to every default role
  "firm:scanFile", // run a one-off, matter-less malware-scan diagnostic — seeded to every default role
  "firm:manageSecrets", // read/write the encrypted per-firm secret store (an audited decrypt on read)
  "firm:manageScanPolicy", // read and update the firm's malware scan-policy settings
  "firm:manageReleaseChannel", // set the firm's release channel between {stable, beta}; alpha is platform-only
  // The firm's notification POLICY, which is a different act from a member's own preferences. The
  // in-app floor decides what every member of the firm must go on hearing whatever they switch off;
  // the retention window decides how long every member's pointers live; the digest hour decides when
  // the firm's mail lands. None of those is a personal setting, so none of them may ride
  // notifications:read — that key is seeded to EVERY default role including Read-only precisely
  // because reading one's own feed is not a privilege, and reusing it here would let any member lower
  // the floor and shorten retention for everybody. Owner/Admin only, mirroring firm:manageScanPolicy.
  "firm:manageNotificationPolicy", // read and update the firm's notification policy: the in-app floor, retention window, and digest hour
  // Incidents — gates on the user-authored incident report beyond filing it.
  "incidents:viewDescription", // decrypt and read an incident's protected description (audited)
  // Matters — the matter shell, its lifecycle, and the per-firm type/numbering configuration.
  "matters:create", // open a consultation or a numbered matter
  "matters:open", // draw a number on a prospective matter (prospective -> open)
  "matters:close", // archive a matter (closed-but-additive)
  "matters:reopen", // return a closed matter to open
  "matters:edit", // edit matter fields (title/description/type/location/attorney/client)
  "matters:renumber", // assign a manual/court/legacy number
  "matters:manageTypes", // create/deactivate matter types
  "matters:manageNumbering", // edit the firm numbering scheme
  // Directory — persons, organizations, and their sensitive typed identifiers.
  "directory:edit", // create/edit directory entities, names, identifiers, edges, categories, merges, and matter-party links
  "directory:viewSensitiveIdentifiers", // decrypt and read an entity's protected identifier (SSN/EIN/DL/account/DOB) — audited
  // Conflicts — the firm-wide conflicts-of-interest check and its append-only log.
  "conflicts:run", // run a conflicts check against the directory corpus
  "conflicts:read", // read a completed check and its surfaced hits
  "conflicts:dispose", // record a reviewer's adjudication (clear, waive, wall, decline) of a hit
  // Locations — the firm's offices/letterhead roots.
  "locations:manage", // create/update/close locations, addresses, staff assignment
  // Shipping & postage — connect the firm's postage account and create/rate/buy/track/refund shipments.
  "shipping:manage",
  // Files — the File Manager's upload, organization, and document-type configuration.
  "files:upload", // initiate uploads and commit versions
  "files:organize", // create/rename/move folders and files
  "files:delete", // soft-delete files
  "files:manageDocumentTypes", // create/deactivate document types
  // Tools — the cross-cutting Tools area: general-purpose utilities surfaced in the sidebar and
  // contextually. One key per tool; gates visibility on both surfaces. Role-seeding lands with the
  // Tools UI shell.
  "tools:propertyListings", // external property-listing links (Zillow/Redfin/…)
  "tools:propertyRecords", // county assessor/recorder record links
  "tools:businessLookup", // Secretary-of-State business-entity lookup links
  "tools:attorneyLicense", // attorney-license lookup links
  "tools:shipping", // shipping & postage (the shipping integration)
  "tools:speedTest", // in-app network speed test (runs client-side against the Cloudflare edge)
  "tools:firmUsage", // firm usage snapshot — storage + entity counts (read-only, per-firm)
  "tools:whois", // WHOIS/RDAP registration lookup for a website's domain or an IP
  "tools:safeBrowse", // render a suspect URL in an isolated remote browser (static snapshot only)
  "tools:decryption", // decrypt locked files (PDF/ZIP/OOXML), recover lost passwords, and remove a PDF's owner/permissions ("editing") restrictions from a document that opens without a prompt
  "tools:fileConverter", // general matter-free file converter — convert a file to another format
  "tools:aiTextDetection", // AI-text detection — likelihood that text was machine-generated (a signal, not proof)
  // Documents — in-app editing of a file's content (Collabora), versioning, and the offline
  // check-out / reconciliation flow. Each document route is matter-scoped (RouteMeta resource: "matter").
  "documents:edit", // open a document for editing; a deliberate Save or session-close cuts a version
  "documents:checkout", // take an offline working copy, or an opt-in exclusive lock
  "documents:forceReleaseLock", // release another member's exclusive lock
  "documents:reconcile", // resolve a divergent check-in — choose which copy becomes authoritative
  // E-signature — the platform seal (PAdES) applied to a document, and the ESIGN/UETA signing act
  // around it. The seal runs in the dedicated sign worker that alone holds the platform signing key.
  "esign:seal", // apply the platform seal / signature to a PDF, producing a tamper-evident sealed record
  "tools:metadataScrubber", // inspect/scrub a file's metadata & content artifacts (ephemeral, matter-free)
  "tools:fileIntegrity", // compute a file's cryptographic digests + verify a stored file against its ingest baseline
  "tools:fileTypeVerifier", // identify a file's true content type and flag/repair an extension mismatch
  "tools:fileRepair", // recover content from a structurally corrupted / truncated / damaged file (stateless)
  "tools:ocr", // recognize text in a scanned image or PDF — returns text, word boxes, and confidence
  "tools:emailInspector", // inspect .eml/.msg/mbox headers, participants, attachments, and authenticity facts
  // Custom fields — define and maintain field schemas; purge hard-deletes all values for a field.
  "customFields:manage",
  "customFields:purge",
  // Time tracking, WIP & the rate engine — one namespace per subsystem (house convention).
  "time:track", // create/edit own time entries and run the timer
  "time:viewFirm", // see other timekeepers' time (firm-wide My Day / report gating)
  "time:approve", // submit-for-review / approve / kick-back when the review gate is on
  "time:manageRates", // rate cards, rate versions, and the re-rate-unbilled-drafts action
  "time:manageUtbms", // enable/disable the UTBMS code catalog
  "time:manageSettings", // the scoped time settings, non-billable categories, narrative templates
  // Costs / disbursements — soft costs and hard costs captured against a matter.
  "costs:track", // create/edit cost entries (manual and grid sources)
  "costs:approve", // approve / kick-back cost entries when the review gate is on
  // Support access — a firm member requests time-boxed help-desk access; admins co-sign/manage it.
  "support:request", // request a support session (seeded to EVERY default role — any member may ask)
  "support:cosign", // co-sign a privileged support grant when firm policy requires it (admin)
  "support:manage", // revoke/oversee the firm's support grants (admin)
  "support:mintSession", // platform-level: redeem a grant for a session token (never seeded to a firm role)
  // Diagnostics — the read-only system-state surface a DIAGNOSTIC support session is scoped to. These
  // keys carry NO decrypt capability, so privileged content stays unreachable from a diagnostic session.
  // Never seeded to a firm role — granted only by holding a diagnostic support session.
  "diagnostics:overview", // firm system-state overview (status, schema version, member count, storage)
  // Emails — filing/recording emails to matters, reading a matter's filed threads, managing the
  // per-matter links, and administering the forward/CC capture addresses. Email links are matter-rooted
  // (the files:* precedent), so every emails:* route binds resource: "matter".
  "emails:file", // capture/file an email to a matter (the API entrance)
  "emails:read", // read a matter's filed emails and threads, and the wall-safe "already filed" signal
  "emails:manageLinks", // accept a staged link, link to additional matters, unlink
  // Separate from emails:manageLinks on purpose: filing mail and configuring the machine to file
  // mail are different grants. A rule is durable, acts unattended, and acts on behalf of people who
  // did not create it, so a firm must be able to say "you may file mail" without also saying "you
  // may set up automatic filing".
  "emails:manageAutoFileRules", // create/update/suspend/resume/revoke a matter's auto-file rules
  "emails:manageCaptureAddresses", // mint/rotate a matter's forward token, manage the firm catch-all (admin)
  // Document automation — the firm's assembly-template catalogue and the act of assembling a document
  // onto a matter. The catalogue is firm-level and carries no matter data, so templates:* binds
  // resource: "firm"; an assembly is matter-rooted like every other document operation, so
  // documents:assemble binds resource: "matter" (the files:* precedent). Listing the catalogue is bound
  // to documents:assemble rather than a third read key: a member who can assemble must be able to see
  // what they can assemble, and a member who cannot has no use for the list.
  "templates:manage", // register, version, and archive assembly templates (administrative)
  "documents:assemble", // list the template catalogue and assemble a document onto a matter
  // Custodian — the register of physical client originals the firm holds in safekeeping. Two keys,
  // because reading a register and moving originals in it are genuinely different capabilities: a
  // billing clerk answering "do we hold the deed" needs the read and must not have the write. Both
  // bind resource: "firm" — a custody packet may have no matter by construction, so the firm is its
  // tenancy root.
  "custody:read", // read the register — locations, packets, items, owners, movements, holds, scans
  "custody:manage", // create/edit packets, items, locations and the type catalog; record movements; place and release holds
  // Trust accounting — client money the firm holds and owes back. Two keys, because reading a
  // client's trust balance and moving client money are genuinely different capabilities: a
  // timekeeper answering "how much of this client's money do we hold" needs the read and must not
  // have the write. Both bind resource: "firm" — a trust account belongs to an office, not a
  // matter, and its sub-ledger spans every matter a client has.
  "trust:read", // read trust accounts, the client/matter sub-ledger, balances, available balances, and holds
  "trust:manage", // open trust accounts, build the sub-ledger, place and release holds, compose trust movements
  // The authority to act on client money — the capability a firm's authorization policy can require
  // of whoever lets a disbursement or an earned-fee application go (the approver, or the sole actor
  // when the policy exempts the amount). A separate key from trust:manage because "may keep the
  // trust books" and "may authorize money to leave" are the two capabilities the owner's policy
  // exists to separate; changing the policy itself also takes this key, since relaxing the firm's
  // money-movement posture IS an act of authority over client money.
  "trust:authorize", // authorize money leaving a client ledger when policy requires authority; change the authorization policy
  // The firm's OWN money inside a trust account — the narrow carve-out the conduct rules permit so
  // that the institution's service charges are borne by the firm rather than by client funds. A
  // third key rather than a corner of trust:manage, because it is the one deliberate exception to
  // no-commingling: it is permitted for a single purpose, only in the amount necessary for it, and
  // a firm should be able to say who may put firm money into a client trust account without also
  // saying who may record a client receipt. It cannot reach client money — the movements it gates
  // are structurally incapable of naming a client or a matter — so its whole job is to keep the
  // exception in named hands.
  "trust:firmFunds", // open the bank-charge carve-out on a trust account; deposit the firm's own cushion; record a bank service charge against it
  // Billing and invoicing — the firm's own bill, and the money that comes back against it. Six keys
  // rather than a read/manage pair, because the capabilities genuinely differ and a firm's shape
  // separates them: a billing clerk assembles drafts for a partner to finalize, so drafting and
  // finalizing are different keys; applying moves CLIENT money onto a bill, which is the same reason
  // trust separates reading a balance from moving one; and crediting reverses an evidentiary record
  // the firm has already given somebody. All bind resource: "firm" — one invoice may bill several of
  // a client's matters, so the matter is not its tenancy root.
  "billing:read", // read invoices, lines, unbilled work-in-progress, balances, and the receivables aging
  "billing:draft", // create a draft invoice, claim work-in-progress onto it, edit its lines, void it
  "billing:finalize", // turn a draft into an evidentiary record: draw its number and post the receivable
  "billing:apply", // move client money onto a finalized invoice (payments, earned fees taken from trust)
  "billing:credit", // credit notes and write-offs against a finalized invoice
  "billing:configure", // billing arrangements, tax rates, the numbering scheme, the account-role map
  // Case calendar — litigation events, deadlines, and the matter timeline that federates them with
  // everything else the firm already recorded. Two keys, because reading a case's history and
  // asserting when a hearing is are genuinely different capabilities: everyone working a matter needs
  // to see what is coming, and a wrong hearing date entered by somebody who was not there is a
  // missed appearance. Both bind resource: "matter" for the matter-scoped routes and "firm" for the
  // firm-wide calendar, which is a matter-scoped read repeated under the same visibility predicate.
  "calendar:read", // read matter timelines, events, deadlines, and the firm-wide calendar
  "calendar:manage", // record, edit, and cancel events; record, satisfy, vacate, and supersede deadlines; manage the event-type catalog
  // Matter assets — the register of what a client or an estate owns, kept on a matter. Two keys,
  // because the register concentrates a matter's financially sensitive facts (what the estate owns,
  // what it is worth, account suffixes, home addresses) in one surface: a firm that gives a
  // scheduling paralegal matters:manage has not thereby decided to give them the estate's asset
  // ledger, so these do not ride the matters keys. Both bind resource: "matter" — an asset row is one
  // matter's assertion and cannot exist without one, the clean contrast with custody:*'s firm
  // binding. The namespace is matterAssets rather than the bare word because "assets" already means
  // two other things here (Workers Static Assets, and the firm's own property register that the
  // asset design deliberately excludes), and a permission key is read by people deciding who sees
  // what. There is deliberately no third key for reading a full account or policy number: that read
  // is gated by the decrypt permission already carried on the protected column
  // (directory:viewSensitiveIdentifiers, the key a firm already grants for exactly this class of
  // secret), so matterAssets:read alone never reveals one and no second grant has to be kept in step.
  "matterAssets:read", // read the register — assets, class attributes, valuations, interests, linked documents, the type catalog
  "matterAssets:manage", // record and edit assets, append valuations, add and end interests, link and unlink documents, manage the type catalog
  // Magnus — the conversational assistant. Two keys, because using the assistant and reading what
  // everyone else asked it are different capabilities: the transcript is a firm record and a
  // supervision surface, so "may hold a conversation" must be grantable without "may read every
  // member's conversation". Both bind resource: "firm" — a conversation may carry an optional matter
  // link but exists without one, so the firm is its tenancy root. There is deliberately no
  // per-member enable switch beside these: a second authorization mechanism the chokepoint does not
  // know about is how a feature ends up enforced by discipline in a route handler.
  "magnus:converse", // start conversations, submit turns, read and delete one's OWN conversations
  "magnus:readAllConversations", // read any member's conversation in the firm (the audited supervision read)
  // Discovery — the corpus of documents under review on a matter. Its OWN namespace, and that is the
  // load-bearing part: material produced by another party may be attorney's-eyes-only under a
  // protective order, so reaching a review set must never follow from holding matters:* or files:*.
  // A member with full access to the matter and no discovery grant cannot read a review set, cannot
  // see what was loaded into it, and cannot load anything more.
  //
  // Five keys rather than the house read/manage pair, because three of the capabilities are
  // genuinely different from reading. LOADING is the act that brings another party's untrusted
  // material into the firm's own corpus, consumes the review set's document ceiling, and is the one
  // discovery operation whose cost is set from outside the firm. REVIEWING is the coding gesture
  // itself. PRODUCING is the consequential gate — the point at which a coding decision reaches the
  // outside world — and it is also what manages the access list, because widening who may see a
  // corpus is the same order of decision as deciding what leaves the firm. A contract reviewer
  // working under a protective order holds discovery:read and discovery:review and none of the other
  // three, and that configuration has to be expressible.
  //
  // Privilege DESIGNATION deliberately has no tier of its own: it rides discovery:review with the
  // rest of coding, and discovery:produce is where a designation becomes consequential. Gating the
  // coding gesture itself would make privilege review a bottleneck in exactly the small firms this
  // platform serves, for no defensibility gain.
  //
  // All five bind resource: "matter" — a review set IS one matter's corpus and cannot exist without
  // one, the matterAssets:* binding rather than custody:*'s firm binding. And holding any of them is
  // NOT sufficient on its own: every discovery route additionally checks the review set's own access
  // list (packages/discovery/src/review-set-visibility.ts), because an attorneys'-eyes-only
  // production is a review set whose list is two people.
  "discovery:read", // read review sets, record custodians, loads, review documents, exception reports, and coding
  "discovery:manageReviewSets", // create, rename, lock and close review sets; create and edit record custodians; edit the coding panel
  "discovery:load", // declare a load and put material into a review set
  "discovery:review", // apply and remove coding on documents, run bulk coding operations, and undo them
  "discovery:produce", // manage a review set's access list (and, later, stage and cut productions)
  // Notifications — a member's own feed of things the platform noticed. ONE key, seeded to every
  // default role including Read-only, which is the deliberate contrast with trust:read. A member
  // reading their own feed is not a privilege: the read is scoped to the session's own user id and
  // every row is filtered by matter visibility at read time, so holding the key grants sight of
  // nothing the member could not already reach — and a firm whose staff cannot see their own
  // deadlines is a firm this feature has failed. There is deliberately no notifications:manage
  // beside it: marking one's own item read is the same capability as reading it, and preference
  // writes ride the settings capability that already exists.
  //
  // Binds resource: "firm". A feed spans every matter a member touches and firm-scoped kinds that
  // have no matter at all, so binding it to "matter" would name a resource half the rows do not
  // have — the same reasoning custody:* and trust:* carry.
  "notifications:read", // read one's own notification feed, unread counts, and mark items read or dismissed
  // Reporting — projections over records the firm already holds, read across every matter and client
  // at once. Its OWN namespace rather than a corner of trust:read and billing:read, on the reasoning
  // that split trust:firmFunds off trust:manage: an aggregate spanning the whole firm is a different
  // exposure from a per-matter read, and a member who may read one client's trust balance is not
  // thereby a member who may read the firm's entire receivable position or every client's ledger in
  // one document.
  //
  // Five keys rather than a read/produce pair, because the four report families are four different
  // decisions a firm makes about one person. reports:productivity is deliberately its own key: a
  // report about PEOPLE — what each timekeeper recorded, and how much of it was billable — is a
  // different grant from a report about money, and a firm must be able to give a bookkeeper the
  // financial reports without also handing them a supervision surface over every lawyer.
  // reports:produce is separate again because turning a report into a filed, immutable firm record is
  // an act with a consequence, where reading one on screen is not.
  //
  // All five bind resource: "firm" — every one of these reads spans matters and clients by
  // construction, and the trust account a compliance pack is produced for belongs to an office
  // rather than to a matter. Seeded to Owner and Admin only, which is deliberately narrow: a firm
  // that wants its bookkeeper to run reconciliation packs reaches for a direct grant, which leaves a
  // record.
  "reports:trustCompliance", // read and produce the trust-compliance (bar-audit) pack for any trust account
  "reports:financial", // receivables aging, work in progress, realization — firm-wide and per-office
  "reports:productivity", // hours recorded by timekeeper across the firm
  "reports:operational", // operational volumes — matters, invoices, movements, reconciliations
  "reports:produce", // turn a report into a filed artifact and read the productions
] as const;

// KnownPermission is for hardcoded compile-checked keys (route metadata, role seeds);
// Permission is for runtime-validated strings (the brand requires going through isPermission/assertPermission).
export type KnownPermission = (typeof PERMISSIONS)[number];

const permissionSet: ReadonlySet<string> = new Set(PERMISSIONS);

// Type guard: is `value` a registered permission key? Narrows an untrusted string to the brand.
export function isPermission(value: string): value is Permission {
  return permissionSet.has(value);
}

// Throwing narrower for the common "reject bad input" path. Fails loud with the offending value.
export function assertPermission(value: string): Permission {
  if (!isPermission(value)) throw new TypeError(`Unknown permission: ${JSON.stringify(value)}`);
  return value;
}

// All registered keys under one subsystem namespace, in registry order.
export function permissionsForNamespace(namespace: string): readonly Permission[] {
  const registeredKeys: readonly string[] = PERMISSIONS; // safe widening so the isPermission guard applies
  return registeredKeys.filter((key) => key.startsWith(`${namespace}:`)).filter(isPermission);
}
