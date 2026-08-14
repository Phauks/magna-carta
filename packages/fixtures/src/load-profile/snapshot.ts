import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup } from "node:sqlite";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { LocationId, MatterId } from "@magna-carta/identifiers/types";
import {
  loadMigrationsFromDisk,
  openNodeDatabaseFile,
  type MigratedNodeDatabase,
} from "@magna-carta/database/node-sqlite";
import { fixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import { createLocalPerFirmDatabase } from "../local-database.ts";
import { generateLedgerVolume, type VolumeProbes } from "./generate.ts";
import { generatePracticeVolume, type PracticeProbes } from "./matters-generate.ts";
import { generateProtectedVolume, type ProtectedProbes } from "./protected-generate.ts";
import { generateDirectoryVolume, type DirectoryProbes } from "./directory-generate.ts";
import { generateShippingVolume, type ShippingProbes } from "./shipping-generate.ts";
import { generateCustomFieldVolume, type CustomFieldProbes } from "./custom-field-generate.ts";
import { generateEditingVolume, type EditingProbes } from "./editing-generate.ts";
import { generateTimeVolume, type TimeProbes } from "./timekeeping-generate.ts";
import {
  generateDocumentAutomationVolume,
  type DocumentAutomationProbes,
} from "./document-automation-generate.ts";
import { generateTrustVolume, type TrustProbes } from "./trust-generate.ts";
import { generateCustodianVolume, type CustodianProbes } from "./custodian-generate.ts";
import { generateCalendarVolume, type CalendarProbes } from "./calendar-generate.ts";
import { GENERATOR_VERSION, type LedgerVolumeProfile } from "./profile.ts";

// Snapshot identity: the resolved profile parameters, the generation seed, the per-firm schema
// state (migration journal tags), and the generator version. Any mismatch is a different
// artifact — stale snapshots structurally cannot be replayed.
export interface SnapshotManifest {
  readonly profile: LedgerVolumeProfile;
  readonly seed: string;
  readonly schemaTags: readonly string[];
  readonly generatorVersion: number;
  readonly entryCount: number;
  readonly probes: VolumeProbes;
  // The practice volume laid over the ledger book: total counts + the probe identifiers the
  // matters/locations/file-manager measurement layer binds its volume-shaped reads to.
  readonly matterCount: number;
  readonly fileCount: number;
  readonly fileVersionCount: number;
  readonly folderCount: number;
  readonly practiceProbes: PracticeProbes;
  // The protected-field volume laid over the practice (sealed incident descriptions + firm secrets)
  // and the probe identifiers the protected measurement layer binds its decrypt/blind-index ops to.
  readonly incidentCount: number;
  readonly firmSecretCount: number;
  readonly protectedProbes: ProtectedProbes;
  // The directory volume laid over the practice (persons/organizations, names, edges, blind-indexed
  // identifiers, matter parties) and the probe identifiers the directory measurement layer binds its
  // blind-index lookup / protected-list decrypt / candidate-generation / graph-expansion ops to.
  readonly directoryPersonCount: number;
  readonly directoryOrganizationCount: number;
  readonly directoryProbes: DirectoryProbes;
  // The shipping volume laid over the practice book: total counts + the probe identifiers the
  // shipping measurement layer binds its volume-shaped reads to.
  readonly shipmentCount: number;
  readonly purchasedShipmentCount: number;
  readonly trackingEventCount: number;
  readonly shippingProbes: ShippingProbes;
  // The custom-field volume laid over the practice + directory (fields on matter types + entity
  // categories, picklist options, temporal values) and the probe identifiers the custom-field
  // measurement layer binds its per-record read / reference lookup / convert scan / merge repoint to.
  readonly customFieldDefinitionCount: number;
  readonly picklistOptionCount: number;
  readonly customFieldValueCount: number;
  readonly customFieldProbes: CustomFieldProbes;
  // The editing volume laid over the practice's files/versions (slice 2·2): tiered versions, checkouts,
  // and conflict_pending copies, plus the probe identifiers the editing measurement layer binds its
  // firm-wide sweep scans + reconcile/lock lookups + version-cut write to.
  readonly tieredVersionCount: number;
  readonly editingCheckoutCount: number;
  readonly editingConflictCount: number;
  readonly editingProbes: EditingProbes;
  // The timekeeping volume laid over the practice book (rate cards, effective-dated rates, time entries)
  // and the probe identifiers the timekeeping measurement layer binds its My Day / grid / unbilled-WIP /
  // rate-resolution reads to.
  readonly timeEntryCount: number;
  readonly rateCount: number;
  readonly rateCardCount: number;
  readonly timeProbes: TimeProbes;
  // The document-automation volume laid over the practice + custom-field books (slice 2·6): the template
  // catalogue with its version history, the assembly provenance rows, and the mapping library — plus the
  // probe identifiers the automation measurement layer binds its catalogue list / current-version
  // resolve / batched merge context / custom-field manifest read to.
  readonly documentTemplateCount: number;
  readonly archivedDocumentTemplateCount: number;
  readonly documentTemplateVersionCount: number;
  readonly documentAssemblyCount: number;
  readonly documentFieldMappingCount: number;
  readonly documentAutomationProbes: DocumentAutomationProbes;
  // The trust volume laid over the practice book: the sub-ledger tree, its movements and holds, the
  // bank statements, and the reconciliations — plus the probe identifiers the trust measurement
  // layer binds its three-way proof / matching / client-ledger / fitness operations to.
  readonly trustLedgerNodeCount: number;
  readonly trustMovementCount: number;
  readonly trustHoldCount: number;
  readonly trustBankStatementCount: number;
  readonly trustBankStatementLineCount: number;
  readonly trustReconciliationCount: number;
  readonly trustReconciliationMatchCount: number;
  readonly trustProbes: TrustProbes;
  // The period end the open reconciliation's statement covers. Recorded here rather than re-derived
  // in the measurement layer, so the EXPLAIN probes bind to exactly the date the proof used.
  readonly trustAsOfDate: string;
  // The custody volume laid over the practice + directory books: the container tree, the packets and
  // the items inside them, the append-only movement ledger with its decades of history, holds, and
  // review dates — plus the probe identifiers the custody measurement layer binds its register list /
  // subtree walk / packet detail / overdue sweep / paginated history / number draw to.
  readonly custodyLocationCount: number;
  readonly custodyPacketCount: number;
  readonly custodyItemCount: number;
  readonly custodyMovementCount: number;
  readonly custodyHoldCount: number;
  readonly custodianProbes: CustodianProbes;
  // The calendar volume laid over everything else: the recorded events and deadlines, the firm's own
  // events, the bookable resources and their bookings, and one continued hearing — plus the probe
  // identifiers the calendar measurement layer binds its federated timeline / firm-window / member
  // filter / availability / overlap / chain reads to.
  readonly matterEventCount: number;
  readonly matterEventParticipantCount: number;
  readonly matterDeadlineCount: number;
  readonly firmEventCount: number;
  readonly firmResourceCount: number;
  readonly firmResourceBookingCount: number;
  readonly calendarProbes: CalendarProbes;
}

export interface LoadedSnapshot extends MigratedNodeDatabase {
  readonly cacheKey: string;
  readonly manifest: SnapshotManifest;
  readonly workingPath: string; // the isolated copy measurements run against
  close(): void; // idempotent — safe under collector-style test cleanup
}

export interface SnapshotOptions extends SeedingOptions {
  readonly cacheDirectory?: string;
  readonly onGenerate?: () => void; // testability: observe cache misses
}

// Default cache: node_modules/.cache — gitignored by construction, no .gitignore edit to forget
// (cache, don't commit).
const DEFAULT_CACHE_DIRECTORY = join(
  import.meta.dirname,
  "..",
  "..",
  "node_modules",
  ".cache",
  "load-profile",
);

// The rows the custody volume hangs off, read back deterministically (ORDER BY id) from what the
// earlier generators wrote. Read rather than threaded through as return values because these are
// whole populations rather than probes: a generator's result carries the handful of identifiers its
// own measurements need, and widening it into an inventory of everything it created would make every
// generator's signature grow whenever a later one wanted something.
async function readCustodyAttachPoints(database: SqlDatabase): Promise<{
  firmLocationIds: LocationId[];
  ownerEntityIds: string[];
  matterIds: MatterId[];
}> {
  const [offices, persons, organizations, matters] = await Promise.all([
    database.prepare("SELECT id FROM location ORDER BY id").all<{ id: string }>(),
    database.prepare("SELECT id FROM directory_person ORDER BY id").all<{ id: string }>(),
    database.prepare("SELECT id FROM directory_organization ORDER BY id").all<{ id: string }>(),
    database
      .prepare("SELECT id FROM matter WHERE system_key IS NULL ORDER BY id")
      .all<{ id: string }>(),
  ]);
  return {
    firmLocationIds: offices.results.map((row) => row.id as LocationId),
    // Both entity kinds own property: a will belongs to a person and a share register to a company.
    ownerEntityIds: [
      ...persons.results.map((row) => row.id),
      ...organizations.results.map((row) => row.id),
    ],
    matterIds: matters.results.map((row) => row.id as MatterId),
  };
}

// The firm's own matters, excluding the platform-owned holding matters. It is the SAME set the
// calendar's visible-matter predicate resolves, so a matter this generator writes an event onto is a
// matter the timeline can read it back from — a holding matter's event would be written and then be
// permanently invisible, which is a fixture that quietly measures less than it appears to.
async function readVisibleMatterIds(database: SqlDatabase): Promise<MatterId[]> {
  const { results } = await database
    .prepare("SELECT id FROM matter WHERE system_key IS NULL ORDER BY id")
    .all<{ id: string }>();
  return results.map((row) => row.id as MatterId);
}

export function snapshotCacheKey(profile: LedgerVolumeProfile, seed: string): string {
  return snapshotCacheKeyFromTags(profile, seed, loadCurrentSchemaTags());
}

function loadCurrentSchemaTags(): readonly string[] {
  return loadMigrationsFromDisk("per-firm").map((migration) => migration.tag);
}

function snapshotCacheKeyFromTags(
  profile: LedgerVolumeProfile,
  seed: string,
  schemaTags: readonly string[],
): string {
  const identity = canonicalJsonStringify({
    generatorVersion: GENERATOR_VERSION,
    profile,
    schemaTags,
    seed,
  });
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

// Generate-or-replay: cache miss generates through the real write paths and persists artifact +
// manifest; cache hit copies the artifact to an isolated working file — measurement writes never
// touch the cache.
export async function loadProfileSnapshot(
  profile: LedgerVolumeProfile,
  seed: string,
  options: SnapshotOptions,
): Promise<LoadedSnapshot> {
  assertSeedingAllowed(options);
  const cacheDirectory = options.cacheDirectory ?? DEFAULT_CACHE_DIRECTORY;
  mkdirSync(cacheDirectory, { recursive: true });
  // One schema-tag read feeds both the cache key and the manifest — the two can never disagree.
  const schemaTags = loadCurrentSchemaTags();
  const cacheKey = snapshotCacheKeyFromTags(profile, seed, schemaTags);
  const artifactPath = join(cacheDirectory, `${cacheKey}.sqlite`);
  const manifestPath = join(cacheDirectory, `${cacheKey}.json`);

  if (!existsSync(artifactPath) || !existsSync(manifestPath)) {
    options.onGenerate?.();
    const generated = createLocalPerFirmDatabase();
    try {
      // One FixtureContext threads both generators: the ledger book first, then the practice volume
      // on top (matters carry the ledger's clients implicitly — the two share the same seed stream).
      const context = fixtureContext(seed);
      const result = await generateLedgerVolume(generated.database, context, profile, options);
      const practice = await generatePracticeVolume(
        generated.database,
        context,
        profile.practice,
        options,
      );
      // The protected volume rides next — its sealed incidents reuse a mirrored member as reporter.
      const protectedVolume = await generateProtectedVolume(
        generated.database,
        context,
        profile.protected,
        practice.probes.responsibleMemberId,
        options,
      );
      // The directory volume rides next — its matter-party links join entities to the matters the
      // practice volume already laid down, so it must run after practice generation.
      const directoryVolume = await generateDirectoryVolume(
        generated.database,
        context,
        profile.directory,
        options,
      );
      // The shipping volume rides next on the same FixtureContext, linking its shipments to the
      // matters the practice generation laid down.
      const shipping = await generateShippingVolume(
        generated.database,
        context,
        profile.shipping,
        options,
      );
      // The custom-field volume rides last — it attaches fields to the matter types the practice
      // generator made and sets reference values pointing at the directory generator's entities, so it
      // must run after both.
      const customFields = await generateCustomFieldVolume(
        generated.database,
        context,
        profile.customFields,
        options,
      );
      // The editing volume rides last — it tiers/checks-out/conflicts the files the practice generator
      // already laid down, so it must run after practice generation.
      const editing = await generateEditingVolume(
        generated.database,
        context,
        profile.editing,
        options,
      );
      // The timekeeping volume rides last on the practice book — it binds its entries to the matters the
      // practice generation laid down and the responsible member, so it must run after practice.
      const time = await generateTimeVolume(
        generated.database,
        context,
        profile.time,
        {
          timekeeperUserId: practice.probes.responsibleMemberId,
          matterIds: [practice.probes.busiestMatterId],
        },
        options,
      );
      // The document-automation volume rides LAST: it binds templates to the practice generator's
      // matter types, links parties from the directory generator's entities, and defines its own
      // matter-axis fields alongside the custom-field generator's — so all three must have run. It is
      // handed that generator's probe record so it can pick a DIFFERENT matter for its own probe and
      // leave the custom-field measurements' shape untouched.
      const documentAutomation = await generateDocumentAutomationVolume(
        generated.database,
        context,
        profile.documentAutomation,
        customFields.probes.busiestRecordId,
        options,
      );
      // The trust volume rides after practice generation: it binds a trust account to an office the
      // practice generator opened and a client ledger to its matters, and it composes every row
      // through the trust write paths, so the composition guard and the zero floor bind at any scale.
      const trust = await generateTrustVolume(generated.database, context, profile.trust, options);
      // The custody volume rides after practice and directory generation: its roots bind the offices
      // the practice generator opened, its owner links point at the directory generator's entities,
      // and a fraction of its packets link to matters. It also CREATES the platform holding matter
      // the matterless packets file their scans against, which is why it runs before the calendar
      // volume reads the firm's matters — that row must exist and must be excluded there.
      const custodyAttachPoints = await readCustodyAttachPoints(generated.database);
      const custodian = await generateCustodianVolume(
        generated.database,
        context,
        profile.custodian,
        {
          ...custodyAttachPoints,
          actorUserId: practice.probes.responsibleMemberId,
        },
        options,
      );
      // The calendar volume rides LAST, on purpose: a matter timeline federates over the rows every
      // other generator has already written, so the deep-timeline probe matter is only genuinely deep
      // in every source once they have all run.
      const calendar = await generateCalendarVolume(
        generated.database,
        context,
        profile.calendar,
        {
          matterIds: await readVisibleMatterIds(generated.database),
          deepTimelineMatterId: practice.probes.busiestMatterId,
          memberUserId: practice.probes.responsibleMemberId,
          firmLocationIds: custodyAttachPoints.firmLocationIds,
        },
        options,
      );
      const manifest: SnapshotManifest = {
        profile,
        seed,
        schemaTags,
        generatorVersion: GENERATOR_VERSION,
        entryCount: result.entryCount,
        probes: result.probes,
        matterCount: practice.matterCount,
        fileCount: practice.fileCount,
        fileVersionCount: practice.fileVersionCount,
        folderCount: practice.folderCount,
        practiceProbes: practice.probes,
        incidentCount: protectedVolume.incidentCount,
        firmSecretCount: protectedVolume.firmSecretCount,
        protectedProbes: protectedVolume.probes,
        directoryPersonCount: directoryVolume.personCount,
        directoryOrganizationCount: directoryVolume.organizationCount,
        directoryProbes: directoryVolume.probes,
        shipmentCount: shipping.shipmentCount,
        purchasedShipmentCount: shipping.purchasedCount,
        trackingEventCount: shipping.trackingEventCount,
        shippingProbes: shipping.probes,
        customFieldDefinitionCount: customFields.customFieldDefinitionCount,
        picklistOptionCount: customFields.picklistOptionCount,
        customFieldValueCount: customFields.customFieldValueCount,
        customFieldProbes: customFields.probes,
        tieredVersionCount: editing.tieredVersionCount,
        editingCheckoutCount: editing.checkoutCount,
        editingConflictCount: editing.conflictCount,
        editingProbes: editing.probes,
        timeEntryCount: time.timeEntryCount,
        rateCount: time.rateCount,
        rateCardCount: time.rateCardCount,
        timeProbes: time.probes,
        documentTemplateCount: documentAutomation.templateCount,
        archivedDocumentTemplateCount: documentAutomation.archivedTemplateCount,
        documentTemplateVersionCount: documentAutomation.templateVersionCount,
        documentAssemblyCount: documentAutomation.assemblyCount,
        documentFieldMappingCount: documentAutomation.fieldMappingCount,
        documentAutomationProbes: documentAutomation.probes,
        trustLedgerNodeCount: trust.trustLedgerNodeCount,
        trustMovementCount: trust.trustMovementCount,
        trustHoldCount: trust.trustHoldCount,
        trustBankStatementCount: trust.trustBankStatementCount,
        trustBankStatementLineCount: trust.trustBankStatementLineCount,
        trustReconciliationCount: trust.trustReconciliationCount,
        trustReconciliationMatchCount: trust.trustReconciliationMatchCount,
        trustProbes: trust.probes,
        trustAsOfDate: trust.asOfDate,
        custodyLocationCount: custodian.locationCount,
        custodyPacketCount: custodian.packetCount,
        custodyItemCount: custodian.itemCount,
        custodyMovementCount: custodian.movementCount,
        custodyHoldCount: custodian.holdCount,
        custodianProbes: custodian.probes,
        matterEventCount: calendar.matterEventCount,
        matterEventParticipantCount: calendar.matterEventParticipantCount,
        matterDeadlineCount: calendar.matterDeadlineCount,
        firmEventCount: calendar.firmEventCount,
        firmResourceCount: calendar.firmResourceCount,
        firmResourceBookingCount: calendar.firmResourceBookingCount,
        calendarProbes: calendar.probes,
      };
      // Artifact before manifest: the replay gate above requires BOTH files, so a crash between
      // the two writes leaves a regenerable miss, never a manifest pointing at a missing artifact.
      await backup(generated.raw, artifactPath);
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    } finally {
      generated.raw.close();
    }
  }

  // The manifest is trusted, not verified, against the artifact: both files are written by the
  // same generation run under the same content key, so a key match implies a matching pair.
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SnapshotManifest;
  const workingDirectory = mkdtempSync(join(tmpdir(), "mc-load-profile-"));
  const workingPath = join(workingDirectory, "working.sqlite");
  let opened: MigratedNodeDatabase;
  try {
    copyFileSync(artifactPath, workingPath);
    opened = openNodeDatabaseFile(workingPath);
  } catch (error) {
    // Opening can fail (for example a corrupt artifact) — do not leak the working directory.
    rmSync(workingDirectory, { recursive: true, force: true });
    throw error;
  }
  let closed = false;
  return {
    ...opened,
    cacheKey,
    manifest,
    workingPath,
    close: () => {
      if (closed) return;
      closed = true;
      opened.raw.close();
    },
  };
}
