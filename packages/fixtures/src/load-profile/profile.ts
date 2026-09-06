// Bump when GENERATION LOGIC changes in a way that alters produced rows for the same profile +
// seed (new archetype, changed faker call order, …) — it participates in snapshot identity, so a
// stale cached artifact can never be measured against silently. Profile parameter changes bump
// the profile's own `version` instead.
export const GENERATOR_VERSION = 12;

// Transaction archetypes, weighted (faker.helpers.weightedArrayElement). The settlement archetype
// is the multi-line tail; the rest are two-line entries. Weights are profile PARAMETERS, never
// generator constants.
export interface ArchetypeWeights {
  readonly trustDeposit: number;
  readonly trustDisbursement: number;
  readonly feeBilled: number;
  readonly paymentReceived: number;
  readonly operatingExpense: number;
  readonly settlement: number;
}

// The practice volume the matters/locations/file-manager generator lays down on top of the ledger
// book: offices, matter
// types, the active numbering scheme, matters across the lifecycle, and the folder/file tree with
// committed clean versions. Every count/distribution is a PARAMETER here, never a generator constant —
// changing one bumps the profile `version` (the baseline file renames), so a baseline can never
// silently compare data of two different shapes. The file/file_version/storage_meter rows ARE the
// queryable shadow of the R2 blob layer: node:sqlite has no R2, so the modeled sizes and version rows
// stand in for the blobs the reads and the meter would resolve against in production.
export interface PracticeVolume {
  readonly locationCount: number;
  readonly matterTypeCount: number;
  // Matters laid down per lifecycle status. Prospective = consultations (no number); open/closed draw
  // a number through openMatter, exercising the counter.
  readonly prospectiveMatterCount: number;
  readonly openMatterCount: number;
  readonly closedMatterCount: number;
  // Folders created per matter (a flat working set under the matter root; no nesting in v1 volume).
  readonly foldersPerMatter: { readonly min: number; readonly max: number };
  // Files created per matter (each lands in a matter folder or the matter root).
  readonly filesPerMatter: { readonly min: number; readonly max: number };
  // Committed clean versions per file (≥ 1 — a file is visible only once a version commits clean).
  readonly versionsPerFile: { readonly min: number; readonly max: number };
  // Synthetic committed-version size in bytes, drawn per version (the modeled R2 blob size that also
  // feeds storage_meter). Plausible document sizes, not a stress payload.
  readonly fileSizeBytes: { readonly min: number; readonly max: number };
  // Fraction of committed clean versions left scan_verdict='unscanned' (awaiting the scan engine) vs
  // 'clean' (already scanned) — the queryable shadow of the launch→engine transition. The weekly
  // re-scan sweep targets exactly the unscanned subset, so this fraction is what makes its batch read a
  // selective, volume-shaped operation rather than a trivial all-or-nothing scan.
  readonly unscannedVersionFraction: number;
}

// The shipping volume laid over the practice book: drafts spread across the firm's matters, a
// fraction taken through to a bought label, and a handful of tracking events per purchased shipment.
// Every count is a PARAMETER here, never a generator constant — changing one bumps the profile
// `version`. Sized like an established firm's mailing volume, not a stress run.
export interface ShippingVolume {
  readonly shipmentCount: number;
  // Percentage of drafts taken through to a bought label (the rest stay drafts). 0–100.
  readonly purchasedPercent: number;
  // Tracking events appended per purchased shipment (the pulled carrier history).
  readonly trackingEventsPerShipment: { readonly min: number; readonly max: number };
}

// The protected-field volume laid over the practice: diagnostic incidents whose user-authored
// descriptions are SEALED at rest, and a handful of named firm secrets whose values are sealed too.
// This is the queryable shadow of the crypto chokepoint — the encrypt-on-write
// and audited decrypt-on-read paths the protected() module introduces. Counts are PARAMETERS (scaling
// bumps the profile version). Directory-scale protected volume — many blind-indexed sensitive
// identifiers — rides slice 1·3, where an indexed protected column first exists.
export interface ProtectedVolume {
  // Diagnostic incidents with a sealed description (the protected list read decrypts a page of these).
  readonly incidentCount: number;
  // Named firm secrets with a sealed value (read by name through the secrets store).
  readonly firmSecretCount: number;
}

// The directory volume laid over the practice: persons and organizations, their name history (former
// names and aliases that stay in the conflicts corpus), the relationship graph between entities, the
// blind-indexed sensitive identifiers (SSN) that ride the protected-field chokepoint, and the
// matter-party links that join an entity to a matter in a role. This is the queryable shadow of the
// conflicts/related-party surface — the blind-index identifier lookup, the protected-list decrypt, the
// duplicate-candidate generation channels, and the inbound+outbound edge expansion. Every count and
// distribution is a PARAMETER here, never a generator constant — changing one bumps the profile
// `version`, so a baseline never silently compares two different shapes.
export interface DirectoryVolume {
  // Person entities (each created through createPerson, with a current name + phonetic codes).
  readonly personCount: number;
  // Organization entities (each created through createOrganization).
  readonly organizationCount: number;
  // Fraction of persons given a name change (changeName) — leaves a former name in the corpus.
  readonly nameChangeFraction: number;
  // Fraction of persons given an alias (addName, role "alias") — a non-current name in the corpus.
  readonly aliasNameFraction: number;
  // Directed edges per entity: each entity gets a draw in [min, max]; the probe entity is given the
  // max both inbound and outbound so the graph-expansion read has its hot case.
  readonly edgesPerEntity: { readonly min: number; readonly max: number };
  // Persons given a blind-indexed SSN identifier through the protected-field chokepoint. The
  // identifier write is the per-value HKDF+HMAC blind-index cost; the read decrypts a page of them.
  readonly identifiersPerEntity: number;
  // Fraction of persons linked to a matter as a party in a role (linkMatterParty).
  readonly matterPartyFraction: number;
  // A deep corporate group: one chain of corporate_successor edges (a rename/merger lineage the
  // conflicts traversal follows transitively at no hop cost) and one wide fan of subsidiaries hanging
  // off the chain's head. Sized past the conflicts closure cap on purpose — a traversal that never
  // meets its own bound never exercises the truncation record, and the truncation record is the part
  // that must never silently report an incomplete search as a complete one.
  readonly corporateGroup: {
    readonly chainLength: number;
    readonly fanWidth: number;
  };
}

