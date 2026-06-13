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
      const result = await generateLedgerVolume(
        generated.database,
        fixtureContext(seed),
        profile,
        options,
      );
      const manifest: SnapshotManifest = {
        profile,
        seed,
        schemaTags,
        generatorVersion: GENERATOR_VERSION,
        entryCount: result.entryCount,
        probes: result.probes,
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
