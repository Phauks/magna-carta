// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { createMemoryLogger } from "@magna-carta/telemetry/logger";
import { describe, expect, it } from "vitest";
import { getFile, runWopiCallback } from "../../src/editing/wopi-routes.ts";
import { WopiGuardError } from "../../src/editing/wopi-guard.ts";
import type { EditTokenClaims } from "../../src/editing/wopi-token.ts";
import type { ProxyBatchDatabase } from "../../src/firm-database/firm-database-proxy.ts";

// The WOPI callback surface authenticates from a token off the cookie chokepoint, so it does not ride
// the request-path telemetry middleware. runWopiCallback is its diagnostics seam: it mints a
// correlation id per callback, maps a thrown fault to the WOPI-contract status, and emits one redacted
// operation.failed event carrying an error id — never the document bytes or the access token (the
// event's allowlist has no slot for either).

const now = () => "2026-06-22T12:00:00.000Z";

const claims: EditTokenClaims = {
  firmId: "firm_a",
  matterId: "matter_a",
  fileId: "file_a",
  versionId: "fileVersion_a",
  memberId: "user_a",
  capability: "edit",
  sessionId: "wopiSession_a",
  exp: Date.parse(now()) + 60_000,
  jti: "jti_a",
};

describe("WOPI surface diagnostics", () => {
  it("maps an unexpected fault to a 500 and emits one redacted operation.failed event with an error id", async () => {
    const logger = createMemoryLogger();
    // A bucket whose get throws — an R2 fault surfacing inside GetFile.
    const throwingBucket = {
      get: () => {
        throw new Error("R2 unavailable");
      },
    } as unknown as R2Bucket;

    const response = await runWopiCallback("wopi.getFile", { logger, now }, () =>
      getFile(claims, {
        database: {} as unknown as ProxyBatchDatabase,
        bucket: throwingBucket,
        currentMeta: null,
        liveSessionId: null,
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("X-MC-Error-Id")).toMatch(/^error_/);
    expect(logger.events).toHaveLength(1);
    const event = logger.events[0];
    expect(event?.name).toBe("operation.failed");
    expect(event?.fields.operation).toBe("wopi.getFile");
    expect(event?.fields.errorId).toMatch(/^error_/);
    // The header's error id is the same handle logged against the server trace.
    expect(event?.fields.errorId).toBe(response.headers.get("X-MC-Error-Id"));
  });

  it("mints a correlation id per callback when none is supplied", async () => {
    const logger = createMemoryLogger();
    await runWopiCallback("wopi.getFile", { logger, now }, async () => {
      throw new WopiGuardError("not-found");
    });
    expect(logger.events[0]?.correlationId).toMatch(/^correlation_/);
  });

  it("maps the WOPI guard fault codes to their contract statuses", async () => {
    const logger = createMemoryLogger();
    const statusFor = async (code: "unauthorized" | "not-found" | "forbidden-readonly") =>
      (
        await runWopiCallback("wopi.checkFileInfo", { logger, now }, async () => {
          throw new WopiGuardError(code);
        })
      ).status;

    expect(await statusFor("unauthorized")).toBe(401);
    expect(await statusFor("not-found")).toBe(404);
    expect(await statusFor("forbidden-readonly")).toBe(403);
  });

  it("can carry only the allowlisted fields — no slot for document bytes or the access token", async () => {
    const logger = createMemoryLogger();
    await runWopiCallback("wopi.putFile", { logger, now }, async () => {
      throw new WopiGuardError("forbidden-readonly");
    });

    const event = logger.events[0];
    expect(Object.keys(event?.fields ?? {}).sort()).toEqual([
      "errorId",
      "errorName",
      "messageHead",
      "operation",
    ]);
    expect(event?.fields).not.toHaveProperty("accessToken");
    expect(event?.fields).not.toHaveProperty("bytes");
  });

  it("returns the function's response untouched when it succeeds", async () => {
    const logger = createMemoryLogger();
    const response = await runWopiCallback(
      "wopi.getFile",
      { logger, now },
      async () => new Response("ok", { status: 200 }),
    );
    expect(response.status).toBe(200);
    expect(logger.events).toHaveLength(0);
  });
});