// The custom-field volume laid over the practice + directory: firm-defined fields attached to the
// matter types and entity categories the practice/directory generators created, picklist options on
// the picklist fields, and temporal value rows on the busiest matters and entities. This is the
// queryable shadow of the custom-fields surface — the per-record current-value read (the matter/entity
// detail panel), the contact-reference back-reference lookup (which records point at an entity, the
// merge repoint's read), and the convert preview scan (a field's whole current-value set classified for
// a kind change). Every count is a PARAMETER here, never a generator constant — changing one bumps the
// profile `version`, so a baseline never silently compares two different shapes. Sized like an
// established firm's field usage, not a stress run; the per-scope and per-field counts stay well under
// the limits.ts caps so the measured per-record read keeps its realistic ceiling.
// The timekeeping volume laid over the practice book: rate cards with effective-dated rate versions, and
// captured time entries spread across the firm's timekeepers and matters, in a draft/billed mix with a
// UTBMS-coded fraction. This is the queryable shadow of the WIP store + rate engine — the My Day daily
// totals read, the weekly-grid fan, the per-matter unbilled-WIP read (billing query), and rate
// resolution. Every count/distribution is a PARAMETER here, never a generator constant — changing one
// bumps the profile `version`. Sized like an established firm's monthly capture, not a stress run.
export interface TimeVolume {
  // Time entries captured per timekeeper per day over the span (the My Day / weekly-grid fan).
  readonly entriesPerTimekeeperPerDay: number;
  // Named rate cards the firm runs (e.g. Standard, Insurance-capped).
  readonly rateCardCount: number;
  // Effective-dated rate versions appended per card (closed-interval history the resolver walks).
  readonly ratesPerCard: number;
  // Fraction of billable entries carrying UTBMS task + activity codes.
  readonly utbmsCodedFraction: number;
  // Fraction of captured entries already marked billed (the rest stay draft — the unbilled-WIP read's
  // selectivity). 0–1.
  readonly draftBilledMix: number;
  // Days the capture span covers (work_date dispersal via fixed-clock advances).
  readonly spanDays: number;
}

// The costs/expenses volume laid over the practice book: disbursement entries (filing fees, postage,
// court reporters, …) spread across the firm's matters, in a hard/soft class mix and a billable
// fraction, resting at points across the draft→billed lifecycle, with a slice arriving through the
// cost-recovery seam. This is the queryable shadow of the disbursement WIP store — the per-matter
// unbilled-cost read (the billing query), the by-id lifecycle-guard read, the matter e-billing-flag
// read, and the recovery dedup lookup. Every count/distribution is a PARAMETER here, never a generator
// constant — changing one bumps the profile `version`. Sized like an established firm's monthly
// disbursement volume, not a stress run.
export interface CostVolume {
  // Cost entries captured per matter over the span (the per-matter unbilled-WIP fan).
  readonly entriesPerMatter: { readonly min: number; readonly max: number };
  // Fraction of entries classed as a hard cost (third-party disbursement the firm fronts) vs a soft
  // cost (in-house charge). 0–1.
  readonly hardCostFraction: number;
  // Fraction of entries marked billable to the client (the rest are non-billable write-offs). 0–1.
  readonly billableFraction: number;
  // Relative weights for the lifecycle status an entry rests at. The unbilled-WIP read's selectivity
  // comes from the billed/void tail being excluded — most disbursements settle, leaving a live head of
  // draft/submitted/approved the read returns.
  readonly statusWeights: {
    readonly draft: number;
    readonly submitted: number;
    readonly approved: number;
    readonly billed: number;
    readonly void: number;
  };
  // Fraction of entries that arrive through the cost-recovery seam (source 'recovery', carrying a
  // recovery_category + a unique recovery_ref). The rest are captured manually or imported from a grid.
  readonly recoveryFraction: number;
  // Days the incurred-date window covers (incurred_date dispersal via fixed-base arithmetic).
  readonly spanDays: number;
}

export interface CustomFieldVolume {
  // Fields defined on each matter type (attachment_id = the matter type) — the matter detail panel
  // renders this many custom rows for a matter of that type.
  readonly fieldsPerMatterType: number;
  // Fields defined on each entity category (attachment_id = the category) — the same for an entity.
  readonly fieldsPerCategory: number;
  // Picklist options created on each picklist field (the choice list a picklist field offers).
  readonly optionsPerPicklist: number;
  // Current values set on each of the busiest records (one per field in the record's scope) — the
  // per-record read fans over this many rows. The probe record is given the full set so its read is
  // the volume-shaped hot case.
  readonly valuesPerRecord: number;
  // History depth per value on the probe field: each value is re-set this many times, so the field's
  // table carries history rows (is_current = 0) the convert scan must still skip over via the index.
  readonly historyDepth: number;
  // Fraction of the entity records' values that are contact-reference values pointing at another
  // entity — the back-reference corpus the merge repoint and the reference lookup traverse.
  readonly referenceShare: number;
}

// The editing volume laid over the practice's files/versions (slice 2·2): a fraction of superseded
// (non-current) clean versions already tiered to Infrequent Access, a set of offline/exclusive
// checkouts across the firm's files, and a handful of files left with a conflict_pending conflicting
// copy awaiting reconciliation. This is the queryable shadow of the editing background work — the
// firm-wide tiering candidate scan, the idle-checkout sweep scan, the active-exclusive-lock launch gate,
// and the reconcile lookup. The two SWEEP scans are firm-wide (every version / every checkout), so they
// are the volume-shaped operations that must walk an index, not the table. Every count/fraction is a
// PARAMETER (changing one bumps the profile `version`). Sized like an established firm's editing
// activity, not a stress run.
export interface EditingVolume {
  // Fraction of superseded (non-current) clean versions already moved to Infrequent Access — the
  // standard/IA mix the tiering candidate scan reads against (its candidates are the standard remainder).
  readonly tieredVersionFraction: number;
  // Offline/exclusive checkouts laid across the firm's files — the firm-wide set the idle-checkout
  // sweep scans. A fraction are left idle (active with an old last_activity) so the sweep's stage-1 scan
  // is selective and volume-shaped.
  readonly checkoutCount: number;
  // Fraction of those checkouts that are exclusive locks (the rest are offline working copies) — gives
  // the active-exclusive-lock launch gate a populated lookup.
  readonly exclusiveCheckoutFraction: number;
  // Fraction of the checkouts left idle (active, last_activity older than any plausible window) — the
  // stage-1 candidates the idle sweep's firm-wide scan must find selectively.
  readonly idleCheckoutFraction: number;
  // Files left with a conflict_pending conflicting copy awaiting human reconciliation (the document
  // flag the reconcile lookup finds). Created through the real check-in divergence path.
  readonly conflictCount: number;
}

