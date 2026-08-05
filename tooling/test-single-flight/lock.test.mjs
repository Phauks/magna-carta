import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireSingleFlightLock, blockedMessage, STALE_AFTER_MILLISECONDS } from "./lock.mjs";

let directory;
let lockPath;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "single-flight-"));
  // A nested path, because the real lock lives under a cache directory that may not exist yet.
  lockPath = path.join(directory, "cache", "test-single-flight.lock");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const alive = () => true;
const dead = () => false;

describe("acquiring the lock", () => {
  it("creates the lock file, and its directory, on a free worktree", () => {
    const claim = acquireSingleFlightLock({
      lockPath,
      identity: { processIdentifier: 4242, command: "vp test" },
      now: () => 1000,
    });

    expect(claim.acquired).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
    expect(JSON.parse(readFileSync(lockPath, "utf8"))).toEqual({
      processIdentifier: 4242,
      command: "vp test",
      startedAt: 1000,
    });
  });

  it("refuses a second run while the first is alive and recent", () => {
    acquireSingleFlightLock({
      lockPath,
      identity: { processIdentifier: 4242 },
      now: () => 1000,
      processAlive: alive,
    });

    const second = acquireSingleFlightLock({
      lockPath,
      identity: { processIdentifier: 4243 },
      now: () => 2000,
      processAlive: alive,
    });

    expect(second.acquired).toBe(false);
    expect(second.reason).toBe("held");
    expect(second.holder.processIdentifier).toBe(4242);
  });

  it("lets the next run in once the first has released", () => {
    const first = acquireSingleFlightLock({
      lockPath,
      identity: { processIdentifier: 4242 },
      processAlive: alive,
    });
    first.release();
    expect(existsSync(lockPath)).toBe(false);

    const second = acquireSingleFlightLock({
      lockPath,
      identity: { processIdentifier: 4243 },
      processAlive: alive,
    });
    expect(second.acquired).toBe(true);
  });

  it("treats release as idempotent, so an exit handler can call it after a normal exit", () => {
    const claim = acquireSingleFlightLock({ lockPath, processAlive: alive });
    claim.release();
    expect(() => claim.release()).not.toThrow();
  });
});

describe("reclaiming an abandoned lock", () => {
  it("takes over when the holding process is gone", () => {
    acquireSingleFlightLock({
      lockPath,
      identity: { processIdentifier: 4242 },
      now: () => 1000,
      processAlive: alive,
    });

    const second = acquireSingleFlightLock({
      lockPath,
      identity: { processIdentifier: 4243 },
      now: () => 2000,
      processAlive: dead,
    });

    expect(second.acquired).toBe(true);
    expect(second.reason).toBe("holder-gone");
    expect(second.reclaimedFrom.processIdentifier).toBe(4242);
  });

  it("takes over a lock older than the stale window even if a process by that id is alive", () => {
    // A recycled process id must not be able to hold a worktree hostage forever.
    acquireSingleFlightLock({
      lockPath,
      identity: { processIdentifier: 4242 },
      now: () => 0,
      processAlive: alive,
    });

    const second = acquireSingleFlightLock({
      lockPath,
      identity: { processIdentifier: 4243 },
      now: () => STALE_AFTER_MILLISECONDS + 1,
      processAlive: alive,
    });

    expect(second.acquired).toBe(true);
    expect(second.reason).toBe("expired");
  });

  it("respects a long-running holder inside the stale window", () => {
    acquireSingleFlightLock({
      lockPath,
      identity: { processIdentifier: 4242 },
      now: () => 0,
      processAlive: alive,
    });

    const second = acquireSingleFlightLock({
      lockPath,
      identity: { processIdentifier: 4243 },
      now: () => STALE_AFTER_MILLISECONDS - 1,
      processAlive: alive,
    });

    expect(second.acquired).toBe(false);
  });

  it("takes over a lock whose contents cannot be parsed", () => {
    // Acquire and release once so the cache directory exists, then leave a truncated lock behind.
    acquireSingleFlightLock({ lockPath, processAlive: alive }).release();
    writeFileSync(lockPath, "{ not json");

    const claim = acquireSingleFlightLock({
      lockPath,
      identity: { processIdentifier: 7 },
      processAlive: alive,
    });
    expect(claim.acquired).toBe(true);
    expect(claim.reason).toBe("holder-gone");
  });
});

describe("the blocked message", () => {
  it("names the holder, what it is running, the lock path and the override", () => {
    const message = blockedMessage(
      { processIdentifier: 4242, startedAt: 0, command: "vp test run packages/ledger" },
      "/tmp/x.lock",
    );

    expect(message).toContain("process 4242");
    expect(message).toContain("vp test run packages/ledger");
    expect(message).toContain("/tmp/x.lock");
    expect(message).toContain("MAGNA_CARTA_ALLOW_CONCURRENT_TESTS=1");
  });

  it("still reads sensibly when the holder recorded nothing usable", () => {
    const message = blockedMessage(null, "/tmp/x.lock");
    expect(message).toContain("another process");
    expect(message).not.toContain("undefined");
  });
});
