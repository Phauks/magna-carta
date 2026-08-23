import { describe, expect, it, vi } from "vitest";
import type { ProxyBatchDatabase } from "../../src/firm-database/firm-database-proxy.ts";
import { mintEditToken } from "../../src/editing/wopi-token.ts";
import { assertEditCapability, wopiGuard, WopiGuardError } from "../../src/editing/wopi-guard.ts";

const env = { AUTH_SECRET: "test-auth-secret-value-not-for-production" };
// The guard only passes the database through; a stand-in is enough for these unit tests.
const fakeDatabase = { __stub: "firm-db" } as unknown as ProxyBatchDatabase;

const baseInput = {
  firmId: "firm_aaa",
  matterId: "matter_bbb",
  fileId: "file_ccc",
  versionId: "fileVersion_ddd",
  memberId: "usr_eee",
  capability: "edit" as const,
  sessionId: "wopiSession_fff",
};
const oneHourFromNow = () => Date.now() + 60 * 60 * 1000;

describe("WOPI guard", () => {
  it("verifies the token and resolves the firm database from the token's firmId — never a request path", async () => {
    const token = await mintEditToken({ ...baseInput, exp: oneHourFromNow() }, env);
    const resolveFirm = vi.fn(async (_firmId: string) => fakeDatabase);

    const result = await wopiGuard(token, env, resolveFirm);

    // The firm is resolved from the token's firmId and nothing else (no request-path input exists).
    expect(resolveFirm).toHaveBeenCalledOnce();
    expect(resolveFirm).toHaveBeenCalledWith("firm_aaa");
    expect(result.claims.fileId).toBe("file_ccc");
    expect(result.claims.capability).toBe("edit");
    expect(result.firmDatabase).toBe(fakeDatabase);
  });

  it("rejects an invalid token as unauthorized and never resolves a firm", async () => {
    const resolveFirm = vi.fn(async () => fakeDatabase);
    await expect(wopiGuard("garbage.token.value", env, resolveFirm)).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(resolveFirm).not.toHaveBeenCalled();
  });

  it("returns not-found (404) when the token's firm has no database", async () => {
    const token = await mintEditToken({ ...baseInput, exp: oneHourFromNow() }, env);
    const resolveFirm = vi.fn(async () => null); // unknown / unprovisioned / shredded firm
    await expect(wopiGuard(token, env, resolveFirm)).rejects.toMatchObject({ code: "not-found" });
  });

  it("assertEditCapability allows an edit token and rejects a view token server-side", () => {
    const editClaims = { ...baseInput, jti: "nonce", exp: oneHourFromNow() };
    expect(() => assertEditCapability(editClaims)).not.toThrow();
    expect(() => assertEditCapability({ ...editClaims, capability: "view" })).toThrowError(
      WopiGuardError,
    );
    expect(() => assertEditCapability({ ...editClaims, capability: "view" })).toThrowError(
      "forbidden-readonly",
    );
  });
});
