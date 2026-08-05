import type { DictionaryEntry } from "./dictionary.ts";
import type { MatterPartyMergeRow } from "./merge-statements.ts";
import type { MergeListItem, MergeValue } from "./types.ts";

// The matter's party links, as merge fields.
//
// A matter records who it is about through `matter_party` rows — a Directory entity plus the role it
// plays. `client.displayName` has always been readable because a matter carries its client on its own
// row; every other role was only reachable by walking `matter.parties` and reading the role out of each
// item. These entries close that gap: a template names the opposing party the way it names the client.
//
// THE ROLE IS THE KEY, WITH THE PUNCTUATION TAKEN OUT. `matter_party.role` is free text — the firm's
// own role catalogue is what a screen lists from, not a constraint on the column — so one firm writes
// `opposing_party`, the next `Opposing Party`, and a third `opposing-party`. A platform merge key
// cannot be firm text (it has to lex as one atom and be typeable from memory), so the platform declares
// a small closed set of role sources and a party matches one when its stored role, lowercased with
// every non-alphanumeric character removed, equals the source key given the same treatment. That makes
// the mapping derivable rather than a second table to keep in step: `opposingParty` matches
// `opposing_party`, `Opposing Party`, and `OPPOSING-PARTY`, and matches nothing else.
//
// AMBIGUITY IS AN ANSWER, NOT A COIN TOSS. A matter with two parties in one role has no single one to
// name, so the singular keys resolve to NOTHING and the reason travels with the absence — including how
// many candidates there were, because "there are three opposing parties on this matter" is the fact
// that tells a person what to do next, and "[OPPOSING PARTY DISPLAY NAME]" alone does not. Picking the
// first by created-at would produce a document that is wrong in a way nobody can see. The many case has
// its own answer: `<role>.all` is a collection a repeating block walks, bounded by exactly what every
// other repeat is bounded by.

// One role the platform ships a merge source for. Each is a role this repository already models —
// nothing here invents a practice vocabulary, and a role a firm uses that is not on this list is still
// reachable through `matter.parties`, whose items carry the role they were linked in.
export interface DirectoryRoleSource {
  // The key's first segment, and (normalized) the stored role it matches.
  readonly key: string;
  // What a person calls the role, in running prose. Used in the absence reasons and the descriptions.
  readonly label: string;
}

export const DIRECTORY_ROLE_SOURCES: readonly DirectoryRoleSource[] = [
  { key: "opposingParty", label: "opposing party" },
  { key: "opposingCounsel", label: "opposing counsel" },
  { key: "guardian", label: "guardian" },
  { key: "witness", label: "witness" },
];

// The field a role source's collection is named by. One segment, so `opposingParty.all` is a dictionary
// key of the same dotted shape every other key has, and an item's field inside a repeating block reads
// `opposingParty.all.displayName` — the collection key plus the field, which is the binding the repeat
// machinery already produces for `matter.parties`.
export const DIRECTORY_ROLE_LIST_FIELD = "all";

