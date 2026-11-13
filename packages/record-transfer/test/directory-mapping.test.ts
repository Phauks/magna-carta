import { describe, expect, it } from "vitest";
import {
  IncompleteMappingRulesError,
  calendarDateFrom,
  columnsMissingFrom,
  mapOrganizationRow,
  mapPersonRow,
  type OrganizationMappingRules,
  type PersonMappingRules,
} from "../src/directory-mapping.ts";
import type { SourceFileRow } from "../src/source-file.ts";

const HEADER = [
  "Id",
  "Title",
  "First",
  "Last",
  "Born",
  "Email",
  "Email 2",
  "Phone",
  "Fax",
  "Street",
  "Suburb",
  "State",
  "Postcode",
];

const RULES: PersonMappingRules = {
  given: "First",
  family: "Last",
  prefix: "Title",
  dateOfBirth: "Born",
  dateOrder: "day-month-year",
  emails: ["Email", "Email 2"],
  phones: [{ column: "Fax", fax: true }, { column: "Phone" }],
  address: { street: "Street", city: "Suburb", region: "State", postal: "Postcode" },
  addressCountry: "AU",
};

const row = (...values: string[]): SourceFileRow => ({ rowNumber: 1, lineNumber: 2, values });

const ADA = row(
  "c-1",
  "Ms",
  " Ada ",
  "Lovelace",
  "10/12/1815",
  "ada@example.test",
  "",
  "02 5550 0101",
  "02 5550 0102",
  "1 Engine St",
  "Sydney",
  "NSW",
  "2000",
);

describe("mapping a person", () => {
  it("lays the named columns into a draft the Directory accepts", () => {
    const mapped = mapPersonRow(RULES, HEADER, ADA);
    expect(mapped).toEqual({
      ok: true,
      findings: [],
      draft: {
        name: { given: "Ada", family: "Lovelace", prefix: "Ms", middle: null, suffix: null },
        dateOfBirth: "1815-12-10",
        emails: [{ address: "ada@example.test", isPrimary: true }],
        phones: [
          { number: "02 5550 0102", contactSystem: "fax", isPrimary: false },
          { number: "02 5550 0101", contactSystem: "voice", isPrimary: true },
        ],
        addresses: [
          {
            street: "1 Engine St",
            streetTwo: null,
            dependentLocality: null,
            city: "Sydney",
            region: "NSW",
            postal: "2000",
            country: "AU",
            isPrimary: true,
          },
        ],
      },
    });
  });

  it("makes the record and reports a value it had to leave out", () => {
    const values = [...ADA.values];
    values[4] = "sometime in 1815";
    values[5] = "not an address";
    values[6] = "ada@example.test";
    values[7] = "ask reception";
    const mapped = mapPersonRow(RULES, HEADER, row(...values));
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.findings).toEqual([
      { column: "Email", finding: "emailNotAnAddress" },
      { column: "Phone", finding: "phoneHasNoDigits" },
      { column: "Born", finding: "dateUnreadable" },
    ]);
    expect(mapped.draft.dateOfBirth).toBeNull();
    // The second column's address is the only usable one, so it is the primary.
    expect(mapped.draft.emails).toEqual([{ address: "ada@example.test", isPrimary: true }]);
    // The fax is the only number left, and a fax line is never the primary.
    expect(mapped.draft.phones).toEqual([
      { number: "02 5550 0102", contactSystem: "fax", isPrimary: false },
    ]);
  });

  it("keeps one of an address that two columns both hold", () => {
    const values = [...ADA.values];
    values[6] = "ADA@example.test";
    const mapped = mapPersonRow(RULES, HEADER, row(...values));
    expect(mapped.ok && mapped.draft.emails).toHaveLength(1);
  });

  it("writes no address when every address column is empty", () => {
    const values = [...ADA.values];
    for (const index of [9, 10, 11, 12]) values[index] = "  ";
    const mapped = mapPersonRow(RULES, HEADER, row(...values));
    expect(mapped.ok && mapped.draft.addresses).toEqual([]);
  });

  it("accepts a person with one name and refuses a row with none", () => {
    const mononym = [...ADA.values];
    mononym[3] = "";
    expect(mapPersonRow(RULES, HEADER, row(...mononym)).ok).toBe(true);

    const nameless = [...mononym];
    nameless[2] = "   ";
    expect(mapPersonRow(RULES, HEADER, row(...nameless))).toEqual({
      ok: false,
      rejection: "noName",
    });
  });

  it("refuses a row of the wrong width without guessing which value is missing", () => {
    expect(mapPersonRow(RULES, HEADER, row("c-1", "Ms", "Ada"))).toEqual({
      ok: false,
      rejection: "tooFewValues",
    });
    expect(mapPersonRow(RULES, HEADER, row(...ADA.values, "extra"))).toEqual({
      ok: false,
      rejection: "tooManyValues",
    });
  });

  it("refuses rules that map a date without saying which order the file writes it in", () => {
    const { dateOrder: _dateOrder, ...withoutOrder } = RULES;
    expect(() => mapPersonRow(withoutOrder, HEADER, ADA)).toThrow(IncompleteMappingRulesError);
  });
});

