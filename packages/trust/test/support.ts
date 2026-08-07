import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { LedgerAccountId, LocationId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import type { ClockPort } from "@magna-carta/ledger/types";
import { ensureMatterTrustLeaf, openTrustAccount } from "../src/account-tree.ts";

export const clock: ClockPort = {
  now: () => "2026-08-05T15:00:00.000Z",
  today: () => "2026-08-05",
};

export const options = { clock } as const;

export const commit = (database: BatchDatabase, effect: EffectWrite): Promise<void> =>
  commitEffectBatch(database, effect, { now: () => clock.now() });

// The append-only triggers surface differently by substrate: node:sqlite throws synchronously out of
// run(), D1 rejects. Deferring through a resolved promise turns the first into the second so one
// assertion holds on either.
export const expectRefusal = (run: () => Promise<unknown>): Promise<unknown> =>
  Promise.resolve().then(run);

// Merges effects the way a real caller does — creation and first posting in ONE batch, which is the
// whole reason ensureMatterTrustLeaf returns an effect rather than committing on its own.
export const mergeEffects = (...effects: readonly EffectWrite[]): EffectWrite => ({
  statements: effects.flatMap((effect) => [...effect.statements]),
  outboxMessages: effects.flatMap((effect) => [...effect.outboxMessages]),
});

// The office's jurisdiction defaults to unrecorded, which is what the structural-guard suites want:
// they prove the composition rules and must not depend on a jurisdiction being present. The movement
// suites pass one, because a movement on an account with no recorded jurisdiction refuses by design.
export interface TrustFixtureOptions {
  readonly jurisdiction?: string | null;
}

export async function trustFixture(fixtureOptions: TrustFixtureOptions = {}) {
  const database: BatchDatabase = createMigratedNodeDatabase("per-firm").database;
  // node:sqlite enforces foreign keys, so the office and the member a matter hangs off have to be
  // real rows — which is the right substrate: the trust tables' references are load-bearing.
  const locationId = newIdentifier("location") as LocationId;
  const memberUserId = newIdentifier("user");
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
  ]);
  const opened = await openTrustAccount(
    database,
    {
      name: "IOLTA — Reno",
      locationId,
      jurisdiction: fixtureOptions.jurisdiction ?? null,
      currency: "USD",
      openedOn: "2026-08-01",
    },
    options,
  );
  await commit(database, opened.effect);

  // An ordinary operating chart the trust guard must refuse to mix with: a bank, a fee income
  // account, and an expense account standing in for a processor fee.
  const operatingBank = await createAccount(
    database,
    { name: "Operating Bank Account", type: "asset", currency: "USD" },
    options,
  );
  const accountsReceivable = await createAccount(
    database,
    { name: "Accounts Receivable", type: "asset", currency: "USD" },
    options,
  );
  const processorFeeExpense = await createAccount(
    database,
    { name: "Processor Fees", type: "expense", currency: "USD" },
    options,
  );
  await commit(
    database,
    mergeEffects(operatingBank.effect, accountsReceivable.effect, processorFeeExpense.effect),
  );

  return {
    database,
    locationId,
    memberUserId,
    trustAccountId: opened.trustAccountId,
    bankLedgerAccountId: opened.bankLedgerAccountId,
    clientLiabilityAccountId: opened.clientLiabilityAccountId,
    operatingBankAccountId: operatingBank.accountId,
    accountsReceivableAccountId: accountsReceivable.accountId,
    processorFeeAccountId: processorFeeExpense.accountId,
  };
}

