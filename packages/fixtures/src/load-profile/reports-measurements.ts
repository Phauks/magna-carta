import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import { refusingTrustJurisdictions } from "@magna-carta/trust/jurisdiction";
import {
  selectTrustBankJournalInPeriodStatement,
  selectTrustClientLedgerEntriesInPeriodStatement,
  selectTrustMatterLeafBalancesAsOfStatement,
} from "@magna-carta/trust/statements";
import { resolveReportingPeriod } from "@magna-carta/reporting/temporal";
import { assembleTrustCompliancePack } from "@magna-carta/reporting/trust-compliance/pack";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The reporting set, measured over the trust volume the trust generator laid down: a client ledger
// per matter that holds money, a couple of years of monthly statements, and one period left open.
//
// Three reads and the whole document, each at ONE MONTH and at TWELVE. The pair is the point rather
// than either number: a pack is produced for whatever period an examiner asks about, and what has to
// be known is how the cost grows with that period. A read that is flat at one month and quadratic at
// twelve is a read that works in development and refuses in front of a regulator.
//
// The honest weak point, and the reason the journal is measured on its own: a journal over a trust
// bank account joins `ledger_line` (by account) to `ledger_entry` (for the dates), so SQLite drives
// from the account index and filters the dates as a residual — over a long-lived account that reads
// more lines than the period needs. If this measurement says that matters, the remedy is a
// denormalization rather than a materialisation: a copy of `effective_date` onto `ledger_line`,
// written by the ledger package inside the posting batch, so a composite `(account_id,
// effective_date)` index can drive the read. That duplicates an immutable column of the same row's
// parent and can never drift, which is categorically different from storing a computed balance —
// and it is not built until the measurement asks for it.

export interface ReportsMeasurementHandle {
  readonly snapshot: LoadedSnapshot;
}

export function reportsMeasurementHandle(snapshot: LoadedSnapshot): ReportsMeasurementHandle {
  return { snapshot };
}

// A knowledge bound past every row the generator wrote, so the second axis does not quietly shrink
// the result set. What is being measured is the cost of the period, not the cost of a filter that
// happened to exclude most of it.
const EVERYTHING_RECORDED = "9999-12-31T23:59:59.999Z";

// The month the generator's open reconciliation covers, and the year ending on the same day.
function periodBounds(asOfDate: string, months: number): { start: string; end: string } {
  const end = new Date(`${asOfDate}T00:00:00.000Z`);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - months);
  start.setUTCDate(start.getUTCDate() + 1);
  return { start: civilDateOf(start), end: asOfDate };
}

// Recover the runtime node-sqlite shape so the EXPLAIN probes run the REAL query SQL (the statement
// builders type their return as the narrower D1-shaped SqlStatement, which omits sql/bindings).
function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

