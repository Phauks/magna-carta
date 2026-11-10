import { todayInUtc } from "@magna-carta/civil-time/civil-date";
import { zonedReading } from "@magna-carta/civil-time/time-zone";
import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, LocationId, UserId } from "@magna-carta/identifiers/types";
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

// Opening a trust account over HTTP. What is proved here is the wiring the domain suite cannot
// reach: that the chokepoint gates the route on trust:manage, that the jurisdiction on the opened
// account is the HOLDING OFFICE'S rather than anything the caller could state, that a retried open
// returns the first account instead of opening a second, and that an office with no jurisdiction
// recorded opens an account that refuses money until the office records one.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let noTrustCookie: string;
let nevadaLocationId: LocationId;
let unstatedLocationId: LocationId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString(), today: () => todayInUtc() };

interface TrustAccountRow {
  id: string;
  name: string;
  locationId: string;
  jurisdiction: string | null;
  bankName: string | null;
  accountNumberLastFour: string | null;
  currency: string;
  iolta: boolean;
  status: string;
  openedOn: string;
  closedAt: string | null;
  timeZone: string;
}

async function seedOffice(
  name: string,
  jurisdiction: string | null,
  timeZone: string | null,
): Promise<LocationId> {
  const locationId = newIdentifier("location") as LocationId;
  await firmDatabase
    .prepare(
      "INSERT INTO location (id, name, status, jurisdiction, time_zone, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?4, ?5, ?5)",
    )
    .bind(locationId, name, jurisdiction, timeZone, clock.now())
    .run();
  return locationId;
}

