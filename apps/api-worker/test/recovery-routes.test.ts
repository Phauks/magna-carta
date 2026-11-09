// Focused route-registration test for the password-recovery surface (routes/files/recovery.ts). Asserts
// the three operations are registered at their declared method/path and carry the
// tools:decryption permission — a light unit test over the EMITTED OpenAPI document (matching
// test/contracts/route-meta.test.ts's approach), not a live-request exercise: env.RECOVERY_JOB
// (the RecoveryJobCoordinator Durable Object binding) is wired in a later task, so a request-level
// test would need a binding that does not exist yet. buildOpenAPIDocument() calls createApp() with
// no bindings — registration alone never touches env.
import { describe, expect, it } from "vitest";
import { buildOpenAPIDocument } from "../src/http/app.ts";

describe("registerRecoveryRoutes", () => {
  const document = buildOpenAPIDocument();

  it("registers POST /api/v1/decryption/recover with tools:decryption", () => {
    const operation = document.paths?.["/api/v1/decryption/recover"]?.post;
    expect(operation).toBeDefined();
    expect(operation?.operationId).toBe("decryption.recoverStart");
    expect((operation as Record<string, unknown>)["x-mc-permission"]).toBe("tools:decryption");
    expect((operation as Record<string, unknown>)["x-mc-surface"]).toBe("app");
    expect((operation as Record<string, unknown>)["x-mc-authenticated"]).toBe(true);
    expect((operation as Record<string, unknown>)["x-mc-resource"]).toBe("firm");
    expect((operation as Record<string, unknown>)["x-mc-audited"]).toBe(true);
  });

  it("registers GET /api/v1/decryption/recover/{jobId} with tools:decryption", () => {
    const operation = document.paths?.["/api/v1/decryption/recover/{jobId}"]?.get;
    expect(operation).toBeDefined();
    expect(operation?.operationId).toBe("decryption.recoverStatus");
    expect((operation as Record<string, unknown>)["x-mc-permission"]).toBe("tools:decryption");
    // A read — never audited.
    expect((operation as Record<string, unknown>)["x-mc-audited"]).toBe(false);
  });

  it("registers DELETE /api/v1/decryption/recover/{jobId} with tools:decryption", () => {
    const operation = document.paths?.["/api/v1/decryption/recover/{jobId}"]?.delete;
    expect(operation).toBeDefined();
    expect(operation?.operationId).toBe("decryption.recoverCancel");
    expect((operation as Record<string, unknown>)["x-mc-permission"]).toBe("tools:decryption");
    expect((operation as Record<string, unknown>)["x-mc-audited"]).toBe(true);
  });
});
