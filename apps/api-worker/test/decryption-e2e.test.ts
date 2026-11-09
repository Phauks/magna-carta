import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import { runScheduledSweep } from "../src/background/scheduled.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  captureResetToken,
  liveCookie,
  PASSWORD,
  postJson,
  seedCredentialedUser,
  setCookies,
  signIn,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The same RC4-40 password-protected PDF (password: "test") used in decryption-route.test.ts.
// Embedded as base64 because workerd has no filesystem access.
// Source: crates/decryption-core/tests/fixtures/pdf_userpw_test.pdf (828 bytes)
const PDF_FIXTURE_BASE64 =
  "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDZlNDcxYmFjZTg+Cj4+CmVuZG9i" +
  "agoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5k" +
  "b2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAg" +
  "b2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAy" +
  "MDAgMjAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xl" +
  "bmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8YmFkYWQxZTg2NDQy" +
  "Njk5NDI3MTE2ZDNlNWQ1MjcxYmM4MGEyNzgxNGZjNWU4MGY4MTVlZmVlZjgzOTM1NGM1Zj4KL1Ug" +
  "PGYxMWFjZWIxZjVhMmY1Y2RmN2EzNmE0OGQwYmVhZTk3MjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2" +
  "ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAw" +
  "MTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAwMTE4IDAwMDAwIG4gCjAwMDAw" +
  "MDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jv" +
  "b3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDM1Mzk2MzMyMzA2MjYyNjE2NTYzMzgzMjY1MzE2" +
  "MjM1NjMzNjMzNjM2MTYyNjU2NjM1NjE2NjYxNjU2NjMxMzE+IDwzNTM5NjMzMjMwNjI2MjYxNjU2" +
  "MzM4MzI2NTMxNjIzNTYzMzYzMzYzNjE2MjY1NjYzNTYxNjY2MTY1NjYzMTMxPiBdCi9FbmNyeXB0" +
  "IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzYKJSVFT0YK";

// End-to-end capstone: a single sequential journey through the REAL HTTP surface (SELF fetch).
// A firm is provisioned, its owner activated and mirrored, then:
//   1. inspect returns format/hash/hashcatMode
//   2. unlock decrypts the same file and returns %PDF bytes
//   3. both audit rows exist; neither leaks the password value or decrypted content
//   4. a principal without tools:decryption gets 403 on both routes
//
// This test focuses on the combined provisioned-firm round-trip and cross-route coverage.
// Per-call 401/400/wrong-password/malformed-input cases live in decryption-route.test.ts.

interface ProvisionResponseBody {
  id: string;
  name: string;
  status: string;
  owner: { id: string; email: string; name: string };
}

const FIRM_INPUT = {
  name: "Decryption E2E Firm",
  owner: { email: "decryption-e2e-owner@example.com", name: "Decryption E2E Owner" },
};

let firm: ProvisionResponseBody;
let ownerCookie = "";
let unpermissionedCookie = "";
// Populated in the unlock step and used in the audit-redaction assertion.
let decryptedBase64Result = "";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);

  // Provision the firm through the real HTTP surface — the provisioner applies per-firm migrations,
  // so this test does NOT call applyPerFirmMigrations separately.
  const provisionResponse = await SELF.fetch("https://example.com/api/v1/firms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Platform-Admin-Key": env.PLATFORM_ADMIN_KEY,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(FIRM_INPUT),
  });
  expect(provisionResponse.status).toBe(201);
  firm = (await provisionResponse.json()) as ProvisionResponseBody;
  expect(firm.status).toBe("active");

  // Mirror the owner into the per-firm member table before the sign-in flow runs.
  const sweepReport = await runScheduledSweep(env);
  expect(sweepReport.controlPlane.failed).toBe(0);

  // Activate the owner through the reset-password flow (Path A every invited owner travels).
  const { token } = await captureResetToken(FIRM_INPUT.owner.email);
  expect(
    (await postJson("/api/auth/reset-password", { newPassword: PASSWORD, token })).status,
  ).toBe(200);
  const signInResponse = await signIn(FIRM_INPUT.owner.email);
  ownerCookie = liveCookie(setCookies(signInResponse), "session_token")?.pair ?? "";
  expect(ownerCookie).not.toBe("");

  // Seed a principal who IS a firm member (has a member row and a role assignment) but whose role
  // does NOT include tools:decryption. All five default roles seeded by migration 0035 carry the
  // permission, so this test creates a custom role with no permissions and mirrors the user with
  // that role — the chokepoint finds a member row + role but no tools:decryption grant → 403.
  // This exercises the PERMISSION gate, not just the membership gate (no member row at all).
  const firmId = assertIdentifier(firm.id, "firm");
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const { userId: nopermUserId } = await seedCredentialedUser("decryption-e2e-noperm@example.com", {
    userName: "No Decryption Permission",
    firmId,
  });
  const nopermRoleId = "role_E2ENoDecryptionAccess0";
  await firmDatabase
    .prepare("INSERT INTO role (id, name, created_at) VALUES (?1, ?2, ?3)")
    .bind(nopermRoleId, "E2E No Decryption", new Date().toISOString())
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(nopermUserId, "No Decryption Permission", "active", new Date().toISOString())
    .run();
  await firmDatabase
    .prepare("INSERT INTO member_role (id, member_user_id, role_id) VALUES (?1, ?2, ?3)")
    .bind("memberRole_E2ENoDecryptAccess1", nopermUserId, nopermRoleId)
    .run();
  unpermissionedCookie = await signInForSessionCookie("decryption-e2e-noperm@example.com");
  expect(unpermissionedCookie).not.toBe("");
});

