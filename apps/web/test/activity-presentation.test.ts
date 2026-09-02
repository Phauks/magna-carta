import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { activityDays } from "$lib/matters/activity-days.ts";
import type { ActivityEntry } from "$lib/matters/activity-api.ts";
import {
  ACTIVITY_KIND_VALUES,
  activityColumns,
  activityRows,
} from "$lib/matters/activity-columns.ts";
import {
  ACTIVITY_PRESENTATIONS,
  followableLink,
  happenedText,
  presentationFor,
} from "$lib/matters/activity-presentation.ts";
import { matterSections } from "$lib/matters/sections.ts";

/*
 * The pairing between the platform's timeline registry and this screen's presentation registry.
 *
 * The federated read declares its sources in packages/calendar/src/sources/all.ts and says nothing
 * about how any of them looks — deliberately, so a read-side declaration is not also a UI change.
 * That leaves exactly one way for the two halves to drift: a subsystem joins the timeline, nothing
 * here knows its key, and it reaches a person's screen as an unexplained row. This scan closes that,
 * in the direction it can actually fail — the SERVER is the authority, so every key it declares must
 * have words here, and a stale entry here for a source that was removed is a lint rather than a bug.
 *
 * A source scan rather than an import: apps/web does not depend on @magna-carta/calendar, and adding
 * the dependency to assert a naming rule would put a server package in the browser bundle's graph.
 */

const SOURCES_FILE = fileURLToPath(
  new URL("../../../packages/calendar/src/sources/all.ts", import.meta.url),
);

function declaredSourceKeys(): readonly string[] {
  const source = readFileSync(SOURCES_FILE, "utf8");
  // Both shapes the file uses: a source literal's own `key:` and a factory call's `key:`.
  const keys = [...source.matchAll(/^\s*key: "([A-Za-z]+)",$/gm)].map((match) => match[1] ?? "");
  return [...new Set(keys)].filter((key) => key !== "");
}

describe("every timeline source the platform declares can be read on the screen", () => {
  it("finds the platform's declared sources at all, so an empty scan cannot pass vacuously", () => {
    const keys = declaredSourceKeys();
    expect(keys.length).toBeGreaterThanOrEqual(14);
    expect(keys).toContain("matterNote");
    expect(keys).toContain("trustMovement");
  });

  it("carries one presentation for each of them", () => {
    const missing = declaredSourceKeys().filter((key) => presentationFor(key) === undefined);
    expect(
      missing,
      "a source joined the platform's timeline with no entry in activity-presentation.ts — " +
        "add one there, or its rows reach a person as an unexplained line",
    ).toEqual([]);
  });

  it("presents no source the platform does not declare", () => {
    const declared = new Set(declaredSourceKeys());
    const stale = ACTIVITY_PRESENTATIONS.map((entry) => entry.key).filter(
      (key) => !declared.has(key),
    );
    expect(stale).toEqual([]);
  });
});

describe("what a row says", () => {
  it("states what happened as a whole sentence, on every source", () => {
    for (const presentation of ACTIVITY_PRESENTATIONS) {
      // The primary text of most rows, because most sources declare no label at all. It has to read
      // on its own, so it starts with a capital and is longer than a noun.
      expect(presentation.happened.length).toBeGreaterThan(presentation.noun.length);
      expect(presentation.happened[0]).toBe(presentation.happened[0]?.toUpperCase());
    }
  });

  it("answers a source it has never heard of with a true sentence rather than a guess", () => {
    // A deployed client meeting a server one release ahead. Saying something specific would be
    // inventing it; saying nothing would render a blank row.
    expect(happenedText("somethingShippedLater")).toContain("recorded");
    expect(presentationFor("somethingShippedLater")).toBeUndefined();
  });

  it("names what a declared label MEANS wherever a source declares one", () => {
    // A document's TYPE beside "A document was filed" reads as the file's name unless it says which
    // field it is. The sources that declare no label carry no meaning to name.
    const documents = presentationFor("documentFiled");
    expect(documents?.labelMeaning).toBe("Document type");
    expect(presentationFor("matterNote")?.labelMeaning).toBeUndefined();
    expect(presentationFor("emailFiled")?.labelMeaning).toBeUndefined();
  });

  it("offers every source's kind to the Kind column's filter, present on screen or not", () => {
    // A set filter otherwise offers only what the loaded rows hold, and a matter with no costs yet
    // would show a filter that cannot say "Cost" — which a reader takes for "it never can".
    const offered = new Set(ACTIVITY_KIND_VALUES);
    for (const presentation of ACTIVITY_PRESENTATIONS) {
      expect(offered.has(presentation.noun), `${presentation.key} names ${presentation.noun}`).toBe(
        true,
      );
    }
  });
});

