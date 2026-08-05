// Bump when GENERATION LOGIC changes in a way that alters produced rows for the same profile +
// seed (new archetype, changed faker call order, …) — it participates in snapshot identity, so a
// stale cached artifact can never be measured against silently. Profile parameter changes bump
// the profile's own `version` instead.
export const GENERATOR_VERSION = 7;

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
  // Assemblies (filed-document provenance rows) recorded per matter over the span.
  readonly assembliesPerMatter: { readonly min: number; readonly max: number };
  // Confirmed Word-name-to-merge-key entries in the firm's mapping library — read WHOLE, once per
  // registration, which is why its size is a parameter rather than an accident.
  readonly fieldMappingCount: number;
  // Stored template package size, drawn per version (the modeled R2 object size the version row
  // records; node:sqlite has no R2, so the recorded size stands in for the bytes).
  readonly templateSizeBytes: { readonly min: number; readonly max: number };
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
}

// A plausible established small firm: a few years of posting activity over a 200-client trust book,
// three offices, a working caseload of a few hundred matters, and a document tree of a few thousand
// files with multi-version histories.
export const ledgerVolume: LedgerVolumeProfile = {
  name: "ledgerVolume",
  version: 10,
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
    assembliesPerMatter: { min: 0, max: 8 },
    fieldMappingCount: 120,
    templateSizeBytes: { min: 20_000, max: 400_000 },
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
  };
}