// A matter row and its client party — no trust leaf. The movement suites need this because a deposit
// CREATES the leaf, and node:sqlite enforces the trust node's foreign key to the matter. The client
// party is not decoration: a trust ledger's client attribution is DERIVED from it, so a matter
// without one holds no client money at all.
export async function seedMatter(
  fixture: Awaited<ReturnType<typeof trustFixture>>,
  label: string,
  clientEntityId?: string,
): Promise<MatterId> {
  const matterId = newIdentifier("matter") as MatterId;
  await fixture.database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, ?4)",
    )
    .bind(matterId, `${label} matter`, fixture.memberUserId, clock.now())
    .run();
  if (clientEntityId !== undefined) await seedMatterClientParty(fixture, matterId, clientEntityId);
  return matterId;
}

// The `matter_party` row the whole client attribution hangs off. Separate from seedMatter so a suite
// can prove the refusal a matter with no client earns, and so a suite can deliberately seed the
// mismatch the fitness query exists to find.
export async function seedMatterClientParty(
  fixture: Awaited<ReturnType<typeof trustFixture>>,
  matterId: MatterId,
  clientEntityId: string,
): Promise<void> {
  await fixture.database
    .prepare(
      "INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, 'client', ?4, ?4)",
    )
    .bind(newIdentifier("matterParty"), matterId, clientEntityId, clock.now())
    .run();
}

// A member who holds the trust capability, granted directly. The sole-authorizer trigger counts
// exactly these rows, so a suite that exercises the single-manager path controls how many exist.
export async function seedTrustManager(
  fixture: Awaited<ReturnType<typeof trustFixture>>,
  displayName: string,
): Promise<UserId> {
  const userId = newIdentifier("user");
  await fixture.database.batch([
    fixture.database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, 'active', ?3)",
      )
      .bind(userId, displayName, clock.now()),
    fixture.database
      .prepare(
        "INSERT INTO direct_grant (id, member_user_id, permission, expires_at, granted_by, created_at) VALUES (?1, ?2, 'trust:manage', NULL, ?2, ?3)",
      )
      .bind(newIdentifier("grant"), userId, clock.now()),
  ]);
  return userId;
}

// The authority capability, granted directly to an existing member. The authority triggers count
// exactly these rows (plus role-held grants no fixture seeds), so a suite that exercises the
// approver-authority option controls who holds it.
export async function grantTrustAuthority(
  fixture: Awaited<ReturnType<typeof trustFixture>>,
  userId: UserId,
): Promise<void> {
  await fixture.database
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, expires_at, granted_by, created_at) VALUES (?1, ?2, 'trust:authorize', NULL, ?2, ?3)",
    )
    .bind(newIdentifier("grant"), userId, clock.now())
    .run();
}

// A bare active member row — the roster the authority triggers check membership against. The
// authority option needs members who hold nothing, which seedTrustManager cannot provide.
export async function seedActiveMember(
  fixture: Awaited<ReturnType<typeof trustFixture>>,
  displayName: string,
): Promise<UserId> {
  const userId = newIdentifier("user");
  await fixture.database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, 'active', ?3)",
    )
    .bind(userId, displayName, clock.now())
    .run();
  return userId;
}

export interface SeededMatterLeaf {
  readonly nodeId: Awaited<ReturnType<typeof ensureMatterTrustLeaf>>["nodeId"];
  readonly ledgerAccountId: LedgerAccountId;
  readonly clientEntityId: string;
  readonly matterId: MatterId;
}

export async function seedMatterLeaf(
  fixture: Awaited<ReturnType<typeof trustFixture>>,
  clientEntityId: string,
  label: string,
): Promise<SeededMatterLeaf> {
  const { database, trustAccountId } = fixture;
  const matterId = await seedMatter(fixture, label, clientEntityId);
  const leaf = await ensureMatterTrustLeaf(
    database,
    {
      trustAccountId,
      matterId,
      clientNodeName: `Trust — ${label}`,
      matterLeafName: `Trust — ${label} — ${matterId}`,
    },
    options,
  );
  await commit(database, leaf.effect);
  return {
    nodeId: leaf.nodeId,
    ledgerAccountId: leaf.ledgerAccountId,
    clientEntityId,
    matterId,
  };
}
