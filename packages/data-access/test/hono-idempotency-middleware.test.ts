import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  idempotencyMiddleware,
  type IdempotencyContext,
} from "../src/hono-idempotency-middleware.ts";
import { stubD1 } from "./support/stub-d1.ts";

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

function appWith(
  requirement: "required" | "optional",
  stub: ReturnType<typeof stubD1>,
  handler = vi.fn((context: { json: (body: unknown, code?: number) => Response }) =>
    context.json({ ok: true }, 201),
  ),
) {
  const app = new Hono<{ Variables: { idempotency?: IdempotencyContext } }>();
  app.post(
    "/api/payments",
    idempotencyMiddleware({ requirement, database: stub.database as never }),
    (context) => handler(context),
  );
  return { app, handler };
}

describe("idempotencyMiddleware", () => {
  it("required + missing header -> 400 with a clear error; handler never runs", async () => {
    const stub = stubD1();
    const { app, handler } = appWith("required", stub);
    const response = await app.request("/api/payments", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Idempotency-Key") });
    expect(handler).not.toHaveBeenCalled();
  });

  it("optional + missing header -> passes through with no idempotency SQL", async () => {
    const stub = stubD1();
    const { app, handler } = appWith("optional", stub);
    const response = await app.request("/api/payments", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(201);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(stub.executed).toHaveLength(0);
  });

  it("header present + no record -> handler runs with {key, fingerprint} in context", async () => {
    const stub = stubD1();
    stub.onAll("FROM idempotency_key", []);
    let seen: IdempotencyContext | undefined;
    const handler = vi.fn(
      (context: {
        get: (name: "idempotency") => IdempotencyContext | undefined;
        json: (body: unknown, code?: number) => Response;
      }) => {
        seen = context.get("idempotency");
        return context.json({ ok: true }, 201);
      },
    );
    const { app } = appWith("required", stub, handler as never);
    const response = await app.request("/api/payments", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json", "Idempotency-Key": "client-key-1" },
    });
    expect(response.status).toBe(201);
    expect(seen?.key).toBe("client-key-1");
    expect(seen?.fingerprint).toMatch(FINGERPRINT_PATTERN);
  });

  it("completed record with the same fingerprint -> replays without invoking the handler", async () => {
    const stub = stubD1();
    // Compute the fingerprint the middleware will derive, by scripting after one probe call:
    // simpler — script the record lazily using a function that reflects the middleware's lookup.
    let storedFingerprint = "";
    stub.onAll("FROM idempotency_key", () => [
      {
        key: "client-key-1",
        fingerprint: storedFingerprint,
        status: "completed",
        response_code: 201,
        response_body: '{"id":"inv_stored"}',
      },
    ]);
    const { app, handler } = appWith("required", stub);
    // First, learn the fingerprint by sending once with a mismatching stored value (gets 422),
    // then set the stored fingerprint to match and assert the replay path.
    storedFingerprint = "0".repeat(64);
    const mismatch = await app.request("/api/payments", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json", "Idempotency-Key": "client-key-1" },
    });
    expect(mismatch.status).toBe(422);
    const { fingerprintRequest } = await import("../src/canonical.ts");
    storedFingerprint = await fingerprintRequest({
      method: "POST",
      path: "/api/payments",
      body: { a: 1 },
    });
    const replay = await app.request("/api/payments", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json", "Idempotency-Key": "client-key-1" },
    });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual({ id: "inv_stored" });
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(handler).not.toHaveBeenCalled();
  });

  it("in_progress record -> 409", async () => {
    const stub = stubD1();
    const { fingerprintRequest } = await import("../src/canonical.ts");
    const fingerprint = await fingerprintRequest({
      method: "POST",
      path: "/api/payments",
      body: { a: 1 },
    });
    stub.onAll("FROM idempotency_key", [
      {
        key: "client-key-1",
        fingerprint,
        status: "in_progress",
        response_code: null,
        response_body: null,
      },
    ]);
    const { app, handler } = appWith("required", stub);
    const response = await app.request("/api/payments", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json", "Idempotency-Key": "client-key-1" },
    });
    expect(response.status).toBe(409);
    expect(handler).not.toHaveBeenCalled();
  });
});
