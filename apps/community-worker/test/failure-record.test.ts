import { setFailedOperationTap } from "@magna-carta/telemetry/failed-operation-tap";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { setServiceIdentity } from "@magna-carta/telemetry/service-identity";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { recordFailuresIn } from "../src/failure-record.ts";

afterEach(() => setFailedOperationTap(null));

describe("the board's failures", () => {
  it("are kept against the Error ID the board answered with, as a server failure", async () => {
    setServiceIdentity("cmy");
    const kept: Promise<unknown>[] = [];
    recordFailuresIn(env.DB_CONTROL, (work) => kept.push(work));

    const errorId = logOperationFailed(
      createWorkersLogger(undefined, () => {}),
      "community.post",
      new RangeError("thread body too long"),
    );
    await Promise.all(kept);

    const row = await env.DB_CONTROL.prepare(
      "SELECT source, service, operation, status, error_name, message_head, firm_id, user_id FROM error_record WHERE id = ?1",
    )
      .bind(errorId)
      .first();
    expect(row).toEqual({
      source: "server",
      service: "cmy",
      operation: "community.post",
      status: 500,
      error_name: "RangeError",
      message_head: "thread body too long",
      firm_id: null,
      user_id: null,
    });
  });
});
