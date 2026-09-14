import { describe, expect, it } from "vitest";
import {
  FIRM_DEFAULT_MARK,
  officeColumns,
  officeMatchesSearch,
} from "$lib/offices/office-columns.ts";
import type { OfficeSummary } from "$lib/offices/offices-api.ts";

/*
 * The Offices register's column model: what the platform's one table is told about an office, and
 * which of those columns a reader meets first. A column that starts hidden is still a column the
 * rows can answer, which is the whole point of declaring it.
 */

const RENO: OfficeSummary = {
  id: "location_reno",
  name: "Reno",
  status: "active",
  jurisdiction: "US-NV",
  timeZone: "America/Los_Angeles",
  numberCode: "RNO",
  email: "reno@example.com",
  addresses: [
    {
      kind: "physical",
      street: "1 Main St",
      streetTwo: "Suite 200",
      dependentLocality: null,
      city: "Reno",
      region: "NV",
      postal: "89501",
      sortingCode: null,
      country: "US",
      phone: "+17755550148",
    },
    {
      kind: "mailing",
      street: "PO Box 9",
      streetTwo: null,
      dependentLocality: null,
      city: "Reno",
      region: "NV",
      postal: "89509",
      sortingCode: null,
      country: "US",
      phone: null,
    },
  ],
  members: 3,
  hasLetterheadLogo: false,
  firmDefault: true,
};

describe("the offices register's columns", () => {
  it("leads with the name, anchored, and shows the facts a reader scans offices by", () => {
    const columns = officeColumns();
    expect(columns[0]).toMatchObject({ id: "name", anchored: true });
    const shown = columns.filter((column) => column.hidden !== true).map((column) => column.id);
    expect(shown).toEqual([
      "name",
      "status",
      "jurisdiction",
      "timeZone",
      "numberCode",
      "address",
      "phone",
      "members",
    ]);
  });

  it("offers the email, the mailing address, the logo and the default without showing them", () => {
    const hidden = officeColumns()
      .filter((column) => column.hidden === true)
      .map((column) => column.id);
    expect(hidden).toEqual(["email", "mailingAddress", "letterheadLogo", "firmDefault"]);
  });

  it("answers each column from the row, in the reader's words", () => {
    const value = (id: string) =>
      officeColumns()
        .find((column) => column.id === id)
        ?.value(RENO);
    expect(value("status")).toBe("Active");
    expect(value("address")).toBe("1 Main St, Suite 200, Reno, NV 89501");
    expect(value("mailingAddress")).toBe("PO Box 9, Reno, NV 89509");
    expect(value("phone")).toBe("(775) 555-0148");
    expect(value("timeZone")).toContain("Los Angeles");
    expect(value("letterheadLogo")).toBe("Firm's mark");
    expect(value("firmDefault")).toBe(FIRM_DEFAULT_MARK);
    expect(value("members")).toBe(3);
  });

  it("the status filter offers both standings whether or not a row carries them", () => {
    const status = officeColumns().find((column) => column.id === "status");
    expect(status?.filterValues).toEqual(["Active", "Closed"]);
  });
});

describe("the register's own search", () => {
  it("matches the name, the code, the jurisdiction, the email and any address line", () => {
    expect(officeMatchesSearch(RENO, "")).toBe(true);
    expect(officeMatchesSearch(RENO, "reno")).toBe(true);
    expect(officeMatchesSearch(RENO, "rno")).toBe(true);
    expect(officeMatchesSearch(RENO, "us-nv")).toBe(true);
    expect(officeMatchesSearch(RENO, "example.com")).toBe(true);
    expect(officeMatchesSearch(RENO, "po box")).toBe(true);
    expect(officeMatchesSearch(RENO, "vegas")).toBe(false);
  });
});
