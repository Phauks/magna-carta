import { describe, expect, it } from "vitest";
import { assertPermission, type Permission } from "@magna-carta/access-control/registry";
import { readTimelinePage } from "../src/timeline.ts";
import { TIMELINE_SOURCES, timelineSourceRegistry } from "../src/sources/all.ts";
import { visibleMatterPredicate } from "../src/visibility.ts";
import { ACTOR, MATTER, WALLED_MATTER, migratedDatabase, seedMatters } from "./support.ts";

// The description pass: a matter-scoped read names the rows on its page through each owning source's
// own describe statement, behind that source's own permission. Nothing here changes what the page
// read projects — the firm-wide read is asserted to stay exactly as thin as it was.

type Raw = ReturnType<typeof migratedDatabase>["raw"];

const at = (day: string) => `2026-0${day}T10:00:00.000Z`;

function seedCorpus(raw: Raw): void {
  seedMatters(raw);
  raw.exec(`
    INSERT INTO document_type (id, name, active, created_at, updated_at)
      VALUES ('documentType_retainer000000000', 'Retainer agreement', 1, '${at("1-01")}', '${at("1-01")}');
    INSERT INTO file (id, matter_id, name, document_type_id, edit_state, created_at, updated_at)
      VALUES ('file_retainer000000000000000000', '${MATTER}', 'Retainer Agreement.pdf', 'documentType_retainer000000000', 'idle', '${at("3-02")}', '${at("3-02")}');
    INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, sniffed_content_type, status, scan_verdict, created_at)
      VALUES ('fileVersion_retainer2000000000', 'file_retainer000000000000000000', 2, 'firm/retainer/v2', 1258291, 'application/pdf', 'clean', 'clean', '${at("3-02")}');
    UPDATE file SET current_version_id = 'fileVersion_retainer2000000000' WHERE id = 'file_retainer000000000000000000';
    INSERT INTO file (id, matter_id, name, edit_state, created_at, updated_at)
      VALUES ('file_walled00000000000000000000', '${WALLED_MATTER}', 'Estate inventory.xlsx', 'idle', '${at("3-03")}', '${at("3-03")}');
    INSERT INTO audit_log (id, event, actor_user_id, subject_id, metadata, created_at)
      VALUES ('auditLog_rename0000000000000000', 'file.renamed', '${ACTOR}', 'file_retainer000000000000000000', '{"redacted":true}', '${at("3-04")}'),
             ('auditLog_firstcommit00000000000', 'file.version_committed', '${ACTOR}', 'fileVersion_retainer2000000000', NULL, '${at("3-02")}'),
             ('auditLog_walledrename0000000000', 'file.renamed', '${ACTOR}', 'file_walled00000000000000000000', NULL, '${at("3-05")}');
    INSERT INTO matter_note (id, matter_id, author_user_id, body, occurred_on, created_at, updated_at)
      VALUES ('matterNote_call000000000000000', '${MATTER}', '${ACTOR}', 'Call with the client about the offer.\nShe is thinking about it.', '2026-04-11', '${at("4-12")}', '${at("4-12")}');
    INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, currency, status, source, entry_number, created_at, updated_at)
      VALUES ('timeEntry_drafting0000000000000', '${MATTER}', '${ACTOR}', '2026-04-10', 90, 87, 'Drafted the opposition brief', 1, 'USD', 'draft', 'manual', 'T-14', '${at("4-10")}', '${at("4-10")}');
    INSERT INTO cost_entry (id, matter_id, incurred_date, amount_minor, currency, disbursement_class, billable, description, status, source, created_at, updated_at)
      VALUES ('costEntry_filingFee00000000000', '${MATTER}', '2026-03-02', 27000, 'USD', 'hard', 1, 'Filing fee', 'draft', 'manual', '${at("3-02")}', '${at("3-02")}');
    INSERT INTO matter_event (id, matter_id, title, status, starts_on, starts_at_time, time_zone, location_text, recorded_at, created_at, updated_at)
      VALUES ('matterEvent_hearing00000000000000', '${MATTER}', 'Hearing on the motion', 'scheduled', '2026-09-14', '09:00', 'America/Los_Angeles', 'Courtroom 4B', '${at("8-06")}', '${at("8-06")}', '${at("8-06")}');
    INSERT INTO matter_deadline (id, matter_id, title, due_on, time_zone, source, state, authority_text, recorded_at, created_at, updated_at)
      VALUES ('matterDeadline_opposition00000000', '${MATTER}', 'Opposition due', '2026-09-07', 'America/Los_Angeles', 'member', 'open', 'Local Rule 7-3', '${at("8-06")}', '${at("8-06")}', '${at("8-06")}');
  `);
}

