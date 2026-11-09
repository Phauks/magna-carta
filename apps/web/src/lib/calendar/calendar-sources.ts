/*
 * The CATALOG of individual calendars, and the folders they are kept in.
 *
 * A firm does not have one calendar. It has a calendar per attorney, a calendar per paralegal and
 * receptionist, a calendar per conference room, and a handful of calendars that are dates rather
 * than people — custody dates, file-destruction dates. The firm grid used to paint all of it as one
 * undifferentiated month, with one dropdown offering one colleague at a time; this module is the
 * other answer, the one every calendar product settled on: every calendar is its own row, rows are
 * kept in folders, and a reader turns them on one at a time or a folder at a time.
 *
 * NOTHING HERE IS INVENTED. Every calendar in the catalog stands over a read that already exists:
 * a member calendar is the member filter the firm read already takes, a room calendar is the
 * resource availability read, and a date calendar is a timeline source the federated read is
 * widened to. A row with nothing behind it yet is still listed, marked Soon and refused, because a
 * reader deciding whether this product holds their destruction dates must be able to see the
 * answer — and must never be able to mistake the shape of it for the thing.
 *
 * THE FOLDERS ARE THE FIRM'S OWN VOCABULARY, NOT OURS. Which members are attorneys and which are
 * support staff is a question the firm already answered when it gave them roles, so a folder is a
 * role and its rows are the members holding it. A member holding several roles is listed once,
 * under the first role the roster names them with, because a calendar that appeared in two folders
 * would read as two calendars and toggle as one.
 *
 * This module is pure. What a reader has turned ON, and what colour they gave it, is
 * `calendar-preferences.svelte.ts`; what the selection makes the app READ is `calendar-reads.ts`.
 */
import {
  defaultCalendarColor,
  type CalendarGridColor,
} from "@magna-carta/design-system/calendar-grid";
import type { FirmMemberSummary } from "$lib/members/members-api.ts";
import type { FirmResource } from "./calendar-api.ts";
import { CALENDAR_LAYERS, type CalendarLayer } from "./calendar-vocabulary.ts";

/**
 * What one calendar in the catalog stands over. A closed union, so the read plan switches on it
 * once (`calendar-reads.ts`) rather than each surface guessing from a key's shape.
 */
export type CalendarSourceKind =
  /** The firm's case settings: every matter's hearings, depositions and conferences. */
  | { readonly kind: "caseSettings" }
  /** The firm's deadlines, across every matter. */
  | { readonly kind: "deadlines" }
  /** The firm's own events — meetings, closures, training, holidays. */
  | { readonly kind: "firmEvents" }
  /** One member's calendar: what they are a participant in, responsible for, or invited to. */
  | { readonly kind: "member"; readonly memberId: string }
  /** One bookable resource's schedule: a room, a vehicle, a piece of equipment. */
  | { readonly kind: "resource"; readonly resourceId: string }
  /** A date-bearing timeline source the federated read is widened to. */
  | { readonly kind: "layer"; readonly layerKey: string };

/** One individual calendar a reader can turn on. */
export interface CalendarSource {
  /** Stable across reads and across sessions: what a preference and an address remember. */
  readonly key: string;
  /** What the row says: a person's name, a room's name, "Case Settings". */
  readonly name: string;
  readonly kind: CalendarSourceKind;
  /**
   * What this calendar waits on, where nothing serves it yet. A row with one is listed, marked
   * Soon and refused rather than left out — the standing rule for a designed-but-unwired
   * capability — so it can never be turned on and quietly paint nothing.
   */
  readonly soonReason?: string;
}

/** A folder of calendars: the firm's records, a role's members, the rooms, the date calendars. */
export interface CalendarFolder {
  readonly key: string;
  readonly name: string;
  readonly sources: readonly CalendarSource[];
}

/** The key a member's calendar is remembered by. */
export function memberSourceKey(memberId: string): string {
  return `member:${memberId}`;
}

/** The key a resource's calendar is remembered by. */
export function resourceSourceKey(resourceId: string): string {
  return `resource:${resourceId}`;
}

