import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import {
  getActiveExclusiveLock,
  getActiveExclusiveLockStatement,
  selectIdleActiveCheckouts,
  selectIdleActiveCheckoutsStatement,
} from "@magna-carta/file-manager/checkout-statements";
import { commitEditedVersion } from "@magna-carta/file-manager/file-service";
import {
  getConflictPendingVersion,
  getConflictPendingVersionStatement,
  listTierableVersions,
  listTierableVersionsStatement,
} from "@magna-carta/file-manager/queries";
import type { LedgerMeasurementHandle } from "./ledger-measurements.ts";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The editing (slice 2·2) volume-shaped measured set. The two SWEEP reads are firm-wide — the daily
// tiering sweep scans every clean version for cold superseded Standard candidates, and the idle-checkout
// sweep scans every checkout for idle ones — so they are the operations whose cost grows with the firm's
// document history and MUST walk an index, not the table. The reconcile + exclusive-lock lookups are
// file-scoped (bounded), measured to confirm they keep their index. The version-cut write is the
// Save/session-close commit batch. The handle is shared with the ledger set; its `${seed}:measure`
// context keeps the version-cut write deterministic on a disjoint identifier stream.

export type EditingMeasurementHandle = LedgerMeasurementHandle;

// The sweep batch caps (apps/api-worker — tiering-sweep.ts / idle-checkout-sweep.ts): the LIMIT each sweep
// read draws, so the measured cost matches one real sweep batch.
const TIER_SWEEP_BATCH = 500;
const IDLE_SWEEP_BATCH = 200;

export const editingMeasurements: readonly Measurement<EditingMeasurementHandle, unknown>[] = [
  {
    name: "tiering-sweep.find-candidates",
    operation: async (handle) => {
      // The daily tiering sweep's firm-wide candidate read: cold, superseded, still-Standard versions.
      await listTierableVersions(
        handle.snapshot.database,
        handle.snapshot.manifest.editingProbes.tierCutoffIso,
        TIER_SWEEP_BATCH,
      );
    },
  },
  {
    name: "idle-checkout-sweep.find-idle",
    operation: async (handle) => {
      // The daily idle-checkout sweep's firm-wide stage-1 read: active checkouts past the idle window.
      await selectIdleActiveCheckouts(
        handle.snapshot.database,
        handle.snapshot.manifest.editingProbes.idleCutoffIso,
        IDLE_SWEEP_BATCH,
      );
    },
  },
  {
    name: "reconcile.find-conflict",
    operation: async (handle) => {
      // The reconcile route's lookup: the document's conflict_pending flag (file-scoped).
      await getConflictPendingVersion(
        handle.snapshot.database,
        handle.snapshot.manifest.editingProbes.conflictFileId,
      );
    },
  },
  {
    name: "checkout.active-exclusive-lock",
    operation: async (handle) => {
      // The edit-launch read-only gate: is an exclusive lock held on this file (file-scoped).
      await getActiveExclusiveLock(
        handle.snapshot.database,
        handle.snapshot.manifest.editingProbes.exclusiveLockFileId,
      );
    },
  },
  {
    name: "version-cut.commit",
    operation: async (handle) => {
      const { editingProbes } = handle.snapshot.manifest;
      // The Save / session-close version-cut batch: copy current → a new version, commit, advance the
      // pointer, meter, audit. The R2 copy is a no-op here (node:sqlite has no R2); a fresh hash each
      // iteration keeps every cut a real new version (the no-op SHA skip never fires).
      const result = await commitEditedVersion(
        handle.snapshot.database,
        {
          fileId: editingProbes.versionCutFileId,
          currentR2Key: `files/${editingProbes.versionCutFileId}/current`,
          contentSha256: handle.context.faker.string.hexadecimal({
            length: 64,
            prefix: "",
            casing: "lower",
          }),
          sizeBytes: handle.context.faker.number.int({ min: 20_000, max: 2_000_000 }),
          uploadedBy: editingProbes.versionCutMemberId,
          saveKind: "explicit",
          participants: [],
        },
        {
          clock: handle.context.clock,
          actorUserId: editingProbes.versionCutMemberId,
          randomSource: handle.context.randomSource,
        },
        async () => {
          /* node:sqlite has no R2 — the server-side copy is a no-op in the harness */
        },
      );
      await commitEffectBatch(handle.snapshot.database, result.effect, {
        now: () => handle.context.clock.now(),
      });
    },
  },
];

// No table-wide-by-nature scans here: both sweep reads must walk an index (that is the whole point of
// measuring them), and the lookups are file-scoped.
export const EDITING_PLAN_SCAN_ALLOWLIST: readonly string[] = [];

function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

export function editingHotPathPlans(snapshot: LoadedSnapshot): LabeledPlan[] {
  const { editingProbes } = snapshot.manifest;
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "tiering-sweep.find-candidates",
      statement: capturedStatement(
        listTierableVersionsStatement(
          snapshot.database,
          editingProbes.tierCutoffIso,
          TIER_SWEEP_BATCH,
        ),
      ),
    },
    {
      label: "idle-checkout-sweep.find-idle",
      statement: capturedStatement(
        selectIdleActiveCheckoutsStatement(
          snapshot.database,
          editingProbes.idleCutoffIso,
          IDLE_SWEEP_BATCH,
        ),
      ),
    },
    {
      label: "reconcile.find-conflict",
      statement: capturedStatement(
        getConflictPendingVersionStatement(snapshot.database, editingProbes.conflictFileId),
      ),
    },
    {
      label: "checkout.active-exclusive-lock",
      statement: capturedStatement(
        getActiveExclusiveLockStatement(snapshot.database, editingProbes.exclusiveLockFileId),
      ),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(snapshot.raw, statement.sql, statement.bindings),
  }));
}
