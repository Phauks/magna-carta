/*
 * The error record: every problem the API answers is kept against the Error ID the member was shown
 * (except a signed-out or rate-limit answer), a browser crash is kept through POST
 * /api/v1/client-errors, the lookup is a platform operator's alone, and the daily pass ages records
 * out after thirty days.
 */
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { runErrorRecordRetentionSweep } from "../src/background/system-status/error-record-retention.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { settleBackgroundWork } from "./support/settle-background-work.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

let firmId: FirmId;
let cookie: string;

interface StoredRecord {
  id: string;
  source: string;
  service: string | null;
  operation: string | null;
  status: number | null;
  problem_type: string | null;
  error_name: string | null;
  message_head: string | null;
  location: string | null;
  firm_id: string | null;
  user_id: string | null;
}

async function storedRecord(errorId: string): Promise<StoredRecord | undefined> {
  const { results } = await env.DB_CONTROL.prepare(
    "SELECT id, source, service, operation, status, problem_type, error_name, message_head, location, firm_id, user_id FROM error_record WHERE id = ?1",
  )
    .bind(errorId)
    .all<StoredRecord>();
  return results[0];
}

function postClientError(body: unknown, sessionCookie?: string): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/client-errors", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sessionCookie === undefined ? {} : { cookie: sessionCookie }),
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Error Record Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  const { userId } = await seedCredentialedUser("error-record@example.com", {
    userName: "Error Record Member",
    firmId,
  });
  await mirrorMemberWithOwnerRole(userId, "Error Record Member", firmId);
  cookie = await signInForSessionCookie("error-record@example.com");
});

describe("POST /api/v1/client-errors", () => {
  it("keeps a crash against its client_ ID, with the engine's message for an engine kind", async () => {
    const response = await postClientError(
      {
        errorId: "client_7KQ2M9XA",
        route: "/(app)/meetings/[meetingId]",
        errorName: "TypeError",
        message: "Cannot read properties of null (reading 'participantId')",
        location: "meeting-stage.svelte:212:18",
        build: "8d03be33 (production)",
      },
      cookie,
    );
    expect(response.status).toBe(201);
    const record = await storedRecord("client_7KQ2M9XA");
    expect(record).toMatchObject({
      source: "browser",
      service: "web",
      operation: "/(app)/meetings/[meetingId]",
      status: null,
      error_name: "TypeError",
      message_head: "Cannot read properties of null (reading 'participantId')",
      location: "meeting-stage.svelte:212:18",
      firm_id: firmId,
    });
    expect(record?.user_id).toMatch(/^user_/);
  });

  it("drops a message our own code or a library wrote", async () => {
    const response = await postClientError(
      {
        errorId: "client_8MNP3QRS",
        route: "/(app)/trust",
        errorName: "Error",
        message: "ledger for Smith v. Jones failed",
        build: "8d03be33 (production)",
      },
      cookie,
    );
    expect(response.status).toBe(201);
    expect((await storedRecord("client_8MNP3QRS"))?.message_head).toBeNull();
  });

  it("a second send of one ID leaves the first record standing", async () => {
    const body = {
      errorId: "client_9TVW4XYZ",
      route: "/(app)/home",
      errorName: "RangeError",
      message: "Invalid time value",
      build: "first",
    };
    expect((await postClientError(body, cookie)).status).toBe(201);
    expect((await postClientError({ ...body, message: "second" }, cookie)).status).toBe(201);
    expect((await storedRecord("client_9TVW4XYZ"))?.message_head).toBe("Invalid time value");
  });
});

describe("the API's own problems", () => {
  it("a refusal is kept against the Error ID it answered, with its operation", async () => {
    const response = await postClientError({ errorId: "not a handle" }, cookie);
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { errorId: string; operation?: string };
    expect(problem.operation).toBe("POST /api/v1/client-errors");
    await settleBackgroundWork();
    expect(await storedRecord(problem.errorId)).toMatchObject({
      source: "server",
      service: "api",
      operation: "POST /api/v1/client-errors",
      status: 422,
      problem_type: "validation",
      firm_id: firmId,
    });
  });

  it("a signed-out answer is not kept", async () => {
    const response = await postClientError({ errorId: "client_ABCDEFGH" });
    expect(response.status).toBe(401);
    const problem = (await response.json()) as { errorId: string };
    await settleBackgroundWork();
    expect(await storedRecord(problem.errorId)).toBeUndefined();
  });
});

describe("GET /api/v1/platform/errors/{errorId}", () => {
  it("is refused to a member who is not a platform operator", async () => {
    const response = await SELF.fetch(
      "https://example.com/api/v1/platform/errors/client_7KQ2M9XA",
      { headers: { cookie } },
    );
    expect(response.status).toBe(403);
  });
});

describe("the retention pass", () => {
  it("deletes records older than thirty days and keeps the rest", async () => {
    const now = Date.parse("2026-12-31T00:00:00Z");
    const old = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(now - 29 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB_CONTROL.batch([
      env.DB_CONTROL.prepare(
        "INSERT INTO error_record (id, recorded_at, source) VALUES ('error_retention_old', ?1, 'server')",
      ).bind(old),
      env.DB_CONTROL.prepare(
        "INSERT INTO error_record (id, recorded_at, source) VALUES ('error_retention_new', ?1, 'server')",
      ).bind(recent),
    ]);
    await runErrorRecordRetentionSweep(env, now);
    expect(await storedRecord("error_retention_old")).toBeUndefined();
    expect(await storedRecord("error_retention_new")).toBeDefined();
  });
});
