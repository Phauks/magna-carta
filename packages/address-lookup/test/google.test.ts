import { describe, expect, it } from "vitest";
import { encodeOpaqueHandle } from "../src/opaque-handle.ts";
import {
  DETAILS_FIELD_MASK,
  googleAddressLookupPort,
  partsFromDetails,
  type GoogleFetch,
} from "../src/google.ts";

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function scriptedFetch(answer: (url: string) => Response): { fetch: GoogleFetch; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(answer(url));
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function header(call: Call | undefined, name: string): string | undefined {
  return (call?.init?.headers as Record<string, string> | undefined)?.[name];
}

const RENO_DETAILS = {
  addressComponents: [
    { longText: "14", shortText: "14", types: ["street_number"] },
    { longText: "Rosewood Drive", shortText: "Rosewood Dr", types: ["route"] },
    { longText: "Reno", shortText: "Reno", types: ["locality", "political"] },
    {
      longText: "Nevada",
      shortText: "NV",
      types: ["administrative_area_level_1", "political"],
    },
    { longText: "United States", shortText: "US", types: ["country", "political"] },
    { longText: "89501", shortText: "89501", types: ["postal_code"] },
  ],
  postalAddress: {
    regionCode: "US",
    postalCode: "89501",
    administrativeArea: "NV",
    locality: "Reno",
    addressLines: ["14 Rosewood Dr"],
  },
  location: { latitude: 39.53, longitude: -119.81 },
};

describe("suggest", () => {
  it("asks Autocomplete in the form's country, with the key in a header and the query in the body", async () => {
    const { fetch, calls } = scriptedFetch(() =>
      json({
        suggestions: [
          {
            placePrediction: {
              placeId: "ChIJ-reno_14",
              text: { text: "14 Rosewood Dr, Reno, NV, USA" },
            },
          },
          { queryPrediction: { text: { text: "rosewood" } } },
        ],
      }),
    );
    const answer = await googleAddressLookupPort("key-secret", fetch).suggest({
      query: "  14 Rose ",
      country: "us",
    });

    const asked = calls[0];
    expect(asked?.url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(asked?.init?.method).toBe("POST");
    expect(header(asked, "x-goog-api-key")).toBe("key-secret");
    // Neither the key nor the client's address is in the URL, which is what the platform logs.
    expect(asked?.url).not.toContain("key-secret");
    expect(asked?.url).not.toContain("Rose");
    expect(JSON.parse(String(asked?.init?.body))).toEqual({
      input: "14 Rose",
      includedRegionCodes: ["us"],
      regionCode: "us",
    });
    // A query prediction is a search phrase, not a place, and is not offered.
    expect(answer).toEqual({
      ok: true,
      suggestions: [
        {
          suggestionId: expect.any(String),
          label: "14 Rosewood Dr, Reno, NV, USA",
          parts: { country: "US" },
          kind: "address",
        },
      ],
    });
  });

  it("asks nothing for nothing typed", async () => {
    const { fetch, calls } = scriptedFetch(() => json({}));
    expect(
      await googleAddressLookupPort("k", fetch).suggest({ query: "  ", country: "US" }),
    ).toEqual({ ok: true, suggestions: [] });
    expect(calls).toHaveLength(0);
  });

  it("reports a refusal by its status and nothing else", async () => {
    const { fetch } = scriptedFetch(() => json({ error: { message: "API key not valid" } }, 403));
    const answer = await googleAddressLookupPort("k", fetch).suggest({
      query: "14 Rose",
      country: "US",
    });
    expect(answer).toEqual({
      ok: false,
      reason: "adapter-error",
      detail: "The address service refused the request (status 403).",
    });
  });
});

describe("resolve", () => {
  async function offered(fetch: GoogleFetch): Promise<string> {
    const answer = await googleAddressLookupPort("k", fetch).suggest({
      query: "14 Rose",
      country: "US",
    });
    if (!answer.ok || answer.suggestions[0] === undefined) throw new Error("no offer");
    return answer.suggestions[0].suggestionId;
  }

  it("asks Place Details inside the Essentials tier and answers the record's parts and location", async () => {
    const { fetch, calls } = scriptedFetch((url) =>
      url.endsWith(":autocomplete")
        ? json({
            suggestions: [
              { placePrediction: { placeId: "ChIJ-reno_14", text: { text: "14 Rosewood Dr" } } },
            ],
          })
        : json(RENO_DETAILS),
    );
    const port = googleAddressLookupPort("k", fetch);
    const answer = await port.resolve({ suggestionId: await offered(fetch) });

    const asked = calls[1];
    expect(asked?.url).toBe("https://places.googleapis.com/v1/places/ChIJ-reno_14");
    expect(header(asked, "x-goog-fieldmask")).toBe(DETAILS_FIELD_MASK);
    expect(answer).toEqual({
      ok: true,
      resolution: "address",
      parts: {
        street: "14 Rosewood Dr",
        city: "Reno",
        region: "NV",
        postal: "89501",
        country: "US",
      },
      location: { latitude: 39.53, longitude: -119.81 },
    });
  });

  it("answers expired for an identifier it did not mint, and asks nobody", async () => {
    const { fetch, calls } = scriptedFetch(() => json(RENO_DETAILS));
    const port = googleAddressLookupPort("k", fetch);
    expect(await port.resolve({ suggestionId: "not-a-handle" })).toEqual({
      ok: true,
      resolution: "expired",
    });
    // A place ID with a path in it did not come from Google.
    const forged = encodeOpaqueHandle({ placeIdentifier: "../billing", country: "US" });
    expect(await port.resolve({ suggestionId: forged })).toEqual({
      ok: true,
      resolution: "expired",
    });
    expect(calls).toHaveLength(0);
  });

  it("answers expired for a place Google no longer knows", async () => {
    const { fetch } = scriptedFetch(() => json({ error: {} }, 404));
    const handle = encodeOpaqueHandle({ placeIdentifier: "ChIJ-gone", country: "US" });
    expect(await googleAddressLookupPort("k", fetch).resolve({ suggestionId: handle })).toEqual({
      ok: true,
      resolution: "expired",
    });
  });
});

describe("partsFromDetails", () => {
  it("puts a unit Google knows on the second line behind #", () => {
    const parts = partsFromDetails(
      {
        addressComponents: [
          ...RENO_DETAILS.addressComponents,
          { longText: "4B", shortText: "4B", types: ["subpremise"] },
        ],
        postalAddress: { ...RENO_DETAILS.postalAddress, addressLines: [] },
      },
      "US",
    );
    expect(parts.street).toBe("14 Rosewood Dr");
    expect(parts.streetTwo).toBe("# 4B");
  });

  it("takes the street line Google formats for the country, and the country it names", () => {
    const parts = partsFromDetails(
      {
        addressComponents: [
          { longText: "Unter den Linden", shortText: "Unter den Linden", types: ["route"] },
          { longText: "77", shortText: "77", types: ["street_number"] },
          { longText: "Berlin", shortText: "Berlin", types: ["locality"] },
          { longText: "10117", shortText: "10117", types: ["postal_code"] },
          { longText: "Germany", shortText: "DE", types: ["country"] },
        ],
        postalAddress: { regionCode: "DE", addressLines: ["Unter den Linden 77"] },
      },
      "DE",
    );
    expect(parts).toEqual({
      street: "Unter den Linden 77",
      city: "Berlin",
      postal: "10117",
      country: "DE",
    });
  });
});
