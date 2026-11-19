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
  codeIsMatched,
  codeMatchingLabel,
  codeMatchingOf,
  delimiterHintedBy,
  KEY_ONLY,
  keyColumnOf,
  mappingFingerprint,
  mappingFromStated,
  mappingProblems,
  openingMapping,
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
  rejectedRowsFileName,
  rejectionLabel,
  runStatusLabel,
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

describe("the mapping a file opens on", () => {
  const saved = { ...blankMapping("matter", DEFAULTS), dateOrder: "day-month-year" as const };
  const stated = { ...blankMapping("matter", DEFAULTS), dateOrder: "year-month-day" as const };

  it("is the saved one for a file that has never been run", () => {
    const opening = openingMapping({
      saved: { mapping: saved, savedAt: "2026-11-18T10:00:00.000Z" },
      stated: null,
      passRequestedAt: null,
    });
    expect(opening).toEqual({ mapping: saved, source: "saved" });
  });

  it("is nothing where nothing is saved and the file has never been run", () => {
    expect(openingMapping({ saved: null, stated: null, passRequestedAt: null })).toEqual({
      mapping: null,
      source: "none",
    });
  });

  it("is what the latest pass ran under when the mapping was saved before that pass", () => {
    const opening = openingMapping({
      saved: { mapping: saved, savedAt: "2026-11-18T10:00:00.000Z" },
      stated,
      passRequestedAt: "2026-11-18T10:05:00.000Z",
    });
    expect(opening).toEqual({ mapping: stated, source: "stated" });
  });

  it("is the saved one when it was saved after the latest pass was asked for", () => {
    const opening = openingMapping({
      saved: { mapping: saved, savedAt: "2026-11-18T10:06:00.000Z" },
      stated,
      passRequestedAt: "2026-11-18T10:05:00.000Z",
    });
    expect(opening).toEqual({ mapping: saved, source: "saved" });
  });

  it("compares the two moments as moments, whatever zone each is written in", () => {
    const opening = openingMapping({
      saved: { mapping: saved, savedAt: "2026-11-18T21:00:00+11:00" },
      stated,
      passRequestedAt: "2026-11-18T10:05:00.000Z",
    });
    expect(opening.source).toBe("stated");
  });

  it("falls back to the saved one where the pass's rules could not be read", () => {
    const opening = openingMapping({
      saved: { mapping: saved, savedAt: "2026-11-18T10:00:00.000Z" },
      stated: null,
      passRequestedAt: "2026-11-18T10:05:00.000Z",
    });
    expect(opening.source).toBe("saved");
  });

  it("is what the pass ran under where nothing is saved", () => {
    expect(
      openingMapping({ saved: null, stated, passRequestedAt: "2026-11-18T10:05:00.000Z" }),
    ).toEqual({ mapping: stated, source: "stated" });
  });
});

describe("whether a mapping has changed since it was saved", () => {
  it("does not depend on the order columns and codes were touched in", () => {
    const first: FileMapping = {
      ...blankMapping("matter", DEFAULTS),
      assignments: { Number: hold("number"), Title: hold("title") },
      members: { AL: "member-one", BK: "member-two" },
    };
    const second: FileMapping = {
      ...blankMapping("matter", DEFAULTS),
      assignments: { Title: hold("title"), Number: hold("number") },
      members: { BK: "member-two", AL: "member-one" },
    };
    expect(mappingFingerprint(first)).toBe(mappingFingerprint(second));
  });

  it("differs when any statement differs", () => {
    const base: FileMapping = {
      ...blankMapping("matter", DEFAULTS),
      assignments: { Party: hold("party", { role: "witness" }) },
    };
    const fingerprint = mappingFingerprint(base);
    expect(mappingFingerprint({ ...base, delimiter: "tab" })).not.toBe(fingerprint);
    expect(mappingFingerprint({ ...base, otherwiseMember: "member-one" })).not.toBe(fingerprint);
    expect(mappingFingerprint({ ...base, matterTypes: { CONV: "type-one" } })).not.toBe(
      fingerprint,
    );
    expect(
      mappingFingerprint({ ...base, assignments: { Party: hold("party", { role: "expert" }) } }),
    ).not.toBe(fingerprint);
  });
});