describe("mapping an organization", () => {
  const header = ["Id", "Name", "Email", "Phone"];
  const rules: OrganizationMappingRules = {
    legalName: "Name",
    emails: ["Email"],
    phones: [{ column: "Phone" }],
  };

  it("lays the named columns into a draft", () => {
    expect(
      mapOrganizationRow(rules, header, row("o-1", "Analytical Engines Pty Ltd", "", "5550 0199")),
    ).toEqual({
      ok: true,
      findings: [],
      draft: {
        legalName: "Analytical Engines Pty Ltd",
        emails: [],
        phones: [{ number: "5550 0199", contactSystem: "voice", isPrimary: true }],
        addresses: [],
      },
    });
  });

  it("refuses a row with no name", () => {
    expect(mapOrganizationRow(rules, header, row("o-1", " ", "", ""))).toEqual({
      ok: false,
      rejection: "noName",
    });
  });
});

describe("checking rules against a file's header", () => {
  it("names every column the rules read that the file does not have, once", () => {
    expect(columnsMissingFrom(HEADER, RULES)).toEqual([]);
    expect(
      columnsMissingFrom(HEADER, {
        ...RULES,
        family: "Surname",
        emails: ["Email", "E-mail"],
        address: { street: "Street", postal: "Zip" },
      }),
    ).toEqual(["E-mail", "Zip", "Surname"]);
  });
});

describe("reading a date in the order the file states", () => {
  it("reads the same text as two different days under two orders", () => {
    expect(calendarDateFrom("03/04/2021", "day-month-year")).toBe("2021-04-03");
    expect(calendarDateFrom("03/04/2021", "month-day-year")).toBe("2021-03-04");
  });

  it("accepts the common separators, single digits and a trailing time", () => {
    expect(calendarDateFrom("2021-4-3", "year-month-day")).toBe("2021-04-03");
    expect(calendarDateFrom("3.4.2021", "day-month-year")).toBe("2021-04-03");
    expect(calendarDateFrom("03/04/2021 00:00:00", "day-month-year")).toBe("2021-04-03");
    expect(calendarDateFrom("2021-04-03T00:00:00Z", "year-month-day")).toBe("2021-04-03");
  });

  it("refuses a day the calendar does not have, a two-digit year and the wrong order", () => {
    expect(calendarDateFrom("30/02/2021", "day-month-year")).toBeNull();
    expect(calendarDateFrom("03/04/21", "day-month-year")).toBeNull();
    expect(calendarDateFrom("25/12/2021", "month-day-year")).toBeNull();
    expect(calendarDateFrom("2021-04-03", "day-month-year")).toBeNull();
    expect(calendarDateFrom("", "day-month-year")).toBeNull();
  });
});
