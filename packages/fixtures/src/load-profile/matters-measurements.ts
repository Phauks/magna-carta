import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import type { MatterId } from "@magna-carta/identifiers/types";
import { createMatter, openMatter } from "@magna-carta/matters/matter-service";
import { listConsultations, listConsultationsStatement } from "@magna-carta/matters/queries";
import { listMatters, listMattersStatement } from "@magna-carta/matters/queries";
import {
  getCurrentCleanVersion,
  listCleanCurrentVersionsByMatter,
  listCleanCurrentVersionsByMatterStatement,
  listCleanVersions,
  listFiles,
  listFilesStatement,
  listFoldersByMatter,
  listFoldersByMatterStatement,
  listUnscannedCommittedVersions,
  listUnscannedCommittedVersionsStatement,
  selectCurrentCleanVersionStatement,
} from "@magna-carta/file-manager/queries";
import { STORAGE_METER_TABLE } from "@magna-carta/file-manager/metering-statements";
import type { LedgerMeasurementHandle } from "./ledger-measurements.ts";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The matters / locations / file-manager volume-shaped measured set, on the ledger-measurements
// pattern. Each operation's cost depends on the data SHAPE the practice generator
// laid down — a paginated caseload list, a per-attorney consultations view, the clean-version reads
// the download path resolves, and the matter-number counter draw. Constant-time point lookups are
// excluded (they belong in unit benchmarks). The measurement handle is shared with the ledger set:
// its `${seed}:measure` context keeps the draw writes deterministic on a disjoint identifier stream.

export type MattersMeasurementHandle = LedgerMeasurementHandle;

// A storage-usage read: the firm's whole meter summed by bytes/objects — what a storage dashboard
// shows. The meter has a tiny fixed cardinality by design (one row per class/role/prefix), so this is
// a table-wide aggregate (allowlisted below), built here because file-manager exposes no meter reader.
function storageMeterSummaryStatement(snapshot: LoadedSnapshot): NodeSqlStatement {
  return snapshot.database.prepare(
    `SELECT sum(bytes) AS bytes, sum(object_count) AS objects FROM ${STORAGE_METER_TABLE}`,
  ) as unknown as NodeSqlStatement;
}

const STALE_CONSULTATION_DAYS = 30;

// The weekly re-scan sweep's per-firm batch cap (apps/worker scheduled.ts) — the LIMIT the find-
// unscanned read draws, so the measured cost matches one real sweep batch.
const RESCAN_SWEEP_BATCH = 100;

// A consultation the measured counter-draw promotes to open. Each draw burns a fresh prospective
// (openMatter is one-shot: a second draw on the same matter is "matter-not-prospective"), so the
// untimed prepare mints one per iteration and only the draw is on the clock.
async function freshConsultation(handle: MattersMeasurementHandle): Promise<MatterId> {
  const created = await createMatter(
    handle.snapshot.database,
    {
      title: "Load-profile measurement consultation",
      responsibleMemberId: handle.snapshot.manifest.practiceProbes.responsibleMemberId,
      status: "prospective",
    },
    { clock: handle.context.clock, actorUserId: null, randomSource: handle.context.randomSource },
  );
  return created.matterId;
}

