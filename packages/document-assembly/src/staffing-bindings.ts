import { facetsForKind } from "./catalog/facets.ts";
import { MERGE_SUBJECTS, normalizedRoleToken, type MergeSubject } from "./catalog/subjects.ts";
import type { MatterStaffingMergeRow } from "./merge-statements.ts";
import type { MergeListItem, MergeValue } from "./types.ts";

// The matter's staffing, as merge fields — our side of "attorneys and types of attorneys".
//
// A member subject and a party subject share one facet vocabulary and one resolution shape, and
// differ in which batched read fills them: every member subject is a pass over the rows the ONE
// staffing read returns, exactly as every party subject is a pass over the one party read. The
// responsible attorney resolves from the matter row's own responsible_member_id — that column stays
// its one home — and the staffing statement labels that row with the subject's own token, so the
// resolution below treats all five subjects identically.
//
// THE ROLE IS THE KEY, WITH THE PUNCTUATION TAKEN OUT — the same rule matter_party.role follows.
// `matter_assignment.assignment_role` is free text, and a row fills a subject's slot when its
// stored role, lowercased with every non-alphanumeric character removed, equals the subject's
// token: `supervising_attorney`, `Supervising Attorney`, and `supervising-attorney` all match
// `supervisingAttorney`, and match nothing else.
//
// AMBIGUITY IS AN ANSWER, NOT A COIN TOSS. Two supervising attorneys means there is no single one
// to name, so the singular keys resolve to NOTHING with a reason naming the count, and
// `supervisingAttorney.all` is the way out — the level-1 rule, unchanged from the party axis.

// One member subject the platform ships a staffing source for. Derived from the subject registry
// rather than listed beside it, so a member subject added there gains its resolution here with no
// second row to keep in step.
export interface StaffingSource {
  readonly key: string;
  // What a person calls the role, in running prose. Used in the absence reasons.
  readonly label: string;
  // The scalar facets the staffing read answers for this subject.
  readonly scalarFacets: readonly string[];
  readonly tokens: readonly string[];
}

// The field a member subject's collection is named by — the same one-segment convention every party
// subject uses, so `supervisingAttorney.all.displayName` is the binding the repeat machinery
// already produces.
export const STAFFING_LIST_FIELD = "all";

// The subject whose slot the matter row itself fills. The staffing statement labels the
// responsible-member row with this token, and the write path refuses an assignment role that
// normalizes to it — one home per fact, enforced at both doors.
export const RESPONSIBLE_ATTORNEY_SUBJECT_KEY = "responsibleAttorney";

function staffingSourceOf(subject: MergeSubject): StaffingSource {
  return {
    key: subject.key,
    label: subject.proseLabel,
    scalarFacets: facetsForKind("member")
      .filter((facet) => facet.name !== STAFFING_LIST_FIELD)
      .map((facet) => facet.name),
    tokens: [normalizedRoleToken(subject.key)],
  };
}

export const STAFFING_SOURCES: readonly StaffingSource[] = MERGE_SUBJECTS.filter(
  (subject) => subject.kind === "member",
).map(staffingSourceOf);

const SOURCE_BY_TOKEN: ReadonlyMap<string, StaffingSource> = new Map(
  STAFFING_SOURCES.flatMap((source) => source.tokens.map((token) => [token, source] as const)),
);

// The dictionary keys one member subject's staffing resolution answers. The protected bar-number
// key is deliberately NOT here: it rides the protected read path (protected-bindings.ts), and this
// list is what the batching plan uses to decide whether the staffing statement runs at all.
export function staffingKeysFor(source: StaffingSource): readonly string[] {
  return [
    ...source.scalarFacets.map((facet) => `${source.key}.${facet}`),
    `${source.key}.${STAFFING_LIST_FIELD}`,
  ];
}

const STAFFING_KEYS: ReadonlySet<string> = new Set(
  STAFFING_SOURCES.flatMap((source) => staffingKeysFor(source)),
);

export function isStaffingKey(key: string): boolean {
  return STAFFING_KEYS.has(key);
}

// The member subjects a set of manifest keys actually reaches.
export function staffingSourcesIn(keys: Iterable<string>): readonly StaffingSource[] {
  const wanted = new Set<StaffingSource>();
  for (const key of keys) {
    if (!STAFFING_KEYS.has(key)) continue;
    const source = SOURCE_BY_TOKEN.get(normalizedRoleToken(key.slice(0, key.indexOf("."))));
    if (source !== undefined) wanted.add(source);
  }
  return [...wanted];
}

// How one member subject's slot resolved: the single staffed member, or the reason there is no
// single one. The protected read path consumes this so a bar number is only ever decrypted for a
// subject that RESOLVED — an ambiguous slot is an absence before any decrypt is attempted, and
// leaves no decrypt audit row.
export interface StaffingSlot {
  readonly row?: MatterStaffingMergeRow;
  readonly reason?: string;
}

export interface StaffingResolution {
  readonly values: ReadonlyMap<string, MergeValue>;
  // Keyed by the merge key that could not be resolved. A reason names COUNTS and ROLES only —
  // never a candidate's name.
  readonly reasons: ReadonlyMap<string, string>;
  readonly slots: ReadonlyMap<string, StaffingSlot>;
}

