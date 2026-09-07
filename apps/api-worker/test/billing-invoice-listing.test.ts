import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

/*
 * THE INVOICE LISTING'S THREE SCOPES — GET /api/v1/billing/invoices.
 *
 * The one read serves the firm's own billing register, a client's bills, and the bills that charge
 * one matter, and the three have to agree about every row they share. Two of the three are new: the
 * matter narrowing (with each row carrying that matter's own share) and the client's name, both
 * registered as gaps by the matter Billing tab's screen design. Before them, a matter's register
 * listed the CLIENT's bills and then read every one of their details to work out this matter's
 * share of each — an N-plus-one that grew with the client's whole billing history.
 *
 * THE ROWS ARE SEEDED DIRECTLY rather than composed through draft-claim-finalize. What is under
 * test is the read: which invoices come back, in what order, and what each row carries. Standing up
 * the chart of accounts, the rate engine and the numbering sequence to reach the same rows would
 * make this suite about the write path, which billing-routes.test.ts already proves end to end.
 *
 * ITS OWN FIRM, for the rate limiter's sake — the default bucket is per principal, and the main
 * billing suite already sits close to its ceiling.
 */

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let pembertonMatterId: string;
let harlowMatterId: string;
let redwoodMatterId: string;

const clock = { now: () => new Date().toISOString() };
const ACME = "directoryOrganization_listing_acme";
const REDWOOD = "directoryOrganization_listing_redwood";

function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function openMatter(title: string): Promise<string> {
  const created = await SELF.fetch("https://example.com/api/v1/matters", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ title, status: "open", responsibleMemberId: ownerUserId }),
  });
  return ((await created.json()) as { matterId: string }).matterId;
}

async function seedOrganization(id: string, displayName: string): Promise<void> {
  await firmDatabase
    .prepare(
      "INSERT INTO directory_organization (id, legal_name, display_name, status, created_at, updated_at) VALUES (?1, ?2, ?2, 'active', ?3, ?3)",
    )
    .bind(id, displayName, clock.now())
    .run();
}

/**
 * One seeded bill. `createdAt` is explicit because the listing's order — and its cursor — are the
 * (created_at, id) pair, and a seed that let three rows share a millisecond would be asserting
 * against an order the statement never promised.
 */
async function seedInvoice(options: {
  readonly clientEntityId: string;
  readonly status: "draft" | "final";
  readonly createdAt: string;
  readonly lines: readonly { readonly matterId: string; readonly amountMinor: number }[];
  /** Written only for a finalized bill: a balance row is created at finalization, never before. */
  readonly balances?: readonly {
    readonly matterId: string;
    readonly totalMinor: number;
    readonly appliedMinor: number;
  }[];
  readonly invoiceNumber?: string;
}): Promise<string> {
  const invoiceId = newIdentifier("invoice");
  const final = options.status === "final";
  await firmDatabase
    .prepare(
      `INSERT INTO invoice (id, client_entity_id, currency, status, invoice_number, number_scope_key,
                            number_drawn_value, issue_date, due_date, finalized_at, created_at, updated_at)
       VALUES (?1, ?2, 'USD', ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?9)`,
    )
    .bind(
      invoiceId,
      options.clientEntityId,
      options.status,
      final ? (options.invoiceNumber ?? null) : null,
      final ? "default" : null,
      final ? 1 : null,
      final ? "2026-06-01" : null,
      final ? clock.now() : null,
      options.createdAt,
    )
    .run();

  let lineIndex = 0;
  for (const line of options.lines) {
    await firmDatabase
      .prepare(
        `INSERT INTO invoice_line (id, invoice_id, line_index, matter_id, kind, description, amount_minor, currency, created_at)
         VALUES (?1, ?2, ?3, ?4, 'fee', 'Professional services', ?5, 'USD', ?6)`,
      )
      .bind(
        newIdentifier("invoiceLine"),
        invoiceId,
        lineIndex,
        line.matterId,
        line.amountMinor,
        options.createdAt,
      )
      .run();
    lineIndex += 1;
  }

  for (const balance of options.balances ?? []) {
    await firmDatabase
      .prepare(
        `INSERT INTO invoice_matter_balance (invoice_id, matter_id, total_minor, applied_minor, currency, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'USD', ?5, ?5)`,
      )
      .bind(
        invoiceId,
        balance.matterId,
        balance.totalMinor,
        balance.appliedMinor,
        options.createdAt,
      )
      .run();
  }
  return invoiceId;
}

