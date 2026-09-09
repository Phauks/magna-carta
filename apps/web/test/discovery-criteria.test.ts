/*
 * The narrowing registry, and the property the whole discovery surface turns on: a selection is a
 * criteria set, never a list of document identifiers.
 *
 * These are the assertions that would catch the mistakes that cost the most. A criterion that
 * composes into the wrong parameter narrows a corpus by the wrong thing, which in discovery is a
 * reviewer certifying the contents of a set they never saw. A criteria set that does not survive a
 * round trip through the address breaks the one property that makes a narrowed queue shareable. And
 * a not-yet-served criterion that leaked into a server query would send a parameter the read does
 * not understand.
 */
import { describe, expect, it } from "vitest";
import {
  composeDocumentQuery,
  criteriaAreSet,
  criteriaCount,
  criteriaFromSearchParameters,
  criteriaProvider,
  criteriaToSearchParameters,
  CRITERIA_PROVIDERS,
  providerIsBuilt,
  withCriterion,
} from "../src/lib/discovery/criteria.ts";

describe("the narrowing registry", () => {
  it("declares every criterion once", () => {
    const keys = CRITERIA_PROVIDERS.map((provider) => provider.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every unserved criterion a dependency to show and a read it will compose into", () => {
    for (const provider of CRITERIA_PROVIDERS) {
      if (providerIsBuilt(provider)) continue;
      expect(provider.waitsOn.trim()).not.toBe("");
      expect(["the document list", "the search index"]).toContain(provider.willComposeInto);
    }
  });

  it("serves the five measured narrowings, and the name search beside them", () => {
    const built = CRITERIA_PROVIDERS.filter(providerIsBuilt).map((provider) => provider.key);
    expect(built).toEqual(["custodian", "load", "state", "exception", "family", "search"]);
  });

  it("names where a criterion set outside the popover is set, so the control can say so", () => {
    // The two whose control is elsewhere. A criterion with no editing control in the popover and no
    // `setFrom` renders as a dead row a reader cannot interpret, which is the failure this catches.
    const elsewhere = CRITERIA_PROVIDERS.filter((provider) => provider.setFrom !== undefined).map(
      (provider) => provider.key,
    );
    expect(elsewhere.toSorted()).toEqual(["family", "search"]);
    for (const provider of CRITERIA_PROVIDERS) {
      if (provider.setFrom === undefined) continue;
      expect(provider.setFrom.trim()).not.toBe("");
    }
  });

  it("narrows by what a document is CALLED and by what is IN it as two separate criteria", () => {
    // The distinction the whole surface turns on. One is served today and composes into this list;
    // the other is not served and composes into the review set's own index. Collapsing them into
    // one control would tell a reviewer they had searched a corpus when they had searched its file
    // names.
    const name = criteriaProvider("search");
    const keyword = criteriaProvider("keyword");
    expect(name).toBeDefined();
    expect(keyword).toBeDefined();
    expect(providerIsBuilt(name!)).toBe(true);
    expect(providerIsBuilt(keyword!)).toBe(false);
    expect(composeDocumentQuery({ search: "ridgeway" })).toEqual({ search: "ridgeway" });
    // The unserved one contributes nothing rather than sending a parameter the read cannot read.
    expect(composeDocumentQuery({ keyword: "ridgeway" })).toEqual({});
  });

  it("declares keyword as narrowing through the search index, not the document list", () => {
    const keyword = criteriaProvider("keyword");
    expect(keyword).toBeDefined();
    expect(providerIsBuilt(keyword!)).toBe(false);
    // The whole point of declaring where a criterion composes: not every narrowing is a WHERE
    // clause on one table, and lighting this one up is a binding plus a stage flip rather than a
    // change to the control that sets it.
    expect(providerIsBuilt(keyword!) ? null : keyword!.willComposeInto).toBe("the search index");
  });
});

describe("composing a criteria set into the document read", () => {
  it("maps each built criterion onto its own server parameter", () => {
    expect(
      composeDocumentQuery({
        custodian: "recordCustodian_1",
        load: "discoveryLoad_1",
        state: "excepted",
        exception: "encrypted",
        family: "reviewDocument_1",
      }),
    ).toEqual({
      recordCustodianId: "recordCustodian_1",
      discoveryLoadId: "discoveryLoad_1",
      processingState: "excepted",
      exceptionCode: "encrypted",
      familyId: "reviewDocument_1",
    });
  });

  it("contributes nothing for a criterion nobody serves yet", () => {
    expect(composeDocumentQuery({ keyword: "easement", dates: "2026-01-01..2026-02-01" })).toEqual(
      {},
    );
  });

  it("ignores a key no provider declares rather than failing the read", () => {
    // An address carrying a criteria set from a later version of the app should narrow by what this
    // version understands and drop the rest: the alternative is a shared link that renders an error
    // instead of a list.
    expect(composeDocumentQuery({ somethingLater: "x", custodian: "recordCustodian_1" })).toEqual({
      recordCustodianId: "recordCustodian_1",
    });
  });

  it("treats an empty value as unset", () => {
    expect(composeDocumentQuery({ custodian: "  " })).toEqual({});
    expect(criteriaAreSet({ custodian: "" })).toBe(false);
    expect(criteriaCount({ custodian: "", load: "discoveryLoad_1" })).toBe(1);
  });
});

describe("a criteria set riding the address", () => {
  it("survives a round trip", () => {
    const criteria = { custodian: "recordCustodian_1", state: "processed" };
    const parameters = criteriaToSearchParameters(criteria);
    expect(criteriaFromSearchParameters(parameters)).toEqual(criteria);
  });

  it("carries only declared keys, so a stray parameter cannot ride along", () => {
    const parameters = criteriaToSearchParameters({ custodian: "recordCustodian_1", stray: "x" });
    expect(parameters.get("stray")).toBeNull();
    expect([...parameters.keys()]).toEqual(["custodian"]);
  });

  it("drops a declared key with no value, so clearing and never touching agree", () => {
    expect(criteriaToSearchParameters({ custodian: "" }).toString()).toBe("");
  });

  it("reads back nothing from an address with no criteria on it", () => {
    expect(criteriaFromSearchParameters(new URLSearchParams("page=2"))).toEqual({});
  });
});

describe("setting one criterion", () => {
  it("returns a new set rather than mutating the one passed in", () => {
    const before = { custodian: "recordCustodian_1" };
    const after = withCriterion(before, "state", "excepted");
    expect(before).toEqual({ custodian: "recordCustodian_1" });
    expect(after).toEqual({ custodian: "recordCustodian_1", state: "excepted" });
  });

  it("removes the criterion when it is emptied", () => {
    expect(withCriterion({ custodian: "recordCustodian_1" }, "custodian", "")).toEqual({});
  });
});
