import {
  commitEffectBatch,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import { insertDocumentCheckoutStatement } from "@magna-carta/file-manager/checkout-statements";
import { commitCheckinVersion, initiateCheckin } from "@magna-carta/file-manager/file-service";
import {
  FILES_PREFIX,
  setVersionStorageClassStatement,
} from "@magna-carta/file-manager/file-statements";
import { meterTierChangeStatements } from "@magna-carta/file-manager/metering-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DocumentCheckoutId,
  FileId,
  FileVersionId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { EditingVolume } from "./profile.ts";

// The editing volume (slice 2·2) laid over the practice's files/versions: a fraction of superseded
// (non-current) clean versions tiered to Infrequent Access, offline/exclusive checkouts across distinct
// files (a subset gone idle), and a handful of files left with a conflict_pending conflicting copy.
// Tiering rides the real statement builders the sweep commits (setVersionStorageClass +
// meterTierChange); checkouts ride insertDocumentCheckoutStatement (the checkout route's write);
// conflicts ride the REAL divergence path (initiateCheckin → commitCheckinVersion against a stale base)
// — valid by construction. All randomness is from the one FixtureContext; no wall-clock, no R2.

// last_activity for an idle checkout — far enough in the past that any plausible idle window has elapsed
// (the idle-sweep scan's stage-1 candidates). Recent checkouts use the generator clock instead.
const IDLE_LAST_ACTIVITY_ISO = "2000-01-01T00:00:00.000Z";

export interface EditingProbes {
  readonly conflictFileId: FileId; // a file with a conflict_pending copy (the reconcile lookup)
  readonly exclusiveLockFileId: FileId; // a file with an active exclusive lock (the launch gate)
  readonly offlineCheckoutFileId: FileId; // a file with an active offline checkout (the check-in gate)
  readonly versionCutFileId: FileId; // a file the version-cut write targets
  readonly versionCutMemberId: UserId; // the author for the measured version-cut write
  // A cutoff admitting every standard non-current version as a tiering candidate (worst-case scan).
  readonly tierCutoffIso: string;
  // A cutoff admitting the idle checkouts but not the recent ones (the idle-sweep stage-1 scan).
  readonly idleCutoffIso: string;
}

export interface EditingGenerationResult {
  readonly tieredVersionCount: number;
  readonly checkoutCount: number;
  readonly conflictCount: number;
  readonly probes: EditingProbes;
}

interface VersionRow {
  readonly id: FileVersionId;
  readonly fileId: FileId;
  readonly versionNumber: number;
  readonly sizeBytes: number;
  readonly isCurrent: boolean;
}

export async function generateEditingVolume(
  database: BatchDatabase,
  context: FixtureContext,
  volume: EditingVolume,
  options: SeedingOptions,
): Promise<EditingGenerationResult> {
  assertSeedingAllowed(options);
  const { faker, clock, randomSource } = context;
  const serviceOptions = { clock, actorUserId: null, randomSource };
  const commit = (effect: EffectWrite) =>
    commitEffectBatch(database, effect, { now: () => clock.now() });

  // A holder for the checkouts (the practice generator mirrored members). Deterministic: lowest id.
  const memberRow = (
    await database.prepare("SELECT user_id FROM member ORDER BY user_id LIMIT 1").all<{
      user_id: string;
    }>()
  ).results[0];
  if (memberRow === undefined) throw new Error("load-profile: editing volume found no member");
  const holderMemberId = memberRow.user_id as UserId;

  // Every clean version with its file's current pointer, ordered deterministically.
  const versions = (
    await database
      .prepare(
        "SELECT v.id, v.file_id, v.version_number, v.size_bytes, " +
          "CASE WHEN f.current_version_id = v.id THEN 1 ELSE 0 END AS is_current " +
          "FROM file_version v JOIN file f ON f.id = v.file_id " +
          "WHERE v.status = 'clean' ORDER BY v.file_id, v.version_number",
      )
      .all<{
        id: string;
        file_id: string;
        version_number: number;
        size_bytes: number | null;
        is_current: number;
      }>()
  ).results.map((row) => ({
    id: row.id as FileVersionId,
    fileId: row.file_id as FileId,
    versionNumber: row.version_number,
    sizeBytes: row.size_bytes ?? 0,
    isCurrent: row.is_current === 1,
  }));

  // --- Tier a fraction of SUPERSEDED (non-current) versions to Infrequent Access. ---
  let tieredVersionCount = 0;
  const superseded = versions.filter((version) => !version.isCurrent);
  for (const version of superseded) {
    if (faker.number.float() >= volume.tieredVersionFraction) continue;
    await commit({
      statements: [
        setVersionStorageClassStatement(database, version.id, "standard", "infrequent_access"),
        ...meterTierChangeStatements(
          database,
          { storageClass: "standard", artifactRole: "original", prefix: FILES_PREFIX },
          { storageClass: "infrequent_access", artifactRole: "original", prefix: FILES_PREFIX },
          version.sizeBytes,
        ),
      ],
      outboxMessages: [],
    });
    tieredVersionCount += 1;
  }

  // --- Checkouts across DISTINCT files (one active checkout per file is the route's invariant). ---
  // Files by their current version, in deterministic order; the head of the list takes the checkouts.
  const currentByFile = versions.filter((version) => version.isCurrent);
  const exclusiveTarget = Math.round(volume.checkoutCount * volume.exclusiveCheckoutFraction);
  const idleTarget = Math.round(volume.checkoutCount * volume.idleCheckoutFraction);
  let exclusiveLockFileId: FileId | null = null;
  let offlineCheckoutFileId: FileId | null = null;
  let checkoutCount = 0;
  for (let index = 0; index < volume.checkoutCount && index < currentByFile.length; index += 1) {
    const file = currentByFile[index]!;
    const isExclusive = index < exclusiveTarget;
    const isIdle = !isExclusive && index >= exclusiveTarget && index < exclusiveTarget + idleTarget;
    await commit({
      statements: [
        insertDocumentCheckoutStatement(database, {
          id: newIdentifier("documentCheckout", randomSource),
          fileId: file.fileId,
          holderMemberId,
          lockType: isExclusive ? "exclusive" : "offline_working_copy",
          baseVersionId: file.id,
          acquiredAt: isIdle ? IDLE_LAST_ACTIVITY_ISO : clock.now(),
        }),
      ],
      outboxMessages: [],
    });
    checkoutCount += 1;
    if (isExclusive && exclusiveLockFileId === null) exclusiveLockFileId = file.fileId;
    if (!isExclusive && !isIdle && offlineCheckoutFileId === null) {
      offlineCheckoutFileId = file.fileId;
    }
  }

  // --- Conflicts: files with ≥2 versions get a conflict_pending copy through the REAL divergence
  // path (a checkout against a STALE base, then check-in → commitCheckinVersion sees base != current). ---
  const versionsByFile = new Map<FileId, VersionRow[]>();
  for (const version of versions) {
    const list = versionsByFile.get(version.fileId) ?? [];
    list.push(version);
    versionsByFile.set(version.fileId, list);
  }
  // Multi-version files NOT already holding a checkout (so the conflict's checkout is the file's only
  // active one) — taken from the tail so they are disjoint from the checkout head above.
  const checkoutFiles = new Set(
    currentByFile.slice(0, checkoutCount).map((version) => version.fileId),
  );
  const conflictCandidates = [...versionsByFile.entries()]
    .filter(([fileId, list]) => list.length >= 2 && !checkoutFiles.has(fileId))
    .map(([fileId, list]) => ({ fileId, list }));
  let conflictCount = 0;
  let conflictFileId: FileId | null = null;
  for (const candidate of conflictCandidates) {
    if (conflictCount >= volume.conflictCount) break;
    const staleBase = candidate.list[0]!; // the oldest version — no longer current
    const checkoutId = newIdentifier("documentCheckout", randomSource);
    await commit({
      statements: [
        insertDocumentCheckoutStatement(database, {
          id: checkoutId,
          fileId: candidate.fileId,
          holderMemberId,
          lockType: "offline_working_copy",
          baseVersionId: staleBase.id,
          acquiredAt: clock.now(),
        }),
      ],
      outboxMessages: [],
    });
    const initiated = await initiateCheckin(
      database,
      {
        fileId: candidate.fileId,
        checkoutId: checkoutId as DocumentCheckoutId,
        declaredSize: null,
        declaredContentType: "application/pdf",
        uploadedBy: holderMemberId,
      },
      serviceOptions,
    );
    await commit(initiated.effect);
    const committed = await commitCheckinVersion(
      database,
      {
        versionId: initiated.versionId,
        checkoutId: checkoutId as DocumentCheckoutId,
        sizeBytes: faker.number.int({ min: 20_000, max: 2_000_000 }),
        sniffedContentType: "application/pdf",
        contentSha256: faker.string.hexadecimal({ length: 64, prefix: "", casing: "lower" }),
        scanVerdict: "clean",
        scanEngineVersion: "fixture-1",
        scanDetail: null,
        now: clock.now(),
      },
      serviceOptions,
    );
    await commit(committed.effect);
    if (!committed.diverged) {
      throw new Error("load-profile: editing conflict generation did not diverge");
    }
    conflictCount += 1;
    conflictFileId ??= candidate.fileId;
    clock.advanceMinutes(1);
  }

  if (exclusiveLockFileId === null) {
    throw new Error("load-profile: editing volume generated no exclusive lock");
  }
  if (offlineCheckoutFileId === null) {
    throw new Error("load-profile: editing volume generated no offline checkout");
  }
  if (conflictFileId === null) {
    throw new Error("load-profile: editing volume generated no conflict");
  }

  return {
    tieredVersionCount,
    checkoutCount,
    conflictCount,
    probes: {
      conflictFileId,
      exclusiveLockFileId,
      offlineCheckoutFileId,
      versionCutFileId: currentByFile[0]!.fileId,
      versionCutMemberId: holderMemberId,
      tierCutoffIso: "2999-01-01T00:00:00.000Z",
      idleCutoffIso: "2010-01-01T00:00:00.000Z",
    },
  };
}