// A member's name, as parts. The display half is the member row's own display name — always
// recorded — and the separated parts arrive from the member's mapped Directory person where the
// firm keeps one, riding the staffing read. A member is a person, so the organisation refusals
// never apply; a rendering that needs an unrecorded part is the ordinary declared absence.
export function memberNameValue(row: MatterStaffingMergeRow): MergeValue | undefined {
  if (row.displayName === null || row.displayName === "") return undefined;
  const part = (value: string | null): string | undefined =>
    value === null || value === "" ? undefined : value;
  return {
    kind: "name",
    display: row.displayName,
    isOrganisation: false,
    ...(part(row.namePrefix) === undefined ? {} : { prefix: row.namePrefix as string }),
    ...(part(row.nameGiven) === undefined ? {} : { given: row.nameGiven as string }),
    ...(part(row.nameMiddle) === undefined ? {} : { middle: row.nameMiddle as string }),
    ...(part(row.nameFamily) === undefined ? {} : { family: row.nameFamily as string }),
    ...(part(row.nameSuffix) === undefined ? {} : { suffix: row.nameSuffix as string }),
  };
}

function textValue(text: string | null): MergeValue | undefined {
  return text === null || text === "" ? undefined : { kind: "text", text };
}

// One scalar facet's value for one resolved member. A facet added to the member kind lands here and
// nowhere else.
function facetValue(facet: string, row: MatterStaffingMergeRow): MergeValue | undefined {
  switch (facet) {
    case "displayName":
      return memberNameValue(row);
    case "title":
      return textValue(row.title);
    case "emailAddress":
      return textValue(row.professionalEmail);
    case "directDial":
      return textValue(row.directDial);
    default:
      return undefined;
  }
}

function staffingItem(row: MatterStaffingMergeRow): MergeListItem {
  const fields = new Map<string, MergeValue>();
  const displayName = textValue(row.displayName);
  if (displayName !== undefined) fields.set("displayName", displayName);
  const title = textValue(row.title);
  if (title !== undefined) fields.set("title", title);
  return { fields };
}

// Every member subject's values, derived from the staffing rows ALREADY READ — a pass over an array
// in memory, not a read. A template naming five member subjects costs exactly what a template
// naming one does.
export function staffingValues(
  rows: readonly MatterStaffingMergeRow[],
  sources: readonly StaffingSource[],
  // The keys the manifest actually names, so a collection is materialized only when something walks it.
  wantedKeys: ReadonlySet<string>,
): StaffingResolution {
  const values = new Map<string, MergeValue>();
  const reasons = new Map<string, string>();
  const slots = new Map<string, StaffingSlot>();

  const byToken = new Map<string, MatterStaffingMergeRow[]>();
  for (const row of rows) {
    const token = normalizedRoleToken(row.role);
    const bucket = byToken.get(token);
    if (bucket === undefined) byToken.set(token, [row]);
    else bucket.push(row);
  }

  for (const source of sources) {
    const matched = source.tokens.flatMap((token) => byToken.get(token) ?? []);
    const listKey = `${source.key}.${STAFFING_LIST_FIELD}`;
    if (wantedKeys.has(listKey)) {
      values.set(listKey, { kind: "list", items: matched.map(staffingItem) });
    }

    const only = matched.length === 1 ? matched[0] : undefined;
    if (only !== undefined) {
      slots.set(source.key, { row: only });
      for (const facet of source.scalarFacets) {
        const key = `${source.key}.${facet}`;
        const value = facetValue(facet, only);
        if (value !== undefined) {
          values.set(key, value);
          continue;
        }
        // The member is staffed but this fact about them is unrecorded. The name has its own
        // sentence because a nameless member row is a data defect worth naming; a missing title or
        // direct dial is an ordinary absence the marker already states — a profile the member has
        // not filled in yet — and a reason on every one would bury the ones that need reading.
        if (facet === "displayName") {
          reasons.set(
            key,
            `This matter staffs one member as ${source.label}, but that member record supplies no name.`,
          );
        }
      }
      continue;
    }

    // Two ambiguities that want different repairs, so they are different sentences: several
    // DIFFERENT members in the role (counted as members, not rows — walk them all, or end the
    // stale ones), and ONE member assigned to the role more than once (a duplicate staffing
    // record — end the duplicates). Saying "2 members" about one member twice would send the
    // reader hunting for a second person who does not exist.
    const distinctMembers = new Set(matched.map((row) => row.memberUserId)).size;
    const reason =
      matched.length === 0
        ? `This matter staffs no member in the ${source.label} role.`
        : distinctMembers === 1
          ? `This matter records ${matched.length} assignments of the same member in the ${source.label} role, so there is no single assignment to read. End the duplicate assignments, or walk them with a repeating block over ${listKey}.`
          : `This matter staffs ${distinctMembers} members in the ${source.label} role, so there is no single ${source.label} to name. Walk them all with a repeating block over ${listKey}.`;
    slots.set(source.key, { reason });
    for (const facet of source.scalarFacets) reasons.set(`${source.key}.${facet}`, reason);
  }

  return { values, reasons, slots };
}
