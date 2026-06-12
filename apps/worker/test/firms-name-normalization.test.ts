import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// Firm-name normalization at the route boundary (slice 0·4 hardening). The provisioner's resume
// identity is the byte-exact UNIQUE firm.name (WHERE name = ?1), so the route canonicalizes the
// name (trim + Unicode NFC) before the provisioner sees it — otherwise 'Acme Legal ' or an NFD
// variant of an existing name misses the row, inserts a SECOND provisioning firm, and claims a
// second dev-pool database.
//
// Storage is SHARED across this file's tests (and isolated from other files): the suite provisions
// ONE firm under the NFC name, then re-invokes it through every variant.

const CANONICAL_NAME = "Café Légal"; // NFC: precomposed e-acute
const NFD_NAME = CANONICAL_NAME.normalize("NFD"); // decomposed: e + combining acute
const OWNER = { email: "cafe-legal-owner@example.com", name: "Cafe Owner" };

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

async function postFirms(body: unknown): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/firms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Platform-Admin-Key": env.PLATFORM_ADMIN_KEY,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

// One firm row under the canonical NFC name, one pool claim — re-asserted after every variant.
async function expectSingleCanonicalFirm(expectedFirmId: string): Promise<void> {
  const firms = await env.DB_CONTROL.prepare("SELECT id, name, database_identifier FROM firm").all<{
    id: string;
    name: string;
    database_identifier: string | null;
  }>();
  expect(firms.results).toEqual([
    { id: expectedFirmId, name: CANONICAL_NAME, database_identifier: "DB_FIRM_POOL_1" },
  ]);
}

let firmId: string;

describe("POST /api/v1/firms firm-name normalization", () => {
  it("provisions under the NFC-canonical name", async () => {
    expect(NFD_NAME).not.toBe(CANONICAL_NAME); // the variant really is a different byte sequence
    const response = await postFirms({ name: CANONICAL_NAME, owner: OWNER });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; name: string };
    firmId = body.id;
    expect(body.name).toBe(CANONICAL_NAME);
    await expectSingleCanonicalFirm(firmId);
  });

  it("a trailing-space variant under a NEW key answers the SAME firm — no second row, no second pool claim", async () => {
    const response = await postFirms({ name: `${CANONICAL_NAME} `, owner: OWNER });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; name: string };
    expect(body.id).toBe(firmId);
    expect(body.name).toBe(CANONICAL_NAME);
    await expectSingleCanonicalFirm(firmId);
  });

  it("an NFD variant under a NEW key answers the SAME firm — no second row, no second pool claim", async () => {
    const response = await postFirms({ name: NFD_NAME, owner: OWNER });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; name: string };
    expect(body.id).toBe(firmId);
    expect(body.name).toBe(CANONICAL_NAME);
    await expectSingleCanonicalFirm(firmId);
  });

  it("rejects a name that trims to empty", async () => {
    const response = await postFirms({ name: "   ", owner: OWNER });
    expect(response.status).toBe(400);
    await expectSingleCanonicalFirm(firmId); // nothing was provisioned by it
  });
});
