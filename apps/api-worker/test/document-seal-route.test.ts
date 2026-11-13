import { env } from "cloudflare:test";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { CertificateOfCompletion } from "@magna-carta/signing";
import type { SealPort, SealRequest, SealResponse } from "@magna-carta/signing/port";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The Admin role id is a committed literal from 0002_member-rbac.sql.
const OWNER_ADMIN_ROLE_ID = "role_Gw-zKO8hOHQuNv2bWokMp";

// A tiny valid base64 payload. The fake SealPort never parses the document (the real WASM seal is
// proven end to end in the sign-worker's own pool test), so any base64 exercises the route.
const DOCUMENT_BASE64 = btoa("%PDF-1.7\nfake-document-bytes\n%%EOF\n");

// A fake SealPort that records the request it received and returns a shape-correct sealed response.
// Injected via createApp so the sealed-response path runs without a live sign worker or signing key.
class FakeSealPort implements SealPort {
  lastRequest: SealRequest | undefined;
  seal(request: SealRequest): Promise<SealResponse> {
    this.lastRequest = request;
    const certificate: CertificateOfCompletion = {
      documentHashSha256: "a".repeat(64),
      reference: "MC-AAAA-AAAA-AAAA",
      sealedAt: request.signingTime,
      signers: request.signers,
      ...(request.envelope !== undefined ? { envelope: request.envelope } : {}),
    };
    return Promise.resolve({
      sealedPdf: new TextEncoder().encode("%PDF-1.7 sealed-stub"),
      documentHashSha256: "a".repeat(64),
      certificate,
      certificateText: "CERTIFICATE OF COMPLETION\nstub",
      certificatePdf: new TextEncoder().encode("%PDF-1.7 certificate-stub"),
    });
  }
}

function sealBody(): string {
  return JSON.stringify({
    documentBase64: DOCUMENT_BASE64,
    signers: [
      {
        intent: {
          signerId: "usr_seal",
          name: "Seal Signer",
          email: "seal-signer@example.com",
          adoption: "typed",
          affirmedAt: "2026-08-03T12:00:00Z",
        },
        consent: { disclosureVersion: "v1", consentedAt: "2026-08-03T11:59:00Z" },
        // observedIp is deliberately omitted from the request schema — the server sets it.
        attribution: { level: "firm-authenticated" },
      },
    ],
    documentTitle: "Engagement letter.pdf",
    seal: { reason: "Engagement letter", name: "Magna Carta Platform Seal" },
  });
}

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Document Seal Route Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  // esign:seal is seeded onto Admin + Attorney in a per-firm migration. Grant it here directly
  // so the route tests do not depend on that seed having run against the pooled test database.
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare("INSERT OR IGNORE INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
    .bind("rolePermission_esignSealOwnerTest01", OWNER_ADMIN_ROLE_ID, "esign:seal")
    .run();
});

describe("POST /api/v1/documents/seal", () => {
  it("seals via the injected port, returns the sealed shape, and writes a redacted audit row", async () => {
    const port = new FakeSealPort();
    const app = createApp({ sealPort: port });
    const { userId } = await seedCredentialedUser("seal-ok@example.com", {
      userName: "Seal OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Seal OK", poolFirmId);
    const cookie = await signInForSessionCookie("seal-ok@example.com");

    const response = await app.request(
      "https://example.com/api/v1/documents/seal",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          cookie,
          "CF-Connecting-IP": "203.0.113.7",
          "User-Agent": "SealRouteTest/1.0",
        },
        body: sealBody(),
        // What the network says about the connecting address, as the edge attaches it.
        cf: { city: "Springfield", region: "Illinois", country: "US" },
      },
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sealedPdfBase64: string;
      documentHashSha256: string;
      certificate: CertificateOfCompletion;
      certificateText: string;
      certificatePdfBase64: string;
    };
    expect(body.documentHashSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.certificate.signers).toHaveLength(1);
    expect(body.certificateText).toContain("CERTIFICATE OF COMPLETION");

    // The signing time is server-set, and observedIp is the server-observed connecting IP — never a
    // client self-report (the request schema does not even accept it).
    expect(port.lastRequest?.signingTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(port.lastRequest?.signers[0]?.attribution.observedIp).toBe("203.0.113.7");
    expect(port.lastRequest?.signers[0]?.attribution.userAgent).toBe("SealRouteTest/1.0");
    expect(port.lastRequest?.signers[0]?.attribution.location).toBe("Springfield, Illinois, US");
    expect(port.lastRequest?.signers[0]?.intent.name).toBe("Seal Signer");

    // The certificate comes back as a PDF too, and names the document and a reference.
    expect(atob(body.certificatePdfBase64)).toContain("%PDF-");
    expect(port.lastRequest?.envelope?.title).toBe("Engagement letter.pdf");
    expect(body.certificate.envelope?.id).toBe(port.lastRequest?.envelope?.id);

    // Exactly one redacted audit row, carrying the digest and signer count but no document content.
    const auditRow = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT metadata FROM audit_log WHERE event = 'esign.sealed' LIMIT 1")
      .first<{ metadata: string }>();
    expect(auditRow).not.toBeNull();
    expect(auditRow!.metadata).toContain('"outcome":"sealed"');
    expect(auditRow!.metadata).toContain("documentHashSha256");
    expect(auditRow!.metadata).not.toContain(DOCUMENT_BASE64);
  });

  it("returns 503 when the seal is not configured (no override, the pool stub reports not-configured)", async () => {
    const app = createApp();
    const { userId } = await seedCredentialedUser("seal-unconfigured@example.com", {
      userName: "Seal Unconfigured",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Seal Unconfigured", poolFirmId);
    const cookie = await signInForSessionCookie("seal-unconfigured@example.com");

    const response = await app.request(
      "https://example.com/api/v1/documents/seal",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://example.com", cookie },
        body: sealBody(),
      },
      env,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns 403 for an authenticated member without esign:seal", async () => {
    const app = createApp({ sealPort: new FakeSealPort() });
    // seedCredentialedUser assigns no role; membership alone carries no permission.
    await seedCredentialedUser("seal-noperm@example.com", {
      userName: "Seal No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("seal-noperm@example.com");

    const response = await app.request(
      "https://example.com/api/v1/documents/seal",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: sealBody(),
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns 401 for an unauthenticated request", async () => {
    const app = createApp({ sealPort: new FakeSealPort() });
    const response = await app.request(
      "https://example.com/api/v1/documents/seal",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: sealBody(),
      },
      env,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns 400 (not 500) for malformed base64 and does not echo the submitted value", async () => {
    const app = createApp({ sealPort: new FakeSealPort() });
    const { userId } = await seedCredentialedUser("seal-badb64@example.com", {
      userName: "Seal Bad Base64",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Seal Bad Base64", poolFirmId);
    const cookie = await signInForSessionCookie("seal-badb64@example.com");

    const malformedInput = "!!!not base64!!!";
    const response = await app.request(
      "https://example.com/api/v1/documents/seal",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://example.com", cookie },
        body: JSON.stringify({
          documentBase64: malformedInput,
          signers: [
            {
              intent: {
                signerId: "usr_seal",
                adoption: "typed",
                affirmedAt: "2026-08-03T12:00:00Z",
              },
              consent: { disclosureVersion: "v1", consentedAt: "2026-08-03T11:59:00Z" },
              attribution: { level: "firm-authenticated" },
            },
          ],
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const bodyText = await response.text();
    expect(bodyText).not.toContain(malformedInput);
  });
});