// The document-automation volume laid over the practice + custom-field books: the firm's template
// catalogue with its immutable version history, the confirmed Word-name-to-merge-key mapping library,
// the assembly provenance rows the filed documents left behind, and — on one probe matter — the
// merge-context hot case (its own matter-axis custom fields with current values, and a full set of
// party links). This is the queryable shadow of the automation surface: the catalogue list at the top
// of the range, the one-read current-version resolve every job starts with, the whole batched merge
// context, and the per-firm custom-field manifest read the dictionary is derived from.
//
// The corpus that actually grows here is the OUTPUT, and it grows as ordinary matter documents that
// the practice volume already models — so the counts below are sized like an established firm's
// template set and a year or two of generated documents, not as a stress run. Every count is a
// PARAMETER, never a generator constant — changing one bumps the profile `version`.
export interface DocumentAutomationVolume {
  // Templates in the firm's catalogue. A template set is small and slow-moving; a few hundred is the
  // top of the plausible range, and the catalogue list is measured against it.
  readonly templateCount: number;
  // Fraction of those templates archived. The catalogue list filters on `status`, so the archived tail
  // is what makes that filter selective rather than decorative.
  readonly archivedTemplateFraction: number;
  // Immutable versions registered per template. Only the last becomes current; the earlier ones stay
  // readable because an assembly records the exact version it used.
  readonly versionsPerTemplate: { readonly min: number; readonly max: number };
  // Platform merge keys an ordinary template version's manifest declares. Bounded above by the shipped
  // dictionary — a manifest field is keyed by its merge key, so a template cannot declare more distinct
  // platform fields than the platform has.
  readonly fieldsPerTemplate: { readonly min: number; readonly max: number };
  // Placeholder occurrences per declared field (the manifest's `totalOccurrences` denominator) — the
  // same key printed in the body, a header, and a signature block is one field and three occurrences.
  readonly occurrencesPerField: { readonly min: number; readonly max: number };
  // Matter-axis custom fields defined for the probe matter's matter type, each carrying a current value
  // on that matter. These are the `custom.<handle>` bindings the probe template declares, and they are
  // what the merge context resolves in ONE batched read however many there are — so this count is the
  // width of that statement's bound-parameter list, which is the number the batching rule is about.
  readonly customFieldBindings: number;
  // Party links on the probe matter: the matter's whole party collection, read once for a repeat.
  readonly partyLinksOnProbeMatter: number;
  // Staffing assignments on the probe matter beyond the responsible attorney (who lives on the
  // matter row): the rows the ONE staffing read joins to members, profiles, and mapped Directory
  // persons. The probe matter also carries its court-case and estate records — one of each by
  // construction, so they are structural rather than parameters.
  readonly staffingAssignmentsOnProbeMatter: number;
  // Assemblies (filed-document provenance rows) recorded per matter over the span.
  readonly assembliesPerMatter: { readonly min: number; readonly max: number };
  // Confirmed Word-name-to-merge-key entries in the firm's mapping library — read WHOLE, once per
  // registration, which is why its size is a parameter rather than an accident.
  readonly fieldMappingCount: number;
  // Stored template package size, drawn per version (the modeled R2 object size the version row
  // records; node:sqlite has no R2, so the recorded size stands in for the bytes).
  readonly templateSizeBytes: { readonly min: number; readonly max: number };
  // FILLABLE-PDF FORM TEMPLATES in the catalogue, alongside the word-processing ones. A firm's court
  // and agency forms are a smaller set than its letters and pleadings, and they change when a court
  // reissues one rather than when a paralegal edits one — so they are a minority of the catalogue and
  // a single version each. They are in the profile because the catalogue list, the current-version
  // resolve, and the binding index all page over both kinds now.
  readonly formTemplateCount: number;
  // Boxes on a form. A one-page intake form has a dozen; a family-law financial disclosure has a few
  // hundred, which is the top of the range and the case that makes reading the whole field set at
  // registration worth doing once rather than per assembly.
  readonly boxesPerFormTemplate: { readonly min: number; readonly max: number };
  // Fraction of a form's boxes left UNBOUND — no confirmed mapping, so every document assembled from
  // the template leaves them for a person. This is the realistic case rather than an edge one: a firm
  // confirms the boxes it fills every time and leaves the rest, and the unbound list is what the
  // registration surface, the field list, and every assembly report.
  readonly unboundBoxFraction: number;
}

// The trust volume laid over the practice book: one real trust account with its sub-ledger tree, a
// client ledger per matter that holds client money, the movements that put it there and take it out,
// disputed-funds holds on a slice of them, and the bank statements and reconciliations that prove
// the three sides agree. This is the queryable shadow of the trust surface — the client-ledger read,
// the available-balance read, the as-of book and client totals the three-way proof computes, the
// outstanding-item read the matcher works from, and the table-wide fitness sweep. Every count is a
// PARAMETER here, never a generator constant — changing one bumps the profile `version`. Sized like
// an established firm's trust book over a couple of years, not a stress run.
export interface TrustVolume {
  // Matters given a client trust ledger. Well below the practice volume's matter count: most matters
  // never hold client money, which is the whole reason the leaf is created lazily.
  readonly matterLedgerCount: number;
  // Movements appended to each ledger beyond its opening deposit — the depth the client-ledger read
  // fans over.
  readonly extraMovementsPerBusyLedger: number;
  // The opening deposit drawn per ledger, and the disbursements taken back out of it.
  readonly depositMinor: { readonly min: number; readonly max: number };
  readonly disbursementMinor: { readonly min: number; readonly max: number };
  // Fraction of ledgers carrying an active disputed-funds hold — what makes available balance differ
  // from stored balance often enough for the difference to be measured rather than assumed.
  readonly heldLedgerFraction: number;
  // Bank statements recorded, each covering an equal slice of the span. All but the most recent are
  // reconciled and CLOSED (their proofs frozen); the last stays open, so the live three-way
  // computation has a period whose proof is recomputed on every read.
  readonly statementCount: number;
  // A service charge the firm never records, added to every statement. It is what leaves one line
  // unmatched in every period — the item the no-negative floor cannot see, and the reason the proof
  // has to be able to report an honest red at volume rather than only in a unit test.
  readonly serviceChargeMinor: number;
  // Days the movement and statement window covers.
  readonly spanDays: number;
}

export interface InvoiceVolume {
  // Matters that have been billed at least once. Below the practice matter count: a matter opened
  // this month has nothing to bill yet, which is what makes the unbilled read worth measuring.
  readonly billedMatterCount: number;
  // Finalized invoices per billed matter — the depth the client and matter reads fan over.
  readonly invoicesPerBilledMatter: number;
  // Time entries claimed onto each invoice. This is the number the finalize batch's statement count
  // scales with (two writes per claimed entry plus one per line), so it is what the batch-ceiling
  // measurement varies.
  readonly claimsPerInvoice: number;
  // One draft left open per this many billed matters, so the drafts a firm is working on are in the
  // list read alongside the finalized ones and the claim table has active rows.
  readonly openDraftEveryNthMatter: number;
  // Days the issue and due dates spread over. Long enough that the aging buckets are all populated.
  //
  // There is deliberately no settled/paid fraction: nothing can apply value to an invoice until the
  // application path lands, so every finalized invoice here is outstanding. That is the honest shape
  // of the data at this point, and it makes the aging read fan over everything rather than a slice.
  readonly spanDays: number;
}

