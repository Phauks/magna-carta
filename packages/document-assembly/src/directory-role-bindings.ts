import {
  MERGE_SUBJECTS,
  normalizedRoleToken,
  partySubjectRoleTokens,
  type MergeSubject,
} from "./catalog/subjects.ts";
import { facetsForKind } from "./catalog/facets.ts";
import type { MatterPartyMergeRow } from "./merge-statements.ts";
import type { MergeListItem, MergeValue } from "./types.ts";

// The matter's party links, as merge fields.
//
// A matter records who it is about through `matter_party` rows — a Directory entity plus the role it
// plays — and a party subject in the catalogue is one of those roles, named. A template names the
// opposing party the way it names the client.
//
// THE ROLE IS THE KEY, WITH THE PUNCTUATION TAKEN OUT. `matter_party.role` is free text — the firm's
// own role catalogue is what a screen lists from, not a constraint on the column — so one firm writes
// `opposing_party`, the next `Opposing Party`, and a third `opposing-party`. A platform merge key
// cannot be firm text (it has to lex as one atom and be typeable from memory), so the platform declares
// its party subjects and a party matches one when its stored role, lowercased with every non-alphanumeric
// character removed, equals a token that subject matches on. That makes the mapping derivable rather
// than a second table to keep in step: `opposingParty` matches `opposing_party`, `Opposing Party`, and
// `OPPOSING-PARTY`, and matches nothing else.
//
// AMBIGUITY IS AN ANSWER, NOT A COIN TOSS. A matter with two parties in one role has no single one to
// name, so the singular keys resolve to NOTHING and the reason travels with the absence — including how
// many candidates there were, because "there are three opposing parties on this matter" is the fact
// that tells a person what to do next, and a bare marker does not. Picking the first by created-at would
// produce a document that is wrong in a way nobody can see. The many case has its own answer:
// `<subject>.all` is a collection a repeating block walks, bounded by exactly what every other repeat is
// bounded by.

export { normalizedRoleToken };

// One party subject the platform ships a merge source for, in the shape this module's resolution needs.
// Derived from the subject registry rather than listed beside it: a party subject added there gains its
// resolution here with no second row to keep in step.
export interface DirectoryRoleSource {
  // The key's first segment, and (normalized) the stored role it matches.
  readonly key: string;
  // What a person calls the role, in running prose. Used in the absence reasons and the descriptions.
  readonly label: string;
  // The scalar facets THIS read answers. A facet the subject declares but another read already supplies
  // is excluded, so the party read never claims a key it does not source — and a template naming only
  // such a key never pays for a party read it does not need.
  readonly scalarFacets: readonly string[];
  readonly tokens: readonly string[];
}

// The field a party subject's collection is named by. One segment, so `opposingParty.all` is a dictionary
// key of the same dotted shape every other key has, and an item's field inside a repeating block reads
// `opposingParty.all.displayName` — the collection key plus the field, which is the binding the repeat
// machinery already produces for `matter.parties`.
export const DIRECTORY_ROLE_LIST_FIELD = "all";

function roleSourceOf(subject: MergeSubject): DirectoryRoleSource {
  const answeredElsewhere = new Set(subject.facetsAnsweredElsewhere ?? []);
  return {
    key: subject.key,
    label: subject.proseLabel,
    scalarFacets: facetsForKind("party")
      .filter((facet) => facet.name !== DIRECTORY_ROLE_LIST_FIELD)
      .filter((facet) => !answeredElsewhere.has(facet.name))
      .map((facet) => facet.name),
    tokens: partySubjectRoleTokens(subject),
  };
}

export const DIRECTORY_ROLE_SOURCES: readonly DirectoryRoleSource[] = MERGE_SUBJECTS.filter(
  (subject) => subject.kind === "party",
).map(roleSourceOf);

const SOURCE_BY_TOKEN: ReadonlyMap<string, DirectoryRoleSource> = new Map(
  DIRECTORY_ROLE_SOURCES.flatMap((source) =>
    source.tokens.map((token) => [token, source] as const),
  ),
);

// The dictionary keys one party subject's resolution answers: its scalar facets, and the collection of
// everyone in the role.
export function directoryRoleKeysFor(source: DirectoryRoleSource): readonly string[] {
  return [
    ...source.scalarFacets.map((facet) => `${source.key}.${facet}`),
    `${source.key}.${DIRECTORY_ROLE_LIST_FIELD}`,
  ];
}

// Every key any party subject contributes — what tells resolution whether a manifest needs the party
// collection at all.
const ROLE_KEYS: ReadonlySet<string> = new Set(
  DIRECTORY_ROLE_SOURCES.flatMap((source) => directoryRoleKeysFor(source)),
);

export function isDirectoryRoleKey(key: string): boolean {
  return ROLE_KEYS.has(key);
}

// The party subjects a set of manifest keys actually reaches. Resolution builds a collection only for the
// subjects a template names: the party read is one read whatever happens, but a list nobody walks is a
// list nobody should pay to assemble.
export function directoryRoleSourcesIn(keys: Iterable<string>): readonly DirectoryRoleSource[] {
  const wanted = new Set<DirectoryRoleSource>();
  for (const key of keys) {
    if (!ROLE_KEYS.has(key)) continue;
    const source = SOURCE_BY_TOKEN.get(normalizedRoleToken(key.slice(0, key.indexOf("."))));
    if (source !== undefined) wanted.add(source);
  }
  return [...wanted];
}

