/*
 * The matters list's declarative column model — what the one table (DataTable.Grid) is told about
 * the firm's docket. Pure: it takes the rows' vocabulary lookups and returns columns. The screen
 * owns fetching and rendering; this module owns what a column IS, so the answer is unit-testable
 * and there is one place to change it.
 *
 * Two column decisions are worth stating, because both are about not inventing:
 *
 *   - The matter number ANCHORS the row. It is the identity a legal docket is read by, it always
 *     leads, and it is never hidden. A matter that has not drawn one is a consultation, and the
 *     cell says "Consultation" — the same word the matter header prints for the same fact, rather
 *     than a blank that reads as missing data.
 *   - Practice area, Location and the responsible attorney arrive as identifiers and are resolved
 *     against the firm's own vocabularies — its matter types, its offices, and its member roster.
 *     An identifier that resolves to nothing renders EMPTY, never as the handle: a matter type that
 *     was deactivated and is no longer listed is an honest gap, and printing `matterType_01J…` at a
 *     person is not an answer. The same rule carries the responsible attorney: a member the roster
 *     does not name is a blank cell, not a `user_…`.
 *
 * A THIRD DECISION, ABOUT FILTERING: A COLUMN OVER A DECLARED VOCABULARY OFFERS THE WHOLE
 * VOCABULARY. A set filter otherwise offers what the loaded rows happen to carry, so a firm with
 * nothing closed today gets no Closed choice, a practice area nobody has used yet is unfilterable,
 * and an attorney carrying no matters cannot be asked for. Each of those tells the reader the firm
 * cannot hold such a thing, which is false. So the four columns whose values come from something
 * the firm DECLARES — its lifecycle statuses, its matter types, its offices, its roster — hand the
 * grid that vocabulary, and every value in it is offered with its true count, zero included. Client
 * is the one set column with no declared vocabulary, because nothing publishes a client directory:
 * its options are honestly the clients the docket names.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { MatterSummary } from "./matters-api.ts";
import { matterStatusLabel, MATTER_STATUS_LABELS } from "./matter-status.ts";

/** What a matter's type, Location and responsible-member identifiers resolve to, by identifier. */
export interface MatterVocabulary {
  matterTypeNames: ReadonlyMap<string, string>;
  locationNames: ReadonlyMap<string, string>;
  memberNames: ReadonlyMap<string, string>;
}

/** One vocabulary's names, in reading order and each named once — what a set filter offers whole. */
export function vocabularyValues(names: ReadonlyMap<string, string>): readonly string[] {
  return [...new Set(names.values())]
    .filter((name) => name !== "")
    .toSorted((left, right) => left.localeCompare(right));
}

/** An empty vocabulary — what the screen has before the lists land. */
export const EMPTY_MATTER_VOCABULARY: MatterVocabulary = {
  matterTypeNames: new Map(),
  locationNames: new Map(),
  memberNames: new Map(),
};

/** Build the lookup a column model needs from the three list responses. */
export function matterVocabulary(
  matterTypes: readonly { id: string; name: string }[],
  locations: readonly { id: string; name: string }[],
  members: readonly { userId: string; displayName: string }[] = [],
): MatterVocabulary {
  return {
    matterTypeNames: new Map(matterTypes.map((type) => [type.id, type.name])),
    locationNames: new Map(locations.map((location) => [location.id, location.name])),
    memberNames: new Map(members.map((member) => [member.userId, member.displayName])),
  };
}

/**
 * What a PROSPECTIVE matter's number column reads when it carries no number of either kind — a
 * consultation taken before the firm's consultation sequence existed. The designation states what
 * the record is rather than leaving a gap that reads as a number the platform failed to fill.
 */
export const UNNUMBERED_DESIGNATION = "Consultation";
/** The designation for an intake, which by construction carries no number of either kind yet. */
export const INTAKE_DESIGNATION = "Intake";

/**
 * The number as it prints.
 *
 * A consultation carries its own tentative number, so that is what the column shows while the matter
 * is a consultation — the number people quote is the one on the screen. Once the matter opens it prints
 * the matter number: the permanent number is what the file is called from then on, and the tentative
 * one stays on the record (and in search) rather than in the column.
 *
 * The fallback designation is tied to the STATUS, not merely to the absence of a number. An open or
 * closed matter with no number is not a consultation: it is a numbered thing whose number is
 * missing, which happens where a row was written without drawing one. Calling that "Consultation"
 * would assert a lifecycle state the record does not hold, so it reads as an honest gap instead.
 */
