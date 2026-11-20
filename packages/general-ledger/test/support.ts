import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  LedgerAccountId,
  LocationId,
  MatterId,
  OperatingBankAccountId,
  TrustAccountId,
  UserId,
} from "@magna-carta/identifiers/types";
import { openTrustAccount } from "@magna-carta/trust/account-tree";
import { openOperatingBankAccount } from "../src/operating-accounts.ts";
import { configureAccountRoles } from "../src/role-configuration.ts";
import { adoptStarterChart, suggestedRoleAccounts } from "../src/starter-chart.ts";
import type { GeneralLedgerServiceOptions } from "../src/types.ts";

export const memberUserId = "user_generalLedgerMember0" as UserId;

export const clock = {
  now: () => "2026-11-20T15:00:00.000Z",
  today: () => "2026-11-20",
};

export const options: GeneralLedgerServiceOptions = { clock, actorUserId: memberUserId };

export const commit = (database: BatchDatabase, effect: EffectWrite): Promise<void> =>
  commitEffectBatch(database, effect, { now: () => clock.now() });

// node:sqlite throws a trigger refusal synchronously and D1 rejects; one shape for both.
export const expectRefusal = (run: () => Promise<unknown>): Promise<unknown> =>
  Promise.resolve().then(run);

export interface BooksFixture {
  readonly database: BatchDatabase;
  readonly locationId: LocationId;
  readonly accountByCode: ReadonlyMap<string, LedgerAccountId>;
  readonly mainOperatingId: OperatingBankAccountId;
  readonly payrollOperatingId: OperatingBankAccountId;
  readonly trustAccountId: TrustAccountId;
  readonly trustBankLedgerAccountId: LedgerAccountId;
}

// A firm on the standard chart with its suggested roles mapped, two operating accounts (the first
// opened becomes the default) and a trust account beside them.
export async function booksFixture(): Promise<BooksFixture> {
  const database: BatchDatabase = createMigratedNodeDatabase("per-firm").database;
  const locationId = newIdentifier("location") as LocationId;
  await database.batch([
    database
      .prepare(
        "INSERT INTO location (id, name, status, created_at, updated_at) VALUES (?1, 'Reno', 'active', ?2, ?2)",
      )
      .bind(locationId, clock.now()),
    database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Bookkeeper', 'active', ?2)",
      )
      .bind(memberUserId, clock.now()),
  ]);
  const adopted = await adoptStarterChart(database, options);
  await commit(database, adopted.effect);
  const suggested = await suggestedRoleAccounts(database);
  await commit(
    database,
    await configureAccountRoles(
      database,
      [...suggested].map(([role, ledgerAccountId]) => ({ role, ledgerAccountId })),
      options,
    ),
  );
  const main = await openOperatingBankAccount(
    database,
    { name: "Operating", bankName: "First Bank", accountNumberLastFour: "1234", code: "1000", openedOn: "2026-01-02" },
    options,
  );
  await commit(database, main.effect);
  const payroll = await openOperatingBankAccount(
    database,
    { name: "Payroll", code: "1010", openedOn: "2026-01-02" },
    options,
  );
  await commit(database, payroll.effect);
  const trust = await openTrustAccount(
    database,
    { name: "IOLTA", locationId, jurisdiction: "NV", currency: "USD", openedOn: "2026-01-02" },
    { clock },
  );
  await commit(database, trust.effect);
  const { results } = await database
    .prepare("SELECT id, code FROM ledger_account WHERE code IS NOT NULL")
    .all<{ id: string; code: string }>();
  return {
    database,
    locationId,
    accountByCode: new Map(results.map((row) => [row.code, row.id as LedgerAccountId])),
    mainOperatingId: main.operatingBankAccountId,
    payrollOperatingId: payroll.operatingBankAccountId,
    trustAccountId: trust.trustAccountId,
    trustBankLedgerAccountId: trust.bankLedgerAccountId,
  };
}

export function accountId(fixture: BooksFixture, code: string): LedgerAccountId {
  const id = fixture.accountByCode.get(code);
  if (!id) throw new Error(`no account ${code} in the fixture`);
  return id;
}

export async function balanceOf(fixture: BooksFixture, ledgerAccountId: LedgerAccountId): Promise<number> {
  const { results } = await fixture.database
    .prepare("SELECT balance_minor FROM account_balance WHERE account_id = ?1")
    .bind(ledgerAccountId)
    .all<{ balance_minor: number }>();
  return results[0]?.balance_minor ?? 0;
}

export async function seedMatter(fixture: BooksFixture, title: string): Promise<MatterId> {
  const matterId = newIdentifier("matter") as MatterId;
  await fixture.database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, ?4)",
    )
    .bind(matterId, title, memberUserId, clock.now())
    .run();
  return matterId;
}
