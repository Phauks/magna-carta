/*
 * The printout a directory record downloads as (PDF and plain text), pinned.
 *
 * A printout is the firm's own copy, so it says everything the record holds about reaching
 * someone, including what the firm must not use, and never a sealed identifier.
 */
import { describe, expect, it } from "vitest";
import { recordPrintout, type RecordPrintoutParts } from "../src/lib/directory/record-printout.ts";
import { renderTextExport } from "../src/lib/export/render-text.ts";
import type {
  DirectoryContactPointState,
  DirectoryEntityDetail,
} from "../src/lib/directory/directory-api.ts";

const STATE: DirectoryContactPointState = {
  permitted: true,
  preferred: false,
  note: null,
  verificationStatus: "unverified",
  verifiedAt: null,
  verificationDetail: null,
};

const PERSON: DirectoryEntityDetail = {
  kind: "person",
  person: {
    id: "directoryPerson_one",
    prefix: null,
    given: "Rosalind",
    middle: null,
    family: "Chase",
    suffix: null,
    displayName: null,
    status: "active",
    mergedIntoId: null,
    pronouns: null,
    dateOfBirth: "1980-04-15",
    dateOfDeath: null,
    deceased: false,
  },
};

function parts(overrides: Partial<RecordPrintoutParts> = {}): RecordPrintoutParts {
  return {
    entity: PERSON,
    names: [],
    contactPoints: { emails: [], phones: [], addresses: [] },
    edges: [],
    matters: [],
    ...overrides,
  };
}

const AT = new Date(2026, 10, 9, 14, 30, 0);

describe("a record's printout", () => {
  it("is titled with the record's name and leaves out lists that hold nothing", () => {
    const printout = recordPrintout(parts(), AT);
    expect(printout.title).toBe("Rosalind Chase");
    expect(printout.sections.map((section) => section.title)).toEqual(["Record"]);
    expect(printout.sections[0]?.rows).toContainEqual(["Kind", "Person"]);
    expect(printout.sections[0]?.rows.some((row) => row[0] === "Born")).toBe(true);
  });

  it("prints every contact point, saying which the firm must not use", () => {
    const printout = recordPrintout(
      parts({
        contactPoints: {
          emails: [
            {
              id: "e",
              address: "old@example.com",
              contactUse: "former",
              isPrimary: false,
              state: { ...STATE, permitted: false },
            },
          ],
          phones: [],
          addresses: [],
        },
      }),
      AT,
    );
    const contact = printout.sections.find((section) => section.title === "Contact");
    expect(contact?.rows).toEqual([["old@example.com", "Email", "Former", "Do not use"]]);
  });

  it("lists the matters the record is a party to", () => {
    const printout = recordPrintout(
      parts({
        matters: [
          {
            id: "p",
            matterId: "m",
            role: "client",
            capacity: null,
            matterTitle: "Chase v. Acme",
            matterNumber: "2026-0001",
            matterStatus: "open",
            linkedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
      AT,
    );
    const matters = printout.sections.find((section) => section.title === "Matters");
    expect(matters?.rows).toEqual([["Chase v. Acme", "2026-0001", "client", "—"]]);
  });

  it("renders to plain text through the reports' own renderer", () => {
    const text = renderTextExport(recordPrintout(parts(), AT));
    expect(text.startsWith("ROSALIND CHASE\n")).toBe(true);
    expect(text).toContain("RECORD");
  });
});
