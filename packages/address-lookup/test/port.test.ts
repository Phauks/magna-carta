import { describe, expect, it } from "vitest";
import {
  addressAdapterError,
  addressCountryNotCovered,
  addressEngineNotImplemented,
  deferredAddressLookupPort,
  resolutionExpired,
  resolvedAddress,
  resolvedGroup,
  suggested,
  type AddressLookupPort,
  type AddressSuggestion,
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
    // An empty list says "that country is covered and nothing matched", which invites a correction;
    // no-coverage says "nobody has published that country's addresses", which invites nothing.
    const nothingMatched = suggested([]);
    const notCovered = addressCountryNotCovered("ER");

    expect(nothingMatched).toEqual({ ok: true, suggestions: [] });
    expect(notCovered).toEqual({ ok: false, reason: "no-coverage", detail: "ER" });
    expect(nothingMatched.ok).not.toBe(notCovered.ok);
  });

  it("keeps an expired offer apart from a failure", () => {
    // The data moved between the offer and the choice. Nothing went wrong; ask again.
    expect(resolutionExpired()).toEqual({ ok: true, resolution: "expired" });
    expect(addressAdapterError("socket closed").ok).toBe(false);
  });

  it("makes every failure assignable to either result union", () => {
    const failure = addressEngineNotImplemented();
    const asSuggest: Awaited<ReturnType<AddressLookupPort["suggest"]>> = failure;
    const asResolve: Awaited<ReturnType<AddressLookupPort["resolve"]>> = failure;
    expect(asSuggest).toBe(asResolve);
  });
});

describe("a group", () => {
  const building: AddressSuggestion = {
    suggestionId: "opaque-building",
    label: "1042 W Center St, Orem UT 84057 (24 units)",
    parts: {
      street: "1042 W Center St",
      city: "Orem",
      region: "UT",
      postal: "84057",
      country: "US",
    },
    kind: "group",
    count: 24,
  };
  const unit: AddressSuggestion = {
    suggestionId: "opaque-unit",
    label: "1042 W Center St Apt 108, Orem UT 84057",
    parts: { ...building.parts, streetTwo: "Apt 108" },
    kind: "address",
  };

  it("resolves to the addresses inside it rather than to an address", async () => {
    // A group is not an address a record can hold. Writing the building's line into a record whose
    // client lives in one unit is a letter that does not arrive.
    const port: AddressLookupPort = {
      suggest: () => Promise.resolve(suggested([building])),
      resolve: (input) =>
        Promise.resolve(
          input.suggestionId === building.suggestionId
            ? resolvedGroup([unit])
            : input.suggestionId === unit.suggestionId
              ? resolvedAddress(unit.parts)
              : resolutionExpired(),
        ),
    };

    const offers = await port.suggest({ query: "1042 W Cen", country: "US" });
    expect(offers.ok && offers.suggestions[0]?.kind).toBe("group");

    const opened = await port.resolve({ suggestionId: building.suggestionId });
    expect(opened).toMatchObject({ ok: true, resolution: "group" });
    if (opened.ok && opened.resolution === "group") {
      const chosen = await port.resolve({ suggestionId: opened.suggestions[0]!.suggestionId });
      expect(chosen).toEqual({ ok: true, resolution: "address", parts: unit.parts });
    }

    expect(await port.resolve({ suggestionId: "gone" })).toEqual(resolutionExpired());
  });
});
