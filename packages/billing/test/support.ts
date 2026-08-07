import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  CostEntryId,
  LedgerAccountId,
  LocationId,
  MatterId,
  TimeEntryId,
  TrustAccountId,
  TrustLedgerNodeId,
  UserId,
} from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import type { ClockPort } from "@magna-carta/ledger/types";
import { currencyFromCode, money } from "@magna-carta/money/money";
import { openTrustAccount } from "@magna-carta/trust/account-tree";
import { composeTrustDeposit } from "@magna-carta/trust/movements";
import { composeAccountRoleConfiguration } from "../src/account-roles.ts";
import type { AccountRole } from "../src/types.ts";

export const clock: ClockPort = {
  now: () => "2026-08-05T15:00:00.000Z",
  today: () => "2026-08-05",
};

export const options = { clock } as const;

export const commit = (database: BatchDatabase, effect: EffectWrite): Promise<void> =>
  commitEffectBatch(database, effect, { now: () => clock.now() });

// The triggers surface differently by substrate: node:sqlite throws synchronously out of run(), D1
// rejects. Deferring through a resolved promise turns the first into the second so one assertion
// holds on either.
export const expectRefusal = (run: () => Promise<unknown>): Promise<unknown> =>
  Promise.resolve().then(run);

export const mergeEffects = (...effects: readonly EffectWrite[]): EffectWrite => ({
  statements: effects.flatMap((effect) => [...effect.statements]),
  outboxMessages: effects.flatMap((effect) => [...effect.outboxMessages]),
});

export interface BillingFixture {
  readonly database: BatchDatabase;
  readonly locationId: LocationId;
  readonly memberUserId: UserId;
  readonly accountsReceivableAccountId: LedgerAccountId;
  readonly feeIncomeAccountId: LedgerAccountId;
  readonly clientCostsAdvancedAccountId: LedgerAccountId;
  readonly costRecoveryIncomeAccountId: LedgerAccountId;
  readonly operatingBankAccountId: LedgerAccountId;
}

// A firm with an office, a member, and a chart of accounts — but deliberately NO account-role map:
// the unmapped-role refusal is a first-class behaviour and every suite that wants finalization to
// work maps the roles explicitly through mapAccountRoles below.
export async function billingFixture(): Promise<BillingFixture> {
  const database: BatchDatabase = createMigratedNodeDatabase("per-firm").database;
  const locationId = newIdentifier("location") as LocationId;
  const memberUserId = newIdentifier("user") as UserId;
  await database.batch([
    database
      .prepare(
        "INSERT INTO location (id, name, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)",
      )
      .bind(locationId, "Reno", clock.now()),
    database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, 'active', ?3)",
      )
      .bind(memberUserId, "Responsible Attorney", clock.now()),
    // The fixture member is the firm's ONE genuine trust:manage holder: the earned-fee transfer's
    // lone-holder exception belongs to the counted member, so a firm with zero holders could not
    // apply trust funds single-handed at all.
    database
      .prepare(
        "INSERT INTO direct_grant (id, member_user_id, permission, expires_at, granted_by, created_at) VALUES (?1, ?2, 'trust:manage', NULL, ?2, ?3)",
      )
      .bind(newIdentifier("grant"), memberUserId, clock.now()),
  ]);

  const accountsReceivable = await createAccount(
    database,
    { name: "Accounts Receivable", type: "asset", currency: "USD" },
    options,
  );
  const feeIncome = await createAccount(
    database,
    { name: "Fee Income", type: "income", currency: "USD" },
    options,
  );
  const clientCostsAdvanced = await createAccount(
    database,
    { name: "Client Costs Advanced", type: "asset", currency: "USD" },
    options,
  );
  const costRecoveryIncome = await createAccount(
    database,
    { name: "Cost Recovery Income", type: "income", currency: "USD" },
    options,
  );
  // The firm's own bank — the operating side of a transfer out of trust. An ordinary account outside
  // every trust account, which is exactly what the trust composer checks it is.
  const operatingBank = await createAccount(
    database,
    { name: "Operating Bank Account", type: "asset", currency: "USD" },
    options,
  );
  await commit(
    database,
    mergeEffects(
      accountsReceivable.effect,
      feeIncome.effect,
      clientCostsAdvanced.effect,
      costRecoveryIncome.effect,
      operatingBank.effect,
    ),
  );

  return {
    database,
    locationId,
    memberUserId,
    accountsReceivableAccountId: accountsReceivable.accountId,
    feeIncomeAccountId: feeIncome.accountId,
    clientCostsAdvancedAccountId: clientCostsAdvanced.accountId,
    costRecoveryIncomeAccountId: costRecoveryIncome.accountId,
    operatingBankAccountId: operatingBank.accountId,
  };
}

// Maps only the roles named, so a suite can prove finalization refuses on exactly the missing one.
export async function mapAccountRoles(
  fixture: BillingFixture,
  roles: readonly AccountRole[],
): Promise<void> {
  const accountByRole: Partial<Record<AccountRole, LedgerAccountId>> = {
    accounts_receivable: fixture.accountsReceivableAccountId,
    fee_income: fixture.feeIncomeAccountId,
    client_costs_advanced: fixture.clientCostsAdvancedAccountId,
    cost_recovery_income: fixture.costRecoveryIncomeAccountId,
    operating_bank: fixture.operatingBankAccountId,
  };
  await commit(
    fixture.database,
    composeAccountRoleConfiguration(
      fixture.database,
      roles.map((role) => {
        const ledgerAccountId = accountByRole[role];
        if (!ledgerAccountId) throw new Error(`the fixture has no account for the ${role} role`);
        return { role, ledgerAccountId };
      }),
      options,
    ),
  );
}

