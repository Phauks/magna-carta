/*
 * The address form's lookup over the Worker's two operations, driven against fake ports.
 *
 * What is pinned: offers and resolutions come across in the form's own vocabulary, no-coverage and
 * unavailable stay answers rather than failures, and a call that could not run REJECTS — so the form
 * shows a failed service as a failure, never as an address nobody has.
 */
import { describe, expect, it } from "vitest";
import {
  addressLookup,
  type AddressLookupPorts,
} from "../src/lib/addresses/address-lookup-source.ts";

function ports(overrides: Partial<AddressLookupPorts>): AddressLookupPorts {
  return {
    suggest: () => Promise.resolve({ outcome: "unavailable" }),
    resolve: () => Promise.resolve({ outcome: "expired" }),
    ...overrides,
  };
}

describe("addressLookup", () => {
  it("offers addresses and groups in the form's vocabulary, asked in the form's country", async () => {
    const asked: [string, string][] = [];
    const lookup = addressLookup(
      ports({
        suggest: (country, query) => {
          asked.push([country, query]);
          return Promise.resolve({
            outcome: "suggestions",
            suggestions: [
              {
                suggestionId: "s1",
                label: "14 Rosewood Dr, Reno, NV 89501",
                parts: { street: "14 Rosewood Dr", country: "US" },
                kind: "address",
              },
              {
                suggestionId: "g1",
                label: "1042 W Center St",
                parts: {},
                kind: "group",
                count: 24,
              },
            ],
          });
        },
      }),
    );
    expect(await lookup.suggest("US", "14 Rose")).toEqual({
      kind: "offers",
      offers: [
        { identifier: "s1", label: "14 Rosewood Dr, Reno, NV 89501", kind: "address" },
        { identifier: "g1", label: "1042 W Center St", kind: "group", count: 24 },
      ],
    });
    expect(asked).toEqual([["US", "14 Rose"]]);
  });

  it("passes no-coverage and unavailable through as answers, not failures", async () => {
    const outcomes = ["no-coverage", "unavailable"] as const;
    const answers = await Promise.all(
      outcomes.map((outcome) =>
        addressLookup(ports({ suggest: () => Promise.resolve({ outcome }) })).suggest(
          "US",
          "14 Rose",
        ),
      ),
    );
    expect(answers).toEqual(outcomes.map((outcome) => ({ kind: outcome })));
  });

  it("REJECTS when the call could not run, so the form never shows it as no matches", async () => {
    const lookup = addressLookup(ports({ suggest: () => Promise.reject(new Error("502")) }));
    await expect(lookup.suggest("US", "14 Rose")).rejects.toThrow();
  });

  it("resolves an address into the form's parts, and a group into its addresses", async () => {
    const lookup = addressLookup(
      ports({
        resolve: (identifier) =>
          Promise.resolve(
            identifier === "s1"
              ? { outcome: "address", parts: { street: "14 Rosewood Dr", city: "Reno" } }
              : {
                  outcome: "group",
                  suggestions: [
                    { suggestionId: "u1", label: "Apt 108", parts: {}, kind: "address" },
                  ],
                },
          ),
      }),
    );
    expect(await lookup.resolve("s1")).toEqual({
      kind: "address",
      parts: { street: "14 Rosewood Dr", city: "Reno" },
    });
    expect(await lookup.resolve("g1")).toEqual({
      kind: "group",
      offers: [{ identifier: "u1", label: "Apt 108", kind: "address" }],
    });
  });

  it("passes expired through as an answer", async () => {
    expect(await addressLookup(ports({})).resolve("gone")).toEqual({ kind: "expired" });
  });
});
