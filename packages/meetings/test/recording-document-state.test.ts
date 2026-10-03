import { describe, expect, it } from "vitest";
import type { FileVersionId } from "@magna-carta/identifiers/types";
import {
  readRecordingDocumentFacts,
  readRecordingDocuments,
  recordingDocumentFor,
  recordingDocumentStateOf,
  type RecordingDocumentFacts,
} from "../src/recording-document-state.ts";
import { HOLDING_MATTER, MATTER, migratedDatabase, seedFirm, visibility } from "./support.ts";

// Where the document a recording filed stands, read from the file pipeline's own record. WHAT IS
// PINNED: a filed recording is openable only while the version it filed is clean AND the file's
// current version, because the file's download serves the current one; a pending version is being
// checked, a quarantined or flagged one is held, a later version replaces it, the trash removes it;
// and a file moved behind a wall reports nothing across it. One read answers a whole page.

const AT = "2026-09-20T15:00:00.000Z";

function fresh() {
  const database = migratedDatabase();
  seedFirm(database.raw);
  return database;
}

type Raw = ReturnType<typeof fresh>["raw"];

/** A file on a matter holding the versions given, with the named one as its current version. */
function seedFile(
  raw: Raw,
  file: string,
  versions: readonly {
    id: string;
    status: string;
    scanVerdict?: string;
  }[],
  options: { matter?: string; current?: string | null; deleted?: boolean } = {},
): void {
  raw.exec(
    `INSERT INTO file (id, matter_id, name, edit_state, created_at, updated_at, deleted_at) ` +
      `VALUES ('${file}', '${options.matter ?? MATTER}', 'Meeting recording.wav', 'idle', '${AT}', '${AT}', ` +
      `${options.deleted === true ? `'${AT}'` : "NULL"})`,
  );
  versions.forEach((version, index) => {
    raw.exec(
      `INSERT INTO file_version (id, file_id, version_number, r2_key, status, scan_verdict, created_at) ` +
        `VALUES ('${version.id}', '${file}', ${String(index + 1)}, 'files/${version.id}', '${version.status}', ` +
        `${version.scanVerdict === undefined ? "NULL" : `'${version.scanVerdict}'`}, '${AT}')`,
    );
  });
  if (options.current !== undefined && options.current !== null) {
    raw.exec(`UPDATE file SET current_version_id = '${options.current}' WHERE id = '${file}'`);
  }
}

const version = (id: string) => id as FileVersionId;

function facts(overrides: Partial<RecordingDocumentFacts> = {}): RecordingDocumentFacts {
  return {
    version_id: version("fileVersion_recorded000000000"),
    version_status: "clean",
    scan_verdict: "clean",
    current_version_id: version("fileVersion_recorded000000000"),
    deleted_at: null,
    ...overrides,
  };
}

describe("where a filed version stands", () => {
  it("is available only while it is clean and still the file's current version", () => {
    expect(recordingDocumentStateOf(facts())).toBe("available");
    expect(
      recordingDocumentStateOf(
        facts({ current_version_id: version("fileVersion_later0000000000000") }),
      ),
    ).toBe("replaced");
    // Clean with no current version at all is not the version the download would serve.
    expect(recordingDocumentStateOf(facts({ current_version_id: null }))).toBe("replaced");
  });

  it("is being checked while the scan has not answered, and held when it held it", () => {
    expect(
      recordingDocumentStateOf(
        facts({ version_status: "pending", scan_verdict: null, current_version_id: null }),
      ),
    ).toBe("pending");
    expect(
      recordingDocumentStateOf(facts({ version_status: "quarantined", current_version_id: null })),
    ).toBe("held");
    // A later scan that flags a clean version holds it even before the version's status moves.
    expect(recordingDocumentStateOf(facts({ scan_verdict: "flagged" }))).toBe("held");
  });

  it("is removed when the file is in the trash, and unavailable when the upload never landed", () => {
    expect(recordingDocumentStateOf(facts({ deleted_at: AT }))).toBe("removed");
    expect(recordingDocumentStateOf(facts({ version_status: "abandoned" }))).toBe("unavailable");
  });
});

