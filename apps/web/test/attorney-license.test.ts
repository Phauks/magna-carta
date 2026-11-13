/*
 * The Attorney License Lookup's own logic, off the DOM: the rows the screen lists, and the column
 * model it lists them through. The tool is a link generator, so "does every state resolve to a
 * live-looking register" is the whole correctness question — there is no request to mock.
 */
import { describe, expect, it } from "vitest";
import {
  ADDRESS_COLUMN_ID,
  ATTORNEY_LICENSE_INITIAL_SORT,
  CONNECTION_COLUMN_ID,
  CONNECTION_ENCRYPTED,
  CONNECTION_STANDINGS,
  CONNECTION_UNENCRYPTED,
  STATE_COLUMN_ID,
  attorneyLicenseColumns,
  attorneyLicenseRows,
  connectionEntry,
} from "../src/lib/tools/attorney-license/attorney-license.ts";

const rows = attorneyLicenseRows();
const columns = attorneyLicenseColumns();

describe("the registers listed", () => {
  it("lists every state and the District of Columbia", () => {
    expect(rows).toHaveLength(51);
  });

  it("names each state, with its postal code beside it", () => {
    const california = rows.find((row) => row.stateFips === "06");
    expect(california?.state).toBe("California");
    expect(california?.code).toBe("CA");
  });

  it("carries no duplicate row keys, so no two rows are the same row", () => {
    expect(new Set(rows.map((row) => row.stateFips)).size).toBe(rows.length);
  });

  it("gives every row a register on an absolute URL", () => {
    for (const row of rows) {
      expect(row.searchUrl, row.state).toMatch(/^https?:\/\//);
      expect(row.register, row.state).not.toBe("");
    }
  });

  it("names the register after the state whose register it is", () => {
    expect(rows.find((row) => row.stateFips === "12")?.register).toBe("Florida Attorney Search");
  });

  it("reads alphabetically by state, which is the order the table opens in", () => {
    expect(rows.map((row) => row.state)).toEqual(
      rows.map((row) => row.state).toSorted((left, right) => left.localeCompare(right)),
    );
    expect(ATTORNEY_LICENSE_INITIAL_SORT).toEqual({
      columnId: STATE_COLUMN_ID,
      direction: "ascending",
    });
  });
});

describe("how a register is served", () => {
  it("knows which registers are not served over TLS, so the table can mark them", () => {
    // Two of the fifty-one, and not a transcription error: plain-HTTP government portals are
    // ordinary. The table marks them rather than linking to them silently.
    const unencrypted = rows.filter((row) => !row.secure).map((row) => row.state);
    expect(unencrypted).toEqual(["Rhode Island", "Washington"]);
  });

  it("says what each standing means for the person about to search there", () => {
    const encrypted = connectionEntry(rows.find((row) => row.secure)!);
    const plain = connectionEntry(rows.find((row) => !row.secure)!);
    expect(encrypted.label).toBe(CONNECTION_ENCRYPTED);
    expect(plain.label).toBe(CONNECTION_UNENCRYPTED);
    expect(plain.meaning).not.toBe(encrypted.meaning);
    expect(plain.meaning).toContain("insecure connection");
  });
});

describe("the column model", () => {
  it("anchors the row on the state, so it can never be hidden or dragged off the front", () => {
    expect(columns[0]?.id).toBe(STATE_COLUMN_ID);
    expect(columns[0]?.anchored).toBe(true);
  });

  it("offers the register's address, starting hidden", () => {
    const address = columns.find((column) => column.id === ADDRESS_COLUMN_ID);
    expect(address?.hidden).toBe(true);
    expect(address?.value(rows[0]!)).toBe(rows[0]?.searchUrl);
  });

  it("filters the connection over the DECLARED vocabulary, not over what the rows happen to hold", () => {
    // Otherwise a table narrowed to the encrypted registers would drop "Not encrypted" from its own
    // filter and tell the reader no such register exists.
    const connection = columns.find((column) => column.id === CONNECTION_COLUMN_ID);
    expect(connection?.filter).toBe("set");
    expect(connection?.filterValues).toEqual([...CONNECTION_STANDINGS]);
  });

  it("gives every column a distinct id and a label", () => {
    expect(new Set(columns.map((column) => column.id)).size).toBe(columns.length);
    for (const column of columns) expect(column.label, column.id).not.toBe("");
  });

  it("reads a value for every column of every row", () => {
    for (const column of columns) {
      for (const row of rows) {
        expect(column.value(row), `${column.id} of ${row.state}`).not.toBe("");
      }
    }
  });
});