// The role-matching rule, in one place. Case and punctuation are removed rather than normalized to a
// separator because the separator itself is what firms disagree about: a space, an underscore, a hyphen,
// or nothing at all. What is left is the letters and digits of the role's name, which is the only part
// two firms writing down the same role reliably agree on.
export function normalizedRoleToken(role: string): string {
  return role.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const SOURCE_BY_TOKEN: ReadonlyMap<string, DirectoryRoleSource> = new Map(
  DIRECTORY_ROLE_SOURCES.map((source) => [normalizedRoleToken(source.key), source]),
);

// The dictionary keys one role source contributes: the single party in that role, and the collection of
// everyone in it.
export function directoryRoleKeysFor(source: DirectoryRoleSource): readonly string[] {
  return [
    `${source.key}.displayName`,
    `${source.key}.kind`,
    `${source.key}.${DIRECTORY_ROLE_LIST_FIELD}`,
  ];
}

// Every key any role source contributes — what tells resolution whether a manifest needs the party
// collection at all.
const ROLE_KEYS: ReadonlySet<string> = new Set(
  DIRECTORY_ROLE_SOURCES.flatMap((source) => directoryRoleKeysFor(source)),
);

export function isDirectoryRoleKey(key: string): boolean {
  return ROLE_KEYS.has(key);
}

// The role sources a set of manifest keys actually reaches. Resolution builds a collection only for the
// roles a template names: the party read is one read whatever happens, but a list nobody walks is a list
// nobody should pay to assemble.
export function directoryRoleSourcesIn(keys: Iterable<string>): readonly DirectoryRoleSource[] {
  const wanted = new Set<DirectoryRoleSource>();
  for (const key of keys) {
    if (!ROLE_KEYS.has(key)) continue;
    const source = SOURCE_BY_TOKEN.get(normalizedRoleToken(key.slice(0, key.indexOf("."))));
    if (source !== undefined) wanted.add(source);
  }
  return [...wanted];
}

// The shipped dictionary rows for every role source.
//
// `displayName` and `kind` are `placeholder` absences rather than `blank` ones for the reason the whole
// absence model biases that way: a letter addressed to nobody, filed because the gap was invisible, is
// the failure this subsystem exists to prevent. The collection is `blank`, exactly as `matter.parties`
// is — a matter with no opposing party has an empty list, which a repeating block correctly renders as
// nothing at all.
export const DIRECTORY_ROLE_DICTIONARY_ENTRIES: readonly DictionaryEntry[] =
  DIRECTORY_ROLE_SOURCES.flatMap((source) => [
    {
      key: `${source.key}.displayName`,
      source: "party" as const,
      valueType: "text" as const,
      defaultFormat: "plain",
      sensitivity: "ordinary" as const,
      absence: "placeholder" as const,
      description: `The ${source.label}'s name, when the matter links exactly one.`,
    },
    {
      key: `${source.key}.kind`,
      source: "party" as const,
      valueType: "text" as const,
      defaultFormat: "plain",
      sensitivity: "ordinary" as const,
      absence: "placeholder" as const,
      description: `Whether the ${source.label} is a person or an organisation.`,
    },
    {
      key: `${source.key}.${DIRECTORY_ROLE_LIST_FIELD}`,
      source: "party" as const,
      valueType: "list" as const,
      // A list is never rendered — a repeating block walks it — so its default format is the empty
      // rendering the format table declares for the type.
      defaultFormat: "",
      sensitivity: "ordinary" as const,
      absence: "blank" as const,
      description: `Everyone the matter links as ${source.label}, for a repeating block to walk.`,
      itemFields: [
        {
          name: "displayName",
          valueType: "text" as const,
          description: "The party's name as it should appear in a document.",
        },
        {
          name: "kind",
          valueType: "text" as const,
          description: "Whether the party is a person or an organisation.",
        },
      ],
    },
  ]);

// What one role source worked out to, given the matter's whole party collection.
export interface DirectoryRoleResolution {
  readonly values: ReadonlyMap<string, MergeValue>;
  // Keyed by the merge key that could not be resolved. A key that resolved carries no reason, and a
  // reason names COUNTS and ROLES only — never a party's name, which is the value the resolution
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

// Every role source's values, derived from the party rows ALREADY READ. This is a pass over an array in
// memory, not a read: the merge context issues one party query for the matter and every role source is
// answered from it, so a template naming four roles costs exactly what a template naming one does.
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
    const matched = byToken.get(normalizedRoleToken(source.key)) ?? [];
    const listKey = `${source.key}.${DIRECTORY_ROLE_LIST_FIELD}`;
    if (wantedKeys.has(listKey)) {
      values.set(listKey, { kind: "list", items: matched.map(partyItem) });
    }

    const displayNameKey = `${source.key}.displayName`;
    const kindKey = `${source.key}.kind`;
    const only = matched.length === 1 ? matched[0] : undefined;
    if (only !== undefined) {
      if (only.displayName !== null && only.displayName !== "") {
        values.set(displayNameKey, { kind: "text", text: only.displayName });
      } else {
        // The link is there and the Directory entry behind it is gone or nameless. That is a different
        // fact from "no such party", and saying which one it is saves a search that would find the link
        // and conclude the merge field is broken.
        reasons.set(
          displayNameKey,
          `This matter links one party in the ${source.label} role, but that Directory entry supplies no name.`,
        );
      }
      values.set(kindKey, { kind: "text", text: only.kind });
      continue;
    }

    const reason =
      matched.length === 0
        ? `This matter links no party in the ${source.label} role.`
        : `This matter links ${matched.length} parties in the ${source.label} role, so there is no single ${source.label} to name. Walk them all with a repeating block over ${listKey}.`;
    reasons.set(displayNameKey, reason);
    reasons.set(kindKey, reason);
  }

  return { values, reasons };
}
