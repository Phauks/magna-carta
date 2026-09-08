import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { LocationId, MatterId, UserId } from "@magna-carta/identifiers/types";
import type { ClockPort } from "@magna-carta/ledger/types";
import { money, USD } from "@magna-carta/money/money";
import { openTrustAccount } from "@magna-carta/trust/account-tree";
import { composeTrustDeposit, composeTrustDisbursement } from "@magna-carta/trust/movements";
import type { TrustJurisdictionPort } from "@magna-carta/trust/jurisdiction";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";

// A firm with one trust account and real client money on it, built through the composers a firm's
// own routes go through — never by inserting ledger rows by hand. A report suite that seeded its own
// rows would be proving that the report agrees with the suite's idea of a trust ledger rather than
// with the ledger the platform actually writes.

export const usd = (minor: number) => money(minor, USD);

export const RECORDER = "user_recorder" as UserId;
export const AUTHORIZER = "user_authorizer" as UserId;

export const clockAt = (instant: string): ClockPort => ({
  now: () => instant,
  today: () => civilDateOf(instant),
});

export const optionsAt = (instant: string) => ({ clock: clockAt(instant) });

export const commit = (
  database: BatchDatabase,
  effect: EffectWrite,
  instant: string,
): Promise<void> => commitEffectBatch(database, effect, { now: () => instant });

// The corpus as it ships: encoded jurisdictions exist, and none of them has been through an
// attorney's review, so every requirement refuses. A pack produced against this port is the ordinary
// case today, not an edge case — which is exactly why the pack has to have an answer for it.
export const unreviewedJurisdictions: TrustJurisdictionPort = {
  resolve() {
    throw new TrustValidationError(
      "jurisdiction-not-verified",
      "the rules for US-NV are encoded and no attorney has reviewed them",
    );
  },
};

// A port that answers, for the arm where the corpus has been reviewed.
export const reviewedJurisdictions: TrustJurisdictionPort = {
  resolve: <T>() =>
    ({
      requirement: "reconciliation" as const,
      value: undefined as T,
      binding: true,
      citation: "Nev. Sup. Ct. R. 78.5",
    }) as never,
};

export async function reportingFixture(instant = "2026-06-01T09:00:00.000Z") {
  const database: BatchDatabase = createMigratedNodeDatabase("per-firm").database;
  const locationId = newIdentifier("location") as LocationId;
  await database.batch([
    database
      .prepare(
        "INSERT INTO location (id, name, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)",
      )
      .bind(locationId, "Reno", instant),
    database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, 'active', ?3)",
      )
      .bind(RECORDER, "Recording Member", instant),
    database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, 'active', ?3)",
      )
      .bind(AUTHORIZER, "Responsible Attorney", instant),
    database
      .prepare(
        "INSERT INTO direct_grant (id, member_user_id, permission, expires_at, granted_by, created_at) VALUES (?1, ?2, 'trust:manage', NULL, ?2, ?3)",
      )
      .bind(newIdentifier("grant"), AUTHORIZER, instant),
    database
      .prepare(
        "INSERT INTO direct_grant (id, member_user_id, permission, expires_at, granted_by, created_at) VALUES (?1, ?2, 'trust:authorize', NULL, ?2, ?3)",
      )
      .bind(newIdentifier("grant"), AUTHORIZER, instant),
  ]);

  // Not the pooled interest-bearing kind, so the bank-charge carve-out can be opened on it in the
  // suites that exercise the firm's own cushion.
  const opened = await openTrustAccount(
    database,
    {
      name: "Trust — Reno",
      locationId,
      jurisdiction: "US-NV",
      currency: "USD",
      iolta: false,
      openedOn: "2026-01-01",
    },
    optionsAt(instant),
  );
  await commit(database, opened.effect, instant);

  return {
    database,
    locationId,
    trustAccountId: opened.trustAccountId,
    bankLedgerAccountId: opened.bankLedgerAccountId,
  };
}

export type ReportingFixture = Awaited<ReturnType<typeof reportingFixture>>;

export async function seedMatter(
  fixture: ReportingFixture,
  label: string,
  clientEntityId: string,
  instant: string,
): Promise<MatterId> {
  const matterId = newIdentifier("matter") as MatterId;
  await fixture.database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, ?4)",
    )
    .bind(matterId, `${label} matter`, AUTHORIZER, instant)
    .run();
  await fixture.database
    .prepare(
      "INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, 'client', ?4, ?4)",
    )
    .bind(newIdentifier("matterParty"), matterId, clientEntityId, instant)
    .run();
  return matterId;
}

const leafReference = (matterId: string, label: string) => ({
  matterId: matterId as never,
  clientNodeName: `Trust — ${label}`,
  matterLeafName: `Trust — ${label} — ${matterId}`,
});

export async function depositInto(
  fixture: ReportingFixture,
  input: {
    readonly matterId: MatterId;
    readonly label: string;
    readonly amountMinor: number;
    readonly effectiveDate: string;
    readonly recordedAt: string;
    readonly description?: string;
  },
) {
  const deposit = await composeTrustDeposit(
    fixture.database,
    {
      trustAccountId: fixture.trustAccountId,
      to: leafReference(input.matterId, input.label),
      amount: usd(input.amountMinor),
      effectiveDate: input.effectiveDate,
      description: input.description ?? "Retainer received",
      method: "check",
      reference: "1041",
      source: input.label,
      purpose: "Advance on fees and costs",
      recordedBy: RECORDER,
    },
    optionsAt(input.recordedAt),
  );
  await commit(fixture.database, deposit.effect, input.recordedAt);
  return deposit;
}

export async function disburseFrom(
  fixture: ReportingFixture,
  input: {
    readonly fromNodeId: Awaited<ReturnType<typeof depositInto>>["nodeId"];
    readonly amountMinor: number;
    readonly effectiveDate: string;
    readonly recordedAt: string;
    readonly description?: string;
  },
) {
  const paid = await composeTrustDisbursement(
    fixture.database,
    {
      fromNodeId: input.fromNodeId,
      amount: usd(input.amountMinor),
      effectiveDate: input.effectiveDate,
      description: input.description ?? "Filing fee",
      method: "check",
      reference: "2001",
      payee: "Clerk of the Court",
      purpose: "Court filing fee",
      recordedBy: RECORDER,
      authorizedBy: AUTHORIZER,
    },
    optionsAt(input.recordedAt),
  );
  await commit(fixture.database, paid.effect, input.recordedAt);
  return paid;
}