// A matter with a client party — the link an invoice's client resolves through. Directory rows are
// not created: matter_party.entity_id carries no foreign key, which is what lets the billing suites
// stay inside the tables this package owns.
export async function seedMatter(
  fixture: BillingFixture,
  clientEntityId: string,
  label: string,
): Promise<MatterId> {
  const matterId = newIdentifier("matter") as MatterId;
  await fixture.database.batch([
    fixture.database
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, ?4)",
      )
      .bind(matterId, `${label} matter`, fixture.memberUserId, clock.now()),
    fixture.database
      .prepare(
        "INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, 'client', ?4, ?4)",
      )
      .bind(newIdentifier("matterParty"), matterId, clientEntityId, clock.now()),
  ]);
  return matterId;
}

export interface SeedTimeEntryOptions {
  readonly durationMinutes?: number;
  readonly rateE4?: number;
  readonly amountMinor?: number;
  readonly status?: string;
  readonly narrative?: string;
}

export async function seedTimeEntry(
  fixture: BillingFixture,
  matterId: MatterId,
  entryOptions: SeedTimeEntryOptions = {},
): Promise<TimeEntryId> {
  const id = newIdentifier("timeEntry") as TimeEntryId;
  const durationMinutes = entryOptions.durationMinutes ?? 60;
  const rateE4 = entryOptions.rateE4 ?? 4_000_000; // 400.0000 per hour
  const amountMinor = entryOptions.amountMinor ?? Math.round((rateE4 * durationMinutes) / 60 / 100);
  await fixture.database
    .prepare(
      `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, currency, rate_e4, amount_minor, status, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, '2026-08-01', ?4, ?4, ?5, 1, 'USD', ?6, ?7, ?8, 'manual', ?9, ?9)`,
    )
    .bind(
      id,
      matterId,
      fixture.memberUserId,
      durationMinutes,
      entryOptions.narrative ?? "Reviewed the settlement agreement",
      rateE4,
      amountMinor,
      entryOptions.status ?? "draft",
      clock.now(),
    )
    .run();
  return id;
}

export interface SeedCostEntryOptions {
  readonly amountMinor?: number;
  readonly disbursementClass?: "hard" | "soft";
  readonly status?: string;
  readonly description?: string;
}

export async function seedCostEntry(
  fixture: BillingFixture,
  matterId: MatterId,
  entryOptions: SeedCostEntryOptions = {},
): Promise<CostEntryId> {
  const id = newIdentifier("costEntry") as CostEntryId;
  await fixture.database
    .prepare(
      `INSERT INTO cost_entry (id, matter_id, incurred_date, amount_minor, currency, disbursement_class, billable, description, status, source, created_at, updated_at)
       VALUES (?1, ?2, '2026-08-01', ?3, 'USD', ?4, 1, ?5, ?6, 'manual', ?7, ?7)`,
    )
    .bind(
      id,
      matterId,
      entryOptions.amountMinor ?? 12_500,
      entryOptions.disbursementClass ?? "hard",
      entryOptions.description ?? "Filing fee",
      entryOptions.status ?? "draft",
      clock.now(),
    )
    .run();
  return id;
}

// A trust account for the firm's office, and one matter leaf funded with client money. Composed
// through the trust package's own composers rather than by inserting rows: the point of these suites
// is that billing merges what trust returns, so a fixture that hand-built a trust entry would be
// proving something other than what ships.
export async function seedTrustAccount(fixture: BillingFixture): Promise<TrustAccountId> {
  const opened = await openTrustAccount(
    fixture.database,
    {
      name: "IOLTA — Reno",
      locationId: fixture.locationId,
      // A movement refuses outright on an account whose office recorded no jurisdiction, so these
      // suites record one. That refusal has its own home in the trust suite.
      jurisdiction: "NV",
      currency: "USD",
      openedOn: "2026-08-01",
    },
    options,
  );
  await commit(fixture.database, opened.effect);
  return opened.trustAccountId;
}

// The deposit composer ensures the matter's leaf itself, and returns its effect carrying the leaf,
// the leaf's zero floor, and the posting in ONE batch — the arrangement that makes a leaf without its
// floor a state that never exists. Nothing here builds a trust row by hand.
export async function depositToMatterTrustLeaf(
  fixture: BillingFixture,
  trustAccountId: TrustAccountId,
  matterId: MatterId,
  amountMinor: number,
): Promise<TrustLedgerNodeId> {
  const deposit = await composeTrustDeposit(
    fixture.database,
    {
      trustAccountId,
      to: { matterId, clientNodeName: "Client ledger", matterLeafName: "Matter ledger" },
      amount: money(amountMinor, currencyFromCode("USD")),
      effectiveDate: "2026-08-02",
      description: "Retainer received",
      method: "check",
      reference: "1042",
      source: "The client",
      purpose: "Advance against fees",
      recordedBy: fixture.memberUserId,
    },
    options,
  );
  await commit(fixture.database, deposit.effect);
  return deposit.nodeId;
}

export async function readOneRow<Row>(
  database: BatchDatabase,
  sql: string,
  ...bindings: readonly unknown[]
): Promise<Row | undefined> {
  const { results } = await database
    .prepare(sql)
    .bind(...bindings)
    .all<Row>();
  return results[0];
}
