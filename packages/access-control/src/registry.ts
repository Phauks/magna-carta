// Branded permission string. The brand is compile-time only — erased at runtime, so it costs nothing
// on the wire. A Permission IS assignable to string (it flows into database rows and audit logs);
// a raw string is NOT assignable to Permission without going through isPermission/assertPermission.
declare const permissionBrand: unique symbol;
export type Permission = string & { readonly [permissionBrand]: true };

// The platform permission registry: one namespace per subsystem, `<subsystem>:<action>`.
// Grows one block per subsystem slice; the fitness tests cross-check every referenced key against this.
export const PERMISSIONS = [
  "firm:manageMembers", // invite/deactivate members, assign roles
  "firm:provision", // reserved: platform-level firm creation (guarded by secret this slice)
  "firm:reportIncident", // file a diagnostic incident (slice 0·6) — seeded to every default role
  "firm:scanFile", // run a one-off, matter-less malware-scan diagnostic — seeded to every default role
  "firm:manageSecrets", // read/write the encrypted per-firm secret store (an audited decrypt on read)
  "firm:manageScanPolicy", // read and update the firm's malware scan-policy settings
  "firm:manageReleaseChannel", // set the firm's release channel between {stable, beta}; alpha is platform-only
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
  // Three keys rather than the house read/manage pair, because the third capability is genuinely
  // different: LOADING is the act that brings another party's untrusted material into the firm's own
  // corpus, consumes the review set's document ceiling, and is the one discovery operation whose cost
  // is set from outside the firm. A contract reviewer working under a protective order holds
  // discovery:read and neither of the others, and that configuration has to be expressible.
  // All three bind resource: "matter" — a review set IS one matter's corpus and cannot exist without
  // one, the matterAssets:* binding rather than custody:*'s firm binding.
  "discovery:read", // read review sets, record custodians, loads, review documents, and exception reports
  "discovery:manageReviewSets", // create, rename, lock and close review sets; create and edit record custodians
  "discovery:load", // declare a load and put material into a review set
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