// The custody volume laid over the practice + directory books: the physical container tree, the
// packets the firm holds and the items described inside them, the owner links into the Directory, the
// append-only movement ledger, holds, and review dates.
//
// This corpus is SMALL, DEEP, AND OLD — the opposite shape of every other volume here. A firm holds
// low thousands of packets with a handful of items each, but it holds them for DECADES, so the
// movement ledger is the only table that grows without bound and the register is routinely read
// across twenty years of history. The counts below say that: the packet count is modest and the
// history span is what carries the volume. Every count is a PARAMETER, never a generator constant —
// changing one bumps the profile `version`, so a baseline never silently compares two shapes.
export interface CustodianVolume {
  // Container roots that bind a firm office (one per office the practice generator opened), plus the
  // offsite/bank roots that bind none — a vault is not an office row, and the two kinds of root are
  // separate parameters because only the first is capped by the firm's office count.
  readonly officeRootCount: number;
  readonly offsiteRootCount: number;
  // The default shape a firm's tree takes below a root: safes, then boxes, then positions. Four
  // levels including the root, well inside the write path's depth cap of eight — the cap is a
  // refusal, not a target, and a tree at the cap is not what a firm builds.
  readonly safesPerRoot: number;
  readonly boxesPerSafe: number;
  readonly positionsPerBox: number;
  // Packets in the register.
  readonly packetCount: number;
  // Items described inside each packet.
  readonly itemsPerPacket: { readonly min: number; readonly max: number };
  // How far back the oldest deposits go. This is the parameter that carries the subsystem's actual
  // risk: a packet's history depth is its AGE times the movement rate, so lengthening the span
  // deepens the ledger without adding a single packet.
  readonly historySpanYears: number;
  // Movements appended per packet per year of its age, beyond the opening `logged` entry.
  readonly movementsPerPacketPerYear: { readonly min: number; readonly max: number };
  // The tail of the history distribution: one probe packet given this many movements outright, so the
  // keyset-paginated history read is measured at the depth a real long-held packet reaches rather
  // than at the average.
  readonly deepHistoryMovementCount: number;
  // Fraction of packets left checked out at the end of generation (the register's `out` population),
  // and the fraction of THOSE whose due-back date is already past — the overdue sweep's selectivity.
  // A sweep that found either everything or nothing would measure nothing.
  readonly checkedOutPacketFraction: number;
  readonly overdueCheckoutFraction: number;
  // Fraction of packets carrying a hold in force (the destruction and release blocker read).
  readonly heldPacketFraction: number;
  // Fraction of packets carrying a firm-set review date. Nothing derives one and nothing expires when
  // one passes; the only consequence is that the packet appears on a list, which is the read measured.
  readonly reviewScheduledFraction: number;
}

// The calendar volume laid over everything else: the two recorded tables (matter events with their
// participants, and deadlines), the firm's own scope (firm events, resources, bookings), and one
// continued hearing.
//
// What makes this subsystem's read shape unusual is that most of its corpus is NOT its own. A matter
// timeline unions the recorded rows with a dozen federated sources that other generators already laid
// down — time entries, costs, filed documents, assemblies, conflicts checks, custody movements, trust
// movements, the matter's own lifecycle — so the counts below add the calendar's OWN rows and lean on
// the rest of the profile for the depth. That is also why the deep probe matter matters: the design
// asks for one matter deliberately deep in every federated source at once, and the only way to get it
// is to point the calendar's own volume at the matter the other generators already made busiest.
export interface CalendarVolume {
  // Litigation events recorded per matter, drawn per matter across the firm's caseload. Most matters
  // stay shallow; the probe matter below is the tail.
  readonly eventsPerMatter: { readonly min: number; readonly max: number };
  // Events recorded on the probe matter — the deep timeline the page-1-versus-page-20 comparison
  // walks, on top of everything the other generators put on that same matter.
  readonly probeMatterEventCount: number;
  // Participants attached per event. The member filter resolves through this table, so its width is
  // what the participant EXISTS predicate costs.
  readonly participantsPerEvent: { readonly min: number; readonly max: number };
  // Fraction of events on which the firm's own member is one of those participants; the rest are
  // external names. This is a PARAMETER rather than "always", because it is the multiplier the
  // member-filtered read's correlated participant lookup pays per candidate row — a member on every
  // event in the corpus would make that read look worse than any firm's would, and a member on none
  // of them would make it look better. Half is a partner's plausible share of a small firm's diary.
  readonly probeMemberParticipationFraction: number;
  // Deadlines left open across the firm, and the fraction of them already past their due date.
  // Overdue is a comparison made at read time and never a stored fact, so the fraction exists to make
  // that comparison return a mix rather than all-or-nothing.
  readonly openDeadlineCount: number;
  readonly overdueDeadlineFraction: number;
  // Deadlines already discharged (satisfied or vacated), so the state filter is selective.
  readonly closedDeadlineCount: number;
  // Days the event and deadline dates spread over. A decade, with the dense window at the recent end
  // where a real firm's calendar activity is.
  readonly spanDays: number;
  // Fraction of events that land in the DENSE RECENT WINDOW — the most recent quarter of the span,
  // extended six months into the future for settings already given. The rest trail back over the
  // whole span, which is what makes a page-20 read walk genuinely old rows.
  readonly recentWindowFraction: number;
  // The firm's own scope: a year of weekly recurring-shaped meetings entered as individual rows
  // (recurrence is not built, and the fixtures mirror what a firm actually types), plus a handful of
  // all-members entries — the holidays and closures that land on everybody's calendar and make the
  // audience switch a real branch in the member-filtered read.
  readonly weeklyFirmEventWeeks: number;
  readonly allMembersFirmEventCount: number;
  // Bookable resources across the firm's offices, and the bookings laid over them.
  readonly resourceCount: number;
  readonly bookingCount: number;
  // Fraction of bookings deliberately overlapping another on the same resource. Double-booking is
  // warn-and-allow, so the availability read has to pre-pair overlaps at volume — with no overlaps
  // the pairing pass would be measured doing nothing.
  readonly overlappingBookingFraction: number;
  // Settings in the one continuance chain: a hearing continued this many times minus one, with
  // deadlines hanging off the intermediate settings. The chain read walks link hops, so its length is
  // the only thing its cost may depend on.
  readonly continuanceChainLength: number;
}

