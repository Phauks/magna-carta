import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import type { LedgerEntryId } from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import { assertLedgerFitness } from "@magna-carta/ledger/fitness";
import { postEntry } from "@magna-carta/ledger/post-entry";
import { reverseEntry } from "@magna-carta/ledger/reverse-entry";
import {
  selectAccountBalanceStatement,
  selectEntryStatement,
  selectLinesForEntryStatement,
} from "@magna-carta/ledger/statements";
import { money, USD } from "@magna-carta/money/money";
import { fixtureContext, type FixtureContext } from "../context.ts";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

export interface LedgerMeasurementHandle {
  readonly snapshot: LoadedSnapshot;
  readonly context: FixtureContext;
}

// The measurement context derives a DIFFERENT seed: replaying the generation seed would mint the
// exact identifier sequence the snapshot already contains → UNIQUE primary-key collisions on the
// first measured write. `${seed}:measure` keeps determinism with a disjoint stream.
export function measurementHandle(snapshot: LoadedSnapshot, seed: string): LedgerMeasurementHandle {
  return { snapshot, context: fixtureContext(`${seed}:measure`) };
}

const serviceOptions = (context: FixtureContext) => ({
  clock: context.clock,
  randomSource: context.randomSource,
});

async function postMeasurementEntry(handle: LedgerMeasurementHandle): Promise<LedgerEntryId> {
  const { probes } = handle.snapshot.manifest;
  const posted = await postEntry(
    handle.snapshot.database,
    {
      description: "Load-profile measurement entry",
      effectiveDate: handle.context.clock.today(),
      lines: [
        { accountId: probes.operatingBankAccountId, direction: "debit", amount: money(12345, USD) },
        { accountId: probes.feeIncomeAccountId, direction: "credit", amount: money(12345, USD) },
      ],
    },
    serviceOptions(handle.context),
  );
  await commitEffectBatch(handle.snapshot.database, posted.effect, {
    now: () => handle.context.clock.now(),
  });
  return posted.entryId;
}

// The v1 measured set = the deferred efficiency candidates + the hot reads:
// read coalescing in reverseEntry/createAccount, the posting write path, the materialized
// balance read, and the table-wide fitness sweep at volume.
export const ledgerMeasurements: readonly Measurement<LedgerMeasurementHandle, unknown>[] = [
  {
    name: "balance-read.busy-subledger",
    operation: async (handle) => {
      await selectAccountBalanceStatement(
        handle.snapshot.database,
        handle.snapshot.manifest.probes.busySubledgerAccountId,
      ).all();
    },
  },
  {
    name: "post-entry.two-line",
    operation: async (handle) => {
      await postMeasurementEntry(handle);
    },
  },
  {
    name: "reverse-entry.two-line",
    // An entry reverses exactly once (UNIQUE reverses_entry_id) — each iteration prepares a
    // fresh one, untimed; only the reverse is on the clock.
    prepare: (handle) => postMeasurementEntry(handle),
    operation: async (handle, state) => {
      const reversal = await reverseEntry(
        handle.snapshot.database,
        {
          entryId: state as LedgerEntryId,
          description: "Load-profile measurement reversal",
          effectiveDate: handle.context.clock.today(),
        },
        serviceOptions(handle.context),
      );
      await commitEffectBatch(handle.snapshot.database, reversal.effect, {
        now: () => handle.context.clock.now(),
      });
    },
  },
  {
    name: "create-account.trust-subledger",
    operation: async (handle) => {
      const { effect } = await createAccount(
        handle.snapshot.database,
        {
          name: `Trust — ${handle.context.faker.person.fullName()}`,
          type: "liability",
          currency: "USD",
          parentAccountId: handle.snapshot.manifest.probes.clientTrustLiabilityAccountId,
        },
        serviceOptions(handle.context),
      );
      await commitEffectBatch(handle.snapshot.database, effect, {
        now: () => handle.context.clock.now(),
      });
    },
  },
  {
    name: "ledger-fitness.table-wide",
    operation: async (handle) => {
      await assertLedgerFitness(handle.snapshot.database);
    },
  },
];

// Fitness queries are table-wide aggregates — scans by nature, allowlisted by label. The hot-path
// reads must walk an index or the primary key.
export const PLAN_SCAN_ALLOWLIST: readonly string[] = ["ledger-fitness"];

// The snapshot database is the node:sqlite adapter, so every statement it prepares really is a
// NodeSqlStatement carrying the SQL text and bindings the EXPLAIN probe needs; the ledger builders
// type their return as the narrower D1-shaped SqlStatement, which omits them. Recovering the
// runtime shape here keeps the probes on the REAL ledger SQL — no literal copy to drift outside
// the schema-name-sync net. If `snapshot.database` were ever a non-node-sqlite adapter, the cast
// would leave `statement.sql`/`statement.bindings` undefined and `explainStatement` would fail
// with a misleading SQL error pointing at the EXPLAIN call.
function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

export function hotPathPlans(snapshot: LoadedSnapshot): LabeledPlan[] {
  const { probes } = snapshot.manifest;
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "balance-read.busy-subledger",
      statement: capturedStatement(
        selectAccountBalanceStatement(snapshot.database, probes.busySubledgerAccountId),
      ),
    },
    {
      label: "entry-read.by-id",
      statement: capturedStatement(selectEntryStatement(snapshot.database, probes.sampleEntryId)),
    },
    {
      label: "lines-read.by-entry",
      statement: capturedStatement(
        selectLinesForEntryStatement(snapshot.database, probes.sampleEntryId),
      ),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(snapshot.raw, statement.sql, statement.bindings),
  }));
}
