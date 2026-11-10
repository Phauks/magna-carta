// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/bindings.ts";
import {
  cloudflareRecoveryBackend,
  resolveRecoveryBackend,
} from "../src/recovery/recovery-backend.ts";

// The backend is exercised against a fake RECOVERY_SERVICE Fetcher (no real recovery-worker running):
// it must dispatch the shard-by-count body with the per-shard X-Recovery-Instance header, and parse
// the JSON reply into a typed ShardOutcome — a malformed reply or non-200 is a fault, never a silent
// miss. resolveRecoveryBackend selects it only when the binding is present.

describe("cloudflareRecoveryBackend", () => {
  it("dispatches a shard with the per-shard instance header and parses the outcome", async () => {
    let captured: Request | undefined;
    const service = {
      fetch: async (r: Request) => {
        captured = r;
        return new Response('{"found":"pw","candidatesTried":42}', { status: 200 });
      },
    } as unknown as Fetcher;

    const outcome = await cloudflareRecoveryBackend(service).recoverShard({
      firmId: "firm_x",
      jobId: "recoveryJob_9",
      shardIndex: 2,
      shardCount: 4,
      hash: "$pdf$...",
      format: "pdf",
      hashcatMode: 10500,
      ruleSet: "best64",
    });

    expect(outcome).toEqual({ found: "pw", candidatesTried: 42 });
    expect(captured!.headers.get("X-Recovery-Instance")).toBe("recoveryJob_9:2");
    expect(await captured!.json()).toMatchObject({
      shardIndex: 2,
      shardCount: 4,
      ruleSet: "best64",
    });
  });

  it("throws on a non-200 response (never returns a silent miss)", async () => {
    const service = {
      fetch: async () => new Response('{"found":null,"candidatesTried":0}', { status: 500 }),
    } as unknown as Fetcher;

    await expect(
      cloudflareRecoveryBackend(service).recoverShard({
        firmId: "firm_x",
        jobId: "recoveryJob_9",
        shardIndex: 0,
        shardCount: 1,
        hash: "$pdf$...",
        format: "pdf",
        hashcatMode: 10500,
        ruleSet: "best64",
      }),
    ).rejects.toThrow();
  });

  it("throws on a malformed body (an unrecognized shape is a fault)", async () => {
    const service = {
      fetch: async () => new Response('{"notAnOutcome":true}', { status: 200 }),
    } as unknown as Fetcher;

    await expect(
      cloudflareRecoveryBackend(service).recoverShard({
        firmId: "firm_x",
        jobId: "recoveryJob_9",
        shardIndex: 0,
        shardCount: 1,
        hash: "$pdf$...",
        format: "pdf",
        hashcatMode: 10500,
        ruleSet: "best64",
      }),
    ).rejects.toThrow();
  });
});

describe("resolveRecoveryBackend", () => {
  it("resolves the backend only when the service binding is present", () => {
    expect(resolveRecoveryBackend({} as Bindings)).toBeNull();
    expect(resolveRecoveryBackend({ RECOVERY_SERVICE: {} } as unknown as Bindings)).not.toBeNull();
  });
});
