/*
 * How a matter reaches its own screen, pinned. The distinction this file protects is the one the
 * whole surface rests on: a matter read from the firm's record and an in-repo sample must never be
 * indistinguishable, because a screen that shows invented data as though it were the firm's is the
 * failure. The rest is the fallback order, and refusing a body that is not a matter.
 */
import { describe, expect, it } from "vitest";
import { matterFixtures } from "../src/lib/matters/fixtures.ts";
import {
  isMatterReadPayload,
  matterRecordFromRead,
  resolveMatterRecord,
} from "../src/lib/matters/matter-record.ts";

function answering(status: number, body?: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )) as unknown as typeof fetch;
}

const liveBody = {
  id: "matter_01JQ8N4E5Z2Y7W3K6M9P0R1T2V",
  title: "Estate of Marchetti",
  description: null,
  status: "open",
  matterTypeId: null,
  locationId: null,
  responsibleMemberId: "user_01",
  clientDisplayName: "Marchetti Family Trust",
  clientCode: "MAR-01",
  matterNumber: "2026-0301",
};

describe("resolveMatterRecord", () => {
  it("resolves a sample identifier from the fixtures without spending a request", async () => {
    let called = false;
    const fetchImpl = (() => {
      called = true;
      return Promise.reject(new Error("should not be called"));
    }) as unknown as typeof fetch;

    const fixture = matterFixtures[0];
    const record = await resolveMatterRecord(fetchImpl, fixture?.id ?? "");
    expect(record?.source).toBe("sample");
    expect(record?.title).toBe(fixture?.title);
    expect(called).toBe(false);
  });

  it("resolves a real identifier from the firm's record, marked live", async () => {
    const record = await resolveMatterRecord(answering(200, liveBody), liveBody.id);
    expect(record?.source).toBe("live");
    expect(record?.title).toBe("Estate of Marchetti");
    expect(record?.matterNumber).toBe("2026-0301");
  });

  it("leaves what the matter read does not carry absent rather than inventing it", async () => {
    const record = await resolveMatterRecord(answering(200, liveBody), liveBody.id);
    expect(record?.responsibleAttorneyName).toBeNull();
    expect(record?.eBilling).toBeNull();
    expect(record?.files).toEqual([]);
    expect(record?.timeEntries).toEqual([]);
    expect(record?.costs).toEqual([]);
  });

  it("resolves nothing for an identifier that is neither, so the route can 404", async () => {
    expect(
      await resolveMatterRecord(answering(404, { title: "Not found" }), "matter_absent"),
    ).toBeUndefined();
  });

  it("resolves nothing when there is no session rather than rendering a blank matter", async () => {
    expect(await resolveMatterRecord(answering(401), "matter_absent")).toBeUndefined();
  });

  it("resolves nothing when nothing answers at all", async () => {
    const dead = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(await resolveMatterRecord(dead, "matter_absent")).toBeUndefined();
  });

  it("refuses a body that is not a matter, rather than rendering one with blank fields", async () => {
    expect(
      await resolveMatterRecord(answering(200, { message: "hello" }), "matter_absent"),
    ).toBeUndefined();
  });
});

describe("isMatterReadPayload", () => {
  it("accepts the matter read's shape", () => {
    expect(isMatterReadPayload(liveBody)).toBe(true);
  });

  it("rejects a body with an unknown status", () => {
    expect(isMatterReadPayload({ ...liveBody, status: "archived" })).toBe(false);
  });

  it("rejects nothing at all", () => {
    expect(isMatterReadPayload(null)).toBe(false);
    expect(isMatterReadPayload("matter")).toBe(false);
  });
});

describe("matterRecordFromRead", () => {
  it("marks every record it builds as live", () => {
    expect(matterRecordFromRead(liveBody as never).source).toBe("live");
  });
});
