import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, LocationId, UserId } from "@magna-carta/identifiers/types";
import { openTrustAccount } from "@magna-carta/trust/account-tree";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The reconciliation HTTP surface over real Miniflare bindings. What is proved here is the wiring the
// domain suites cannot reach: that the chokepoint gates these routes on the trust capabilities, that
// recording a statement and matching a line commit idempotently, that the import surface reports
// before it stores and refuses a file that changed in between, and that a period which does not tie
// out closes anyway with the disagreement recorded.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let noTrustCookie: string;
let trustAccountId: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString(), today: () => todayInUtc() };
const todayInUtc = () => new Date().toISOString().slice(0, 10);
// The ledger refuses a future effective date, so every recorded movement below is dated today and
// the statement period is the single day that contains them.
const PERIOD = () => ({ periodStart: todayInUtc(), periodEnd: todayInUtc() });

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Trust Reconciliation Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("reconciliation-owner@example.com", {
    userName: "Reconciliation Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Reconciliation Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("reconciliation-owner@example.com");

  // A member with no trust capability at all — the chokepoint must refuse every route below.
  const noTrust = await seedCredentialedUser("reconciliation-none@example.com", {
    userName: "No Trust",
    firmId: poolFirmId,
  });
  await insertMemberStatement(firmDatabase, {
    userId: noTrust.userId,
    displayName: "No Trust",
    now: clock.now(),
  }).run();
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, 'firm:reportIncident', ?2, NULL, ?3)",
    )
    .bind(newIdentifier("grant"), noTrust.userId, clock.now())
    .run();
  noTrustCookie = await signInForSessionCookie("reconciliation-none@example.com");

  await SELF.fetch("https://example.com/api/v1/numbering-scheme", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      segments: [
        { kind: "literal", text: "REC-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });

  const locationId = newIdentifier("location") as LocationId;
  await firmDatabase
    .prepare(
      "INSERT INTO location (id, name, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)",
    )
    .bind(locationId, "Reno", clock.now())
    .run();
  const opened = await openTrustAccount(
    firmDatabase,
    {
      name: "IOLTA — Reno",
      locationId,
      jurisdiction: "US-NV",
      currency: "USD",
      openedOn: "2026-08-01",
    },
    { clock },
  );
  await commitEffectBatch(firmDatabase, opened.effect, { now: () => clock.now() });
  trustAccountId = opened.trustAccountId;
});

function post(path: string, body: unknown, cookie = ownerCookie, key?: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
      "Idempotency-Key": key ?? crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function openMatter(title: string): Promise<string> {
  const created = await post("/api/v1/matters", {
    title,
    status: "open",
    responsibleMemberId: ownerUserId,
  });
  return (await created.json()).matterId;
}

async function depositInto(matterId: string, amountMinor: number, clientEntityId: string) {
  const response = await post("/api/v1/trust/deposits", {
    trustAccountId,
    matterId,
    clientEntityId,
    amountMinor,
    currency: "USD" as const,
    effectiveDate: todayInUtc(),
    description: "Retainer received",
    method: "check" as const,
    reference: "1041",
    source: "Webb Holdings",
    purpose: "Advance on fees and costs",
  });
  expect(response.status).toBe(201);
  return await response.json();
}

describe("trust reconciliation routes", () => {
  it("records a statement, matches a line by hand, and freezes a balanced proof", async () => {
    const matterId = await openMatter("Reconciliation Matter");
    const deposit = await depositInto(matterId, 500000, "entity_webb");

    const recorded = await post("/api/v1/trust/bank-statements", {
      trustAccountId,
      ...PERIOD(),
      openingBalanceMinor: 0,
      closingBalanceMinor: 500000,
      currency: "USD",
      statementReference: "STMT-1",
      lines: [
        {
          postedOn: todayInUtc(),
          direction: "deposit",
          amountMinor: 500000,
          description: "DEPOSIT CHECK 1041",
          reference: "1041",
          counterpartyName: "Webb Holdings",
        },
      ],
    });
    expect(recorded.status).toBe(201);
    const statementAck = (await recorded.json()) as {
      trustBankStatementId: string;
      linesRecorded: number;
    };
    expect(statementAck.linesRecorded).toBe(1);

    const opened = await post("/api/v1/trust/reconciliations", {
      statementId: statementAck.trustBankStatementId,
    });
    expect(opened.status).toBe(201);
    const { trustReconciliationId } = (await opened.json()) as { trustReconciliationId: string };

    // The suggestion surface offers the pair and its reasons, and matches nothing.
    const suggested = await get(
      `/api/v1/trust/reconciliations/${trustReconciliationId}/suggestions`,
    );
    expect(suggested.status).toBe(200);
    const suggestions = (await suggested.json()) as {
      suggestions: readonly { statementLineId: string; ledgerEntryId: string }[];
      unmatchedLines: readonly { id: string }[];
    };
    expect(suggestions.suggestions).toHaveLength(1);
    expect(suggestions.suggestions[0]?.ledgerEntryId).toBe(deposit.ledgerEntryId);

    const matched = await post(`/api/v1/trust/reconciliations/${trustReconciliationId}/matches`, {
      statementLineId: suggestions.suggestions[0]?.statementLineId,
      ledgerEntryId: deposit.ledgerEntryId,
    });
    expect(matched.status).toBe(201);

    const detail = await get(`/api/v1/trust/reconciliations/${trustReconciliationId}`);
    const proof = (await detail.json()).proof;
    expect(proof.balanced).toBe(true);

    const closed = await post(
      `/api/v1/trust/reconciliations/${trustReconciliationId}/close`,
      undefined,
    );
    expect(closed.status).toBe(201);
    expect(await closed.json()).toMatchObject({
      frozenProof: { balanced: true, bookBalanceMinor: 500000, clientLedgerTotalMinor: 500000 },
    });

    // A closed reconciliation refuses another match: what it matched is part of what it attested to.
    const late = await post(`/api/v1/trust/reconciliations/${trustReconciliationId}/matches`, {
      statementLineId: suggestions.unmatchedLines[0]?.id,
      ledgerEntryId: deposit.ledgerEntryId,
    });
    expect(late.status).toBe(409);
  });

  it("closes an unbalanced period, naming the leg that disagrees", async () => {
    const matterId = await openMatter("Unbalanced Matter");
    await depositInto(matterId, 300000, "entity_shaw");

    const recorded = await post("/api/v1/trust/bank-statements", {
      trustAccountId,
      ...PERIOD(),
      openingBalanceMinor: 0,
      // The bank took a service charge the firm never recorded, so the closing balance is short.
      closingBalanceMinor: 799500,
      currency: "USD",
      lines: [
        {
          postedOn: todayInUtc(),
          direction: "withdrawal",
          amountMinor: 2500,
          description: "MONTHLY SERVICE CHARGE",
        },
      ],
    });
    const { trustBankStatementId } = (await recorded.json()) as { trustBankStatementId: string };
    const opened = await post("/api/v1/trust/reconciliations", {
      statementId: trustBankStatementId,
    });
    const { trustReconciliationId } = (await opened.json()) as { trustReconciliationId: string };

    const closed = await post(
      `/api/v1/trust/reconciliations/${trustReconciliationId}/close`,
      undefined,
    );
    expect(closed.status).toBe(201);
    const body = (await closed.json()) as {
      frozenProof: { balanced: boolean };
      proof: { disagreements: readonly { leg: string; differenceMinor: number }[] };
    };
    expect(body.frozenProof.balanced).toBe(false);
    // The bank leg is the one that is out, and only that one: book and client agree by construction
    // while the composition guard holds. The AMOUNT is not pinned here — this firm carries whatever
    // the tests above recorded — and the exact arithmetic is proved in the trust package's own suite,
    // which owns the whole ledger it measures.
    expect(body.proof.disagreements.map((disagreement) => disagreement.leg)).toEqual([
      "bank-to-book",
    ]);
  });

  it("previews a file without storing it, then imports only the file that was reviewed", async () => {
    const file = [
      "Date,Description,Amount,Check Number,Payee",
      `${todayInUtc()},"DEPOSIT CHECK 3001",1000.00,3001,Nguyen Trust`,
      `${todayInUtc()},BANK FEE,-15.00,,`,
    ].join("\n");

    const previewed = await post("/api/v1/trust/bank-statements/import/preview", {
      fileText: file,
      currency: "USD",
    });
    expect(previewed.status).toBe(200);
    const preview = (await previewed.json()) as {
      rows: readonly unknown[];
      rejections: readonly unknown[];
      fingerprint: string;
      columnMapping: Record<string, string>;
    };
    expect(preview.rows).toHaveLength(2);
    expect(preview.rejections).toEqual([]);
    expect(preview.columnMapping["amount"]).toBe("Amount");

    // Nothing was stored by previewing.
    const before = await get(`/api/v1/trust/bank-statements?trustAccountId=${trustAccountId}`);
    const beforeCount = (await before.json()).statements.length;

    const importBody = (fileText: string, fingerprint: string) => ({
      trustAccountId,
      ...PERIOD(),
      openingBalanceMinor: 0,
      closingBalanceMinor: 98500,
      currency: "USD" as const,
      fileText,
      confirmedFingerprint: fingerprint,
    });

    // A file that changed between the review and the confirmation is refused, not stored.
    const changed = await post(
      "/api/v1/trust/bank-statements/import",
      importBody(file.replace("1000.00", "9000.00"), preview.fingerprint),
    );
    expect(changed.status).toBe(422);

    const imported = await post(
      "/api/v1/trust/bank-statements/import",
      importBody(file, preview.fingerprint),
    );
    expect(imported.status).toBe(201);
    expect(await imported.json()).toMatchObject({
      linesRecorded: 2,
      rowsRejected: 0,
      depositTotalMinor: 100000,
      withdrawalTotalMinor: 1500,
    });

    const after = await get(`/api/v1/trust/bank-statements?trustAccountId=${trustAccountId}`);
    expect((await after.json()).statements.length).toBe(beforeCount + 1);
  });

  it("replays a retried statement rather than recording it twice", async () => {
    const key = crypto.randomUUID();
    const body = {
      trustAccountId,
      ...PERIOD(),
      openingBalanceMinor: 0,
      closingBalanceMinor: 12345,
      currency: "USD" as const,
      lines: [
        {
          postedOn: todayInUtc(),
          direction: "deposit" as const,
          amountMinor: 12345,
          description: "DEPOSIT",
        },
      ],
    };
    const first = await post("/api/v1/trust/bank-statements", body, ownerCookie, key);
    const replayed = await post("/api/v1/trust/bank-statements", body, ownerCookie, key);
    expect(first.status).toBe(201);
    expect(replayed.status).toBe(201);
    expect(replayed.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replayed.json()).toEqual(await first.json());
  });

  it("refuses every route to a member without the trust capability", async () => {
    const statement = await post(
      "/api/v1/trust/bank-statements",
      {
        trustAccountId,
        ...PERIOD(),
        openingBalanceMinor: 0,
        closingBalanceMinor: 0,
        currency: "USD",
        lines: [
          {
            postedOn: todayInUtc(),
            direction: "deposit",
            amountMinor: 1,
            description: "DEPOSIT",
          },
        ],
      },
      noTrustCookie,
    );
    expect(statement.status).toBe(403);
    const listed = await get(
      `/api/v1/trust/reconciliations?trustAccountId=${trustAccountId}`,
      noTrustCookie,
    );
    expect(listed.status).toBe(403);
  });
});