// Sends an authenticated POST as the provisioned firm owner.
async function ownerPost(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
    },
    body: JSON.stringify(body),
  });
}

// Sends an authenticated POST as the principal without tools:decryption.
async function unpermissionedPost(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: unpermissionedCookie,
    },
    body: JSON.stringify(body),
  });
}

// The steps run in sequence and share module-level state — matching the timekeeping and
// auth-provisioning e2e patterns. A failure in step 1 surfaces immediately; the later steps
// are informative failures, not independent failures.
describe("decryption end-to-end: provisioned firm → inspect → unlock → audit", () => {
  it("inspect: returns format, hash, and hashcatMode for the encrypted PDF fixture (200)", async () => {
    const response = await ownerPost("/api/v1/decryption/inspect", {
      fileBase64: PDF_FIXTURE_BASE64,
      attestation: { authorized: true },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { format: string; hash: string; hashcatMode: number };
    expect(body.format).toBe("pdf");
    expect(body.hash).toMatch(/^\$pdf\$/);
    expect(typeof body.hashcatMode).toBe("number");
  });

  it("unlock: decrypts the fixture with password 'test' and returns bytes starting with %PDF (200)", async () => {
    const response = await ownerPost("/api/v1/decryption/unlock", {
      fileBase64: PDF_FIXTURE_BASE64,
      password: "test",
      attestation: { authorized: true },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { decryptedBase64: string; filenameHint?: string };
    decryptedBase64Result = body.decryptedBase64;

    // PDF magic bytes: 0x25 ('%'), 0x50 ('P'), 0x44 ('D'), 0x46 ('F').
    const bytes = Uint8Array.from(atob(decryptedBase64Result), (ch) => ch.charCodeAt(0));
    expect(bytes[0]).toBe(0x25);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x44);
    expect(bytes[3]).toBe(0x46);
  });

  it("audit: exactly one row per call written; neither row leaks the password or decrypted content", async () => {
    // After the sequential inspect + unlock calls, the firm database must have exactly one row
    // per event — the combined cross-route count that only this e2e can assert.
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, assertIdentifier(firm.id, "firm"));
    const inspectedCount = await firmDatabase
      .prepare("SELECT COUNT(*) AS count FROM audit_log WHERE event = 'decryption.inspected'")
      .first<{ count: number }>();
    expect(inspectedCount?.count).toBe(1);

    const unlockedCount = await firmDatabase
      .prepare("SELECT COUNT(*) AS count FROM audit_log WHERE event = 'decryption.unlocked'")
      .first<{ count: number }>();
    expect(unlockedCount?.count).toBe(1);

    // Pull the metadata text from both rows for redaction checks.
    const allRows = await firmDatabase
      .prepare(
        "SELECT event, metadata FROM audit_log WHERE event IN ('decryption.inspected', 'decryption.unlocked')",
      )
      .all<{ event: string; metadata: string }>();
    expect(allRows.results).toHaveLength(2);

    const combined = allRows.results.map((row) => row.metadata).join("\n");

    // The JSON key "password" must never appear in either row — if the handler had logged the
    // password field, the key would be present in the serialised metadata.
    expect(combined).not.toContain('"password"');
    // The password VALUE itself must also be absent as a JSON string literal — a leak under a
    // differently-named key would survive the key check above but is caught here. Checking the
    // quoted form '"test"' avoids a false-positive match inside the "attestation" key name.
    expect(combined).not.toContain('"test"');

    // No decrypted content must appear. Guard with a fail-loud length assertion so that a
    // zero-length or truncated unlock result cannot silently skip the prefix check below.
    expect(decryptedBase64Result.length).toBeGreaterThanOrEqual(20);
    // A meaningful prefix of the decrypted base64 is unique enough to rule out accidental
    // persistence of the plaintext bytes.
    expect(combined).not.toContain(decryptedBase64Result.slice(0, 20));

    // Each row must carry its expected outcome without leaking content.
    const inspectedRow = allRows.results.find((row) => row.event === "decryption.inspected");
    expect(inspectedRow?.metadata).toContain('"outcome":"extracted"');
    expect(inspectedRow?.metadata).toContain("fileSha256");

    const unlockedRow = allRows.results.find((row) => row.event === "decryption.unlocked");
    expect(unlockedRow?.metadata).toContain('"outcome":"decrypted"');
    expect(unlockedRow?.metadata).toContain("fileSha256");
  });

  it("403 for a firm member whose role lacks tools:decryption — permission gate enforced on both routes", async () => {
    const inspectResponse = await unpermissionedPost("/api/v1/decryption/inspect", {
      fileBase64: PDF_FIXTURE_BASE64,
      attestation: { authorized: true },
    });
    expect(inspectResponse.status).toBe(403);
    expect(inspectResponse.headers.get("content-type")).toContain("application/problem+json");

    const unlockResponse = await unpermissionedPost("/api/v1/decryption/unlock", {
      fileBase64: PDF_FIXTURE_BASE64,
      password: "test",
      attestation: { authorized: true },
    });
    expect(unlockResponse.status).toBe(403);
    expect(unlockResponse.headers.get("content-type")).toContain("application/problem+json");
  });
});
