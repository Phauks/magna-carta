import { afterEach, describe, expect, it, vi } from "vitest";

import { collectViaLogs, LogCollectionTimeoutError } from "../src/logs-collect.ts";
import type { VastClient } from "../src/vast-client.ts";

/** A client whose only exercised method is `requestLogsUrl`; the rest throw if touched. */
function clientReturningUrl(url: string, requestLogsUrl = vi.fn(async () => url)): VastClient {
  return {
    searchOffers: async () => {
      throw new Error("not used");
    },
    createInstance: async () => {
      throw new Error("not used");
    },
    getInstance: async () => {
      throw new Error("not used");
    },
    listInstances: async () => {
      throw new Error("not used");
    },
    destroyInstance: async () => {
      throw new Error("not used");
    },
    requestLogsUrl,
  };
}

const S3_URL = "https://s3.example.com/logs/777.txt?X-Amz-Signature=SECRETCAP";

describe("collectViaLogs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps polling past a transient fetch failure instead of discarding a healthy rig", async () => {
    vi.useFakeTimers();
    // Attempt 0: the S3 object does not exist yet (404). Attempt 1: exists but incomplete.
    // Attempt 2: complete. The healthy instance must NOT be abandoned on the early 404.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("NoSuchKey", { status: 404 }))
      .mockResolvedValueOnce(new Response("BENCH_BEGIN\nMODE=9600\n", { status: 200 }))
      .mockResolvedValueOnce(
        new Response("BENCH_BEGIN\nMODE=9600\n1:9600::::5\nBENCH_END", { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchImpl);

    const promise = collectViaLogs(clientReturningUrl(S3_URL), 777);
    await vi.runAllTimersAsync();
    const text = await promise;

    expect(text).toContain("BENCH_END");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("times out (never abandons early) and leaks neither the signed URL nor a key into the error", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("still pulling image", { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    const promise = collectViaLogs(clientReturningUrl(S3_URL), 777);
    // Attach the rejection assertion before advancing timers so the rejection is never unhandled.
    const assertion = expect(promise).rejects.toBeInstanceOf(LogCollectionTimeoutError);
    await vi.runAllTimersAsync();
    await assertion;

    try {
      await promise;
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("SECRETCAP");
      expect(message).not.toContain("s3.example.com");
    }
  });
});