/** The key a date calendar is remembered by. */
export function layerSourceKey(layerKey: string): string {
  return `layer:${layerKey}`;
}

/**
 * The firm's case settings and the firm's deadlines: two calendars, each with its own row and its
 * own colour. They were one row ("Matters and deadlines") until 2026-11-09, when the owner split
 * them so a hearing and a filing deadline read differently at a glance and each can be turned off
 * alone — which is also what let the toolbar's separate Kinds filter go.
 */
export const CASE_SETTINGS_SOURCE_KEY = "caseSettings";
export const DEADLINES_SOURCE_KEY = "deadlines";
/** The firm's own events. */
export const FIRM_EVENTS_SOURCE_KEY = "firmEvents";

/**
 * The calendars that are on when nobody has said otherwise: the firm's case settings, its deadlines
 * and its own events, and nothing else.
 *
 * Deliberately not "everything". Turning on eleven attorneys and nine rooms is twenty reads a
 * reader never asked for, and a grid painted from twenty calendars at once is the undifferentiated
 * month this whole catalog exists to replace. The firm opens on its own record and adds people.
 */
export const DEFAULT_ON_SOURCE_KEYS: readonly string[] = [
  CASE_SETTINGS_SOURCE_KEY,
  DEADLINES_SOURCE_KEY,
  FIRM_EVENTS_SOURCE_KEY,
];

/** The folder the firm's own three calendars sit in. */
const FIRM_FOLDER_KEY = "firm";
/** The folder a member with no role at all falls into. */
const OTHER_MEMBERS_FOLDER_KEY = "role:";
/** The folder the rooms sit in, and the one every other bookable thing sits in. */
const ROOMS_FOLDER_KEY = "rooms";
const EQUIPMENT_FOLDER_KEY = "equipment";
/** The folder the calendars that are dates rather than people sit in. */
const DATES_FOLDER_KEY = "dates";

/**
 * The date calendars that have no source behind them yet, listed so the shape of the calendar is
 * honest about what it will hold, and refused so it cannot be mistaken for what it holds today.
 *
 * File destruction is the one the owner asked for by name. A retention schedule reaching a date is
 * a date that falls due exactly as a custody due-back is, so it belongs in this folder and nowhere
 * else — there is simply no retention model to read from yet.
 */
interface UnservedDateCalendar {
  readonly key: string;
  readonly name: string;
  readonly soonReason: string;
}

const UNSERVED_DATE_CALENDARS: readonly UnservedDateCalendar[] = [
  {
    key: "fileDestruction",
    name: "File Destruction Dates",
    soonReason: "a retention schedule on a matter's files",
  },
];

/** What the catalog is built from: everything the calendar's context already read. */
export interface CalendarCatalogInput {
  /** The firm's roster. A deactivated member's calendar is not offered. */
  readonly members: readonly FirmMemberSummary[];
  /** The firm's bookable resources. An inactive one is not offered. */
  readonly resources: readonly FirmResource[];
  /** The date-bearing sources the read can be widened to. The vocabulary's own list by default. */
  readonly layers?: readonly CalendarLayer[];
}

/**
 * The firm's own calendars, in the order the rail lists them. Every rail name is Title Case (owner,
 * 2026-11-09): a row names a calendar, and a calendar's name is a proper name.
 *
 * Also the plan an embedded host that drew no rail reads (calendar-reads.ts), so Home's Today card
 * and the rail's defaults are one list rather than two that could drift.
 */
export const FIRM_OWN_CALENDARS: readonly CalendarSource[] = [
  { key: CASE_SETTINGS_SOURCE_KEY, name: "Case Settings", kind: { kind: "caseSettings" } },
  { key: DEADLINES_SOURCE_KEY, name: "Deadlines", kind: { kind: "deadlines" } },
  { key: FIRM_EVENTS_SOURCE_KEY, name: "Firm Events", kind: { kind: "firmEvents" } },
];

