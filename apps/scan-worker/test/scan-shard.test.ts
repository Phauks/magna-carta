import { describe, expect, it } from "vitest";
import wranglerConfig from "../wrangler.jsonc?raw";
import {
  SCAN_PRIMARY_SHARD_NAME,
  SCAN_SHARD_COUNT,
  SHARD_KEY_QUERY_PARAMETER,
  scanShardName,
  scanShardNameForRequest,
} from "../src/scan-shard.ts";

// The shard names are Durable Object names, and one container instance runs per DO name — so these
// tests are what stands between the configured container capacity and a fleet of one.

function shardNames(keys: readonly string[]): string[] {
  return keys.map((key) => scanShardName(key));
}

describe("scanShardName", () => {
  it("is deterministic for a given key", () => {
    const first = scanShardName("files/file_abc/version_1");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(scanShardName("files/file_abc/version_1")).toBe(first);
    }
  });

  it("only ever names a shard within the configured capacity", () => {
    const allowed = new Set(
      Array.from({ length: SCAN_SHARD_COUNT }, (_unused, index) => `scan-${index}`),
    );
    for (let index = 0; index < 500; index += 1) {
      expect(allowed.has(scanShardName(`files/file_${index}/version_1`))).toBe(true);
      expect(allowed.has(scanShardName(null))).toBe(true);
    }
  });

  it("spreads distinct keys across every shard", () => {
    const keys = Array.from({ length: 200 }, (_unused, index) => `files/file_${index}/version_1`);
    expect(new Set(shardNames(keys)).size).toBe(SCAN_SHARD_COUNT);
  });

  it("sends a keyless request to the warm primary shard, never a cold random one", () => {
    // A random shard under light load is a cold shard four times in five, and a cold shard is a
    // cold start the member waits through. The interactive lane sends no key on purpose.
    expect(scanShardName(null)).toBe(SCAN_PRIMARY_SHARD_NAME);
    expect(scanShardName("")).toBe(SCAN_PRIMARY_SHARD_NAME);
  });

  it("the primary shard is one of the configured shards", () => {
    expect(SCAN_PRIMARY_SHARD_NAME).toBe("scan-0");
  });

  it("addresses exactly the container capacity the deployment configures", () => {
    // The shard count and max_instances are one decision in two files: fewer shards leaves paid-for
    // capacity unreachable, more shards queues requests behind instances that will never start.
    // Read with a pattern rather than a JSON parse — the config is JSONC (comments, trailing commas).
    // Inlined by the bundler as text rather than read off disk: this worker's runtime has no
    // filesystem, so the test stays inside the same module graph the worker itself is built from.
    const maxInstances = /"max_instances":\s*(\d+)/.exec(wranglerConfig);
    expect(maxInstances).not.toBeNull();
    expect(Number(maxInstances![1])).toBe(SCAN_SHARD_COUNT);
  });
});

describe("scanShardNameForRequest", () => {
  it("routes on the shard key the app worker sends", () => {
    const url = new URL(
      `http://scan-worker/scan?size=1024&contentType=application%2Fpdf&${SHARD_KEY_QUERY_PARAMETER}=files/file_abc/version_1`,
    );
    expect(scanShardNameForRequest(url)).toBe(scanShardName("files/file_abc/version_1"));
  });

  it("sends two different files to different instances (the whole point of sharding)", () => {
    // Two keys chosen because they hash apart — a fixed name would have sent both to one container.
    const first = scanShardName("files/file_1/version_1");
    const second = scanShardName("files/file_2/version_1");
    expect(first).not.toBe(second);
  });

  it("falls back to a shard when no key is present", () => {
    const url = new URL("http://scan-worker/scan?size=1024");
    expect(scanShardNameForRequest(url)).toMatch(/^scan-[0-4]$/);
  });
});