// The task volume laid over the practice book: what the firm still owes on its matters, plus the
// firm's own work on no matter at all. Every count is a PARAMETER here, never a generator constant.
//
// What this volume is really shaping is the THREE-TERM ORDER every task read shares — undated last,
// then by date, then by priority rank, then by identifier — and the ONE visibility fragment every
// read composes, whose nullable-matter branch only exists because some tasks have no matter. A
// corpus where every task were dated, or every task on a matter, would measure neither.
export interface TaskVolume {
  // Tasks recorded per matter across the firm's caseload. Most matters stay shallow; the probe
  // matter below is the tail.
  readonly tasksPerMatter: { readonly min: number; readonly max: number };
  // Tasks on the probe matter — the deep list the page-1-versus-page-20 comparison walks.
  readonly probeMatterTaskCount: number;
  // Tasks on NO matter: the firm's own work, renewing the policy and interviewing candidates. This
  // is the population the visibility fragment's nullable branch exists for, and a corpus without it
  // would measure that branch doing nothing.
  readonly matterlessTaskCount: number;
  // How the corpus splits across the three states. Open is what the default list shows, so the rest
  // is what makes that filter selective rather than a no-op. Cancelled takes the remainder.
  readonly openFraction: number;
  readonly doneFraction: number;
  // Fraction of tasks in somebody's name. The unassigned rest are real — a task nobody has picked up
  // is a state rather than a defect — and they are what the member-filtered read has to skip past.
  readonly assignedFraction: number;
  // Fraction carrying a due date. The order puts the undated LAST, so a corpus that is all dated or
  // all undated would never exercise the branch the sort key turns on.
  readonly datedFraction: number;
  // Of the dated ones, the fraction already past due. Overdue is a comparison made at read time and
  // never a stored fact, so this exists to make that comparison return a mix.
  readonly overdueFraction: number;
  // Fraction waiting on another task. The link renders and sorts and gates nothing, so its cost is
  // the resolution, not a traversal.
  readonly blockedFraction: number;
  // Fraction of tasks that time has been logged against, and the entries per such task. This is what
  // the grouped time read fans over — the read that must stay ONE statement per page of tasks rather
  // than one per task.
  readonly timeLinkedFraction: number;
  readonly timeEntriesPerLinkedTask: { readonly min: number; readonly max: number };
  // Days the due dates spread over, centred on the fixed clock so both halves of the overdue
  // comparison have subjects.
  readonly spanDays: number;
}

export interface LedgerVolumeProfile {
  readonly name: "ledgerVolume";
  // Profile identity: bump on ANY parameter change — baselines measured against different data
  // must never masquerade as comparable.
  readonly version: number;
  readonly trustSubledgerCount: number;
  readonly entryCount: number;
  // Entries spread their effective dates across this span via fixed-clock advances.
  readonly postingSpanDays: number;
  // Fraction of operating-expense entries immediately reversed (trust entries are never reversed —
  // keeps the generator's in-memory trust tracking one-directional and simple).
  readonly reversalRate: number;
  readonly archetypeWeights: ArchetypeWeights;
  // The practice volume laid over the ledger book (matters/locations/file-manager).
  readonly practice: PracticeVolume;
  // The protected-field volume laid over the practice (sealed incident descriptions + firm secrets).
  readonly protected: ProtectedVolume;
  // The directory volume laid over the practice (entities, names, edges, identifiers, matter parties).
  readonly directory: DirectoryVolume;
  // The shipping volume laid over the practice book (shipments/labels/tracking).
  readonly shipping: ShippingVolume;
  // The custom-field volume laid over the practice + directory (fields, options, values, history).
  readonly customFields: CustomFieldVolume;
  // The editing volume laid over the practice's files/versions (tiered versions, checkouts, conflicts).
  readonly editing: EditingVolume;
  // The timekeeping volume laid over the practice book (rate cards, effective-dated rates, time entries).
  readonly time: TimeVolume;
  // The costs volume laid over the practice book (disbursement entries across the lifecycle + recovery).
  readonly costs: CostVolume;
  // The document-automation volume laid over the practice + custom-field books (template catalogue,
  // version history, mapping library, assembly provenance, and the merge-context probe matter).
  readonly documentAutomation: DocumentAutomationVolume;
  // The trust volume laid over the practice book (the sub-ledger tree, movements, holds, bank
  // statements, and reconciliations with their frozen proofs).
  readonly trust: TrustVolume;
  // The invoice volume laid over the practice and timekeeping books (drafts, claims, finalized
  // invoices with their per-matter balances, and the receivables the aging read fans over).
  readonly invoices: InvoiceVolume;
  // The custody volume laid over the practice + directory books (the container tree, packets and
  // items, owner links, the movement ledger with its decades of history, holds, and review dates).
  readonly custodian: CustodianVolume;
  // The calendar volume laid over everything else (matter events and participants, deadlines, the
  // firm's own events, resources and bookings, and one continued hearing).
  readonly calendar: CalendarVolume;
  // The task volume laid over the practice book (what the firm still owes on its matters, its own
  // work on no matter, and the time logged against some of it).
  readonly tasks: TaskVolume;
}

