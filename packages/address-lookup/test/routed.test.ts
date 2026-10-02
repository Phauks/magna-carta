/*
 * The routed port: one port over several engines, chosen by country.
 *
 * What is pinned: a country goes to its engine, an uncovered country is `no-coverage` rather than a
 * failure, every identifier carries the name of the engine that minted it — including the units a
 * group opens into — and an identifier with no known engine name is `expired` without asking anyone.
 */
import { describe, expect, it } from "vitest";
import {
  resolvedAddress,
  resolvedGroup,
  suggested,
  type AddressLookupPort,
  type AddressSuggestion,
} from "../src/port.ts";
import { routedAddressLookupPort } from "../src/routed.ts";

function offer(suggestionId: string, kind: "address" | "group" = "address"): AddressSuggestion {
  return { suggestionId, label: "An offer", parts: {}, kind };
}

/** An engine that answers with one offer and records what it was asked to resolve. */
function recordingEngine(offerId: string) {
  const resolved: string[] = [];
  const port: AddressLookupPort = {
    suggest: () => Promise.resolve(suggested([offer(offerId, "group")])),
    resolve: ({ suggestionId }) => {
      resolved.push(suggestionId);
      return Promise.resolve(
        suggestionId === offerId
          ? resolvedGroup([offer(`${offerId}-unit`)])
          : resolvedAddress({ street: suggestionId }),
      );
    },
  };
  return { port, resolved };
}

describe("routedAddressLookupPort", () => {
  it("sends each country to its engine and names the engine in every identifier", async () => {
    const home = recordingEngine("home-offer");
    const abroad = recordingEngine("abroad-offer");
    const port = routedAddressLookupPort({
      byCountry: { US: { name: "openaddresses", port: home.port } },
      otherwise: { name: "smarty", port: abroad.port },
    });

    const unitedStates = await port.suggest({ country: "us", query: "1 main" });
    const france = await port.suggest({ country: "FR", query: "1 rue" });
    expect(unitedStates).toEqual(suggested([offer("openaddresses.home-offer", "group")]));
    expect(france).toEqual(suggested([offer("smarty.abroad-offer", "group")]));

    const group = await port.resolve({ suggestionId: "openaddresses.home-offer" });
    expect(group).toEqual(resolvedGroup([offer("openaddresses.home-offer-unit")]));
    expect(home.resolved).toEqual(["home-offer"]);

    // A unit from the group routes back to the engine that minted it.
    await port.resolve({ suggestionId: "openaddresses.home-offer-unit" });
    expect(home.resolved).toEqual(["home-offer", "home-offer-unit"]);
    expect(abroad.resolved).toEqual([]);
  });

  it("answers no-coverage for a country no engine covers", async () => {
    const port = routedAddressLookupPort({
      byCountry: { US: { name: "openaddresses", port: recordingEngine("x").port } },
    });
    expect(await port.suggest({ country: "de", query: "1 strasse" })).toEqual({
      ok: false,
      reason: "no-coverage",
      detail: "DE",
    });
  });

  it("answers expired for an identifier no engine here minted, asking nobody", async () => {
    const home = recordingEngine("x");
    const port = routedAddressLookupPort({
      byCountry: { US: { name: "openaddresses", port: home.port } },
    });
    const answers = await Promise.all(
      ["", "no-prefix", ".leading-separator", "smarty.from-an-engine-not-here"].map(
        (suggestionId) => port.resolve({ suggestionId }),
      ),
    );
    expect(answers.every((answer) => answer.ok && answer.resolution === "expired")).toBe(true);
    expect(home.resolved).toEqual([]);
  });
});
