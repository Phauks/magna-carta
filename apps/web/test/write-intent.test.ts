import { describe, expect, it } from "vitest";
import { WriteIntent } from "../src/lib/api/write-intent.ts";

describe("WriteIntent", () => {
  it("gives a second click the first click's submission, not a second effect", async () => {
    const intent = new WriteIntent();
    const keys: string[] = [];
    let release: (value: string) => void = () => undefined;
    const write = (key: string) => {
      keys.push(key);
      return new Promise<string>((settle) => {
        release = settle;
      });
    };

    // Both clicks land before anything has been written back — the case a disabled control misses.
    const first = intent.submit(write);
    const second = intent.submit(write);
    release("recorded");

    expect((await first).joined).toBe(false);
    expect((await second).joined).toBe(true);
    expect(keys).toHaveLength(1); // one submission, so one effect
  });

  it("keeps the key across a failure, so the retry is a RETRY and not a second request", async () => {
    const intent = new WriteIntent();
    const keys: string[] = [];
    const failing = (key: string) => {
      keys.push(key);
      return Promise.reject(new Error("the connection dropped"));
    };

    await expect(intent.submit(failing)).rejects.toThrow("the connection dropped");
    await expect(intent.submit(failing)).rejects.toThrow("the connection dropped");

    // The same key twice: if the first attempt's write actually landed before the connection died,
    // the second replays it rather than recording the cost again.
    expect(new Set(keys).size).toBe(1);
  });

  it("rotates after a success, so the next thing recorded is a new request", async () => {
    const intent = new WriteIntent();
    const keys: string[] = [];
    const write = (key: string) => {
      keys.push(key);
      return Promise.resolve("ok");
    };

    await intent.submit(write);
    await intent.submit(write);

    expect(new Set(keys).size).toBe(2);
  });

  it("accepts a new submission once the in-flight one has settled", async () => {
    const intent = new WriteIntent();
    const outcome = await intent.submit(() => Promise.resolve(1));
    expect(outcome.joined).toBe(false);
    expect((await intent.submit(() => Promise.resolve(2))).value).toBe(2);
  });

  it("releases the in-flight slot after a failure, so a retry is not refused", async () => {
    const intent = new WriteIntent();
    await intent.submit(() => Promise.reject(new Error("no"))).catch(() => undefined);
    await expect(intent.submit(() => Promise.resolve("second attempt"))).resolves.toMatchObject({
      value: "second attempt",
      joined: false,
    });
  });
});
