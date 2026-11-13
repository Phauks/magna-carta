import type { MatterTypeId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  InvalidMatterMappingRulesError,
  mapMatterRow,
  matterColumnsMissingFrom,
  type MatterMappingRules,
} from "../src/matter-mapping.ts";

const HEADER = [
  "No",
  "Title",
  "Opened",
  "Closed",
  "Type",
  "Lawyer",
  "ClientCard",
  "OtherSide",
] as const;
const ADA = "user_ada" as UserId;
const FORMER = "user_former" as UserId;
const CONVEYANCE = "matterType_conveyance" as MatterTypeId;

const RULES: MatterMappingRules = {
  title: "Title",
  number: "No",
  openedDate: "Opened",
  closedDate: "Closed",
  dateOrder: "day-month-year",
  timeZone: "Australia/Sydney",
  client: { column: "ClientCard", sourceKind: "card" },
  parties: [{ column: "OtherSide", sourceKind: "card", role: "opposing_party" }],
  matterType: { column: "Type", types: { Conveyancing: CONVEYANCE } },
  responsibleMember: { column: "Lawyer", members: { AL: ADA }, otherwise: FORMER },
};

function map(values: readonly string[], rules: MatterMappingRules = RULES) {
  return mapMatterRow(rules, HEADER, { rowNumber: 1, lineNumber: 2, values });
}

const GOOD = [
  " 2021-0042 ",
  "Sale of 1 Engine St",
  "03/04/2021",
  "",
  "Conveyancing",
  "AL",
  "c-1",
  "c-2",
];

describe("mapping a matter row", () => {
  it("maps a row to a draft, keeping the number and naming the client and parties by source key", () => {
    const mapped = map(GOOD);
    if (!mapped.ok) throw new Error(mapped.rejection);
    expect(mapped.findings).toEqual([]);
    expect(mapped.draft).toEqual({
      title: "Sale of 1 Engine St",
      description: null,
      matterNumber: "2021-0042",
      matterTypeId: CONVEYANCE,
      responsibleMemberId: ADA,
      clientDisplayName: null,
      // The third of April began in Sydney at 13:00 UTC the day before (daylight time, UTC+11).
      openedAt: "2021-04-02T13:00:00.000Z",
      closedAt: null,
      client: { sourceKind: "card", sourceId: "c-1" },
      parties: [{ sourceKind: "card", sourceId: "c-2", role: "opposing_party" }],
    });
  });

  it("reads the same text as a different day when the rules state another order", () => {
    const mapped = map(GOOD, { ...RULES, dateOrder: "month-day-year", timeZone: "UTC" });
    expect(mapped.ok && mapped.draft.openedAt).toBe("2021-03-04T00:00:00.000Z");
  });

  it("brings a matter with a closing date in closed", () => {
    const mapped = map(GOOD.with(3, "30/06/2022"));
    // Standard time in Sydney, UTC+10.
    expect(mapped.ok && mapped.draft.closedAt).toBe("2022-06-29T14:00:00.000Z");
  });

  it("does not trim a reference, because a source key is compared as written", () => {
    const mapped = map(GOOD.with(6, " c-1 "));
    expect(mapped.ok && mapped.draft.client).toEqual({ sourceKind: "card", sourceId: " c-1 " });
  });

  it("leaves out a party whose column is empty", () => {
    const mapped = map(GOOD.with(7, ""));
    expect(mapped.ok && mapped.draft.parties).toEqual([]);
  });
});

describe("a row that cannot become a matter is rejected with the reason", () => {
  it.each([
    ["noMatterNumber", GOOD.with(0, "  ")],
    ["noTitle", GOOD.with(1, "")],
    ["noOpenedDate", GOOD.with(2, "")],
    ["openedDateUnreadable", GOOD.with(2, "3 April 21")],
    ["closedDateUnreadable", GOOD.with(3, "soon")],
    ["closedBeforeOpened", GOOD.with(3, "01/01/2020")],
    ["tooFewValues", GOOD.slice(0, 4)],
  ])("%s", (rejection, values) => {
    expect(map(values)).toEqual({ ok: false, rejection });
  });

  it("rejects a row whose lawyer is unknown when the rules name nobody to fall back to", () => {
    const rules = { ...RULES, responsibleMember: { column: "Lawyer", members: { AL: ADA } } };
    expect(map(GOOD.with(5, "ZZ"), rules)).toEqual({
      ok: false,
      rejection: "responsibleMemberUnmapped",
    });
  });
});

describe("a value the lookups do not hold is reported, and the matter is still made", () => {
  it("reports an unknown matter type and leaves the type empty", () => {
    const mapped = map(GOOD.with(4, "Probate"));
    if (!mapped.ok) throw new Error(mapped.rejection);
    expect(mapped.draft.matterTypeId).toBeNull();
    expect(mapped.findings).toEqual([{ column: "Type", finding: "matterTypeUnmapped" }]);
  });

  it("reports an unknown lawyer and gives the matter to the stated member", () => {
    const mapped = map(GOOD.with(5, "ZZ"));
    if (!mapped.ok) throw new Error(mapped.rejection);
    expect(mapped.draft.responsibleMemberId).toBe(FORMER);
    expect(mapped.findings).toEqual([{ column: "Lawyer", finding: "responsibleMemberUnmapped" }]);
  });

  it("says nothing when the lawyer column is simply empty", () => {
    const mapped = map(GOOD.with(5, ""));
    expect(mapped.ok && mapped.findings).toEqual([]);
  });

  it("does not read a lookup key from the object's own machinery", () => {
    const mapped = map(GOOD.with(4, "constructor"));
    expect(mapped.ok && mapped.draft.matterTypeId).toBeNull();
  });
});

describe("the rules themselves", () => {
  it("lists the columns the file does not have", () => {
    expect(matterColumnsMissingFrom(HEADER, RULES)).toEqual([]);
    expect(matterColumnsMissingFrom(["No", "Title"], RULES)).toEqual([
      "Opened",
      "Closed",
      "ClientCard",
      "OtherSide",
      "Type",
      "Lawyer",
    ]);
  });

  it("refuses a time zone that is not one, and a party with no role", () => {
    expect(() => map(GOOD, { ...RULES, timeZone: "Sydney" })).toThrow(
      InvalidMatterMappingRulesError,
    );
    expect(() =>
      map(GOOD, { ...RULES, parties: [{ column: "OtherSide", sourceKind: "card", role: " " }] }),
    ).toThrow(InvalidMatterMappingRulesError);
  });
});
