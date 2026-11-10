import { describe, expect, it } from "vitest";
import { deferredCallerLookupPort } from "../src/port.ts";
import { identityFromTelnyxBody, telnyxCallerLookupPort } from "../src/telnyx.ts";

const NEVADA = { countryCallingCode: "1", nationalNumber: "7025550142" };

/** A fetch that records what it was asked and answers from a script. */
function scriptedFetch(answer: () => Response | Promise<Response>): {
  transport: typeof fetch;
  requests: { url: string; init: RequestInit | undefined }[];
} {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const transport = ((input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return Promise.resolve(answer());
  }) as typeof fetch;
  return { transport, requests };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("telnyxCallerLookupPort", () => {
  it("asks for the caller name and the carrier in one request, with the key as a bearer token", async () => {
    const { transport, requests } = scriptedFetch(() =>
      json({ data: { caller_name: { caller_name: "SMITH JOHN" }, carrier: { type: "mobile" } } }),
    );
    await telnyxCallerLookupPort({ apiKey: "key-123" }, transport).lookUp(NEVADA);

    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url);
    expect(url.origin + url.pathname).toBe(
      "https://api.telnyx.com/v2/number_lookup/%2B17025550142",
    );
    expect(url.searchParams.getAll("type")).toEqual(["caller-name", "carrier"]);
    expect(new Headers(requests[0]!.init?.headers).get("authorization")).toBe("Bearer key-123");
  });

  it("reads the name, the line type and the carrier", async () => {
    const { transport } = scriptedFetch(() =>
      json({
        data: {
          caller_name: { caller_name: " SMITH JOHN ", error_code: null },
          carrier: { type: "fixed line", name: "CENTRAL TELEPHONE CO - NV" },
        },
      }),
    );
    const outcome = await telnyxCallerLookupPort({ apiKey: "k" }, transport).lookUp(NEVADA);
    expect(outcome).toEqual({
      kind: "found",
      identity: {
        callerName: "SMITH JOHN",
        lineType: "fixed",
        carrierName: "CENTRAL TELEPHONE CO - NV",
      },
    });
  });

  it("asks nothing about a number outside North America, because there is no caller-name data to pay for", async () => {
    const { transport, requests } = scriptedFetch(() => json({}));
    const outcome = await telnyxCallerLookupPort({ apiKey: "k" }, transport).lookUp({
      countryCallingCode: "44",
      nationalNumber: "2079460000",
    });
    expect(outcome).toEqual({ kind: "not-covered" });
    expect(requests).toHaveLength(0);
  });

  it("answers a refusal, a dropped connection and an unreadable body as failures, never a throw", async () => {
    const refused = scriptedFetch(() => json({ errors: [] }, 401));
    expect(await telnyxCallerLookupPort({ apiKey: "k" }, refused.transport).lookUp(NEVADA)).toEqual(
      { kind: "failed", reason: "refused" },
    );

    const dropped = (() => Promise.reject(new TypeError("network"))) as typeof fetch;
    expect(await telnyxCallerLookupPort({ apiKey: "k" }, dropped).lookUp(NEVADA)).toEqual({
      kind: "failed",
      reason: "transport",
    });

    const garbled = scriptedFetch(() => new Response("not json", { status: 200 }));
    expect(await telnyxCallerLookupPort({ apiKey: "k" }, garbled.transport).lookUp(NEVADA)).toEqual(
      { kind: "failed", reason: "malformed" },
    );
  });
});

describe("identityFromTelnyxBody", () => {
  it("holds an empty name as absent rather than as an empty string", () => {
    expect(
      identityFromTelnyxBody({ data: { caller_name: { caller_name: "" }, carrier: {} } }),
    ).toEqual({ callerName: null, lineType: null, carrierName: null });
  });

  it("maps a line type this product does not distinguish to other, and unknown to absent", () => {
    expect(identityFromTelnyxBody({ data: { carrier: { type: "pager" } } })?.lineType).toBe(
      "other",
    );
    expect(identityFromTelnyxBody({ data: { carrier: { type: "unknown" } } })?.lineType).toBeNull();
    expect(identityFromTelnyxBody({ data: { carrier: { type: "toll free" } } })?.lineType).toBe(
      "tollFree",
    );
  });

  it("refuses a body with no data object", () => {
    expect(identityFromTelnyxBody({ errors: [] })).toBeNull();
    expect(identityFromTelnyxBody(null)).toBeNull();
  });
});

describe("deferredCallerLookupPort", () => {
  it("answers that no engine is provisioned", async () => {
    expect(await deferredCallerLookupPort().lookUp(NEVADA)).toEqual({
      kind: "engine-not-implemented",
    });
  });
});
