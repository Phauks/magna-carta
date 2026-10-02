/*
 * The self-hosted adapter against a scripted engine binding.
 *
 * What is pinned: the engine is asked in its own vocabulary and answered in the form's — a street
 * line, a "#" second line, a city a person would write; identifiers resolve without a request for an
 * address and with one for a building; an identifier the adapter did not mint is `expired`; and the
 * engine's two non-answers stay answers, while a refused or garbled reply is a failure that never
 * quotes what was typed.
 */
import { describe, expect, it } from "vitest";
import { inWrittenCase, selfHostedAddressLookupPort } from "../src/self-hosted.ts";

interface Asked {
  readonly operation: string;
  readonly body: Record<string, unknown>;
}

function scriptedEngine(answer: (asked: Asked) => Response) {
  const asked: Asked[] = [];
  return {
    asked,
    engine: {
      async fetch(input: string, init?: RequestInit) {
        const request = {
          operation: new URL(input).pathname,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        };
        asked.push(request);
        return answer(request);
      },
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const LAWSON = {
  number: "1402",
  street: "LAWSON CREEK WAY",
  unit: "",
  city: "WAKE FOREST",
  region: "NC",
  postcode: "27587",
  longitude: -78.51,
  latitude: 35.97,
};

const CENTER_BUILDING = {
  number: "1042",
  street: "W CENTER ST",
  city: "OREM",
  region: "UT",
  postcode: "84057",
};

describe("suggest", () => {
  it("asks in the engine's vocabulary and offers in the form's", async () => {
    const { engine, asked } = scriptedEngine(() =>
      json({
        outcome: "suggestions",
        offers: [
          { kind: "address", label: "ignored", address: LAWSON },
          { kind: "group", label: "ignored", count: 24, building: CENTER_BUILDING },
        ],
      }),
    );
    const answer = await selfHostedAddressLookupPort(engine).suggest({
      country: "us",
      query: "1402 lawson",
      limit: 50,
      near: "nc",
    });

    expect(asked).toEqual([
      {
        operation: "/suggestions",
        body: { country: "US", query: "1402 lawson", limit: 10, near: "NC" },
      },
    ]);
    if (!answer.ok) throw new Error("expected suggestions");
    expect(answer.suggestions.map(({ suggestionId: _, ...offer }) => offer)).toEqual([
      {
        label: "1402 Lawson Creek Way, Wake Forest, NC 27587",
        parts: {
          street: "1402 Lawson Creek Way",
          city: "Wake Forest",
          region: "NC",
          postal: "27587",
          country: "US",
        },
        kind: "address",
      },
      {
        label: "1042 W Center St, Orem, UT 84057",
        parts: {
          street: "1042 W Center St",
          city: "Orem",
          region: "UT",
          postal: "84057",
          country: "US",
        },
        kind: "group",
        count: 24,
      },
    ]);
  });

  it("puts a unit on the second line behind the designator the postal service accepts for any unit", async () => {
    const { engine } = scriptedEngine(() =>
      json({
        outcome: "suggestions",
        offers: [{ kind: "address", address: { ...LAWSON, unit: "4B" } }],
      }),
    );
    const answer = await selfHostedAddressLookupPort(engine).suggest({
      country: "US",
      query: "1402 lawson",
    });
    if (!answer.ok) throw new Error("expected suggestions");
    expect(answer.suggestions[0]?.parts.streetTwo).toBe("#4B");
    expect(answer.suggestions[0]?.label).toBe("1402 Lawson Creek Way #4B, Wake Forest, NC 27587");
  });

  it("drops an offer the engine described badly rather than offering half an address", async () => {
    const { engine } = scriptedEngine(() =>
      json({
        outcome: "suggestions",
        offers: [
          { kind: "address", address: { ...LAWSON, street: "" } },
          { kind: "address", address: { ...LAWSON, latitude: 400 } },
          { kind: "group", building: { ...CENTER_BUILDING, number: "" } },
          { kind: "something-else" },
          { kind: "address", address: LAWSON },
        ],
      }),
    );
    const answer = await selfHostedAddressLookupPort(engine).suggest({
      country: "US",
      query: "1402 lawson",
    });
    if (!answer.ok) throw new Error("expected suggestions");
    expect(answer.suggestions).toHaveLength(1);
  });

  it("keeps the engine's two non-answers as answers", async () => {
    const uncovered = await selfHostedAddressLookupPort(
      scriptedEngine(() => json({ outcome: "no-coverage" })).engine,
    ).suggest({ country: "fr", query: "12 rue" });
    expect(uncovered).toEqual({ ok: false, reason: "no-coverage", detail: "FR" });

    const unbuilt = await selfHostedAddressLookupPort(
      scriptedEngine(() => json({ outcome: "unavailable" })).engine,
    ).suggest({ country: "US", query: "12 main" });
    expect(unbuilt).toEqual({ ok: false, reason: "engine-not-implemented" });
  });

  it("fails without quoting what was typed when the engine refuses, garbles, or does not answer", async () => {
    const typed = "1402 lawson creek";
    const answers = await Promise.all([
      selfHostedAddressLookupPort(scriptedEngine(() => json({}, 503)).engine).suggest({
        country: "US",
        query: typed,
      }),
      selfHostedAddressLookupPort(
        scriptedEngine(() => new Response("not json", { status: 200 })).engine,
      ).suggest({ country: "US", query: typed }),
      selfHostedAddressLookupPort({
        fetch: () => Promise.reject(new Error(`connection lost asking for ${typed}`)),
      }).suggest({ country: "US", query: typed }),
    ]);
    for (const answer of answers) {
      expect(answer.ok).toBe(false);
      if (answer.ok) continue;
      expect(answer.reason).toBe("adapter-error");
      expect(answer.detail).not.toContain("lawson");
    }
    expect(answers[0]).toMatchObject({ detail: expect.stringContaining("503") });
  });
});

describe("resolve", () => {
  async function offersFor(engineAnswer: unknown) {
    const { engine, asked } = scriptedEngine((request) =>
      request.operation === "/suggestions" ? json(engineAnswer) : json({ outcome: "unavailable" }),
    );
    const port = selfHostedAddressLookupPort(engine);
    const answer = await port.suggest({ country: "US", query: "1402 lawson" });
    if (!answer.ok) throw new Error("expected suggestions");
    return { port, asked, offers: answer.suggestions };
  }

  it("resolves an address from its own identifier, with its coordinates, asking nobody", async () => {
    const { port, asked, offers } = await offersFor({
      outcome: "suggestions",
      offers: [{ kind: "address", address: LAWSON }],
    });
    const resolution = await port.resolve({ suggestionId: offers[0]?.suggestionId ?? "" });
    expect(resolution).toEqual({
      ok: true,
      resolution: "address",
      parts: offers[0]?.parts,
      location: { latitude: 35.97, longitude: -78.51 },
    });
    expect(asked).toHaveLength(1);
  });

  it("opens a building by asking the engine for its units", async () => {
    const { engine, asked } = scriptedEngine((request) =>
      request.operation === "/suggestions"
        ? json({
            outcome: "suggestions",
            offers: [{ kind: "group", count: 2, building: CENTER_BUILDING }],
          })
        : json({
            outcome: "units",
            addresses: [
              { ...LAWSON, ...CENTER_BUILDING, unit: "101" },
              { ...LAWSON, ...CENTER_BUILDING, unit: "102" },
            ],
          }),
    );
    const port = selfHostedAddressLookupPort(engine);
    const offered = await port.suggest({ country: "US", query: "1042 w center" });
    if (!offered.ok) throw new Error("expected suggestions");
    const resolution = await port.resolve({ suggestionId: offered.suggestions[0]?.suggestionId ?? "" });

    expect(asked[1]).toEqual({
      operation: "/units",
      body: { country: "US", building: CENTER_BUILDING },
    });
    if (!resolution.ok || resolution.resolution !== "group") throw new Error("expected a group");
    expect(resolution.suggestions.map((unit) => unit.label)).toEqual([
      "1042 W Center St #101, Orem, UT 84057",
      "1042 W Center St #102, Orem, UT 84057",
    ]);
    // Each unit is an address in its own right: choosing one asks nobody.
    const unit = await port.resolve({ suggestionId: resolution.suggestions[0]?.suggestionId ?? "" });
    expect(unit).toMatchObject({ ok: true, resolution: "address", parts: { streetTwo: "#101" } });
    expect(asked).toHaveLength(2);
  });

  it("answers expired for a building whose units have all gone", async () => {
    const { engine } = scriptedEngine((request) =>
      request.operation === "/suggestions"
        ? json({ outcome: "suggestions", offers: [{ kind: "group", building: CENTER_BUILDING }] })
        : json({ outcome: "units", addresses: [] }),
    );
    const port = selfHostedAddressLookupPort(engine);
    const offered = await port.suggest({ country: "US", query: "1042 w center" });
    if (!offered.ok) throw new Error("expected suggestions");
    expect(
      await port.resolve({ suggestionId: offered.suggestions[0]?.suggestionId ?? "" }),
    ).toEqual({ ok: true, resolution: "expired" });
  });

  it("answers expired for an identifier it did not mint, and never asks the engine about one", async () => {
    const { engine, asked } = scriptedEngine(() => json({ outcome: "units", addresses: [] }));
    const port = selfHostedAddressLookupPort(engine);
    const forged = [
      "",
      "not-base64-json",
      btoa(JSON.stringify({ route: "somewhere-else" })),
      btoa(JSON.stringify({ route: "building", country: "US", building: { street: "MAIN ST" } })),
      btoa(JSON.stringify(["route", "address"])),
    ];
    const answers = await Promise.all(forged.map((suggestionId) => port.resolve({ suggestionId })));
    expect(answers.every((answer) => answer.ok && answer.resolution === "expired")).toBe(true);
    expect(asked).toHaveLength(0);
  });

  it("keeps only known string parts from an identifier that came back from a browser", async () => {
    const port = selfHostedAddressLookupPort(scriptedEngine(() => json({})).engine);
    const tampered = btoa(
      JSON.stringify({
        route: "address",
        parts: { street: "1 Main St", injected: "x", city: 7 },
        location: { latitude: "35", longitude: -78 },
      }),
    );
    expect(await port.resolve({ suggestionId: tampered })).toEqual({
      ok: true,
      resolution: "address",
      parts: { street: "1 Main St" },
    });
  });
});

describe("inWrittenCase", () => {
  it("writes a street the way a person does, leaving numbers, compass points and routes alone", () => {
    expect(inWrittenCase("1402 LAWSON CREEK WAY")).toBe("1402 Lawson Creek Way");
    expect(inWrittenCase("100 W 1ST ST")).toBe("100 W 1st St");
    expect(inWrittenCase("3889 US 401 S HWY")).toBe("3889 US 401 S Hwy");
    expect(inWrittenCase("12 O'BRIEN-SMITH RD")).toBe("12 O'Brien-Smith Rd");
    expect(inWrittenCase("WINSTON-SALEM")).toBe("Winston-Salem");
    expect(inWrittenCase("  ")).toBe("");
  });
});