export function matterNumberText(matter: MatterSummary): string {
  if (matter.matterNumber !== null) return matter.matterNumber;
  if (matter.consultationNumber !== null) return matter.consultationNumber;
  if (matter.status === "intake") return INTAKE_DESIGNATION;
  return matter.status === "consultation" ? UNNUMBERED_DESIGNATION : "";
}

/** A resolved vocabulary name, or "" where nothing answers — never the raw identifier. */
export function resolvedName(names: ReadonlyMap<string, string>, id: string | null): string {
  if (id === null) return "";
  return names.get(id) ?? "";
}

/**
 * The docket's columns. Sorting, the per-column filters, show/hide, reorder, pinning and resize are
 * the grid's; this only declares what each column is.
 *
 * Client, practice area and Location take the SET filter (a checkbox list with counts) because each
 * is a small closed vocabulary in practice — you filter a docket by picking the client you mean,
 * not by typing it. Title takes the default contains-text filter, and Created the date range.
 */
export function matterColumns(vocabulary: MatterVocabulary): GridColumn<MatterSummary>[] {
  return [
    {
      id: "matterNumber",
      label: "Matter Number",
      anchored: true,
      value: (matter) => matter.matterNumber ?? matter.consultationNumber,
      text: matterNumberText,
    },
    { id: "title", label: "Title", value: (matter) => matter.title },
    {
      id: "client",
      label: "Client",
      filter: "set",
      value: (matter) => matter.clientDisplayName,
    },
    {
      id: "status",
      label: "Status",
      filter: "set",
      // The label, not the stored code: the set filter offers what the column shows, and a person
      // filters on "Active", never on `open`.
      value: (matter) => matterStatusLabel(matter.status),
      // EVERY status the firm can hold, in lifecycle order, whether or not one is on screen. A
      // filter that drops Closed on a day nothing is closed is a filter that lies about the firm.
      filterValues: MATTER_STATUS_LABELS,
    },
    {
      id: "practiceArea",
      label: "Practice Area",
      filter: "set",
      value: (matter) => resolvedName(vocabulary.matterTypeNames, matter.matterTypeId),
      // The firm's whole matter-type vocabulary, so an area it has set up and not yet used is
      // still something a reader can ask for.
      filterValues: vocabularyValues(vocabulary.matterTypeNames),
    },
    {
      id: "responsibleAttorney",
      label: "Responsible Attorney",
      filter: "set",
      // The listing answers a member identifier, resolved here against the firm's roster — the same
      // client-side join practice area and Location already take, and for the same reason: one
      // roster read per screen, never one request per row.
      //
      // A matter whose responsible member the roster cannot name renders EMPTY. That covers two
      // real cases and treats them alike on purpose: the roster has not landed yet, and the row
      // names somebody who is not in it. Neither is a fact worth asserting in a cell, and the one
      // thing that must not happen is printing `user_01J…` at a person, or naming the signed-in
      // member on their own matters and leaving everyone else's blank — which is the state that
      // kept this column off the docket until the roster read existed.
      value: (matter) => resolvedName(vocabulary.memberNames, matter.responsibleMemberId),
      // The whole roster, including members carrying nothing right now: "who has no matters" is a
      // question a firm asks, and it cannot be asked of a control that only lists people who do.
      filterValues: vocabularyValues(vocabulary.memberNames),
    },
    {
      id: "location",
      label: "Location",
      filter: "set",
      // Hidden until asked for: most firms run one office, where the column repeats one value on
      // every row. The columns menu shows it the moment a firm has more than one.
      hidden: true,
      value: (matter) => resolvedName(vocabulary.locationNames, matter.locationId),
      filterValues: vocabularyValues(vocabulary.locationNames),
    },
    {
      id: "createdAt",
      label: "Created",
      type: "date",
      // "Created", not "Opened": the listing serves the creation instant, and a matter opened long
      // after the consultation that started it has two different dates. Only the detail read
      // carries the second, so this column names the one it actually has.
      value: (matter) => matter.createdAt,
    },
  ];
}

/** The column the docket sorts by first, newest first — the way a caseload is read. */
export const MATTER_INITIAL_SORT = { columnId: "createdAt", direction: "descending" } as const;
