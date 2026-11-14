/*
 * The Columns tab's model and the workspace's counts.
 *
 * What the operator states per column must become exactly the rules the contract takes, and a
 * pass's stored rules must read back into the same statement, because that round trip is what "Run
 * Again" sends. The counts are what the header sentence and the Before Cutover lines say, so they
 * are held to the latest pass of each file and nothing older.
 */
import { describe, expect, it } from "vitest";
import {
  blankMapping,
  delimiterHintedBy,
  KEY_ONLY,
  keyColumnOf,
  mappingFromStated,
  mappingProblems,
  passRequestFrom,
  recordKindOfFileKind,
  type FileMapping,
  type MappingDefaults,
} from "../src/lib/record-transfer/column-mapping.ts";
import {
  cutoverChecks,
  latestFinishedPassOf,
  latestPassOf,
  passFailureLabel,
  rejectionLabel,
  runSummary,
  type TransferPass,
  type TransferSourceFile,
} from "../src/lib/record-transfer/transfer-run-view.ts";

const DEFAULTS: MappingDefaults = { timeZone: "Australia/Sydney", referenceSourceKind: "card" };

function hold(holds: string, extra: { referenceSourceKind?: string; role?: string } = {}) {
  return { holds, referenceSourceKind: "card", role: "", ...extra };
}

const PEOPLE_COLUMNS = ["Card", "First", "Last", "Email", "Mobile", "Fax No", "Born", "Notes"];

function peopleMapping(): FileMapping {
  return {
    ...blankMapping("person", DEFAULTS),
    assignments: {
      Card: hold(KEY_ONLY),
      First: hold("given"),
      Last: hold("family"),
      Email: hold("email"),
      Mobile: hold("phone"),
      "Fax No": hold("fax"),
      Born: hold("dateOfBirth"),
    },
    dateOrder: "day-month-year",
  };
}

const MATTER_COLUMNS = [
  "File No",
  "Description",
  "Opened",
  "Closed",
  "Client Card",
  "Other Side",
  "Type",
  "Lawyer",
];

function matterMapping(): FileMapping {
  return {
    ...blankMapping("matter", DEFAULTS),
    assignments: {
      "File No": hold("number"),
      Description: hold("title"),
      Opened: hold("openedDate"),
      Closed: hold("closedDate"),
      "Client Card": hold("client"),
      "Other Side": hold("party", { role: "opposingparty" }),
      Type: hold("matterType"),
      Lawyer: hold("responsibleMember"),
    },
    dateOrder: "day-month-year",
    matterTypes: { CONV: "matter-type-1" },
    members: { AL: "member-1" },
    otherwiseMember: "member-2",
  };
}

describe("the Columns tab's mapping", () => {
  it("turns a people file's columns into person rules", () => {
    const request = passRequestFrom(peopleMapping(), "file-1", PEOPLE_COLUMNS);
    expect(request).toEqual({
      recordKind: "person",
      fileId: "file-1",
      sourceKind: "card",
      keyColumn: "Card",
      rules: {
        given: "First",
        family: "Last",
        dateOfBirth: "Born",
        dateOrder: "day-month-year",
        emails: ["Email"],
        phones: [{ column: "Mobile" }, { column: "Fax No", fax: true }],
      },
    });
  });

  it("keys a matter file by its matter number when no column is the key alone", () => {
    const mapping = matterMapping();
    expect(keyColumnOf(mapping, MATTER_COLUMNS)).toBe("File No");
    const request = passRequestFrom(mapping, "file-2", MATTER_COLUMNS);
    expect(request).toEqual({
      recordKind: "matter",
      fileId: "file-2",
      sourceKind: "matter",
      keyColumn: "File No",
      rules: {
        title: "Description",
        number: "File No",
        closedDate: "Closed",
        openedDate: "Opened",
        dateOrder: "day-month-year",
        timeZone: "Australia/Sydney",
        client: { column: "Client Card", sourceKind: "card" },
        parties: [{ column: "Other Side", sourceKind: "card", role: "opposingparty" }],
        matterType: { column: "Type", types: { CONV: "matter-type-1" } },
        responsibleMember: {
          column: "Lawyer",
          members: { AL: "member-1" },
          otherwise: "member-2",
        },
      },
    });
  });

  it("names the delimiter only when the file is not comma-separated", () => {
    const tabbed = { ...peopleMapping(), delimiter: "tab" as const };
    expect(passRequestFrom(tabbed, "file-1", PEOPLE_COLUMNS)).toMatchObject({ delimiter: "\t" });
    expect(passRequestFrom(peopleMapping(), "file-1", PEOPLE_COLUMNS)).not.toHaveProperty(
      "delimiter",
    );
  });

  it("refuses a mapping with a required field unset, and says which", () => {
    const mapping = peopleMapping();
    delete mapping.assignments.Last;
    delete mapping.assignments.Card;
    const problems = mappingProblems(mapping, PEOPLE_COLUMNS);
    expect(problems.ready).toBe(false);
    expect(problems.missing).toEqual(["Key of Each Row", "Family Name"]);
    expect(passRequestFrom(mapping, "file-1", PEOPLE_COLUMNS)).toBeNull();
  });

  it("refuses a date column with no date order", () => {
    const mapping = { ...peopleMapping(), dateOrder: "" as const };
    expect(mappingProblems(mapping, PEOPLE_COLUMNS).dateOrderMissing).toBe(true);
    expect(passRequestFrom(mapping, "file-1", PEOPLE_COLUMNS)).toBeNull();
  });

  it("refuses two columns holding a field that takes one, and a party with no role", () => {
    const repeated = peopleMapping();
    repeated.assignments.Notes = hold("given");
    expect([...mappingProblems(repeated, PEOPLE_COLUMNS).repeatedColumns]).toEqual([
      "First",
      "Notes",
    ]);

    const roleless = matterMapping();
    roleless.assignments["Other Side"] = hold("party");
    expect([...mappingProblems(roleless, MATTER_COLUMNS).detailColumns]).toEqual(["Other Side"]);
  });

  it("refuses a matter file with nobody to be responsible for a row", () => {
    const mapping = { ...matterMapping(), members: {}, otherwiseMember: "" };
    expect(mappingProblems(mapping, MATTER_COLUMNS).responsibleMemberMissing).toBe(true);

    const noColumn = matterMapping();
    delete noColumn.assignments.Lawyer;
    noColumn.otherwiseMember = "";
    expect(mappingProblems(noColumn, MATTER_COLUMNS).missing).toContain("Responsible Member");
  });

  it("reads a pass's stated rules back into the mapping that asked for it", () => {
    for (const [mapping, columns] of [
      [peopleMapping(), PEOPLE_COLUMNS],
      [matterMapping(), MATTER_COLUMNS],
    ] as const) {
      const request = passRequestFrom(mapping, "file-1", columns);
      if (request === null) throw new Error("the mapping should be ready");
      const read = mappingFromStated(
        {
          recordKind: request.recordKind,
          sourceKind: request.sourceKind,
          keyColumn: request.keyColumn,
          delimiter: request.delimiter ?? null,
          rules: request.rules as Record<string, unknown>,
        },
        DEFAULTS,
      );
      expect(passRequestFrom(read, "file-1", columns)).toEqual(request);
    }
  });

  it("knows what a file holds from the slug it was uploaded under", () => {
    expect(recordKindOfFileKind("card-list")).toBe("person");
    expect(recordKindOfFileKind("organization-list")).toBe("organization");
    expect(recordKindOfFileKind("matter-list")).toBe("matter");
    expect(recordKindOfFileKind("trust-ledger")).toBeNull();
  });

  it("reads a one-column header that still has a delimiter in it as wrongly read", () => {
    expect(delimiterHintedBy(["Card;First;Last"])).toBe("semicolon");
    expect(delimiterHintedBy(["Card", "First"])).toBeNull();
    expect(delimiterHintedBy(["Card"])).toBeNull();
  });
});

