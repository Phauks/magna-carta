import { describe, expect, it } from "vitest";
import {
  SEARCH_CHARACTER_LIMIT,
  smartyAddressLookupPort,
  type SmartyFetch,
} from "../src/smarty.ts";

const CREDENTIALS = { authenticationIdentifier: "id-123", authenticationToken: "token-secret" };

/** A fetch that records every URL it was asked for and answers from a script. */
function scriptedFetch(answer: (url: URL) => Response): { fetch: SmartyFetch; urls: URL[] } {
  const urls: URL[] = [];
  return {
    urls,
    fetch: (url) => {
      const parsed = new URL(url);
      urls.push(parsed);
      return Promise.resolve(answer(parsed));
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("the United States", () => {
  it("asks the postal service's autocomplete, authenticated, with location bias switched off", async () => {
    const { fetch, urls } = scriptedFetch(() =>
      json({
        suggestions: [
          {
            street_line: "123 E 103rd St",
            secondary: "Apt A1",
            city: "Chicago",
            state: "IL",
            zipcode: "60628",
            entries: 0,
          },
        ],
      }),
    );
    const answer = await smartyAddressLookupPort(CREDENTIALS, fetch).suggest({
      query: "  123 E 103  ",
      country: "us",
      limit: 50,
    });

    const asked = urls[0]!;
    expect(asked.origin + asked.pathname).toBe("https://us-autocomplete-pro.api.smarty.com/lookup");
    expect(asked.searchParams.get("auth-id")).toBe("id-123");
    expect(asked.searchParams.get("auth-token")).toBe("token-secret");
    expect(asked.searchParams.get("search")).toBe("123 E 103");
    expect(asked.searchParams.get("max_results")).toBe("10"); // clamped to the service's ceiling
    // The caller is a Worker at the edge; biasing toward ITS location would be biasing toward a data
    // centre.
    expect(asked.searchParams.get("prefer_geolocation")).toBe("none");

    expect(answer).toMatchObject({
      ok: true,
      suggestions: [
        {
          label: "123 E 103rd St Apt A1, Chicago, IL 60628",
          kind: "address",
          parts: {
            street: "123 E 103rd St",
            streetTwo: "Apt A1",
            city: "Chicago",
            region: "IL",
            postal: "60628",
            country: "US",
          },
        },
      ],
    });
  });

  it("sends at most thirty-two characters, the prefix the service accepts", async () => {
    const { fetch, urls } = scriptedFetch(() => json({ suggestions: [] }));
    await smartyAddressLookupPort(CREDENTIALS, fetch).suggest({
      query: "1042 West Center Street Apartment 108",
      country: "US",
    });
    expect(urls[0]!.searchParams.get("search")).toHaveLength(SEARCH_CHARACTER_LIMIT);
  });

  it("asks nothing, and pays for nothing, when nothing has been typed", async () => {
    const { fetch, urls } = scriptedFetch(() => json({ suggestions: [] }));
    const answer = await smartyAddressLookupPort(CREDENTIALS, fetch).suggest({
      query: "   ",
      country: "US",
    });
    expect(answer).toEqual({ ok: true, suggestions: [] });
    expect(urls).toHaveLength(0);
  });

  it("resolves a chosen address from the offer itself, with no second request", async () => {
    const { fetch, urls } = scriptedFetch(() =>
      json({
        suggestions: [
          {
            street_line: "14 Rosewood Dr",
            secondary: "",
            city: "Reno",
            state: "NV",
            zipcode: "89501",
            entries: 0,
          },
        ],
      }),
    );
    const port = smartyAddressLookupPort(CREDENTIALS, fetch);
    const offers = await port.suggest({ query: "14 Rose", country: "US" });
    if (!offers.ok) throw new Error("expected offers");

    const chosen = await port.resolve({ suggestionId: offers.suggestions[0]!.suggestionId });
    expect(chosen).toEqual({
      ok: true,
      resolution: "address",
      parts: {
        street: "14 Rosewood Dr",
        city: "Reno",
        region: "NV",
        postal: "89501",
        country: "US",
      },
    });
    expect(urls).toHaveLength(1); // the suggest, and nothing for the resolve
  });

  it("offers a building with many units as a group, and opens it in the service's own format", async () => {
    const { fetch, urls } = scriptedFetch((url) =>
      url.searchParams.has("selected")
        ? json({
            suggestions: [
              {
                street_line: "1042 W Center St",
                secondary: "Apt 108",
                city: "Orem",
                state: "UT",
                zipcode: "84057",
                entries: 1,
              },
              {
                street_line: "1042 W Center St",
                secondary: "Apt 109",
                city: "Orem",
                state: "UT",
                zipcode: "84057",
                entries: 1,
              },
            ],
          })
        : json({
            suggestions: [
              {
                street_line: "1042 W Center St",
                secondary: "Apt",
                city: "Orem",
                state: "UT",
                zipcode: "84057",
                entries: 24,
              },
            ],
          }),
    );
    const port = smartyAddressLookupPort(CREDENTIALS, fetch);
    const offers = await port.suggest({ query: "1042 W Cen", country: "US" });
    if (!offers.ok) throw new Error("expected offers");
    expect(offers.suggestions[0]).toMatchObject({ kind: "group", count: 24 });

    const opened = await port.resolve({ suggestionId: offers.suggestions[0]!.suggestionId });
    // Exactly the documented shape: street line, secondary, (count), city, state, ZIP code.
    expect(urls[1]!.searchParams.get("selected")).toBe("1042 W Center St Apt (24) Orem UT 84057");
    expect(opened).toMatchObject({
      ok: true,
      resolution: "group",
      suggestions: [
        { kind: "address", parts: { streetTwo: "Apt 108" } },
        { kind: "address", parts: { streetTwo: "Apt 109" } },
      ],
    });
  });
});

describe("everywhere else", () => {
  it("asks the international service in alpha-3, and offers summary lines before any charge", async () => {
    const { fetch, urls } = scriptedFetch(() =>
      json({
        candidates: [
          { entries: 1, address_text: "123 Main St Winnipeg, MB, R3C", address_id: "ABC123" },
        ],
      }),
    );
    const answer = await smartyAddressLookupPort(CREDENTIALS, fetch).suggest({
      query: "123 Main",
      country: "CA",
    });
    const asked = urls[0]!;
    expect(asked.origin + asked.pathname).toBe(
      "https://international-autocomplete.api.smarty.com/v2/lookup",
    );
    expect(asked.searchParams.get("country")).toBe("CAN");
    expect(answer).toMatchObject({
      ok: true,
      suggestions: [
        { label: "123 Main St Winnipeg, MB, R3C", kind: "address", parts: { country: "CA" } },
      ],
    });
  });

  it("resolves an offer with the charged lookup, into the parts a record stores", async () => {
    const { fetch, urls } = scriptedFetch((url) =>
      url.pathname.endsWith("/ABC123")
        ? json({
            candidates: [
              {
                street: "1-123 Main St",
                locality: "Fredericton",
                administrative_area: "NB",
                administrative_area_short: "NB",
                administrative_area_long: "New Brunswick",
                postal_code: "E3A 1C7",
                country_iso3: "CAN",
              },
            ],
          })
        : json({
            candidates: [{ entries: 1, address_text: "1-123 Main St", address_id: "ABC123" }],
          }),
    );
    const port = smartyAddressLookupPort(CREDENTIALS, fetch);
    const offers = await port.suggest({ query: "123 Main", country: "CA" });
    if (!offers.ok) throw new Error("expected offers");

    const chosen = await port.resolve({ suggestionId: offers.suggestions[0]!.suggestionId });
    expect(urls[1]!.searchParams.get("country")).toBe("CAN");
    expect(chosen).toEqual({
      ok: true,
      resolution: "address",
      parts: {
        street: "1-123 Main St",
        city: "Fredericton",
        region: "NB", // the short form a country's own post writes
        postal: "E3A 1C7",
        country: "CA", // back to the alpha-2 the rest of the product speaks
      },
    });
  });

  it("opens an international group into the addresses inside it", async () => {
    const { fetch } = scriptedFetch((url) =>
      url.pathname.endsWith("/GROUP1")
        ? json({
            candidates: [
              {
                street: "Flat 1, 10 High St",
                locality: "Bath",
                postal_code: "BA1 1AA",
                country_iso3: "GBR",
              },
              {
                street: "Flat 2, 10 High St",
                locality: "Bath",
                postal_code: "BA1 1AA",
                country_iso3: "GBR",
              },
            ],
          })
        : json({
            candidates: [{ entries: 2, address_text: "10 High St, Bath", address_id: "GROUP1" }],
          }),
    );
    const port = smartyAddressLookupPort(CREDENTIALS, fetch);
    const offers = await port.suggest({ query: "10 High", country: "GB" });
    if (!offers.ok) throw new Error("expected offers");
    expect(offers.suggestions[0]).toMatchObject({ kind: "group", count: 2 });

    const opened = await port.resolve({ suggestionId: offers.suggestions[0]!.suggestionId });
    expect(opened).toMatchObject({
      ok: true,
      resolution: "group",
      suggestions: [
        { kind: "address", parts: { street: "Flat 1, 10 High St", country: "GB" } },
        { kind: "address", parts: { street: "Flat 2, 10 High St", country: "GB" } },
      ],
    });
  });

  it("answers no-coverage for a country with no alpha-3, without asking anybody", async () => {
    const { fetch, urls } = scriptedFetch(() => json({ candidates: [] }));
    const answer = await smartyAddressLookupPort(CREDENTIALS, fetch).suggest({
      query: "Rruga",
      country: "XK",
    });
    expect(answer).toEqual({ ok: false, reason: "no-coverage", detail: "XK" });
    expect(urls).toHaveLength(0);
  });
});

describe("a failure", () => {
  it("names the provider's status, and never the query, the URL or the credentials", async () => {
    const { fetch } = scriptedFetch(() => json({ errors: [] }, 402));
    const answer = await smartyAddressLookupPort(CREDENTIALS, fetch).suggest({
      query: "14 Rosewood",
      country: "US",
    });
    expect(answer).toMatchObject({ ok: false, reason: "adapter-error" });
    const detail = answer.ok ? "" : (answer.detail ?? "");
    expect(detail).toContain("402");
    expect(detail).not.toContain("Rosewood");
    expect(detail).not.toContain("token-secret");
    expect(detail).not.toContain("smarty.com");
  });

  it("reports a service that did not answer as a failure rather than as no matches", async () => {
    const answer = await smartyAddressLookupPort(CREDENTIALS, () =>
      Promise.reject(new Error("connect ECONNREFUSED https://x?auth-token=token-secret&search=14")),
    ).suggest({ query: "14 Rosewood", country: "US" });
    expect(answer).toMatchObject({ ok: false, reason: "adapter-error" });
    // The thrown message quoted the URL; the detail must not have carried it through.
    expect(answer.ok ? "" : answer.detail).not.toContain("token-secret");
  });

  it("reports an answer that is not JSON as a failure", async () => {
    const answer = await smartyAddressLookupPort(CREDENTIALS, () =>
      Promise.resolve(new Response("<html>gateway</html>", { status: 200 })),
    ).suggest({ query: "14 Rosewood", country: "US" });
    expect(answer).toMatchObject({ ok: false, reason: "adapter-error" });
  });
});

describe("an identifier that came back from a browser", () => {
  it("is the port's expired answer when it is anything this adapter did not mint", async () => {
    const { fetch, urls } = scriptedFetch(() => json({}));
    const port = smartyAddressLookupPort(CREDENTIALS, fetch);
    const forged = ["", "not-base64!!", btoa("[]"), btoa(JSON.stringify({ route: "elsewhere" }))];
    const answers = await Promise.all(forged.map((suggestionId) => port.resolve({ suggestionId })));
    for (const answer of answers) expect(answer).toEqual({ ok: true, resolution: "expired" });
    expect(urls).toHaveLength(0);
  });

  it("carries only the known address parts, whatever else was put in it", async () => {
    const forged = btoa(
      JSON.stringify({
        route: "united-states-address",
        parts: { street: "1 Main St", country: "US", injected: "<script>", city: 42 },
      }),
    ).replaceAll("=", "");
    const answer = await smartyAddressLookupPort(CREDENTIALS, () =>
      Promise.reject(new Error("must not be called")),
    ).resolve({ suggestionId: forged });
    expect(answer).toEqual({
      ok: true,
      resolution: "address",
      parts: { street: "1 Main St", country: "US" },
    });
  });
});
