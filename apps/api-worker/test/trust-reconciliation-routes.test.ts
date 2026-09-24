import { todayInUtc } from "@magna-carta/civil-time/civil-date";
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
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";
import type { ProblemBody } from "../src/http/contracts/problem.ts";

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

// The matter's client party, recorded straight into the firm database because there is no HTTP
// surface for it yet. A trust ledger's client attribution is derived from this link, so a matter
// without one holds no client money at all.
async function openMatter(title: string, clientEntityId: string): Promise<string> {
  const created = await post("/api/v1/matters", {
    title,
    status: "open",
    responsibleMemberId: ownerUserId,
  });
  const matterId = (await readJson<{ matterId: string }>(created)).matterId;
  await firmDatabase
    .prepare(
      "INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, 'client', ?4, ?4)",
    )
    .bind(newIdentifier("matterParty"), matterId, clientEntityId, clock.now())
    .run();
  return matterId;
}

async function depositInto(matterId: string, amountMinor: number) {
  const response = await post("/api/v1/trust/deposits", {
    trustAccountId,
    matterId,
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
  return await readJson<{ ledgerEntryId: string }>(response);
}

describe("trust reconciliation routes", () => {
  it("records a statement, matches a line by hand, and freezes a balanced proof", async () => {
    const matterId = await openMatter("Reconciliation Matter", "entity_webb");
    const deposit = await depositInto(matterId, 500000);

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
    const proof = (await readJson<{ proof: { balanced: boolean } }>(detail)).proof;
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

  // The URL asserts a containment, so the handler checks it. Without that the first path segment is
  // decoration: any reconciliation identifier withdraws the named match and answers 201, which is
  // how a client-side mix-up becomes a withdrawal against the wrong period.
  it("refuses a match withdrawal routed through a reconciliation the match does not belong to", async () => {
    const matterId = await openMatter("Withdrawal Path Matter", "entity_path");
    const deposit = await depositInto(matterId, 200000);
    const recorded = await post("/api/v1/trust/bank-statements", {
      trustAccountId,
      ...PERIOD(),
      openingBalanceMinor: 0,
      closingBalanceMinor: 200000,
      currency: "USD",
      statementReference: "STMT-PATH",
      lines: [
        {
          postedOn: todayInUtc(),
          direction: "deposit",
          amountMinor: 200000,
          description: "DEPOSIT CHECK 9001",
          reference: "9001",
        },
      ],
    });
    const { trustBankStatementId } = (await recorded.json()) as { trustBankStatementId: string };
    const opened = await post("/api/v1/trust/reconciliations", {
      statementId: trustBankStatementId,
    });
    const { trustReconciliationId } = (await opened.json()) as { trustReconciliationId: string };
    const lines = await get(`/api/v1/trust/bank-statements/${trustBankStatementId}/lines`);
    const { lines: statementLines } = (await lines.json()) as { lines: readonly { id: string }[] };
    const matched = await post(`/api/v1/trust/reconciliations/${trustReconciliationId}/matches`, {
      statementLineId: statementLines[0]?.id,
      ledgerEntryId: deposit.ledgerEntryId,
    });
    expect(matched.status).toBe(201);
    const { trustReconciliationMatchId } = (await matched.json()) as {
      trustReconciliationMatchId: string;
    };

    const wrongPath = await post(
      `/api/v1/trust/reconciliations/${newIdentifier("trustReconciliation")}/matches/${trustReconciliationMatchId}/withdrawal`,
      undefined,
    );
    expect(wrongPath.status).toBe(422);
    expect((await readJson<ProblemBody>(wrongPath)).type).toBe(
      "https://api.magnacarta.esq/problems/trust-reconciliation-refused",
    );

    // The right path still works, so the check is a containment test and not a new obstacle.
    const rightPath = await post(
      `/api/v1/trust/reconciliations/${trustReconciliationId}/matches/${trustReconciliationMatchId}/withdrawal`,
      undefined,
    );
    expect(rightPath.status).toBe(201);
  });

  it("closes an unbalanced period, naming the leg that disagrees", async () => {
    const matterId = await openMatter("Unbalanced Matter", "entity_shaw");
    await depositInto(matterId, 300000);

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
    const beforeCount = (await readJson<{ statements: unknown[] }>(before)).statements.length;

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
    expect((await readJson<{ statements: unknown[] }>(after)).statements.length).toBe(
      beforeCount + 1,
    );
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

// The record of what members asserted about a period, and what became of each assertion. The
// suggestion surface answers what is still unaccounted for; this one answers who said what.
describe("the matches recorded on a reconciliation", () => {
  interface MatchRow {
    id: string;
    statementLineId: string;
    ledgerEntryId: string;
    recordedBy: string;
    recordedAt: string;
    withdrawnBy: string | null;
    withdrawnAt: string | null;
    line: { id: string; amountMinor: number; description: string };
    item: { ledgerEntryId: string; bankDeltaMinor: number; movementKind: string | null };
  }

  const matchesOf = async (reconciliationId: string): Promise<MatchRow[]> => {
    const response = await get(`/api/v1/trust/reconciliations/${reconciliationId}/matches`);
    expect(response.status).toBe(200);
    return (await readJson<{ matches: MatchRow[] }>(response)).matches;
  };

  it("lists a recorded match with the line and the item it pairs, then what withdrew it", async () => {
    const matterId = await openMatter("Match Record Matter", "entity_record");
    const deposit = await depositInto(matterId, 175000);

    const recorded = await post("/api/v1/trust/bank-statements", {
      trustAccountId,
      ...PERIOD(),
      openingBalanceMinor: 0,
      closingBalanceMinor: 175000,
      currency: "USD",
      statementReference: "STMT-MATCHES",
      lines: [
        {
          postedOn: todayInUtc(),
          direction: "deposit",
          amountMinor: 175000,
          description: "DEPOSIT CHECK 1041",
          reference: "1041",
          counterpartyName: "Webb Holdings",
        },
      ],
    });
    const { trustBankStatementId } = (await recorded.json()) as { trustBankStatementId: string };
    const opened = await post("/api/v1/trust/reconciliations", {
      statementId: trustBankStatementId,
    });
    const { trustReconciliationId } = (await opened.json()) as { trustReconciliationId: string };

    // Nothing has been asserted yet, so there is nothing on the record.
    expect(await matchesOf(trustReconciliationId)).toEqual([]);

    const lines = await get(`/api/v1/trust/bank-statements/${trustBankStatementId}/lines`);
    const { lines: statementLines } = (await lines.json()) as { lines: { id: string }[] };
    const statementLineId = statementLines[0]?.id;
    const matched = await post(`/api/v1/trust/reconciliations/${trustReconciliationId}/matches`, {
      statementLineId,
      ledgerEntryId: deposit.ledgerEntryId,
    });
    expect(matched.status).toBe(201);
    const { trustReconciliationMatchId } = (await matched.json()) as {
      trustReconciliationMatchId: string;
    };

    const standing = await matchesOf(trustReconciliationId);
    expect(standing).toHaveLength(1);
    const match = standing[0];
    expect(match).toMatchObject({
      id: trustReconciliationMatchId,
      statementLineId,
      // The book side is a ledger entry rather than a movement, which is what lets an earned-fee
      // transfer out of trust — which records no movement at all — be matched like anything else.
      ledgerEntryId: deposit.ledgerEntryId,
      recordedBy: ownerUserId,
      withdrawnBy: null,
      withdrawnAt: null,
    });
    // Both ends are served beside the assertion, so a reader sees the two rows somebody said were
    // the same event rather than two identifiers to go and look up.
    expect(match?.line).toMatchObject({
      id: statementLineId,
      amountMinor: 175000,
      description: "DEPOSIT CHECK 1041",
    });
    expect(match?.item).toMatchObject({
      ledgerEntryId: deposit.ledgerEntryId,
      // Signed from the account holder's side: the deposit put money into the bank account.
      bankDeltaMinor: 175000,
      movementKind: "deposit",
    });
    expect(match?.recordedAt).not.toBe("");

    const withdrawn = await post(
      `/api/v1/trust/reconciliations/${trustReconciliationId}/matches/${trustReconciliationMatchId}/withdrawal`,
      undefined,
    );
    expect(withdrawn.status).toBe(201);

    // The assertion stays on the record and says who took it back. The withdrawal is a row of its
    // own in the table and is deliberately not listed as a second match.
    const afterWithdrawal = await matchesOf(trustReconciliationId);
    expect(afterWithdrawal).toHaveLength(1);
    expect(afterWithdrawal[0]).toMatchObject({
      id: trustReconciliationMatchId,
      recordedBy: ownerUserId,
      withdrawnBy: ownerUserId,
    });
    expect(afterWithdrawal[0]?.withdrawnAt).toEqual(expect.any(String));
  });

  it("answers a reconciliation the firm does not have with 404", async () => {
    const response = await get(
      `/api/v1/trust/reconciliations/${newIdentifier("trustReconciliation")}/matches`,
    );
    expect(response.status).toBe(404);
    expect((await readJson<ProblemBody>(response)).type).toBe(
      "https://api.magnacarta.esq/problems/not-found",
    );
  });

  it("refuses the read to a member without the trust capability", async () => {
    const response = await get(
      `/api/v1/trust/reconciliations/${newIdentifier("trustReconciliation")}/matches`,
      noTrustCookie,
    );
    expect(response.status).toBe(403);
  });
});