/**
 * The whole catalog, in the order the rail draws it: the firm's own calendars, then the members
 * folder by folder in the firm's own role names, then the rooms, then the other bookable things,
 * then the dates. An empty folder is not drawn at all — a firm with no vehicles meets no
 * "Vehicles" heading — which is the standing rule about a block announcing its own emptiness.
 */
export function calendarFolders(input: CalendarCatalogInput): readonly CalendarFolder[] {
  const folders: CalendarFolder[] = [
    {
      key: FIRM_FOLDER_KEY,
      name: "The Firm",
      sources: FIRM_OWN_CALENDARS,
    },
    ...memberFolders(input.members),
    ...resourceFolders(input.resources),
    dateFolder(input.layers ?? CALENDAR_LAYERS),
  ];
  return folders.filter((folder) => folder.sources.length > 0);
}

/**
 * The members, one folder per role the firm gave them, in the roster's own words.
 *
 * A member is filed under the FIRST role they hold, so nobody's calendar is listed twice; the
 * folders themselves are ordered by name, and the members inside each by theirs, so a rail that
 * grew by one hire does not re-order itself around the new arrival. A member holding no role at all
 * lands in a folder of their own rather than being dropped — a firm that has not finished giving
 * out roles still needs its people's calendars.
 */
function memberFolders(members: readonly FirmMemberSummary[]): readonly CalendarFolder[] {
  const byRole = new Map<string, CalendarSource[]>();
  const sorted = [...members]
    .filter((member) => member.status === "active")
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName));
  for (const member of sorted) {
    const role = member.roleNames[0] ?? "";
    const sources = byRole.get(role) ?? [];
    sources.push({
      key: memberSourceKey(member.userId),
      name: member.displayName,
      kind: { kind: "member", memberId: member.userId },
    });
    byRole.set(role, sources);
  }
  return [...byRole.entries()]
    .toSorted(([left], [right]) => {
      // The unroled folder goes last whatever it is called: it is the remainder, not a role.
      if (left === "") return 1;
      if (right === "") return -1;
      return left.localeCompare(right);
    })
    .map(([role, sources]) => ({
      key: role === "" ? OTHER_MEMBERS_FOLDER_KEY : `role:${role}`,
      name: role === "" ? "Other Members" : pluralRole(role),
      sources,
    }));
}

/**
 * A role's name as a folder of people reads: "Attorney" names one person, "Attorneys" names the
 * folder they are in. Only the regular plural is formed — a firm that named a role "Of counsel"
 * keeps its own words rather than being handed "Of counsels".
 */
function pluralRole(role: string): string {
  if (/(s|x|z|ch|sh)$/i.test(role)) return `${role}es`;
  if (/[^aeiou]y$/i.test(role)) return `${role.slice(0, -1)}ies`;
  if (/\s/.test(role)) return role;
  return `${role}s`;
}

/** The rooms, and everything else that is booked, as two folders. */
function resourceFolders(resources: readonly FirmResource[]): readonly CalendarFolder[] {
  const active = [...resources]
    .filter((resource) => resource.active)
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const toSource = (resource: FirmResource): CalendarSource => ({
    key: resourceSourceKey(resource.id),
    name: resource.name,
    kind: { kind: "resource", resourceId: resource.id },
  });
  return [
    {
      key: ROOMS_FOLDER_KEY,
      name: "Rooms",
      sources: active.filter((resource) => resource.kind === "room").map(toSource),
    },
    {
      key: EQUIPMENT_FOLDER_KEY,
      name: "Vehicles and Equipment",
      sources: active.filter((resource) => resource.kind !== "room").map(toSource),
    },
  ];
}

/** The calendars that are dates rather than people: the served layers, then the ones still coming. */
function dateFolder(layers: readonly CalendarLayer[]): CalendarFolder {
  return {
    key: DATES_FOLDER_KEY,
    name: "Dates",
    sources: [
      ...layers.map(
        (layer): CalendarSource => ({
          key: layerSourceKey(layer.key),
          name: layer.label,
          kind: { kind: "layer", layerKey: layer.key },
        }),
      ),
      ...UNSERVED_DATE_CALENDARS.map(
        (unserved): CalendarSource => ({
          key: layerSourceKey(unserved.key),
          name: unserved.name,
          kind: { kind: "layer", layerKey: unserved.key },
          soonReason: unserved.soonReason,
        }),
      ),
    ],
  };
}