export const mattersMeasurements: readonly Measurement<MattersMeasurementHandle, unknown>[] = [
  {
    name: "list-matters.first-page",
    operation: async (handle) => {
      // The default caseload list (open + closed), newest-first first page.
      await listMatters(handle.snapshot.database, {});
    },
  },
  {
    name: "list-matters.filtered",
    operation: async (handle) => {
      const { practiceProbes } = handle.snapshot.manifest;
      await listMatters(handle.snapshot.database, {
        status: "open",
        locationId: practiceProbes.listLocationId,
        matterTypeId: practiceProbes.listMatterTypeId,
        responsibleMemberId: practiceProbes.responsibleMemberId,
      });
    },
  },
  {
    name: "list-consultations.by-member",
    operation: async (handle) => {
      await listConsultations(handle.snapshot.database, {
        responsibleMemberId: handle.snapshot.manifest.practiceProbes.responsibleMemberId,
        now: handle.context.clock.now(),
        staleAgeDays: STALE_CONSULTATION_DAYS,
      });
    },
  },
  {
    name: "list-files.by-matter",
    operation: async (handle) => {
      await listFiles(handle.snapshot.database, {
        matterId: handle.snapshot.manifest.practiceProbes.busiestMatterId,
      });
    },
  },
  {
    name: "list-files.by-folder",
    operation: async (handle) => {
      // A folder-scoped list reuses the same statement with the folder filter (the busy folder).
      await listFilesStatement(
        handle.snapshot.database,
        {
          matterId: handle.snapshot.manifest.practiceProbes.busiestMatterId,
          folderId: handle.snapshot.manifest.practiceProbes.busyFolderId,
        },
        undefined,
        50,
      ).all();
    },
  },
  {
    name: "get-current-clean-version",
    operation: async (handle) => {
      await getCurrentCleanVersion(
        handle.snapshot.database,
        handle.snapshot.manifest.practiceProbes.multiVersionFileId,
      );
    },
  },
  {
    name: "list-clean-versions.by-file",
    operation: async (handle) => {
      await listCleanVersions(
        handle.snapshot.database,
        handle.snapshot.manifest.practiceProbes.multiVersionFileId,
      );
    },
  },
  {
    name: "zip-resolution.clean-current-versions",
    operation: async (handle) => {
      // The ZIP download's content set: every clean current version in the matter.
      await listCleanCurrentVersionsByMatter(
        handle.snapshot.database,
        handle.snapshot.manifest.practiceProbes.busiestMatterId,
      );
    },
  },
  {
    name: "zip-resolution.folders-by-matter",
    operation: async (handle) => {
      // The ZIP download's folder tree (path composition).
      await listFoldersByMatter(
        handle.snapshot.database,
        handle.snapshot.manifest.practiceProbes.busiestMatterId,
      );
    },
  },
  {
    name: "rescan-sweep.find-unscanned",
    operation: async (handle) => {
      // The weekly re-scan sweep's batch read: committed clean versions still awaiting the engine
      // (scan_verdict = 'unscanned'), selective against the clean majority the generator lays down.
      await listUnscannedCommittedVersions(handle.snapshot.database, RESCAN_SWEEP_BATCH);
    },
  },
  {
    name: "storage-meter.summary",
    operation: async (handle) => {
      await storageMeterSummaryStatement(handle.snapshot).all();
    },
  },
  {
    name: "matter-number.counter-draw",
    // openMatter is one-shot — each iteration prepares a fresh prospective (untimed); only the draw,
    // which reads the active scheme + the counter and commits the guarded increment, is on the clock.
    prepare: (handle) => freshConsultation(handle),
    operation: async (handle, state) => {
      await openMatter(
        handle.snapshot.database,
        state as MatterId,
        // The probe location's code drives the scheme's scoping segment — the busy counter scope.
        { numberContext: { locationCode: "L01" } },
        {
          clock: handle.context.clock,
          actorUserId: null,
          randomSource: handle.context.randomSource,
        },
      );
    },
  },
];

// Table-wide-by-nature scans, allowlisted by label. The storage meter is a tiny rollup summed in full
// (a few rows); everything else here must walk an index or the primary key.
export const PRACTICE_PLAN_SCAN_ALLOWLIST: readonly string[] = ["storage-meter.summary"];

// Recover the runtime node-sqlite shape so the EXPLAIN probes run the REAL query SQL (the query
// builders type their return as the narrower D1-shaped SqlStatement, which omits sql/bindings).
function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

export function practiceHotPathPlans(snapshot: LoadedSnapshot): LabeledPlan[] {
  const { practiceProbes } = snapshot.manifest;
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "list-matters.first-page",
      statement: capturedStatement(listMattersStatement(snapshot.database, {}, undefined, 51)),
    },
    {
      label: "list-matters.filtered",
      statement: capturedStatement(
        listMattersStatement(
          snapshot.database,
          {
            status: "open",
            locationId: practiceProbes.listLocationId,
            matterTypeId: practiceProbes.listMatterTypeId,
            responsibleMemberId: practiceProbes.responsibleMemberId,
          },
          undefined,
          51,
        ),
      ),
    },
    {
      label: "list-consultations.by-member",
      statement: capturedStatement(
        listConsultationsStatement(
          snapshot.database,
          practiceProbes.responsibleMemberId,
          undefined,
          51,
        ),
      ),
    },
    {
      label: "list-files.by-matter",
      statement: capturedStatement(
        listFilesStatement(
          snapshot.database,
          { matterId: practiceProbes.busiestMatterId },
          undefined,
          51,
        ),
      ),
    },
    {
      label: "list-files.by-folder",
      statement: capturedStatement(
        listFilesStatement(
          snapshot.database,
          { matterId: practiceProbes.busiestMatterId, folderId: practiceProbes.busyFolderId },
          undefined,
          51,
        ),
      ),
    },
    {
      label: "get-current-clean-version",
      statement: capturedStatement(
        selectCurrentCleanVersionStatement(snapshot.database, practiceProbes.multiVersionFileId),
      ),
    },
    {
      label: "zip-resolution.clean-current-versions",
      statement: capturedStatement(
        listCleanCurrentVersionsByMatterStatement(
          snapshot.database,
          practiceProbes.busiestMatterId,
        ),
      ),
    },
    {
      label: "zip-resolution.folders-by-matter",
      statement: capturedStatement(
        listFoldersByMatterStatement(snapshot.database, practiceProbes.busiestMatterId),
      ),
    },
    {
      label: "rescan-sweep.find-unscanned",
      statement: capturedStatement(
        listUnscannedCommittedVersionsStatement(snapshot.database, RESCAN_SWEEP_BATCH),
      ),
    },
    {
      label: "storage-meter.summary",
      statement: storageMeterSummaryStatement(snapshot),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(snapshot.raw, statement.sql, statement.bindings),
  }));
}
