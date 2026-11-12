import { describe, expect, it } from "vitest";
import { readGraphNotices } from "../src/change-notices.ts";

describe("reading what Microsoft Graph posts to a subscription's address", () => {
  it("takes the secret from a notice that something changed, and nothing about the change", () => {
    expect(
      readGraphNotices({
        value: [
          {
            subscriptionId: "sub-1",
            subscriptionExpirationDateTime: "2026-11-13T12:00:00.000Z",
            clientState: "secret-1",
            changeType: "updated",
            resource: "Users/u/Events/e",
            tenantId: "tenant",
            resourceData: { "@odata.type": "#Microsoft.Graph.Event", id: "e" },
          },
        ],
      }),
    ).toEqual([{ secret: "secret-1" }]);
  });

  it("reads each notice about the subscription itself", () => {
    const notice = (lifecycleEvent: string) => ({
      subscriptionId: "sub-1",
      clientState: "secret-1",
      lifecycleEvent,
    });
    expect(
      readGraphNotices({
        value: [
          notice("reauthorizationRequired"),
          notice("subscriptionRemoved"),
          notice("missed"),
          notice("somethingNewer"),
        ],
      }),
    ).toEqual([
      { secret: "secret-1", lifecycle: "renew" },
      { secret: "secret-1", lifecycle: "replace" },
      { secret: "secret-1", lifecycle: "missed" },
      { secret: "secret-1", lifecycle: "renew" },
    ]);
  });

  it("holds no notice in a body that is not Graph's, and drops one with no secret", () => {
    expect(readGraphNotices(undefined)).toEqual([]);
    expect(readGraphNotices("text")).toEqual([]);
    expect(readGraphNotices({ value: "no" })).toEqual([]);
    expect(readGraphNotices({ value: [{ changeType: "updated" }, { clientState: "" }] })).toEqual(
      [],
    );
    expect(readGraphNotices({ value: [{ clientState: "x".repeat(129) }] })).toEqual([]);
  });
});
