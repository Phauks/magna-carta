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
      // The shipping volume rides last on the same FixtureContext, linking its shipments to the
      // matters the practice generation laid down.
      const shipping = await generateShippingVolume(
        generated.database,
        context,
        profile.shipping,
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
