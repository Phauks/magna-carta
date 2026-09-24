import { describe, expect, it } from "vitest";
import {
  addressAdapterError,
  addressCountryNotCovered,
  addressEngineNotImplemented,
  deferredAddressLookupPort,
  resolved,
  suggested,
  type AddressLookupPort,
} from "../src/port.ts";

describe("the deferred port", () => {
  it("answers engine-not-implemented to everything, so a surface can ship against it", async () => {
    const port = deferredAddressLookupPort();
    expect(await port.suggest({ query: "14 Rose", country: "US" })).toEqual({
      ok: false,
      reason: "engine-not-implemented",
    });
    expect(await port.resolve({ suggestionId: "anything" })).toEqual({
      ok: false,
      reason: "engine-not-implemented",
    });
  });

  it("never throws, so a caller pattern-matches rather than catches", async () => {
    const port = deferredAddressLookupPort();
    await expect(port.suggest({ query: "", country: "" })).resolves.toBeDefined();
  });
});

describe("the failure model", () => {
  it("keeps no-coverage apart from a search that simply matched nothing", () => {
    // The distinction this port exists to preserve. An empty list says "that country is covered and
    // nothing matched", which invites a correction; no-coverage says "nobody has published that
    // country's addresses", which invites nothing at all. Folding them together tells somebody
    // their client's address is wrong when it is not.
    const nothingMatched = suggested([]);
    const notCovered = addressCountryNotCovered("ER");

    expect(nothingMatched).toEqual({ ok: true, suggestions: [] });
    expect(notCovered).toEqual({ ok: false, reason: "no-coverage", detail: "ER" });
    expect(nothingMatched.ok).not.toBe(notCovered.ok);
  });

  it("keeps an expired offer apart from a failure", () => {
    // The index was rebuilt between the offer and the choice. Nothing went wrong; ask again.
    expect(resolved(undefined)).toEqual({ ok: true, parts: undefined });
    expect(addressAdapterError("socket closed").ok).toBe(false);
  });

  it("makes every failure assignable to either result union", () => {
    // One failure shape across both operations is what lets an implementation `return` it directly.
    const failure = addressEngineNotImplemented();
    const asSuggest: Awaited<ReturnType<AddressLookupPort["suggest"]>> = failure;
    const asResolve: Awaited<ReturnType<AddressLookupPort["resolve"]>> = failure;
    expect(asSuggest).toBe(asResolve);
  });
});

describe("a stub engine", () => {
  it("carries the parts a record stores, and an opaque handle back to them", async () => {
    const port: AddressLookupPort = {
      suggest: (input) =>
        Promise.resolve(
          input.country === "US"
            ? suggested([
                {
                  suggestionId: "opaque-1",
                  label: "14 Rosewood Drive, Reno, NV 89501",
                  parts: {
                    street: "14 Rosewood Drive",
                    city: "Reno",
                    region: "NV",
                    postal: "89501",
                    country: "US",
                  },
                },
              ])
            : addressCountryNotCovered(input.country),
        ),
      resolve: (input) =>
        Promise.resolve(
          input.suggestionId === "opaque-1"
            ? resolved({
                street: "14 Rosewood Drive",
                city: "Reno",
                region: "NV",
                postal: "89501",
                country: "US",
              })
            : resolved(undefined),
        ),
    };

    const offers = await port.suggest({ query: "14 Rose", country: "US" });
    expect(offers.ok).toBe(true);
    if (offers.ok) {
      expect(offers.suggestions[0]?.parts.region).toBe("NV");
      const chosen = await port.resolve({ suggestionId: offers.suggestions[0]!.suggestionId });
      expect(chosen.ok && chosen.parts?.city).toBe("Reno");
    }

    expect(await port.suggest({ query: "anything", country: "ER" })).toMatchObject({
      reason: "no-coverage",
    });
  });
});