// A plausible established small firm: a few years of posting activity over a 200-client trust book,
// three offices, a working caseload of a few hundred matters, and a document tree of a few thousand
// files with multi-version histories.
export const ledgerVolume: LedgerVolumeProfile = {
  name: "ledgerVolume",
  version: 16,
  trustSubledgerCount: 200,
  entryCount: 25_000,
  postingSpanDays: 1_095,
  reversalRate: 0.02,
  archetypeWeights: {
    trustDeposit: 20,
    trustDisbursement: 12,
    feeBilled: 22,
    paymentReceived: 18,
    operatingExpense: 23,
    settlement: 5,
  },
  practice: {
    locationCount: 3,
    matterTypeCount: 8,
    prospectiveMatterCount: 60,
    openMatterCount: 220,
    closedMatterCount: 120,
    foldersPerMatter: { min: 2, max: 6 },
    filesPerMatter: { min: 3, max: 14 },
    versionsPerFile: { min: 1, max: 4 },
    fileSizeBytes: { min: 20_000, max: 8_000_000 },
    // ~30% of committed versions still await the scan engine — a plausible mid-rollout mix that keeps
    // the re-scan sweep's find-unscanned batch selective against the clean majority.
    unscannedVersionFraction: 0.3,
  },
  protected: {
    // A few years of self-filed diagnostics, and a dozen integration/config secrets.
    incidentCount: 500,
    firmSecretCount: 12,
  },
  directory: {
    // A directory the size of an established small firm's contact book: a few hundred persons across
    // the firm's matters, a hundred organizations, name history on a meaningful slice, a sparse
    // relationship graph, sensitive identifiers on the persons who carry one, and matter-party links
    // joining roughly a third of persons to a matter.
    personCount: 600,
    organizationCount: 100,
    nameChangeFraction: 0.1,
    aliasNameFraction: 0.15,
    edgesPerEntity: { min: 0, max: 3 },
    identifiersPerEntity: 250,
    matterPartyFraction: 0.35,
    // A real holding structure: a lineage a dozen renames deep, and a parent with six hundred
    // subsidiaries — past the 500-entity default closure cap, so the deep-graph measurement below
    // measures a traversal that actually truncates.
    corporateGroup: { chainLength: 12, fanWidth: 600 },
  },
  shipping: {
    shipmentCount: 300,
    purchasedPercent: 70,
    trackingEventsPerShipment: { min: 1, max: 5 },
  },
  customFields: {
    // An established firm's field usage: a handful of fields per matter type and per entity category
    // (well under the 60-per-scope cap), a modest picklist, a full set of current values on the busiest
    // records, a few re-sets of history per value, and a fifth of an entity's values being
    // contact-references into the directory.
    fieldsPerMatterType: 8,
    fieldsPerCategory: 6,
    optionsPerPicklist: 12,
    valuesPerRecord: 14,
    historyDepth: 3,
    referenceShare: 0.2,
  },
  editing: {
    // An established firm's editing background: a quarter of superseded versions already tiered to IA,
    // a few hundred checkouts across the document tree (a fifth exclusive, a fifth gone idle), and a
    // handful of documents currently flagged for reconciliation.
    tieredVersionFraction: 0.25,
    checkoutCount: 200,
    exclusiveCheckoutFraction: 0.2,
    idleCheckoutFraction: 0.2,
    conflictCount: 25,
  },
  time: {
    // An established firm's monthly capture: a handful of entries per timekeeper per day across the
    // span, two named rate cards each with a few effective-dated versions, two-thirds UTBMS-coded, a
    // third already billed, over a quarter's worth of work days.
    entriesPerTimekeeperPerDay: 6,
    rateCardCount: 2,
    ratesPerCard: 4,
    utbmsCodedFraction: 0.66,
    draftBilledMix: 0.33,
    spanDays: 90,
  },
  costs: {
    // An established firm's monthly disbursement volume: a handful of entries per matter across the
    // span, two-thirds hard third-party costs, most billable, a lifecycle weighted toward settled
    // (billed/void) with a live draft/submitted/approved head, and a tenth arriving via cost recovery.
    entriesPerMatter: { min: 1, max: 8 },
    hardCostFraction: 0.66,
    billableFraction: 0.85,
    statusWeights: { draft: 20, submitted: 10, approved: 10, billed: 55, void: 5 },
    recoveryFraction: 0.1,
    spanDays: 90,
  },
  documentAutomation: {
    // An established firm's template set and the documents it has produced: a couple of hundred
    // templates with a slow-moving version history, a sixth of them retired, a mapping library built up
    // from importing a previous system's documents, and a few filed assemblies per matter. The probe
    // matter carries forty of the firm's own fields and a full party list, which is the merge context
    // the batching rule is measured against.
    templateCount: 180,
    archivedTemplateFraction: 0.15,
    versionsPerTemplate: { min: 1, max: 4 },
    fieldsPerTemplate: { min: 6, max: 14 },
    occurrencesPerField: { min: 1, max: 3 },
    customFieldBindings: 40,
    partyLinksOnProbeMatter: 12,
    staffingAssignmentsOnProbeMatter: 3,
    assembliesPerMatter: { min: 0, max: 8 },
    fieldMappingCount: 120,
    templateSizeBytes: { min: 20_000, max: 400_000 },
    formTemplateCount: 24,
    boxesPerFormTemplate: { min: 12, max: 160 },
    unboundBoxFraction: 0.35,
  },
  trust: {
    // An established firm's trust book: a third of the open caseload holding client money, a few
    // movements on each, a fifth of the ledgers carrying a disputed-funds hold, and two years of
    // monthly statements — every one of them with a service charge nobody recorded, so the
    // reconciliation surface is measured against periods that genuinely do not tie out.
    matterLedgerCount: 80,
    extraMovementsPerBusyLedger: 3,
    depositMinor: { min: 100_000, max: 2_000_000 },
    disbursementMinor: { min: 5_000, max: 90_000 },
    heldLedgerFraction: 0.2,
    statementCount: 24,
    serviceChargeMinor: 2_500,
    spanDays: 730,
  },
  invoices: {
    // An established firm's billing book: most of the open caseload has been billed at least once,
    // a handful of bills each over a couple of years, twenty entries claimed onto a typical monthly
    // bill, and one draft in progress for every eight billed matters.
    billedMatterCount: 160,
    invoicesPerBilledMatter: 6,
    claimsPerInvoice: 20,
    openDraftEveryNthMatter: 8,
    spanDays: 730,
  },
  custodian: {
    // An established firm's safe: a root per office plus one offsite vault, a conventional
    // safe/box/position tree under each, two thousand packets of a handful of items, and twenty years
    // of history behind them. The packet count is the design's "low thousands"; the history span is
    // where this subsystem's volume actually lives, since a packet's ledger depth is its age times
    // the movement rate. One packet is given two hundred movements outright — the tail of the
    // distribution, and the depth the paginated history read is measured at.
    officeRootCount: 2,
    offsiteRootCount: 1,
    safesPerRoot: 3,
    boxesPerSafe: 6,
    positionsPerBox: 8,
    packetCount: 2_000,
    itemsPerPacket: { min: 1, max: 5 },
    historySpanYears: 20,
    movementsPerPacketPerYear: { min: 1, max: 2 },
    deepHistoryMovementCount: 200,
    checkedOutPacketFraction: 0.04,
    overdueCheckoutFraction: 0.3,
    heldPacketFraction: 0.05,
    reviewScheduledFraction: 0.35,
  },
  calendar: {
    // A litigation calendar over a decade with the dense window at the recent end: most matters carry
    // a handful of settings, one carries three hundred, several hundred deadlines are open with a
    // realistic overdue slice, and the firm's own scope holds a year of weekly meetings, a handful of
    // all-members closures, eight bookable resources, and a year of bookings with a deliberate
    // overlap fraction. One hearing has been continued four times.
    eventsPerMatter: { min: 0, max: 12 },
    probeMatterEventCount: 300,
    participantsPerEvent: { min: 1, max: 3 },
    probeMemberParticipationFraction: 0.5,
    openDeadlineCount: 400,
    overdueDeadlineFraction: 0.15,
    closedDeadlineCount: 250,
    spanDays: 3_650,
    recentWindowFraction: 0.7,
    weeklyFirmEventWeeks: 52,
    allMembersFirmEventCount: 8,
    resourceCount: 8,
    bookingCount: 400,
    overlappingBookingFraction: 0.15,
    continuanceChainLength: 5,
  },
  tasks: {
    // What a working caseload still owes: most matters carry a handful of open items, one carries
    // four hundred, and the firm's own work — the policy renewal, the candidate interviews, the
    // conflict-check backlog — sits on no matter at all. Two thirds are still open, because the
    // default list shows open and the rest is what makes that filter selective. Half are dated:
    // the order puts the undated last, so a corpus that were all one or all the other would never
    // exercise the branch the sort key turns on. A fifth carry time.
    tasksPerMatter: { min: 0, max: 9 },
    probeMatterTaskCount: 400,
    matterlessTaskCount: 120,
    openFraction: 0.65,
    doneFraction: 0.3,
    assignedFraction: 0.8,
    datedFraction: 0.5,
    overdueFraction: 0.2,
    blockedFraction: 0.15,
    timeLinkedFraction: 0.2,
    timeEntriesPerLinkedTask: { min: 1, max: 6 },
    spanDays: 730,
  },
};