describe("the document a recording filed", () => {
  it("is only a filed recording's, and one the read did not return is unavailable", () => {
    const none = new Map<FileVersionId, RecordingDocumentFacts>();
    expect(recordingDocumentFor({ state: "composing", file_version_id: null }, none)).toBeNull();
    expect(recordingDocumentFor({ state: "abandoned", file_version_id: null }, none)).toBeNull();
    expect(recordingDocumentFor({ state: "filed", file_version_id: null }, none)).toBeNull();
    expect(
      recordingDocumentFor(
        { state: "filed", file_version_id: version("fileVersion_missing00000000000") },
        none,
      ),
    ).toEqual({ versionId: "fileVersion_missing00000000000", state: "unavailable" });
  });
});

describe("the read", () => {
  it("answers every filed version on a page in one read, from the file pipeline's rows", async () => {
    const database = fresh();
    seedFile(
      database.raw,
      "file_available000000000000000",
      [{ id: "fileVersion_available000000000", status: "clean", scanVerdict: "clean" }],
      { current: "fileVersion_available000000000" },
    );
    seedFile(database.raw, "file_pending00000000000000000", [
      { id: "fileVersion_pending00000000000", status: "pending" },
    ]);
    seedFile(database.raw, "file_held000000000000000000000", [
      { id: "fileVersion_held00000000000000", status: "quarantined", scanVerdict: "flagged" },
    ]);
    seedFile(
      database.raw,
      "file_replaced0000000000000000",
      [
        { id: "fileVersion_replacedfirst00000", status: "clean", scanVerdict: "clean" },
        { id: "fileVersion_replacedlater00000", status: "clean", scanVerdict: "clean" },
      ],
      { current: "fileVersion_replacedlater00000" },
    );
    seedFile(
      database.raw,
      "file_removed00000000000000000",
      [{ id: "fileVersion_removed00000000000", status: "clean", scanVerdict: "clean" }],
      { current: "fileVersion_removed00000000000", deleted: true },
    );

    const recordings = [
      { state: "filed", file_version_id: version("fileVersion_available000000000") },
      { state: "filed", file_version_id: version("fileVersion_pending00000000000") },
      { state: "filed", file_version_id: version("fileVersion_held00000000000000") },
      { state: "filed", file_version_id: version("fileVersion_replacedfirst00000") },
      { state: "filed", file_version_id: version("fileVersion_removed00000000000") },
      { state: "composing", file_version_id: null },
    ] as const;

    let reads = 0;
    const counted = {
      prepare: (sql: string) => {
        reads += 1;
        return database.database.prepare(sql);
      },
    };
    const documents = await readRecordingDocuments(counted, recordings, visibility);
    expect(reads).toBe(1);
    expect(recordings.map((recording) => documents.get(recording)?.state ?? null)).toEqual([
      "available",
      "pending",
      "held",
      "replaced",
      "removed",
      null,
    ]);
    expect(documents.get(recordings[3])?.versionId).toBe("fileVersion_replacedfirst00000");
  });

  it("reads nothing at all for a page with no filed recording", async () => {
    let reads = 0;
    const documents = await readRecordingDocuments(
      {
        prepare: () => {
          reads += 1;
          throw new Error("no read was owed");
        },
      },
      [{ state: "recording", file_version_id: null }],
      visibility,
    );
    expect(reads).toBe(0);
    expect([...documents.values()]).toEqual([null]);
  });

  it("reports nothing across a wall: a file moved to a matter the reader cannot see is unavailable", async () => {
    const database = fresh();
    seedFile(
      database.raw,
      "file_walled000000000000000000",
      [{ id: "fileVersion_walled000000000000", status: "clean", scanVerdict: "clean" }],
      { matter: HOLDING_MATTER, current: "fileVersion_walled000000000000" },
    );
    const walled = version("fileVersion_walled000000000000");
    const found = await readRecordingDocumentFacts(database.database, [walled], visibility);
    expect(found.size).toBe(0);

    const recording = { state: "filed", file_version_id: walled } as const;
    const documents = await readRecordingDocuments(database.database, [recording], visibility);
    expect(documents.get(recording)).toEqual({ versionId: walled, state: "unavailable" });
  });
});