export const reportsMeasurements: readonly Measurement<ReportsMeasurementHandle, unknown>[] = [
  {
    name: "reports-client-ledgers.one-month",
    operation: async (handle) => {
      const { start, end } = periodBounds(handle.snapshot.manifest.trustAsOfDate, 1);
      await selectTrustClientLedgerEntriesInPeriodStatement(
        handle.snapshot.database,
        handle.snapshot.manifest.trustProbes.trustAccountId,
        start,
        end,
        EVERYTHING_RECORDED,
      ).all();
    },
  },
  {
    name: "reports-client-ledgers.twelve-months",
    operation: async (handle) => {
      const { start, end } = periodBounds(handle.snapshot.manifest.trustAsOfDate, 12);
      await selectTrustClientLedgerEntriesInPeriodStatement(
        handle.snapshot.database,
        handle.snapshot.manifest.trustProbes.trustAccountId,
        start,
        end,
        EVERYTHING_RECORDED,
      ).all();
    },
  },
  {
    name: "reports-journal.one-month",
    operation: async (handle) => {
      const { start, end } = periodBounds(handle.snapshot.manifest.trustAsOfDate, 1);
      await selectTrustBankJournalInPeriodStatement(
        handle.snapshot.database,
        handle.snapshot.manifest.trustProbes.bankLedgerAccountId,
        start,
        end,
        EVERYTHING_RECORDED,
      ).all();
    },
  },
  {
    name: "reports-journal.twelve-months",
    operation: async (handle) => {
      const { start, end } = periodBounds(handle.snapshot.manifest.trustAsOfDate, 12);
      await selectTrustBankJournalInPeriodStatement(
        handle.snapshot.database,
        handle.snapshot.manifest.trustProbes.bankLedgerAccountId,
        start,
        end,
        EVERYTHING_RECORDED,
      ).all();
    },
  },
  {
    // The per-leaf balance read, taken twice per pack — once at the day before the period starts and
    // once at its end. It is the decomposition the whole pack's client-ledger section hangs off, so
    // it is measured on its own rather than only inside the assembly.
    name: "reports-leaf-balances.as-of",
    operation: async (handle) => {
      await selectTrustMatterLeafBalancesAsOfStatement(
        handle.snapshot.database,
        handle.snapshot.manifest.trustProbes.trustAccountId,
        handle.snapshot.manifest.trustAsOfDate,
        EVERYTHING_RECORDED,
      ).all();
    },
  },
  {
    // The whole document: the cover, every reconciliation in the period with the trust package's own
    // three-way proof beside it, every client ledger, the journal, the cushion, and the exceptions.
    // What a member actually waits for.
    name: "reports-pack.one-month",
    operation: async (handle) => {
      const { start, end } = periodBounds(handle.snapshot.manifest.trustAsOfDate, 1);
      await assembleTrustCompliancePack(
        handle.snapshot.database,
        {
          trustAccountId: handle.snapshot.manifest.trustProbes.trustAccountId,
          period: resolveReportingPeriod(
            { periodStart: start, periodEnd: end, knownAsOf: EVERYTHING_RECORDED },
            EVERYTHING_RECORDED,
          ),
        },
        { jurisdictions: refusingTrustJurisdictions, computedAt: EVERYTHING_RECORDED },
      );
    },
  },
  {
    name: "reports-pack.twelve-months",
    operation: async (handle) => {
      const { start, end } = periodBounds(handle.snapshot.manifest.trustAsOfDate, 12);
      await assembleTrustCompliancePack(
        handle.snapshot.database,
        {
          trustAccountId: handle.snapshot.manifest.trustProbes.trustAccountId,
          period: resolveReportingPeriod(
            { periodStart: start, periodEnd: end, knownAsOf: EVERYTHING_RECORDED },
            EVERYTHING_RECORDED,
          ),
        },
        { jurisdictions: refusingTrustJurisdictions, computedAt: EVERYTHING_RECORDED },
      );
    },
  },
];

// Nothing here is allowed a full table scan: every read is bounded by one trust account and one
// period, and a scan would mean a pack's cost grows with the firm's whole book rather than with the
// period asked for. The list is deliberately empty and stays that way.
export const REPORTS_PLAN_SCAN_ALLOWLIST: readonly string[] = [];

// The EXPLAIN probes. The two per-row reads are the ones that would silently become table scans as a
// firm's book grows: both filter on a date range that no index covers on its own, and both are the
// shape a long-lived account makes expensive.
export function reportsHotPathPlans(handle: ReportsMeasurementHandle): LabeledPlan[] {
  const { database, manifest } = handle.snapshot;
  const { start, end } = periodBounds(manifest.trustAsOfDate, 12);
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "reports-client-ledgers",
      statement: capturedStatement(
        selectTrustClientLedgerEntriesInPeriodStatement(
          database,
          manifest.trustProbes.trustAccountId,
          start,
          end,
          EVERYTHING_RECORDED,
        ),
      ),
    },
    {
      label: "reports-journal",
      statement: capturedStatement(
        selectTrustBankJournalInPeriodStatement(
          database,
          manifest.trustProbes.bankLedgerAccountId,
          start,
          end,
          EVERYTHING_RECORDED,
        ),
      ),
    },
    {
      label: "reports-leaf-balances",
      statement: capturedStatement(
        selectTrustMatterLeafBalancesAsOfStatement(
          database,
          manifest.trustProbes.trustAccountId,
          manifest.trustAsOfDate,
          EVERYTHING_RECORDED,
        ),
      ),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(handle.snapshot.raw, statement.sql, statement.bindings),
  }));
}