// What one party subject worked out to, given the matter's whole party collection.
export interface DirectoryRoleResolution {
  readonly values: ReadonlyMap<string, MergeValue>;
  // Keyed by the merge key that could not be resolved. A key that resolved carries no reason, and a
  // reason names COUNTS and ROLES only — never a candidate's name, which is the value the resolution
  // deliberately refused to choose between.
  readonly reasons: ReadonlyMap<string, string>;
}

function partyItem(party: MatterPartyMergeRow): MergeListItem {
  const fields = new Map<string, MergeValue>([["kind", { kind: "text", text: party.kind }]]);
  if (party.displayName !== null && party.displayName !== "") {
    fields.set("displayName", { kind: "text", text: party.displayName });
  }
  return { fields };
}

// A party row's name, as the parts the Directory records. THE PARTS RIDE THE READ THAT ALREADY HAPPENS:
// the party statement joins the Directory name tables for the display name, so projecting the columns
// beside it costs nothing and is what makes every name rendering expressible. A part the record does not
// separate out stays absent, and a rendering that needs it is a declared absence rather than a fallback.
export function partyNameValue(party: MatterPartyMergeRow): MergeValue | undefined {
  if (party.displayName === null || party.displayName === "") return undefined;
  const part = (value: string | null): string | undefined =>
    value === null || value === "" ? undefined : value;
  return {
    kind: "name",
    display: party.displayName,
    // `unknown` means the Directory entry behind the link is gone, so which it was is not recorded —
    // and an unrecorded fact is left unrecorded rather than guessed to be a person.
    ...(party.kind === "unknown" ? {} : { isOrganisation: party.kind === "organisation" }),
    ...(part(party.namePrefix) === undefined ? {} : { prefix: party.namePrefix as string }),
    ...(part(party.nameGiven) === undefined ? {} : { given: party.nameGiven as string }),
    ...(part(party.nameMiddle) === undefined ? {} : { middle: party.nameMiddle as string }),
    ...(part(party.nameFamily) === undefined ? {} : { family: party.nameFamily as string }),
    ...(part(party.nameSuffix) === undefined ? {} : { suffix: party.nameSuffix as string }),
  };
}

// One scalar facet's value for one resolved party. A facet added to the party kind lands here, and
// nowhere else — the switch is total, so a facet declared without a resolution stops this file compiling.
function facetValue(facet: string, party: MatterPartyMergeRow): MergeValue | undefined {
  switch (facet) {
    case "displayName":
      return partyNameValue(party);
    case "kind":
      return { kind: "text", text: party.kind };
    default:
      return undefined;
  }
}

// Every party subject's values, derived from the party rows ALREADY READ. This is a pass over an array in
// memory, not a read: the merge context issues one party query for the matter and every subject is
// answered from it, so a template naming four subjects costs exactly what a template naming one does.
export function directoryRoleValues(
  parties: readonly MatterPartyMergeRow[],
  sources: readonly DirectoryRoleSource[],
  // The keys the manifest actually names, so a collection is materialized only when something walks it.
  wantedKeys: ReadonlySet<string>,
): DirectoryRoleResolution {
  const values = new Map<string, MergeValue>();
  const reasons = new Map<string, string>();

  const byToken = new Map<string, MatterPartyMergeRow[]>();
  for (const party of parties) {
    const token = normalizedRoleToken(party.role);
    const bucket = byToken.get(token);
    if (bucket === undefined) byToken.set(token, [party]);
    else bucket.push(party);
  }

  for (const source of sources) {
    const matched = source.tokens.flatMap((token) => byToken.get(token) ?? []);
    const listKey = `${source.key}.${DIRECTORY_ROLE_LIST_FIELD}`;
    if (wantedKeys.has(listKey)) {
      values.set(listKey, { kind: "list", items: matched.map(partyItem) });
    }

    const only = matched.length === 1 ? matched[0] : undefined;
    if (only !== undefined) {
      for (const facet of source.scalarFacets) {
        const key = `${source.key}.${facet}`;
        const value = facetValue(facet, only);
        if (value !== undefined) {
          values.set(key, value);
          continue;
        }
        // The link is there and the Directory entry behind it is gone or nameless. That is a different
        // fact from "no such party", and saying which one it is saves a search that would find the link
        // and conclude the merge field is broken. Only a name can land here today — every other scalar
        // facet reads a column the link itself carries — so the sentence names one.
        reasons.set(
          key,
          `This matter links one party in the ${source.label} role, but that Directory entry supplies no name.`,
        );
      }
      continue;
    }

    const reason =
      matched.length === 0
        ? `This matter links no party in the ${source.label} role.`
        : `This matter links ${matched.length} parties in the ${source.label} role, so there is no single ${source.label} to name. Walk them all with a repeating block over ${listKey}.`;
    for (const facet of source.scalarFacets) reasons.set(`${source.key}.${facet}`, reason);
  }

  return { values, reasons };
}