describe("where an entry can be followed", () => {
  it("offers the link when the owning section is built", () => {
    expect(followableLink("matterNote", "/matters/m1/notes?entry=n1")).toBe(
      "/matters/m1/notes?entry=n1",
    );
  });

  it("offers nothing where no matter section owns the record", () => {
    // A conflicts check has no matter section at all; a row states what happened and stops.
    expect(followableLink("conflictsCheck", "/matters/m1/conflicts?entry=c1")).toBeNull();
  });

  it("offers nothing while the owning section is still a stub", () => {
    // Sections come alive on their own schedule. Linking into one that cannot honour the entry it
    // was handed reads as a broken product rather than an unfinished one.
    const unbuilt = matterSections.find((section) => section.stage === "soon");
    expect(unbuilt, "the fixture needs at least one section still marked soon").toBeDefined();
    const source = ACTIVITY_PRESENTATIONS.find(
      (presentation) => presentation.section === unbuilt?.slug,
    );
    if (source !== undefined) {
      expect(followableLink(source.key, "/matters/m1/x?entry=1")).toBeNull();
    }
  });

  it("names only sections the app actually routes", () => {
    // The platform builds the link from this slug. A slug the section registry does not carry is a
    // link to a screen that does not exist, which is how two of them shipped broken.
    const slugs = new Set(matterSections.map((section) => section.slug));
    for (const presentation of ACTIVITY_PRESENTATIONS) {
      if (presentation.section === undefined) continue;
      expect(
        slugs.has(presentation.section),
        `${presentation.key} names ${presentation.section}`,
      ).toBe(true);
    }
  });
});

describe("the chronology, cut into days", () => {
  const entry = (sortKey: string, rowId: string) => ({ sortKey, rowId });

  it("groups a page by the civil day, in the order the server sent it", () => {
    const days = activityDays([
      entry("2026-08-30", "a"),
      entry("2026-08-30T09:00:00.000Z", "b"),
      entry("2026-08-29", "c"),
    ]);
    expect(days.map((day) => day.day)).toEqual(["2026-08-30", "2026-08-29"]);
    expect(days[0]?.entries.map((row) => row.rowId)).toEqual(["a", "b"]);
  });

  it("takes the day off an instant without reading it as a moment", () => {
    // Parsing the instant and formatting it back would move a filing to the day before for every
    // reader west of the zone it was written in.
    const [day] = activityDays([entry("2026-01-01T00:30:00.000Z", "a")]);
    expect(day?.day).toBe("2026-01-01");
  });

  it("never re-orders, so a second page continues where the first stopped", () => {
    const days = activityDays([entry("2026-08-28", "a"), entry("2026-08-30", "b")]);
    expect(days.map((day) => day.day)).toEqual(["2026-08-28", "2026-08-30"]);
  });

  it("answers an empty page with no days at all", () => {
    expect(activityDays([])).toEqual([]);
  });
});

describe("the row model the table reads", () => {
  const entry = (over: Partial<ActivityEntry> & { sourceKey: string; rowId: string }) => ({
    kind: over.sourceKey,
    sortKey: "2026-08-30",
    matterId: "matter_1",
    actorUserId: null,
    label: null,
    link: "/matters/matter_1/notes?entry=note_1",
    ...over,
  });
  const bare = { detailFor: () => undefined, nameOf: () => null };

  it("leads with what the subsystem calls the row, and falls back to what happened", () => {
    const named = activityRows([entry({ sourceKey: "matterNote", rowId: "note_1" })], {
      ...bare,
      detailFor: () => ({ title: "Called the client." }),
    });
    expect(named[0]?.what).toBe("Called the client.");

    const unnamed = activityRows([entry({ sourceKey: "matterNote", rowId: "note_1" })], bare);
    expect(unnamed[0]?.what).toBe("A note was written");
  });

  it("caps how wide one long row may make the column, without losing the record", () => {
    // The grid fits a column to its longest text, so one paragraph-long note would push Who and
    // Details off screen for every other row. The cell keeps the full text in its title.
    const long = "x".repeat(300);
    const [row] = activityRows([entry({ sourceKey: "matterNote", rowId: "note_1" })], {
      ...bare,
      detailFor: () => ({ title: long }),
    });
    expect(row?.what.length).toBeLessThan(100);
    expect(row?.what.endsWith("…")).toBe(true);
  });

  it("names what a declared label is, beside whatever the subsystem said", () => {
    const [row] = activityRows(
      [entry({ sourceKey: "documentFiled", rowId: "file_1", label: "Retainer Agreement" })],
      { ...bare, detailFor: () => ({ title: "Retainer.pdf", secondary: "45 KB" }) },
    );
    expect(row?.details).toBe("45 KB · Document type: Retainer Agreement");
  });

  it("keys a row by source AND row, because two subsystems can share an identifier", () => {
    const rows = activityRows(
      [
        entry({ sourceKey: "matterNote", rowId: "shared" }),
        entry({ sourceKey: "documentFiled", rowId: "shared" }),
      ],
      bare,
    );
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });

  it("keeps the order the server sent, because the cursor continues that order", () => {
    const rows = activityRows(
      [
        entry({ sourceKey: "matterNote", rowId: "a", sortKey: "2026-08-28" }),
        entry({ sourceKey: "matterNote", rowId: "b", sortKey: "2026-08-30" }),
      ],
      bare,
    );
    expect(rows.map((row) => row.day)).toEqual(["2026-08-28", "2026-08-30"]);
  });

  it("offers no link where no built section owns the record", () => {
    const [row] = activityRows([entry({ sourceKey: "conflictsCheck", rowId: "check_1" })], bare);
    expect(row?.href).toBeNull();
  });
});
