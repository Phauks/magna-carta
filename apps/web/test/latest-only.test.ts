import { describe, expect, it } from "vitest";
import { LatestOnly } from "../src/lib/api/latest-only.ts";

// Every test here resolves reads OUT OF ORDER on purpose, because in-order is the case that already
// works and the case every other test in the suite happens to exercise.

/** A read whose answer is released by hand, so a test decides the order two reads come back in. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("LatestOnly", () => {
  it("lets the newest read write, and drops an older one that answers after it", async () => {
    const latest = new LatestOnly();
    const first = deferred<string>();
    const second = deferred<string>();
    const written: string[] = [];

    const read = async (attempt: ReturnType<LatestOnly["begin"]>, source: Promise<string>) => {
      const value = await source;
      if (!attempt.current) return;
      written.push(value);
    };

    const readingFirst = read(latest.begin(), first.promise);
    const readingSecond = read(latest.begin(), second.promise);
    // The SECOND read answers first, then the first one answers — the order that breaks a screen.
    second.resolve("current matter");
    first.resolve("previous matter");
    await Promise.all([readingFirst, readingSecond]);

    expect(written).toEqual(["current matter"]);
  });

  it("keeps the answer when nothing superseded it", async () => {
    const latest = new LatestOnly();
    const attempt = latest.begin();
    await Promise.resolve();
    expect(attempt.current).toBe(true);
  });

  it("supersede() clears a read in flight without starting one, so a cleared screen stays cleared", async () => {
    const latest = new LatestOnly();
    const attempt = latest.begin();
    const answer = deferred<string>();
    let written: string | null = null;
    const reading = answer.promise.then((value) => {
      if (attempt.current) written = value;
    });

    latest.supersede(); // the subject changed and the screen was emptied; no new read yet
    answer.resolve("rows for the matter that is no longer showing");
    await reading;

    expect(written).toBeNull();
  });

  it("attempt() claims without superseding, so a read started after a reset still counts", async () => {
    const latest = new LatestOnly();
    latest.supersede(); // the reset
    const attempt = latest.attempt(); // the read that follows it
    await Promise.resolve();
    expect(attempt.current).toBe(true);
  });

  it("only the very newest survives when several reads are in flight", async () => {
    const latest = new LatestOnly();
    const attempts = [latest.begin(), latest.begin(), latest.begin()];
    expect(attempts.map((one) => one.current)).toEqual([false, false, true]);
  });
});