// The matter's client party, recorded straight into the firm database because there is no HTTP
// surface for it yet. A trust ledger's client attribution is derived from this link, so a matter
// without one holds no client money at all.
async function openMatterWithClient(title: string, clientEntityId: string): Promise<string> {
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

const openingBody = (locationId: LocationId, name: string) => ({
  name,
  locationId,
  bankName: "Nevada State Bank",
  accountNumberLastFour: "4417",
  openedOn: "2026-08-01",
  currency: "USD" as const,
});

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Trust Account Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("trust-account-owner@example.com", {
    userName: "Trust Account Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Trust Account Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("trust-account-owner@example.com");

  // A member with no trust capability at all — the chokepoint must refuse the open outright.
  const noTrust = await seedCredentialedUser("trust-account-none@example.com", {
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
  noTrustCookie = await signInForSessionCookie("trust-account-none@example.com");

  // A matter draws its number when it opens, so the firm needs a scheme before any matter exists.
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
        { kind: "literal", text: "TRA-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });

  nevadaLocationId = await seedOffice("Reno", "US-NV", "America/Los_Angeles");
  unstatedLocationId = await seedOffice("Unstated", null, null);
});

describe("opening a trust account", () => {
  it("takes the jurisdiction from the office, opens pooled interest-bearing, and lists the account back", async () => {
    const response = await post(
      "/api/v1/trust/accounts",
      openingBody(nevadaLocationId, "IOLTA — Reno"),
    );
    expect(response.status).toBe(201);
    const account = await readJson<TrustAccountRow>(response);
    expect(account.id).toMatch(/^trustAccount_/);
    expect(account.name).toBe("IOLTA — Reno");
    expect(account.locationId).toBe(nevadaLocationId);
    // The office's own state, and nothing the caller could have stated: there is no field for it.
    expect(account.jurisdiction).toBe("US-NV");
    expect(account.status).toBe("open");
    // Absent from the request, so pooled interest-bearing — what an ordinary client trust account is.
    expect(account.iolta).toBe(true);
    expect(account.bankName).toBe("Nevada State Bank");
    expect(account.accountNumberLastFour).toBe("4417");
    expect(account.currency).toBe("USD");
    expect(account.openedOn).toBe("2026-08-01");
    expect(account.closedAt).toBeNull();
    // Resolved through the platform's one resolver, so a report asked "as at the end of a day"
    // resolves that day in the office's own zone.
    expect(account.timeZone).toBe("America/Los_Angeles");

    const listed = await get("/api/v1/trust/accounts");
    expect(listed.status).toBe(200);
    const page = await readJson<{ data: TrustAccountRow[] }>(listed);
    expect(page.data.find((row) => row.id === account.id)).toEqual(account);
  });

  it("replays a repeated Idempotency-Key instead of opening a second account", async () => {
    const key = crypto.randomUUID();
    const body = openingBody(nevadaLocationId, "IOLTA — Replay");

    const first = await post("/api/v1/trust/accounts", body, ownerCookie, key);
    expect(first.status).toBe(201);
    const second = await post("/api/v1/trust/accounts", body, ownerCookie, key);
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await second.json()).toEqual(await first.json());

    const page = await readJson<{ data: TrustAccountRow[] }>(await get("/api/v1/trust/accounts"));
    expect(page.data.filter((row) => row.name === "IOLTA — Replay")).toHaveLength(1);
  });

  it("answers an office the firm does not have with 404", async () => {
    const response = await post(
      "/api/v1/trust/accounts",
      openingBody(newIdentifier("location") as LocationId, "IOLTA — Nowhere"),
    );
    expect(response.status).toBe(404);
    expect((await readJson<ProblemBody>(response)).type).toBe(
      "https://api.magnacarta.esq/problems/not-found",
    );
  });

  it("refuses the open to a member without the trust capability", async () => {
    const response = await post(
      "/api/v1/trust/accounts",
      openingBody(nevadaLocationId, "IOLTA — Denied"),
      noTrustCookie,
    );
    expect(response.status).toBe(403);
  });

  // An office that has recorded no state still gets an account, and the account says so rather than
  // inventing a jurisdiction. What it cannot do is hold money: every movement refuses until the
  // office records its state, which is the honest answer and is fixed by a person, not a retry.
  it("opens an account for an office with no jurisdiction, and that account takes no money", async () => {
    const opened = await post(
      "/api/v1/trust/accounts",
      openingBody(unstatedLocationId, "IOLTA — Unstated"),
    );
    expect(opened.status).toBe(201);
    const account = await readJson<TrustAccountRow>(opened);
    expect(account.jurisdiction).toBeNull();
    expect(account.status).toBe("open");
    // No zone recorded either, so the platform's normalized zone rather than nothing.
    expect(account.timeZone).toBe("UTC");

    const matterId = await openMatterWithClient("Unstated Office Matter", "entity_unstated");
    const refused = await post("/api/v1/trust/deposits", {
      trustAccountId: account.id,
      matterId,
      amountMinor: 100000,
      currency: "USD",
      effectiveDate: todayInUtc(),
      description: "Retainer received",
      method: "check",
      reference: "3310",
      source: "Unstated Holdings",
      purpose: "Advance on fees and costs",
    });
    expect(refused.status).toBe(422);
    expect((await readJson<ProblemBody>(refused)).type).toBe(
      "https://api.magnacarta.esq/problems/trust-jurisdiction-unavailable",
    );
  });
});

// An account's position over HTTP. What is proved here is that the figures come from the ledger's
// own dated rows rather than from anything stored: a fresh account reads as zeros, a deposit moves
// the book and the client legs together, and the firm's own cushion is reported beside the client
// total rather than inside it.
describe("a trust account's position", () => {
  interface PositionRow {
    trustAccountId: string;
    currency: string;
    asOfDate: string;
    bookBalanceMinor: number;
    clientLedgerTotalMinor: number;
    heldMinor: number;
    firmFundsMinor: number | null;
    matterLedgerCount: number;
    pendingRequestCount: number;
  }

  // The bank-charge carve-out is refused on a pooled interest-bearing account, so an account that is
  // to hold the firm's cushion is opened as a non-pooled one.
  async function openAccountForPosition(name: string): Promise<string> {
    const opened = await post("/api/v1/trust/accounts", {
      ...openingBody(nevadaLocationId, name),
      iolta: false,
    });
    expect(opened.status).toBe(201);
    return (await readJson<TrustAccountRow>(opened)).id;
  }

  // The position is read as of the HOLDING OFFICE'S day, so money moved in these tests is dated on that
  // day too. Dated today in UTC instead, it lands a day ahead of the office from midnight until the
  // office's own midnight, and the position rightly leaves money dated tomorrow out of today's figure.
  const todayAtTheHoldingOffice = (): string =>
    zonedReading(Date.now(), "America/Los_Angeles").civilDate;

  const positionOf = async (accountId: string): Promise<PositionRow> => {
    const response = await get(`/api/v1/trust/accounts/${accountId}/position`);
    expect(response.status).toBe(200);
    return await readJson<PositionRow>(response);
  };

  it("reads a fresh account as zeros, with no cushion rather than an empty one", async () => {
    const accountId = await openAccountForPosition("IOLTA — Fresh Position");
    const position = await positionOf(accountId);
    expect(position).toEqual({
      trustAccountId: accountId,
      currency: "USD",
      // The day in the HOLDING OFFICE'S zone, which is what makes the figure right for a firm that
      // is not where the server is.
      asOfDate: zonedReading(Date.now(), "America/Los_Angeles").civilDate,
      bookBalanceMinor: 0,
      clientLedgerTotalMinor: 0,
      heldMinor: 0,
      // Null, not zero: the carve-out was never opened on this account, and a zero would say the
      // firm keeps money there and has spent it.
      firmFundsMinor: null,
      matterLedgerCount: 0,
      pendingRequestCount: 0,
    });
  });

  it("moves the book and the client legs together on a deposit, and counts the ledger", async () => {
    const accountId = await openAccountForPosition("IOLTA — Deposit Position");
    const matterId = await openMatterWithClient("Position Matter", "entity_position");
    const deposited = await post("/api/v1/trust/deposits", {
      trustAccountId: accountId,
      matterId,
      amountMinor: 250000,
      currency: "USD",
      effectiveDate: todayAtTheHoldingOffice(),
      description: "Retainer received",
      method: "check",
      reference: "7781",
      source: "Position Holdings",
      purpose: "Advance on fees and costs",
    });
    expect(deposited.status).toBe(201);

    const position = await positionOf(accountId);
    // Book and client agree by construction while the composition guard holds; this is that
    // identity read back over HTTP.
    expect(position.bookBalanceMinor).toBe(250000);
    expect(position.clientLedgerTotalMinor).toBe(250000);
    expect(position.matterLedgerCount).toBe(1);
    expect(position.heldMinor).toBe(0);
    expect(position.firmFundsMinor).toBeNull();
  });

  it("reports the firm's cushion as its own figure, leaving the client total alone", async () => {
    const accountId = await openAccountForPosition("IOLTA — Cushion Position");
    const matterId = await openMatterWithClient("Cushion Position Matter", "entity_cushion");
    expect(
      (
        await post("/api/v1/trust/deposits", {
          trustAccountId: accountId,
          matterId,
          amountMinor: 400000,
          currency: "USD",
          effectiveDate: todayAtTheHoldingOffice(),
          description: "Retainer received",
          method: "check",
          reference: "7782",
          source: "Cushion Holdings",
          purpose: "Advance on fees and costs",
        })
      ).status,
    ).toBe(201);

    expect(
      (
        await post("/api/v1/trust/firm-funds", {
          trustAccountId: accountId,
          nodeName: "Trust — bank charges",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post("/api/v1/trust/firm-funds/deposits", {
          trustAccountId: accountId,
          amountMinor: 15000,
          currency: "USD",
          effectiveDate: todayAtTheHoldingOffice(),
          description: "Cushion for service charges",
          method: "electronic_transfer",
        })
      ).status,
    ).toBe(201);

    const position = await positionOf(accountId);
    expect(position.firmFundsMinor).toBe(15000);
    // The client leg is what the firm owes other people, and the firm's own money is not that.
    expect(position.clientLedgerTotalMinor).toBe(400000);
    // The book holds everything in the bank account, which is both of them.
    expect(position.bookBalanceMinor).toBe(415000);
  });

  it("counts a request nobody has decided, and the queue names the matter it would leave", async () => {
    // A SECOND member holding the trust capability, so the lone-trust-manager exception does not
    // apply: in a firm with one trust manager that member authorizes their own payment, and there
    // would be nothing pending to count. The member never signs in — what matters is that the
    // firm has somebody else who could approve.
    const secondManagerId = newIdentifier("user") as UserId;
    await insertMemberStatement(firmDatabase, {
      userId: secondManagerId,
      displayName: "Second Trust Manager",
      now: clock.now(),
    }).run();
    await firmDatabase
      .prepare(
        "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, 'trust:manage', ?2, NULL, ?3)",
      )
      .bind(newIdentifier("grant"), secondManagerId, clock.now())
      .run();

    // A posture that requires a second person is what leaves a request pending at all: with the
    // shipped default the owner releases their own proposal in the same write.
    const posture = await SELF.fetch("https://example.com/api/v1/trust/authorization-policy", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: ownerCookie,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ policy: "always", requireAuthorizedApprover: false }),
    });
    expect(posture.status).toBe(201);

    const accountId = await openAccountForPosition("IOLTA — Queue Position");
    const matterId = await openMatterWithClient("Queued Payment Matter", "entity_queued");
    expect(
      (
        await post("/api/v1/trust/deposits", {
          trustAccountId: accountId,
          matterId,
          amountMinor: 300000,
          currency: "USD",
          effectiveDate: todayAtTheHoldingOffice(),
          description: "Retainer received",
          method: "check",
          reference: "7783",
          source: "Queued Holdings",
          purpose: "Advance on fees and costs",
        })
      ).status,
    ).toBe(201);

    const proposed = await post("/api/v1/trust/disbursement-requests", {
      trustAccountId: accountId,
      matterId,
      amountMinor: 90000,
      currency: "USD",
      effectiveDate: todayAtTheHoldingOffice(),
      description: "Filing fee",
      method: "check",
      reference: "2207",
      payee: "Second Judicial District Court",
      purpose: "Complaint filing fee",
    });
    expect(proposed.status).toBe(201);
    const { trustDisbursementRequestId, status } = await readJson<{
      trustDisbursementRequestId: string;
      status: string;
    }>(proposed);
    expect(status).toBe("pending");

    expect((await positionOf(accountId)).pendingRequestCount).toBe(1);

    // The matter as the firm recorded it, read straight off the row: an approver looking at a payee
    // and an amount cannot otherwise tell whose money is being paid out.
    const { results } = await firmDatabase
      .prepare("SELECT matter_number, title FROM matter WHERE id = ?1")
      .bind(matterId)
      .all<{ matter_number: string | null; title: string }>();
    const matterRow = results[0];

    const queued = await get(`/api/v1/trust/disbursement-requests?trustAccountId=${accountId}`);
    expect(queued.status).toBe(200);
    const queue = await readJson<{
      requests: {
        id: string;
        matterId: string | null;
        matterNumber: string | null;
        matterTitle: string | null;
      }[];
    }>(queued);
    expect(queue.requests).toContainEqual(
      expect.objectContaining({
        id: trustDisbursementRequestId,
        matterId,
        matterNumber: matterRow?.matter_number,
        matterTitle: matterRow?.title,
      }),
    );
  });
});