describe("which of a column's codes are matched", () => {
  const codes = [
    { value: "CONV", rowCount: 40 },
    { value: "LIT", rowCount: 12 },
    { value: "FAM", rowCount: 3 },
  ];

  it("counts the file's own codes that have no match", () => {
    expect(codeMatchingOf(codes, { CONV: "type-one" })).toEqual({ total: 3, unmatched: 2 });
    expect(codeMatchingLabel(codeMatchingOf(codes, { CONV: "type-one" }))).toBe(
      "2 of 3 not matched",
    );
  });

  it("settles once every code is matched, and ignores a match the file has no code for", () => {
    const matches = { CONV: "type-one", LIT: "type-two", FAM: "type-three", OLD: "type-four" };
    expect(codeMatchingOf(codes, matches)).toEqual({ total: 3, unmatched: 0 });
    expect(codeMatchingLabel(codeMatchingOf(codes, matches))).toBe("All 3 matched");
  });

  it("compares a trimmed value exactly", () => {
    expect(codeIsMatched(" CONV ", { CONV: "type-one" })).toBe(true);
    expect(codeIsMatched("conv", { CONV: "type-one" })).toBe(false);
    expect(codeIsMatched("CON", { CONV: "type-one" })).toBe(false);
  });

  it("does not count a code whose match has not been chosen", () => {
    expect(codeIsMatched("CONV", { CONV: "" })).toBe(false);
  });

  it("is not fooled by a code named like something every object has", () => {
    expect(codeIsMatched("constructor", {})).toBe(false);
    expect(codeIsMatched("toString", {})).toBe(false);
  });

  it("counts a code once however it is spaced, and passes over an empty value", () => {
    const spaced = [
      { value: "AL", rowCount: 5 },
      { value: " AL", rowCount: 1 },
      { value: "", rowCount: 9 },
    ];
    expect(codeMatchingOf(spaced, {})).toEqual({ total: 1, unmatched: 1 });
  });

  it("says so where the column has no codes", () => {
    expect(codeMatchingLabel(codeMatchingOf([], { CONV: "type-one" }))).toBe("No codes");
  });
});

describe("how a run's ending reads", () => {
  const run = {
    id: "run-one",
    sourceSystem: "leap",
    label: "Rehearsal 1",
    startedBy: "member-one",
    startedAt: "2026-11-18T09:00:00.000Z",
    completedAt: null,
    abandonedAt: null,
  };

  it("is Open, Accepted or Stopped", () => {
    expect(runStatusLabel(run)).toBe("Open");
    expect(runStatusLabel({ ...run, completedAt: "2026-11-18T12:00:00.000Z" })).toBe("Accepted");
    expect(runStatusLabel({ ...run, abandonedAt: "2026-11-18T12:00:00.000Z" })).toBe("Stopped");
  });

  it("no longer says what stands before accepting a run that has ended", () => {
    expect(runSummary([], [], false)).toBe("No files.");
  });
});

describe("the name the rejected rows are saved under", () => {
  it("is the file's own name without its ending", () => {
    expect(rejectedRowsFileName("matters.csv")).toBe("rejected-rows-matters.csv");
    expect(rejectedRowsFileName("Matter List 2026.txt")).toBe("rejected-rows-Matter List 2026.csv");
  });

  it("replaces what a file name cannot have, and never comes out empty", () => {
    expect(rejectedRowsFileName("a/b:c.csv")).toBe("rejected-rows-a-b-c.csv");
    expect(rejectedRowsFileName(".csv")).toBe("rejected-rows-file.csv");
  });
});