function file(id: string, sourceKind: string): TransferSourceFile {
  return {
    id,
    sourceKind,
    format: "delimited-text",
    fileName: `${id}.csv`,
    byteLength: 10,
    contentSha256: id,
    keyColumn: null,
    rowCount: null,
    registeredAt: `2026-11-14T00:00:0${id.length}.000Z`,
    removedAt: null,
  };
}

function pass(
  id: string,
  fileId: string,
  requestedAt: string,
  counts: Partial<NonNullable<TransferPass["counts"]>> | null,
  state: TransferPass["state"] = "finished",
): TransferPass {
  return {
    id,
    fileId,
    recordKind: fileId === "matters" ? "matter" : "person",
    sourceKind: fileId === "matters" ? "matter" : "card",
    state,
    requestedBy: "member-1",
    requestedAt,
    startedAt: null,
    finishedAt: null,
    failedAt: null,
    counts:
      counts === null
        ? null
        : {
            rowsRead: 0,
            created: 0,
            alreadyLinked: 0,
            rejected: 0,
            waiting: 0,
            findings: 0,
            columnsMissing: 0,
            ...counts,
          },
  };
}

describe("a run's counts", () => {
  const files = [file("cards", "card-list"), file("matters", "matter-list")];
  const passes = [
    pass("p1", "cards", "2026-11-14T01:00:00.000Z", { rowsRead: 10, created: 6, rejected: 4 }),
    pass("p2", "cards", "2026-11-14T02:00:00.000Z", {
      rowsRead: 10,
      created: 2,
      alreadyLinked: 6,
      rejected: 2,
    }),
    pass("p3", "matters", "2026-11-14T03:00:00.000Z", {
      rowsRead: 5,
      created: 3,
      waiting: 1,
      rejected: 1,
    }),
    pass("p4", "matters", "2026-11-14T04:00:00.000Z", null, "running"),
  ];

  it("takes each file's newest pass, and its newest finished one for the counts", () => {
    expect(latestPassOf(passes, "matters")?.id).toBe("p4");
    expect(latestFinishedPassOf(passes, "matters")?.id).toBe("p3");
    expect(latestFinishedPassOf(passes, "cards")?.id).toBe("p2");
  });

  it("says the header sentence from the latest finished pass of every file", () => {
    expect(runSummary(files, passes)).toBe(
      "11 of 15 rows have arrived. 4 need a decision before this run can be accepted.",
    );
    expect(runSummary(files, [])).toBe("No file has been run yet.");
    expect(runSummary([], [])).toBe("No files yet.");
  });

  it("counts the first two Before Cutover lines and leaves the other two unrun", () => {
    const standings = cutoverChecks(files, passes, {}).map((check) => check.standing);
    expect(standings).toEqual([
      { kind: "open", left: 2 },
      { kind: "open", left: 2 },
      { kind: "notRun" },
      { kind: "notDone" },
    ]);
    expect(cutoverChecks(files, [], {})[0]?.standing).toEqual({ kind: "notRun" });
  });

  it("words a code it knows and shows one it does not as it arrived", () => {
    expect(rejectionLabel("noName")).toBe("The row has no name.");
    expect(rejectionLabel("somethingNew")).toBe("somethingNew");
    expect(
      passFailureLabel({
        reason: "fileNotReadable",
        fileFault: "unterminatedQuote",
        lineNumber: 7,
      }),
    ).toBe("A quoted value is never closed. Line 7.");
  });
});
