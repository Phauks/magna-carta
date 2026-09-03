import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACTIVITY_SECTIONS, navigateInto, type FactContext } from "$lib/activity/contribution.ts";
import {
  ACTIVITY_CONTRIBUTIONS,
  ACTIVITY_CREATE_VERBS,
  ACTIVITY_SECTION_VALUES,
  ACTIVITY_TYPE_VALUES,
  contributionFor,
  happenedText,
  openTargetFor,
} from "$lib/activity/contributions.ts";
import { activityColumns, activityRows, timeOfDay } from "$lib/activity/activity-columns.ts";
import type { ActivityEntry } from "$lib/matters/activity-api.ts";
import {
  UNSECTIONED_TIMELINE_SOURCES,
  matterSections,
  sectionOwningTimelineSource,
} from "$lib/matters/sections.ts";

/*
 * The pairing between the platform's timeline registry and the contributions that present it.
 *
 * The federated read declares its sources in packages/calendar/src/sources/all.ts and says nothing
 * about how any of them looks — deliberately, so a read-side declaration is not also a UI change.
 * That leaves exactly one way for the two halves to drift: a subsystem joins the timeline, nothing
 * here knows its key, and it reaches a person's screen as an unexplained row. This scan closes that,
 * in the direction it can actually fail — the SERVER is the authority, so every key it declares must
 * have a contribution, and a stale contribution for a source that was removed is a lint rather than
 * a bug.
 *
 * A source scan rather than an import: apps/web does not depend on @magna-carta/calendar, and adding
 * the dependency to assert a naming rule would put a server package in the browser bundle's graph.
 */

const SOURCES_FILE = fileURLToPath(
  new URL("../../../packages/calendar/src/sources/all.ts", import.meta.url),
);

function sourcesText(): string {
  return readFileSync(SOURCES_FILE, "utf8");
}

function declaredSourceKeys(): readonly string[] {
  // Both shapes the file uses: a source literal's own `key:` and a factory call's `key:`.
  const keys = [...sourcesText().matchAll(/^\s*key: "([A-Za-z]+)",$/gm)].map(
    (match) => match[1] ?? "",
  );
  return [...new Set(keys)].filter((key) => key !== "");
}