const EVERYTHING: ReadonlySet<Permission> = new Set(
  TIMELINE_SOURCES.map((source) => source.permission).filter(
    (permission): permission is Permission => permission !== null,
  ),
);

describe("a matter-scoped read names its rows through each owning source", () => {
  it("describes a document with the file manager's own facts, a note by its opening line, and the rest by name", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    const page = await readTimelinePage({
      database,
      registry: timelineSourceRegistry(),
      scope: { matterId: MATTER },
      visibility: visibleMatterPredicate(),
      pageSize: 50,
      describe: { permissions: EVERYTHING },
    });
    const byKey = new Map(page.entries.map((entry) => [entry.sourceKey, entry]));

    const document = byKey.get("documentFiled");
    expect(document?.title).toBe("Retainer Agreement.pdf");
    expect(document?.typeText).toBe("Retainer agreement");
    expect(document?.facts).toMatchObject({
      contentType: "application/pdf",
      sizeBytes: 1258291,
      versionNumber: 2,
      status: "clean",
      scanVerdict: "clean",
      hasVersion: 1,
      documentTypeId: "documentType_retainer000000000",
    });

    // The FIRST LINE of the body and nothing past it: the words a member may read, one line of them.
    const note = byKey.get("matterNote");
    expect(note?.title).toBe("Call with the client about the offer.");
    expect(note?.typeText).toBeNull();
    expect(note?.facts).toMatchObject({ occurredOn: "2026-04-11", attachmentCount: 0 });

    expect(byKey.get("timeEntry")?.title).toBe("Drafted the opposition brief");
    expect(byKey.get("timeEntry")?.facts).toMatchObject({
      durationMinutes: 90,
      billable: 1,
      entryNumber: "T-14",
    });
    expect(byKey.get("costEntry")?.title).toBe("Filing fee");
    expect(byKey.get("costEntry")?.facts).toMatchObject({ amountMinor: 27000, currency: "USD" });
    expect(byKey.get("matterEvent")?.title).toBe("Hearing on the motion");
    expect(byKey.get("matterEvent")?.facts).toMatchObject({ locationText: "Courtroom 4B" });
    expect(byKey.get("matterDeadline")?.title).toBe("Opposition due");
    expect(byKey.get("matterDeadline")?.facts).toMatchObject({
      state: "open",
      authorityText: "Local Rule 7-3",
    });

    // What happened to the document, named by the file it happened to and opening onto that file.
    const renamed = page.entries.find((entry) => entry.sourceKey === "fileHistory");
    expect(renamed?.kind).toBe("file.renamed");
    expect(renamed?.title).toBe("Retainer Agreement.pdf");
    expect(renamed?.link).toBe(`/matters/${MATTER}/files?entry=file_retainer000000000000000000`);
    expect(renamed?.facts).toMatchObject({
      event: "file.renamed",
      fileId: "file_retainer000000000000000000",
      metadata: { redacted: true },
    });
    // A version-2 commit would appear; the seeded commit is on version 2 of the retainer, so it does.
    // The walled matter's rename does not: the audit log's subject is confined through the file.
    expect(page.entries.filter((entry) => entry.sourceKey === "fileHistory")).toHaveLength(2);

    // One describe statement per source PRESENT on the page — bounded by the registry, never the rows.
    expect(page.describeStatementCount).toBe(7);
  });

  it("withholds the words, and only the words, from a member who lacks the source's permission", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    const withoutNotes = new Set(EVERYTHING);
    withoutNotes.delete(assertPermission("notes:read"));
    const page = await readTimelinePage({
      database,
      registry: timelineSourceRegistry(),
      scope: { matterId: MATTER },
      visibility: visibleMatterPredicate(),
      pageSize: 50,
      describe: { permissions: withoutNotes },
    });
    const note = page.entries.find((entry) => entry.sourceKey === "matterNote");
    // The entry is still there: that a note was written is not the note.
    expect(note).toBeDefined();
    expect(note?.title).toBeNull();
    expect(note?.facts).toBeNull();
    // Every other source still names its rows.
    expect(page.entries.find((entry) => entry.sourceKey === "documentFiled")?.title).toBe(
      "Retainer Agreement.pdf",
    );
    expect(page.describeStatementCount).toBe(6);
  });

  it("describes nothing on a read that did not ask, and nothing on a firm-wide read however it asks", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    const silent = await readTimelinePage({
      database,
      registry: timelineSourceRegistry(),
      scope: { matterId: MATTER },
      visibility: visibleMatterPredicate(),
      pageSize: 50,
    });
    expect(silent.entries.every((entry) => entry.title === null && entry.facts === null)).toBe(
      true,
    );
    expect(silent.describeStatementCount).toBe(0);

    const firmWide = await readTimelinePage({
      database,
      registry: timelineSourceRegistry(),
      scope: { fromDate: "2026-01-01", toDate: "2026-12-31" },
      visibility: visibleMatterPredicate(),
      pageSize: 50,
      describe: { permissions: EVERYTHING },
    });
    expect(firmWide.entries.length).toBeGreaterThan(0);
    expect(firmWide.entries.every((entry) => entry.title === null)).toBe(true);
    expect(firmWide.describeStatementCount).toBe(0);
  });

  it("binds the matter in every describe statement, so a row of another matter is never named", () => {
    const { database } = migratedDatabase();
    for (const source of TIMELINE_SOURCES) {
      if (source.describe === undefined) continue;
      const statements = source.describe({
        database,
        matterId: MATTER,
        rowIds: ["row_one", "row_two"],
        visibility: visibleMatterPredicate(),
      });
      expect(statements.length, source.key).toBe(1);
      const statement = statements[0];
      if (statement === undefined) throw new Error(`${source.key} built no describe statement`);
      const sql = statement.sql ?? "";
      // The matter binding, the id list, the visibility predicate, and the LIMIT, in that order.
      const matterIndex = sql.indexOf("= ?");
      const inIndex = sql.indexOf("IN (?, ?)");
      const markerIndex = sql.indexOf("matter.system_key IS NULL");
      const limitIndex = sql.lastIndexOf("LIMIT ?");
      expect(matterIndex, `${source.key} does not bind the matter`).toBeGreaterThan(-1);
      expect(inIndex, `${source.key} does not bind the row ids`).toBeGreaterThan(matterIndex);
      expect(markerIndex, `${source.key} does not compose the predicate`).toBeGreaterThan(inIndex);
      expect(limitIndex, `${source.key} is unbounded`).toBeGreaterThan(markerIndex);
      // A describe projects exactly the fixed columns and nothing else — no free text a source
      // did not declare.
      expect(sql).toMatch(
        /^SELECT .+ AS row_id, .+ AS title, .+ AS type_text, .+ AS facts_json FROM /u,
      );
    }
  });

  it("refuses to describe an empty page rather than issuing a statement that cannot match", () => {
    const { database } = migratedDatabase();
    const source = TIMELINE_SOURCES.find((candidate) => candidate.key === "matterNote");
    expect(() =>
      source!.describe!({
        database,
        matterId: MATTER,
        rowIds: [],
        visibility: visibleMatterPredicate(),
      }),
    ).toThrow(/at least one row/u);
  });

  it("every source declares its permission, and the ones with names declare a describe", () => {
    for (const source of TIMELINE_SOURCES) {
      expect(source.permission === null || typeof source.permission === "string", source.key).toBe(
        true,
      );
    }
    const describing = TIMELINE_SOURCES.filter((source) => source.describe !== undefined).map(
      (source) => source.key,
    );
    expect(describing.toSorted()).toEqual(
      [
        "costEntry",
        "documentFiled",
        "fileHistory",
        "matterDeadline",
        "matterEvent",
        "matterNote",
        "matterTask",
        "timeEntry",
      ].toSorted(),
    );
  });
});
