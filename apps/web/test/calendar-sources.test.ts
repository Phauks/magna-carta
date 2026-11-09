/*
 * The catalog of individual calendars, and what a reader has turned on.
 *
 * Every question the rail asks is answered here and rendered there, so the folders a firm sees, the
 * three states a folder's control can be in, and what a stored preference survives are all asserted
 * without a browser.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONCURRENCY } from "@magna-carta/design-system/calendar-grid";
import type { FirmMemberSummary } from "$lib/members/members-api.ts";
import type { FirmResource } from "$lib/calendar/calendar-api.ts";
import {
  assignedColors,
  calendarFolders,
  flattenSources,
  folderSelection,
  layerSourceKey,
  memberSourceKey,
  resourceSourceKey,
  selectableSources,
  sourceByKey,
  toggleFolder,
  toggleSource,
  DEFAULT_ON_SOURCE_KEYS,
  FIRM_EVENTS_SOURCE_KEY,
  RECORDS_SOURCE_KEY,
  type UnservedDateCalendar,
} from "$lib/calendar/calendar-sources.ts";
import {
  isSourceOn,
  normalizeCalendarPreferences,
  overridesFor,
} from "$lib/calendar/calendar-preferences.svelte.ts";

function member(
  userId: string,
  displayName: string,
  roleNames: string[],
  status: FirmMemberSummary["status"] = "active",
): FirmMemberSummary {
  return { userId, displayName, status, roleNames, hasProfessionalProfile: false };
}

function resource(
  id: string,
  name: string,
  kind: FirmResource["kind"],
  active = true,
): FirmResource {
  return { id, name, kind, locationId: null, capacity: null, notes: null, active };
}

const ROSTER: readonly FirmMemberSummary[] = [
  member("user_ada", "Ada Lovelace", ["Attorney"]),
  member("user_grace", "Grace Hopper", ["Attorney"]),
  member("user_kay", "Kay Antonelli", ["Paralegal"]),
  member("user_jean", "Jean Bartik", ["Receptionist"]),
  member("user_new", "Newly Hired", []),
  member("user_gone", "Departed Colleague", ["Attorney"], "deactivated"),
];

const RESOURCES: readonly FirmResource[] = [
  resource("resource_board", "Boardroom", "room"),
  resource("resource_small", "Small conference room", "room"),
  resource("resource_car", "Pool car", "vehicle"),
  resource("resource_old", "Retired room", "room", false),
];

// One date calendar that nothing serves, injected so the Soon row's handling stays proven whether or
// not the shipped catalog happens to be holding one today.
const COMING: UnservedDateCalendar = {
  key: "limitation",
  name: "Limitation dates",
  soonReason: "a limitation period on a matter's claims",
};

const folders = calendarFolders({
  members: ROSTER,
  resources: RESOURCES,
  unservedDates: [COMING],
});

function folderNamed(name: string) {
  const found = folders.find((folder) => folder.name === name);
  if (found === undefined) throw new Error(`no folder called ${name}`);
  return found;
}

describe("the catalog's folders", () => {
  it("leads with the firm's own two calendars", () => {
    expect(folders[0]?.name).toBe("The firm");
    expect(folders[0]?.sources.map((source) => source.key)).toEqual([
      RECORDS_SOURCE_KEY,
      FIRM_EVENTS_SOURCE_KEY,
    ]);
  });

  it("makes a folder of each role the firm gave out, in the firm's own words", () => {
    // The folders are the firm's vocabulary, not ours: whoever the firm calls a Paralegal is in
    // the Paralegals folder, and nothing here classifies anybody.
    const names = folders.map((folder) => folder.name);
    expect(names).toContain("Attorneys");
    expect(names).toContain("Paralegals");
    expect(names).toContain("Receptionists");
  });

  it("files a member under one folder only, and puts the unroled last", () => {
    const everyMemberRow = folders
      .flatMap((folder) => folder.sources)
      .filter((source) => source.kind.kind === "member");
    const keys = everyMemberRow.map((source) => source.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(folderNamed("Other members").sources.map((source) => source.name)).toEqual([
      "Newly Hired",
    ]);
    const roleFolders = folders.filter((folder) =>
      folder.sources.some((source) => source.kind.kind === "member"),
    );
    expect(roleFolders[roleFolders.length - 1]?.name).toBe("Other members");
  });

  it("leaves a departed colleague's calendar out", () => {
    expect(sourceByKey(folders, memberSourceKey("user_gone"))).toBeUndefined();
    expect(sourceByKey(folders, memberSourceKey("user_ada"))?.name).toBe("Ada Lovelace");
  });

  it("splits the rooms from everything else that is booked, and drops what is inactive", () => {
    expect(folderNamed("Rooms").sources.map((source) => source.name)).toEqual([
      "Boardroom",
      "Small conference room",
    ]);
    expect(folderNamed("Vehicles and equipment").sources.map((source) => source.name)).toEqual([
      "Pool car",
    ]);
    expect(sourceByKey(folders, resourceSourceKey("resource_old"))).toBeUndefined();
  });

  it("draws no folder for something the firm has none of", () => {
    const withoutResources = calendarFolders({ members: ROSTER, resources: [] });
    expect(withoutResources.map((folder) => folder.name)).not.toContain("Rooms");
    expect(withoutResources.map((folder) => folder.name)).not.toContain("Vehicles and equipment");
  });

  it("lists the dates, including one nothing serves yet, marked and refused", () => {
    const dates = folderNamed("Dates");
    expect(dates.sources.map((source) => source.name)).toEqual([
      "Custody dates",
      "File destruction dates",
      "Limitation dates",
    ]);
    const coming = dates.sources[2]!;
    // Listed so a firm can see the shape of what is coming; refused so it can never be mistaken
    // for what is here.
    expect(coming.soonReason).toBe("a limitation period on a matter's claims");
    expect(selectableSources(folders)).not.toContain(coming);
  });

  it("serves file destruction dates, under the key the Soon row was remembered by", () => {
    // The shipped catalog, with nothing injected: the paper file's destruction date is a served
    // layer now, and a reader who had the row in view keeps it because the key did not move.
    const shipped = calendarFolders({ members: ROSTER, resources: RESOURCES });
    const destruction = sourceByKey(shipped, layerSourceKey("fileDestruction"))!;
    expect(destruction.name).toBe("File destruction dates");
    expect(destruction.soonReason).toBeUndefined();
    expect(selectableSources(shipped)).toContain(destruction);
  });
});

describe("what a folder's own control does", () => {
  const attorneys = folderNamed("Attorneys");
  const dates = folderNamed("Dates");

  it("reads none, some or all", () => {
    expect(folderSelection(attorneys, new Set())).toBe("none");
    expect(folderSelection(attorneys, new Set([memberSourceKey("user_ada")]))).toBe("some");
    expect(
      folderSelection(
        attorneys,
        new Set([memberSourceKey("user_ada"), memberSourceKey("user_grace")]),
      ),
    ).toBe("all");
  });

  it("counts only the rows that can be turned on, so a Soon row never holds a folder open", () => {
    // Two served date calendars, one still coming: turning the served ones on IS the whole folder.
    expect(
      folderSelection(
        dates,
        new Set([layerSourceKey("custody"), layerSourceKey("fileDestruction")]),
      ),
    ).toBe("all");
  });

  it("completes a part-filled folder, and empties a full one", () => {
    const partly = new Set([memberSourceKey("user_ada")]);
    const completed = toggleFolder(attorneys, partly);
    expect(completed.has(memberSourceKey("user_grace"))).toBe(true);
    expect(toggleFolder(attorneys, completed).size).toBe(0);
  });

  it("never turns on a calendar nothing serves", () => {
    const turnedOn = toggleFolder(dates, new Set());
    expect(turnedOn.has(layerSourceKey("custody"))).toBe(true);
    expect(turnedOn.has(layerSourceKey("fileDestruction"))).toBe(true);
    expect(turnedOn.has(layerSourceKey("limitation"))).toBe(false);
  });
});

describe("one calendar's own control", () => {
  it("turns on and off", () => {
    const ada = sourceByKey(folders, memberSourceKey("user_ada"))!;
    const on = toggleSource(ada, new Set());
    expect([...on]).toEqual([ada.key]);
    expect(toggleSource(ada, on).size).toBe(0);
  });

  it("does not move a row that is waiting on a source", () => {
    const coming = sourceByKey(folders, layerSourceKey("limitation"))!;
    expect(toggleSource(coming, new Set()).size).toBe(0);
  });
});

describe("the colours a calendar wears", () => {
  it("gives every calendar one, and spreads them", () => {
    const colors = assignedColors(folders, {});
    const keys = flattenSources(folders).map((source) => source.key);
    expect(colors.size).toBe(keys.length);
    // Dealt by position, so the first several calendars a firm turns on are told apart at a glance
    // rather than colliding the way a hash of the key would.
    const firstFour = keys.slice(0, 4).map((key) => colors.get(key));
    expect(new Set(firstFour).size).toBe(4);
  });

  it("lets a chosen colour win over the dealt one", () => {
    const colors = assignedColors(folders, { [RECORDS_SOURCE_KEY]: "purple" });
    expect(colors.get(RECORDS_SOURCE_KEY)).toBe("purple");
  });
});

describe("what a browser remembers", () => {
  const known = flattenSources(folders).map((source) => source.key);

  it("opens on the firm's own two calendars and nothing else", () => {
    const fresh = normalizeCalendarPreferences(undefined);
    for (const key of known) {
      expect(isSourceOn(fresh, key)).toBe(DEFAULT_ON_SOURCE_KEYS.includes(key));
    }
  });

  it("stores only what DEPARTS from the default, so a new calendar arrives at its own", () => {
    const on = new Set([RECORDS_SOURCE_KEY, memberSourceKey("user_ada")]);
    const overrides = overridesFor(on, known);
    // Records agrees with the default and is not stored; the firm's events were turned off and the
    // attorney was turned on, and both of those are departures.
    expect(overrides).toEqual({
      [FIRM_EVENTS_SOURCE_KEY]: false,
      [memberSourceKey("user_ada")]: true,
    });
  });

  it("forgets a calendar the catalog no longer holds", () => {
    const on = new Set([memberSourceKey("user_gone")]);
    expect(overridesFor(on, known)).not.toHaveProperty(memberSourceKey("user_gone"));
  });

  it("drops a payload that is not one, an override that is not a boolean, and a colour that is not offered", () => {
    expect(normalizeCalendarPreferences("nonsense")).toEqual({
      onOverrides: {},
      colors: {},
      concurrency: DEFAULT_CONCURRENCY,
      foldedFolders: {},
    });
    const salvaged = normalizeCalendarPreferences({
      onOverrides: { records: true, firmEvents: "yes" },
      colors: { records: "blue", firmEvents: "chartreuse" },
      foldedFolders: { rooms: true, dates: "shut" },
    });
    expect(salvaged.onOverrides).toEqual({ records: true });
    expect(salvaged.colors).toEqual({ records: "blue" });
    expect(salvaged.foldedFolders).toEqual({ rooms: true });
  });

  it("keeps a stored presentation of concurrent entries, and drops one it does not offer", () => {
    expect(normalizeCalendarPreferences({ concurrency: "overlap" }).concurrency).toBe("overlap");
    expect(normalizeCalendarPreferences({ concurrency: "cascade" }).concurrency).toBe(
      DEFAULT_CONCURRENCY,
    );
  });
});
