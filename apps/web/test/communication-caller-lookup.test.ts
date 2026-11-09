import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client } from "@magna-carta/api-client/client";
import {
  areaCodeLine,
  callerIdentityLine,
  localTimeLine,
  lookUpCallerIdentity,
  lookupNumberFor,
  readCallerLookup,
} from "$lib/communications/caller-lookup.ts";

describe("lookupNumberFor", () => {
  it("answers E.164 for a whole number, however it was grouped", () => {
    expect(lookupNumberFor("US", "(702) 555-0142")).toBe("+17025550142");
    expect(lookupNumberFor("US", "702.555.0142")).toBe("+17025550142");
    expect(lookupNumberFor("GB", "020 7946 0018")).toBe("+442079460018");
  });

  it("asks nothing while the number is still being typed", () => {
    expect(lookupNumberFor("US", "")).toBeNull();
    expect(lookupNumberFor("US", "(702) 555-01")).toBeNull();
  });
});

describe("the lines it prints", () => {
  it("shows the network's name as the network holds it, with the kind of line", () => {
    expect(
      callerIdentityLine({
        callerName: "SMITH JOHN",
        lineType: "mobile",
        carrierName: null,
        lookedUpAt: "2026-11-09T21:00:00.000Z",
      }),
    ).toBe("SMITH JOHN · Mobile");
    expect(
      callerIdentityLine({
        callerName: null,
        lineType: null,
        carrierName: null,
        lookedUpAt: "2026-11-09T21:00:00.000Z",
      }),
    ).toBe("No name on record");
  });

  it("says where a number was issued, not where the caller is", () => {
    const nevada = { areaCode: "702", region: "Nevada", place: null, timeZone: null };
    expect(areaCodeLine(nevada)).toBe("702 · Nevada number");
    expect(areaCodeLine({ ...nevada, place: "Henderson, NV" })).toBe(
      "702 · Henderson, Nevada number",
    );
    expect(
      areaCodeLine({
        areaCode: "202",
        region: "Washington D.C.",
        place: "Washington, DC",
        timeZone: null,
      }),
    ).toBe("202 · Washington D.C. number");
  });

  it("tells the time where the number was issued, or nothing when the zone is not known", () => {
    const at = new Date("2026-11-09T23:19:00.000Z");
    const nevada = { areaCode: "702", region: "Nevada", place: null };
    expect(localTimeLine({ ...nevada, timeZone: "America/Los_Angeles" }, at)).toMatch(
      /^3:19\sPM PST there$/,
    );
    expect(localTimeLine({ ...nevada, timeZone: null }, at)).toBeNull();
  });
});

describe("the two requests", () => {
  const ORIGIN = "https://firm.example";
  const requests: Request[] = [];

  function answering(body: unknown): void {
    client.setConfig({
      baseUrl: ORIGIN,
      fetch: ((request: Request) => {
        requests.push(request);
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }) as unknown as typeof fetch,
    });
  }

  beforeEach(() => {
    requests.length = 0;
  });

  afterEach(() => {
    client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
  });

  it("sends the number in the body, never the URL, because it is a client's", async () => {
    answering({
      directoryMatches: [],
      areaCode: null,
      callerIdentity: null,
      paidLookup: "unavailable",
    });
    const free = await readCallerLookup("+17025550142");
    expect(free.kind).toBe("ok");
    expect(requests[0]?.url).toBe(`${ORIGIN}/api/v1/communications/caller-lookup`);
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.text()).toBe(JSON.stringify({ number: "+17025550142" }));

    answering({ outcome: "unavailable" });
    const paid = await lookUpCallerIdentity("+17025550142", "key-1");
    expect(paid).toEqual({ kind: "ok", value: { outcome: "unavailable" } });
    expect(requests[1]?.url).toBe(`${ORIGIN}/api/v1/communications/caller-lookup/caller-identity`);
    expect(requests[1]?.url).not.toContain("7025550142");
    expect(requests[1]?.headers.get("idempotency-key")).toBe("key-1");
  });
});