/** Every calendar in the catalog, folders flattened, in the order the rail draws them. */
export function flattenSources(folders: readonly CalendarFolder[]): readonly CalendarSource[] {
  return folders.flatMap((folder) => folder.sources);
}

/** The calendar a key names, where the catalog holds one. */
export function sourceByKey(
  folders: readonly CalendarFolder[],
  key: string,
): CalendarSource | undefined {
  return flattenSources(folders).find((source) => source.key === key);
}

/** Whether a key names a calendar this catalog actually holds, for reading a preference back. */
export function isKnownSourceKey(folders: readonly CalendarFolder[], key: string): boolean {
  return sourceByKey(folders, key) !== undefined;
}

/** The calendars a reader may turn on: everything the catalog holds that something serves. */
export function selectableSources(folders: readonly CalendarFolder[]): readonly CalendarSource[] {
  return flattenSources(folders).filter((source) => source.soonReason === undefined);
}

/** How a folder's own control reads, which is the three states a set of checkboxes can be in. */
export type FolderSelection = "none" | "some" | "all";

/**
 * How much of a folder is turned on. A folder whose every selectable row is on reads all; one with
 * nothing on reads none; anything else is the indeterminate middle. Rows that cannot be turned on
 * are not counted, so a folder holding one served calendar and one marked Soon still reads "all"
 * when that one is on — a control that could never reach "all" would be a control that never
 * finished.
 */
export function folderSelection(folder: CalendarFolder, on: ReadonlySet<string>): FolderSelection {
  const selectable = folder.sources.filter((source) => source.soonReason === undefined);
  if (selectable.length === 0) return "none";
  const count = selectable.filter((source) => on.has(source.key)).length;
  if (count === 0) return "none";
  return count === selectable.length ? "all" : "some";
}

/**
 * The selection after a folder's own control is pressed: a folder that is not wholly on turns
 * wholly on, and one that is turns off. Pressing the middle state therefore completes it, which is
 * what a reader who has turned two of six attorneys on and pressed the folder meant.
 */
export function toggleFolder(folder: CalendarFolder, on: ReadonlySet<string>): ReadonlySet<string> {
  const next = new Set(on);
  const selectable = folder.sources.filter((source) => source.soonReason === undefined);
  const turningOn = folderSelection(folder, on) !== "all";
  for (const source of selectable) {
    if (turningOn) {
      next.add(source.key);
    } else {
      next.delete(source.key);
    }
  }
  return next;
}

/** The selection after one calendar's own control is pressed. A Soon row never moves. */
export function toggleSource(source: CalendarSource, on: ReadonlySet<string>): ReadonlySet<string> {
  if (source.soonReason !== undefined) return on;
  const next = new Set(on);
  if (next.has(source.key)) {
    next.delete(source.key);
  } else {
    next.add(source.key);
  }
  return next;
}

/**
 * The colour a calendar wears where the reader has not chosen one: the palette dealt round the
 * catalog by position, so a firm that turns eight calendars on without colouring any of them still
 * gets eight columns it can tell apart.
 *
 * Dealt by POSITION rather than by a hash of the key, because position spreads the nine colours
 * evenly and a hash does not — two of the first four calendars coming out the same colour is
 * exactly the failure the colours exist to prevent. The cost is that a calendar's unchosen colour
 * can move when the roster changes; a colour that matters is one the reader chose, and a chosen
 * colour never moves.
 */
export function assignedColors(
  folders: readonly CalendarFolder[],
  chosen: Readonly<Record<string, CalendarGridColor>>,
): ReadonlyMap<string, CalendarGridColor> {
  const colors = new Map<string, CalendarGridColor>();
  flattenSources(folders).forEach((source, index) => {
    colors.set(source.key, chosen[source.key] ?? defaultCalendarColor(index));
  });
  return colors;
}