// One profile, every scale: CI smoke (~0.01), local working scale (1), deliberate stress runs
// (>1). Floors keep a tiny multiplier generatable (enough entries/subledgers for every archetype,
// and at least one office, type, and a handful of matters/files so every measured read has data).
export function scaleProfile(
  profile: LedgerVolumeProfile,
  multiplier: number,
): LedgerVolumeProfile {
  const scaleCount = (value: number, floor: number) =>
    Math.max(floor, Math.round(value * multiplier));
  return {
    ...profile,
    entryCount: Math.max(20, Math.round(profile.entryCount * multiplier)),
    trustSubledgerCount: Math.max(3, Math.round(profile.trustSubledgerCount * multiplier)),
    practice: {
      ...profile.practice,
      locationCount: scaleCount(profile.practice.locationCount, 2),
      matterTypeCount: scaleCount(profile.practice.matterTypeCount, 2),
      prospectiveMatterCount: scaleCount(profile.practice.prospectiveMatterCount, 2),
      openMatterCount: scaleCount(profile.practice.openMatterCount, 3),
      closedMatterCount: scaleCount(profile.practice.closedMatterCount, 2),
    },
    protected: {
      // Floors keep a handful of incidents (enough for a multi-row decrypt page) and a couple of
      // secrets at the smoke multiplier.
      incidentCount: scaleCount(profile.protected.incidentCount, 5),
      firmSecretCount: scaleCount(profile.protected.firmSecretCount, 2),
    },
    directory: {
      ...profile.directory,
      // Floors keep enough entities for a probe with edges both ways, a multi-row decrypt page of
      // sensitive identifiers, and at least one matter-party link at the smoke multiplier.
      personCount: scaleCount(profile.directory.personCount, 12),
      organizationCount: scaleCount(profile.directory.organizationCount, 4),
      identifiersPerEntity: scaleCount(profile.directory.identifiersPerEntity, 6),
      corporateGroup: {
        // The chain floor keeps a lineage longer than any hop budget so the transitive corporate walk
        // is still exercised at the smoke multiplier; the fan floor keeps it cheap.
        chainLength: scaleCount(profile.directory.corporateGroup.chainLength, 4),
        fanWidth: scaleCount(profile.directory.corporateGroup.fanWidth, 8),
      },
    },
    shipping: {
      ...profile.shipping,
      shipmentCount: scaleCount(profile.shipping.shipmentCount, 5),
    },
    customFields: {
      ...profile.customFields,
      // Floors keep a couple of fields per scope, a short picklist, a multi-row value set per record
      // (so the per-record read has its fan and the convert scan has values), and at least one history
      // re-set at the smoke multiplier. referenceShare is a fraction (not scaled).
      fieldsPerMatterType: scaleCount(profile.customFields.fieldsPerMatterType, 2),
      fieldsPerCategory: scaleCount(profile.customFields.fieldsPerCategory, 2),
      optionsPerPicklist: scaleCount(profile.customFields.optionsPerPicklist, 2),
      valuesPerRecord: scaleCount(profile.customFields.valuesPerRecord, 3),
      historyDepth: scaleCount(profile.customFields.historyDepth, 1),
    },
    editing: {
      ...profile.editing,
      // Floors keep a handful of checkouts (enough for an idle subset + an exclusive subset) and at
      // least a couple of conflicts at the smoke multiplier. Fractions are not scaled.
      checkoutCount: scaleCount(profile.editing.checkoutCount, 6),
      conflictCount: scaleCount(profile.editing.conflictCount, 2),
    },
    time: {
      ...profile.time,
      // Floors keep a couple of entries per timekeeper-day (so the My Day / grid reads have a fan), at
      // least one rate card with a couple of effective-dated versions (so resolution walks history), and
      // a handful of span days at the smoke multiplier. The fractions are not scaled.
      entriesPerTimekeeperPerDay: scaleCount(profile.time.entriesPerTimekeeperPerDay, 2),
      rateCardCount: scaleCount(profile.time.rateCardCount, 1),
      ratesPerCard: scaleCount(profile.time.ratesPerCard, 2),
      spanDays: scaleCount(profile.time.spanDays, 5),
    },
    costs: {
      ...profile.costs,
      // Floors keep a couple of entries per matter (so the per-matter unbilled read has a fan) and a
      // handful of span days at the smoke multiplier. The fractions and status weights are not scaled.
      entriesPerMatter: {
        min: Math.max(1, Math.round(profile.costs.entriesPerMatter.min * multiplier)),
        max: Math.max(2, Math.round(profile.costs.entriesPerMatter.max * multiplier)),
      },
      spanDays: scaleCount(profile.costs.spanDays, 5),
    },
    documentAutomation: {
      ...profile.documentAutomation,
      // Floors keep a catalogue big enough for a list page with an archived tail to skip, a couple of
      // versions (so one is superseded and one is current), a handful of the firm's own fields and
      // party links on the probe matter (so the batched merge reads have a real fan), and a few mapping
      // library rows at the smoke multiplier. The fractions and the size range are not scaled.
      templateCount: scaleCount(profile.documentAutomation.templateCount, 6),
      formTemplateCount: scaleCount(profile.documentAutomation.formTemplateCount, 2),
      customFieldBindings: scaleCount(profile.documentAutomation.customFieldBindings, 4),
      partyLinksOnProbeMatter: scaleCount(profile.documentAutomation.partyLinksOnProbeMatter, 3),
      fieldMappingCount: scaleCount(profile.documentAutomation.fieldMappingCount, 4),
      versionsPerTemplate: {
        min: Math.max(
          1,
          Math.round(profile.documentAutomation.versionsPerTemplate.min * multiplier),
        ),
        max: Math.max(
          2,
          Math.round(profile.documentAutomation.versionsPerTemplate.max * multiplier),
        ),
      },
      assembliesPerMatter: {
        min: Math.max(
          0,
          Math.round(profile.documentAutomation.assembliesPerMatter.min * multiplier),
        ),
        max: Math.max(
          2,
          Math.round(profile.documentAutomation.assembliesPerMatter.max * multiplier),
        ),
      },
    },
    trust: {
      ...profile.trust,
      // Floors keep a handful of client ledgers (enough for a busiest one and a held slice), at
      // least one extra movement per ledger, two statements (so one closes frozen and one stays
      // open), and a span long enough for the periods not to collapse onto one day at the smoke
      // multiplier. The fractions and the amount ranges are not scaled.
      matterLedgerCount: scaleCount(profile.trust.matterLedgerCount, 6),
      extraMovementsPerBusyLedger: scaleCount(profile.trust.extraMovementsPerBusyLedger, 1),
      statementCount: scaleCount(profile.trust.statementCount, 2),
      spanDays: scaleCount(profile.trust.spanDays, 20),
    },
    invoices: {
      ...profile.invoices,
      // Floors keep a handful of billed matters (so the client and aging reads have a fan), a couple
      // of invoices on each (so one settles and one stays outstanding), enough claims per invoice for
      // the finalize batch to be a batch rather than a single write, and a span long enough for the
      // aging buckets not to collapse onto one day. The fractions are not scaled.
      billedMatterCount: scaleCount(profile.invoices.billedMatterCount, 6),
      invoicesPerBilledMatter: scaleCount(profile.invoices.invoicesPerBilledMatter, 2),
      claimsPerInvoice: scaleCount(profile.invoices.claimsPerInvoice, 3),
      spanDays: scaleCount(profile.invoices.spanDays, 20),
    },
    custodian: {
      ...profile.custodian,
      // Floors keep a tree with every level populated (so the subtree walk has something to descend
      // through and the occupancy read has shelves), a handful of packets with items and owners, and
      // a history span long enough for the age-derived movement counts not to collapse to zero at the
      // smoke multiplier. The fractions are not scaled — a fraction of a smaller population is still
      // that fraction, which is what keeps the overdue and hold slices selective at every scale.
      officeRootCount: scaleCount(profile.custodian.officeRootCount, 1),
      offsiteRootCount: scaleCount(profile.custodian.offsiteRootCount, 1),
      safesPerRoot: scaleCount(profile.custodian.safesPerRoot, 1),
      boxesPerSafe: scaleCount(profile.custodian.boxesPerSafe, 2),
      positionsPerBox: scaleCount(profile.custodian.positionsPerBox, 2),
      packetCount: scaleCount(profile.custodian.packetCount, 12),
      historySpanYears: scaleCount(profile.custodian.historySpanYears, 2),
      deepHistoryMovementCount: scaleCount(profile.custodian.deepHistoryMovementCount, 8),
      itemsPerPacket: {
        min: Math.max(1, Math.round(profile.custodian.itemsPerPacket.min * multiplier)),
        max: Math.max(2, Math.round(profile.custodian.itemsPerPacket.max * multiplier)),
      },
      movementsPerPacketPerYear: {
        min: Math.max(1, Math.round(profile.custodian.movementsPerPacketPerYear.min * multiplier)),
        max: Math.max(1, Math.round(profile.custodian.movementsPerPacketPerYear.max * multiplier)),
      },
    },
    calendar: {
      ...profile.calendar,
      // Floors keep a probe matter deep enough for a second page to exist, deadlines in both states,
      // a firm scope with weekly rows and an all-members row, and enough resources and bookings for
      // an overlap to be pairable at the smoke multiplier. The fractions are not scaled.
      probeMatterEventCount: scaleCount(profile.calendar.probeMatterEventCount, 60),
      openDeadlineCount: scaleCount(profile.calendar.openDeadlineCount, 8),
      closedDeadlineCount: scaleCount(profile.calendar.closedDeadlineCount, 4),
      spanDays: scaleCount(profile.calendar.spanDays, 90),
      weeklyFirmEventWeeks: scaleCount(profile.calendar.weeklyFirmEventWeeks, 4),
      allMembersFirmEventCount: scaleCount(profile.calendar.allMembersFirmEventCount, 2),
      resourceCount: scaleCount(profile.calendar.resourceCount, 2),
      bookingCount: scaleCount(profile.calendar.bookingCount, 8),
      eventsPerMatter: {
        min: Math.max(0, Math.round(profile.calendar.eventsPerMatter.min * multiplier)),
        max: Math.max(2, Math.round(profile.calendar.eventsPerMatter.max * multiplier)),
      },
      participantsPerEvent: {
        min: Math.max(1, Math.round(profile.calendar.participantsPerEvent.min * multiplier)),
        max: Math.max(1, Math.round(profile.calendar.participantsPerEvent.max * multiplier)),
      },
      // The chain is the one count that is NOT scaled: its whole purpose is that the chain read's
      // cost is bounded by chain length rather than by the firm's event count, and a chain scaled to
      // two nodes at the smoke multiplier would prove that vacuously.
      continuanceChainLength: profile.calendar.continuanceChainLength,
    },
    tasks: {
      ...profile.tasks,
      // Floors keep a probe matter deep enough for a second page to exist, a handful of matterless
      // tasks so the visibility fragment's nullable branch has a population at the smoke multiplier,
      // and a span wide enough for the overdue comparison to find rows on both sides. The fractions
      // are not scaled — they are shape, not size.
      probeMatterTaskCount: scaleCount(profile.tasks.probeMatterTaskCount, 60),
      matterlessTaskCount: scaleCount(profile.tasks.matterlessTaskCount, 6),
      spanDays: scaleCount(profile.tasks.spanDays, 60),
      tasksPerMatter: {
        min: Math.max(0, Math.round(profile.tasks.tasksPerMatter.min * multiplier)),
        max: Math.max(2, Math.round(profile.tasks.tasksPerMatter.max * multiplier)),
      },
      timeEntriesPerLinkedTask: {
        min: Math.max(1, Math.round(profile.tasks.timeEntriesPerLinkedTask.min * multiplier)),
        max: Math.max(1, Math.round(profile.tasks.timeEntriesPerLinkedTask.max * multiplier)),
      },
    },
  };
}
