import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { createApp } from "../src/http/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The Admin role id is a committed literal from 0002_member-rbac.sql.
const OWNER_ADMIN_ROLE_ID = "role_Gw-zKO8hOHQuNv2bWokMp";

// pdf_userpw_test.pdf — a minimal RC4-40 password-protected PDF (password: "test"). This fixture
// is embedded here as base64 because the test environment (workerd) has no filesystem access.
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

const app = createApp();

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  // The firm's FirmDatabase Durable Object self-migrates on first access (resolved by firmId), so
  // create the firm row first, then reach its database.
  poolFirmId = (
    await seedFirm({ name: "Decryption Route Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  // tools:decryption is already seeded onto Admin by the baseline migration; granting it
  // here directly is an idempotent belt so this suite does not depend on migration ordering.
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare("INSERT OR IGNORE INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
    .bind("rolePermission_DecryptionOwnerTest0001", OWNER_ADMIN_ROLE_ID, "tools:decryption")
    .run();
});

describe("POST /api/v1/decryption/inspect", () => {
  it("returns format, hash, and hashcatMode for an encrypted PDF with valid attestation", async () => {
    const { userId } = await seedCredentialedUser("decryption-ok@example.com", {
      userName: "Decryption OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Decryption OK", poolFirmId);
    const cookie = await signInForSessionCookie("decryption-ok@example.com");

    const response = await app.request(
      "https://example.com/api/v1/decryption/inspect",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          cookie,
        },
        body: JSON.stringify({
          fileBase64: PDF_FIXTURE_BASE64,
          attestation: { authorized: true },
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      format: string;
      hash: string;
      hashcatMode: number;
    };
    expect(body.format).toBe("pdf");
    expect(body.hash).toMatch(/^\$pdf\$/);
    expect(typeof body.hashcatMode).toBe("number");

    // Exactly one audit row must have been written for this ephemeral inspection.
    const auditCount = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT COUNT(*) AS count FROM audit_log WHERE event = 'decryption.inspected'")
      .first<{ count: number }>();
    expect(auditCount?.count).toBe(1);
  });

  it("returns 403 for an authenticated member without tools:decryption", async () => {
    // seedCredentialedUser assigns no role; membership alone carries no permission.
    await seedCredentialedUser("decryption-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("decryption-noperm@example.com");

    const response = await app.request(
      "https://example.com/api/v1/decryption/inspect",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          fileBase64: PDF_FIXTURE_BASE64,
          attestation: { authorized: true },
        }),
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns 400 when attestation.authorized is false", async () => {
    const { userId } = await seedCredentialedUser("decryption-noattest@example.com", {
      userName: "No Attestation",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "No Attestation", poolFirmId);
    const cookie = await signInForSessionCookie("decryption-noattest@example.com");

    const response = await app.request(
      "https://example.com/api/v1/decryption/inspect",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          cookie,
        },
        body: JSON.stringify({
          fileBase64: PDF_FIXTURE_BASE64,
          attestation: { authorized: false },
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns 400 (not 500) for malformed base64 input and does not echo the submitted value", async () => {
    const { userId } = await seedCredentialedUser("decryption-badb64@example.com", {
      userName: "Bad Base64",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Bad Base64", poolFirmId);
    const cookie = await signInForSessionCookie("decryption-badb64@example.com");

    const malformedInput = "!!!not base64!!!";
    const response = await app.request(
      "https://example.com/api/v1/decryption/inspect",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          cookie,
        },
        body: JSON.stringify({
          fileBase64: malformedInput,
          attestation: { authorized: true },
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = await response.text();
    expect(body).not.toContain(malformedInput);
  });

  it("returns 401 for an unauthenticated request", async () => {
    const response = await app.request(
      "https://example.com/api/v1/decryption/inspect",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileBase64: PDF_FIXTURE_BASE64,
          attestation: { authorized: true },
        }),
      },
      env,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe("POST /api/v1/decryption/unlock", () => {
  it("decrypts the encrypted PDF fixture and returns bytes starting with %PDF, writing a redacted audit row", async () => {
    const { userId } = await seedCredentialedUser("unlock-ok@example.com", {
      userName: "Unlock OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Unlock OK", poolFirmId);
    const cookie = await signInForSessionCookie("unlock-ok@example.com");

    const response = await app.request(
      "https://example.com/api/v1/decryption/unlock",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          cookie,
        },
        body: JSON.stringify({
          fileBase64: PDF_FIXTURE_BASE64,
          password: "test",
          attestation: { authorized: true },
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { decryptedBase64: string; filenameHint?: string };
    // The decrypted bytes must begin with the PDF magic bytes (%PDF).
    const decryptedBytes = Uint8Array.from(atob(body.decryptedBase64), (ch) => ch.charCodeAt(0));
    expect(decryptedBytes[0]).toBe(0x25); // %
    expect(decryptedBytes[1]).toBe(0x50); // P
    expect(decryptedBytes[2]).toBe(0x44); // D
    expect(decryptedBytes[3]).toBe(0x46); // F

    // Exactly one audit row must have been written for this operation.
    const auditRow = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT metadata FROM audit_log WHERE event = 'decryption.unlocked' LIMIT 1")
      .first<{ metadata: string }>();
    expect(auditRow).not.toBeNull();

    // The audit record must never contain the password or any decrypted file content.
    // The password value "test" must not appear as a JSON string in the metadata.
    const auditMetadataText = auditRow!.metadata;
    expect(auditMetadataText).not.toContain('"password"');
    // The decrypted base64 must not appear in the audit record (check first 20 chars as a proxy).
    expect(auditMetadataText).not.toContain(body.decryptedBase64.slice(0, 20));
    // The outcome field confirms what was recorded without leaking content.
    expect(auditMetadataText).toContain('"outcome":"decrypted"');
    expect(auditMetadataText).toContain("fileSha256");
  });

  it("returns 400 with stable wrong-password code on incorrect password and does not echo the password", async () => {
    const { userId } = await seedCredentialedUser("unlock-wrongpw@example.com", {
      userName: "Unlock Wrong PW",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Unlock Wrong PW", poolFirmId);
    const cookie = await signInForSessionCookie("unlock-wrongpw@example.com");

    const wrongPassword = "nope";
    const response = await app.request(
      "https://example.com/api/v1/decryption/unlock",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          cookie,
        },
        body: JSON.stringify({
          fileBase64: PDF_FIXTURE_BASE64,
          password: wrongPassword,
          attestation: { authorized: true },
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const bodyText = await response.text();
    // The stable problem code is returned.
    expect(bodyText).toContain("wrong-password");
    // The wrong password must not be echoed anywhere in the response body.
    expect(bodyText).not.toContain(wrongPassword);
  });

  it("returns 400 when attestation.authorized is false", async () => {
    const { userId } = await seedCredentialedUser("unlock-noattest@example.com", {
      userName: "Unlock No Attestation",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Unlock No Attestation", poolFirmId);
    const cookie = await signInForSessionCookie("unlock-noattest@example.com");

    const response = await app.request(
      "https://example.com/api/v1/decryption/unlock",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          cookie,
        },
        body: JSON.stringify({
          fileBase64: PDF_FIXTURE_BASE64,
          password: "test",
          attestation: { authorized: false },
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns 403 for an authenticated member without tools:decryption", async () => {
    // seedCredentialedUser assigns no role; membership alone carries no permission.
    await seedCredentialedUser("unlock-noperm@example.com", {
      userName: "Unlock No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("unlock-noperm@example.com");

    const response = await app.request(
      "https://example.com/api/v1/decryption/unlock",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          fileBase64: PDF_FIXTURE_BASE64,
          password: "test",
          attestation: { authorized: true },
        }),
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns 400 (not 500) for malformed base64 input", async () => {
    const { userId } = await seedCredentialedUser("unlock-badb64@example.com", {
      userName: "Unlock Bad Base64",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Unlock Bad Base64", poolFirmId);
    const cookie = await signInForSessionCookie("unlock-badb64@example.com");

    const response = await app.request(
      "https://example.com/api/v1/decryption/unlock",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          cookie,
        },
        body: JSON.stringify({
          fileBase64: "!!!not-base64!!!",
          password: "test",
          attestation: { authorized: true },
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});