/** The sources whose declaration carries a describe — the ones whose rows have names. */
function describingSourceKeys(): readonly string[] {
  const text = sourcesText();
  const keys: string[] = [];
  const blocks = text.split(/^\s*key: "/gm).slice(1);
  for (const block of blocks) {
    const key = block.slice(0, block.indexOf('"'));
    if (/^\s*describe: \(request\)/m.test(block)) keys.push(key);
  }
  return keys;
}

const FACTS: FactContext = {
  money: (amountMinor, currency) => `${currency} ${(amountMinor / 100).toFixed(2)}`,
  date: (civil) => civil,
  today: "2026-09-02",
};

function entry(
  overrides: Partial<ActivityEntry> & Pick<ActivityEntry, "sourceKey">,
): ActivityEntry {
  return {
    kind: overrides.sourceKey,
    sortKey: "2026-09-01",
    rowId: "row_1",
    matterId: "matter_1",
    actorUserId: null,
    label: null,
    link: `/matters/matter_1/files?entry=row_1`,
    title: null,
    typeText: null,
    facts: null,
    ...overrides,
  };
}

describe("every timeline source the platform declares can be read on the screen", () => {
  it("finds the platform's declared sources at all, so an empty scan cannot pass vacuously", () => {
    const keys = declaredSourceKeys();
    expect(keys.length).toBeGreaterThanOrEqual(15);
    expect(keys).toContain("matterNote");
    expect(keys).toContain("trustMovement");
  });

  it("carries one contribution for each of them", () => {
    const missing = declaredSourceKeys().filter((key) => contributionFor(key) === undefined);
    expect(
      missing,
      "a source joined the platform's timeline with no contribution — write one beside the " +
        "owning subsystem's code and register it in $lib/activity/contributions.ts",
    ).toEqual([]);
  });

  it("carries no contribution for a source the platform no longer declares", () => {
    const declared = new Set(declaredSourceKeys());
    const stale = ACTIVITY_CONTRIBUTIONS.map((c) => c.sourceKey).filter(
      (key) => !declared.has(key),
    );
    expect(stale).toEqual([]);
  });

  it("gives every source that describes its rows a contribution that reads them", () => {
    const describing = describingSourceKeys();
    expect(describing.length).toBeGreaterThanOrEqual(6);
    for (const key of describing) {
      const contribution = contributionFor(key);
      expect(
        contribution?.factsOf !== undefined || contribution?.typeOf !== undefined,
        `${key} describes its rows on the server and nothing on the client reads the description`,
      ).toBe(true);
    }
  });

  it("names a section from the declared vocabulary, and the section that owns the source", () => {
    for (const contribution of ACTIVITY_CONTRIBUTIONS) {
      expect(ACTIVITY_SECTIONS).toContain(contribution.section);
      const owner = sectionOwningTimelineSource(contribution.sourceKey);
      if (owner === undefined) {
        expect(
          UNSECTIONED_TIMELINE_SOURCES[contribution.sourceKey],
          `${contribution.sourceKey} is owned by no section and declared ownerless by nobody`,
        ).toBeTypeOf("string");
        continue;
      }
      // The matter's own lifecycle opens on the Overview and reads as "Matter"; every other
      // contribution's section word is the owning section's own label.
      const expected = owner.slug === "overview" ? "Matter" : owner.label;
      expect(contribution.section, contribution.sourceKey).toBe(expected);
    }
  });

  it("states what happened as a whole sentence, and a fact rather than a guess for an unknown source", () => {
    for (const contribution of ACTIVITY_CONTRIBUTIONS) {
      const sentence = happenedText(contribution.sourceKey, contribution.sourceKey);
      expect(sentence.split(" ").length, contribution.sourceKey).toBeGreaterThanOrEqual(3);
      expect(sentence, contribution.sourceKey).not.toMatch(/\bfiled\b/i);
    }
    expect(happenedText("matterLifecycle", "matter.closed")).toBe("The matter was closed");
    expect(happenedText("somethingNew", "x")).toBe("Something was recorded on the matter");
  });

  it("declares the Section vocabulary whole and the Type words the registry knows", () => {
    expect(ACTIVITY_SECTION_VALUES).toEqual([...ACTIVITY_SECTIONS]);
    expect(ACTIVITY_TYPE_VALUES).toContain("Note");
    expect(ACTIVITY_TYPE_VALUES).toContain("Deadline");
    expect(ACTIVITY_TYPE_VALUES).not.toContain("Document type");
    expect(new Set(ACTIVITY_TYPE_VALUES).size).toBe(ACTIVITY_TYPE_VALUES.length);
  });

  it("offers a create verb for every contribution with a window", () => {
    expect(ACTIVITY_CREATE_VERBS.map((verb) => verb.label)).toEqual(["New Note"]);
  });
});

describe("where a row opens", () => {
  it("follows the deep link into a built section, and says why where none is built", () => {
    expect(openTargetFor(entry({ sourceKey: "documentFiled" }))).toEqual({
      kind: "navigate",
      href: "/matters/matter_1/files?entry=row_1",
    });
    const emails = matterSections.find((section) => section.slug === "emails");
    expect(emails?.stage).toBe("soon");
    expect(navigateInto(entry({ sourceKey: "emailFiled" }))).toEqual({
      kind: "none",
      reason: "The Emails section is not built yet",
    });
    expect(openTargetFor(entry({ sourceKey: "conflictsCheck" }))).toEqual({
      kind: "none",
      reason: UNSECTIONED_TIMELINE_SOURCES["conflictsCheck"],
    });
    expect(openTargetFor(entry({ sourceKey: "somethingNew" })).kind).toBe("none");
  });
});

const nameOf = (userId: string | null): string | null =>
  userId === "user_1" ? "Priya Nair" : null;

describe("the row model", () => {
  it("names a described document by the file manager's identification, never a suffix or Document", () => {
    const [row] = activityRows(
      [
        entry({
          sourceKey: "documentFiled",
          sortKey: "2026-09-02T14:12:00.000Z",
          actorUserId: "user_1",
          label: "Retainer agreement",
          title: "Retainer Agreement — Hollis.pdf",
          typeText: "Retainer agreement",
          facts: {
            contentType: "application/pdf",
            sizeBytes: 1258291,
            versionNumber: 2,
            status: "clean",
            scanVerdict: "clean",
            hasVersion: 1,
            documentTypeId: "documentType_1",
          },
        }),
      ],
      { nameOf, facts: FACTS },
    );
    expect(row?.section).toBe("Files");
    expect(row?.type).toBe("Retainer agreement");
    expect(row?.name).toBe("Retainer Agreement — Hollis.pdf");
    expect(row?.glyph).toEqual({
      kind: "file",
      fileName: "Retainer Agreement — Hollis.pdf",
      contentType: "application/pdf",
    });
    expect(row?.details).toBe("1.2 MB · Version 2");
    expect(row?.who).toBe("Priya Nair");
    expect(row?.day).toBe("2026-09-02");
  });

  it("types an untyped document by what its bytes say, and grades a held file", () => {
    const [row] = activityRows(
      [
        entry({
          sourceKey: "documentFiled",
          title: "discovery-production-001.zip",
          typeText: null,
          facts: {
            contentType: "application/zip",
            sizeBytes: 318 * 1024 * 1024,
            versionNumber: 1,
            status: "pending",
            scanVerdict: null,
            hasVersion: 1,
            documentTypeId: null,
          },
        }),
      ],
      { nameOf, facts: FACTS },
    );
    expect(row?.type).toBe("Archive");
    // The register's own word for a file the scanner has not cleared — the same word the Files
    // section's Safety column shows, because both read the one status register.
    expect(row?.facts.map((fact) => fact.value)).toEqual(["318 MB", "Warning"]);
    expect(row?.facts.at(-1)?.tone).toBe("danger");
  });

  it("falls back to the sentence, the noun and the declared label where nothing described the row", () => {
    const [row] = activityRows([entry({ sourceKey: "timeEntry", label: "90 min", title: null })], {
      nameOf,
      facts: FACTS,
    });
    expect(row?.name).toBe("Time was booked");
    expect(row?.type).toBe("Time entry");
    expect(row?.details).toBe("Time booked 90 min");
  });

  it("reads a described note, time entry, cost and deadline in each subsystem's own words", () => {
    const rows = activityRows(
      [
        entry({
          sourceKey: "matterNote",
          rowId: "n1",
          title: "Call with Ms Hollis about the settlement offer",
          facts: { occurredOn: "2026-09-02", occurredAtTime: "11:40", attachmentCount: 1 },
        }),
        entry({
          sourceKey: "timeEntry",
          rowId: "t1",
          title: "Reviewed draft indemnity clause",
          facts: { durationMinutes: 90, billable: 1, entryNumber: "T-14", status: "submitted" },
        }),
        entry({
          sourceKey: "costEntry",
          rowId: "c1",
          title: "Filing fee — motion to compel",
          facts: { amountMinor: 45000, currency: "USD", billable: 0, status: "draft" },
        }),
        entry({
          sourceKey: "matterDeadline",
          rowId: "d1",
          title: "Answer due",
          facts: { state: "open", dueOn: "2026-08-27", authorityText: "Rule 12(a)" },
        }),
        entry({
          sourceKey: "matterEvent",
          rowId: "e1",
          title: "Case management conference",
          typeText: "Hearing",
          facts: { status: "scheduled", startsAtTime: "09:00", locationText: "Courtroom 4B" },
        }),
      ],
      { nameOf, facts: FACTS },
    );
    expect(rows.map((row) => row.details)).toEqual([
      "Happened 2026-09-02 11:40 · 1 attachment",
      "1.5 h · T-14 · Submitted",
      "USD 450.00 · Non-billable",
      "Overdue · Authority Rule 12(a)",
      "At 09:00 · Courtroom 4B",
    ]);
    expect(rows.map((row) => row.type)).toEqual([
      "Note",
      "Time entry",
      "Cost",
      "Deadline",
      "Hearing",
    ]);
    expect(rows[3]?.facts[0]?.tone).toBe("danger");
  });

  it("reads what happened to a document in the File History view's own words", () => {
    const rows = activityRows(
      [
        entry({
          sourceKey: "fileHistory",
          kind: "file.renamed",
          rowId: "audit_1",
          title: "Indemnity Clause Draft.docx",
          facts: { event: "file.renamed", fileId: "file_1", versionNumber: null, metadata: null },
        }),
        entry({
          sourceKey: "fileHistory",
          kind: "file.version_committed",
          rowId: "audit_2",
          title: "Indemnity Clause Draft.docx",
          facts: { event: "file.version_committed", fileId: "file_1", versionNumber: 3 },
        }),
        entry({
          sourceKey: "fileHistory",
          kind: "file.quarantined",
          rowId: "audit_3",
          title: null,
        }),
      ],
      { nameOf, facts: FACTS },
    );
    expect(rows.map((row) => row.type)).toEqual(["Renamed", "New Version", "File change"]);
    expect(rows[0]?.section).toBe("Files");
    expect(rows[0]?.glyph).toEqual({
      kind: "file",
      fileName: "Indemnity Clause Draft.docx",
      contentType: null,
    });
    expect(rows[1]?.details).toBe("Version 3");
    expect(rows[2]?.name).toBe("A document was held by the safety check");
  });

  it("caps a long name's claim on the column without losing the record", () => {
    const long = "A".repeat(100);
    const [row] = activityRows([entry({ sourceKey: "matterNote", title: long })], {
      nameOf,
      facts: FACTS,
    });
    expect(row?.name.length).toBe(72);
    expect(row?.name.endsWith("…")).toBe(true);
    expect(row?.entry.title).toBe(long);
  });

  it("keeps the chronology as the anchored, leading column and filters Section, Type and Who as sets", () => {
    const columns = activityColumns();
    expect(columns[0]).toMatchObject({ id: "date", anchored: true, type: "date" });
    expect(columns.find((c) => c.id === "section")).toMatchObject({
      filter: "set",
      filterValues: ACTIVITY_SECTION_VALUES,
    });
    expect(columns.find((c) => c.id === "type")?.filter).toBe("set");
    expect(columns.find((c) => c.id === "who")?.filter).toBe("set");
  });

  it("cuts the day from the sort key's first ten characters and the time from an instant only", () => {
    expect(timeOfDay("2026-09-01")).toBeNull();
    expect(timeOfDay("2026-09-01T00:00:00.000Z")).toMatch(/^\d{2}:\d{2}$/u);
  });
});