let acmeSplitBillId: string;
let acmeDraftId: string;
let redwoodBillId: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Invoice Listing Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);

  const owner = await seedCredentialedUser("invoice-listing-owner@example.com", {
    userName: "Listing Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Listing Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("invoice-listing-owner@example.com");
  await insertMemberStatement(firmDatabase, {
    userId: ownerUserId,
    displayName: "Listing Owner",
    now: clock.now(),
  }).run();

  // A matter is refused without one: the number is drawn at creation from the firm's own scheme.
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
        { kind: "literal", text: "IL-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });

  await seedOrganization(ACME, "Acme Industries");
  await seedOrganization(REDWOOD, "Redwood Holdings");

  pembertonMatterId = await openMatter("Pemberton Estate");
  harlowMatterId = await openMatter("Harlow Acquisition");
  redwoodMatterId = await openMatter("Redwood Zoning");

  // One finalized bill charging TWO of Acme's matters — the case the whole matter narrowing exists
  // for, because its total is true of the document and false of either matter.
  acmeSplitBillId = await seedInvoice({
    clientEntityId: ACME,
    status: "final",
    createdAt: "2026-06-01T09:00:00.000Z",
    invoiceNumber: "00101",
    lines: [
      { matterId: pembertonMatterId, amountMinor: 30_000 },
      { matterId: harlowMatterId, amountMinor: 70_000 },
    ],
    balances: [
      { matterId: pembertonMatterId, totalMinor: 30_000, appliedMinor: 10_000 },
      { matterId: harlowMatterId, totalMinor: 70_000, appliedMinor: 0 },
    ],
  });

  // A draft on one of them: no balance row exists yet, which is exactly what makes filtering on the
  // balance table wrong and filtering on the lines right.
  acmeDraftId = await seedInvoice({
    clientEntityId: ACME,
    status: "draft",
    createdAt: "2026-06-02T09:00:00.000Z",
    lines: [{ matterId: pembertonMatterId, amountMinor: 12_500 }],
  });

  // A second client entirely, so a firm-wide read has something a client-narrowed one must exclude.
  redwoodBillId = await seedInvoice({
    clientEntityId: REDWOOD,
    status: "final",
    createdAt: "2026-06-03T09:00:00.000Z",
    invoiceNumber: "00102",
    lines: [{ matterId: redwoodMatterId, amountMinor: 45_000 }],
    balances: [{ matterId: redwoodMatterId, totalMinor: 45_000, appliedMinor: 45_000 }],
  });
});

interface ListedInvoice {
  readonly id: string;
  readonly clientEntityId: string;
  readonly clientName: string | null;
  readonly status: string;
  readonly totalMinor: number;
  readonly unpaidMinor: number;
  readonly matterLinesMinor?: number;
  readonly matterTotalMinor?: number | null;
  readonly matterAppliedMinor?: number | null;
}

async function listed(response: Response): Promise<readonly ListedInvoice[]> {
  const body = (await response.json()) as { data: ListedInvoice[] };
  return body.data;
}

describe("the firm's whole register", () => {
  it("answers every client's bills, newest first, when nothing narrows it", async () => {
    const response = await get("/api/v1/billing/invoices");
    expect(response.status).toBe(200);
    const rows = await listed(response);
    expect(rows.map((row) => row.id)).toEqual([redwoodBillId, acmeDraftId, acmeSplitBillId]);
  });

  it("names each bill's client, so the register does not print an identifier", async () => {
    const rows = await listed(await get("/api/v1/billing/invoices"));
    expect(rows.find((row) => row.id === redwoodBillId)?.clientName).toBe("Redwood Holdings");
    expect(rows.find((row) => row.id === acmeDraftId)?.clientName).toBe("Acme Industries");
  });

  it("still narrows to one client", async () => {
    const rows = await listed(await get(`/api/v1/billing/invoices?clientEntityId=${ACME}`));
    expect(rows.map((row) => row.id)).toEqual([acmeDraftId, acmeSplitBillId]);
  });

  it("still narrows to one status", async () => {
    const rows = await listed(await get("/api/v1/billing/invoices?status=draft"));
    expect(rows.map((row) => row.id)).toEqual([acmeDraftId]);
  });
});

describe("one matter's share", () => {
  it("answers only the bills that charge the matter, drafts included", async () => {
    const rows = await listed(await get(`/api/v1/billing/invoices?matterId=${pembertonMatterId}`));
    expect(rows.map((row) => row.id)).toEqual([acmeDraftId, acmeSplitBillId]);
  });

  it("leaves out a bill that charges the client but not this matter", async () => {
    const rows = await listed(await get(`/api/v1/billing/invoices?matterId=${harlowMatterId}`));
    expect(rows.map((row) => row.id)).toEqual([acmeSplitBillId]);
  });

  it("carries the matter's own share, not the bill's total", async () => {
    const rows = await listed(await get(`/api/v1/billing/invoices?matterId=${pembertonMatterId}`));
    const split = rows.find((row) => row.id === acmeSplitBillId);
    // The document totals a thousand dollars across two matters; this matter's share is three
    // hundred of it, and a register that showed the total would misstate the matter's own account.
    expect(split?.totalMinor).toBe(100_000);
    expect(split?.matterLinesMinor).toBe(30_000);
    expect(split?.matterTotalMinor).toBe(30_000);
    expect(split?.matterAppliedMinor).toBe(10_000);
  });

  it("says a draft owes nothing yet with a null rather than a zero", async () => {
    const rows = await listed(await get(`/api/v1/billing/invoices?matterId=${pembertonMatterId}`));
    const draft = rows.find((row) => row.id === acmeDraftId);
    // The lines exist from the moment a claim composes one; the balance row does not exist until
    // finalization. Null is "not owed yet" and zero would read as "settled".
    expect(draft?.matterLinesMinor).toBe(12_500);
    expect(draft?.matterTotalMinor).toBeNull();
    expect(draft?.matterAppliedMinor).toBeNull();
  });

  it("leaves the matter figures off entirely when no matter was named", async () => {
    const rows = await listed(await get("/api/v1/billing/invoices"));
    const split = rows.find((row) => row.id === acmeSplitBillId);
    expect(split?.matterLinesMinor).toBeUndefined();
  });

  it("composes with the client and status narrowings rather than replacing them", async () => {
    const rows = await listed(
      await get(
        `/api/v1/billing/invoices?matterId=${pembertonMatterId}&clientEntityId=${ACME}&status=final`,
      ),
    );
    expect(rows.map((row) => row.id)).toEqual([acmeSplitBillId]);
  });
});
