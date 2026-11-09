/*
 * A directory record as a printout: the same record the window shows, laid out as the export
 * document every report download already renders (apps/web/src/lib/export/tabular-export.ts), so
 * a PDF and a plain-text copy come from the renderers the firm's reports use rather than from a
 * second layout of their own.
 *
 * WHAT A PRINTOUT CARRIES. Unlike the contact card (contact-card.ts), which is handed to someone
 * else's address book, a printout is the firm's own copy of what it holds, so every contact point
 * is on it, former ones and the ones the person asked the firm not to use included, each saying
 * so. Sealed identifiers are the exception: revealing one is a separate permission and an audited
 * act, and a file on a desktop is neither.
 *
 * The builder is pure, so what lands in the file can be asserted without a server; the reader
 * beside it gathers every page of every list first, because a printout that stops at the first
 * page of matters is wrong without saying so.
 */
import { formatDate } from "@magna-carta/design-system/formatters";
import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import type { ApiOutcome, Page } from "$lib/api/request.ts";
import type { TabularExportDocument, TabularExportSection } from "$lib/export/tabular-export.ts";
import {
  readDirectoryContactPoints,
  readDirectoryEdges,
  readDirectoryEntityMatterParties,
  readDirectoryNames,
  type DirectoryContactPoints,
  type DirectoryContactPointState,
  type DirectoryEdgeEntry,
  type DirectoryEntityDetail,
  type DirectoryEntityMatterParty,
  type DirectoryNameEntry,
} from "./directory-api.ts";
import { edgeSentence, UNKNOWN_EDGE_READING } from "./edge-draft.ts";
import {
  directoryEntityName,
  entityKindLabel,
  organizationLegalNameAside,
  pronounShortForm,
  UNNAMED_ENTITY,
} from "./entity-presentation.ts";
import {
  addressLines,
  addressTypeLabel,
  addressUseLabel,
  contactUseLabel,
  EDGE_TYPES,
  nameRoleLabel,
  phoneKindLabel,
} from "./directory-vocabulary.ts";

/** Everything a printout is made from, every page of every list already gathered. */
export interface RecordPrintoutParts {
  readonly entity: DirectoryEntityDetail;
  readonly names: readonly DirectoryNameEntry[];
  readonly contactPoints: DirectoryContactPoints;
  readonly edges: readonly DirectoryEdgeEntry[];
  readonly matters: readonly DirectoryEntityMatterParty[];
}

const GAP = "—";

/** A stored instant or date as a reader's date; the gap where there is none. */
function dateText(value: string | null): string {
  if (value === null) return GAP;
  const day = value.slice(0, 10);
  return isCivilDate(day) ? formatDate(day) : GAP;
}

/** When something was in use, as a person reads it. */
function period(from: string | null, to: string | null): string {
  if (from === null && to === null) return GAP;
  if (to === null) return `From ${dateText(from)}`;
  return `${dateText(from)} to ${dateText(to)}`;
}

/** What the firm may do with a contact point, in a few words. */
function standing(state: DirectoryContactPointState, isPrimary: boolean): string {
  const facts: string[] = [];
  if (isPrimary) facts.push("Default");
  if (state.preferred) facts.push("Preferred");
  if (!state.permitted) facts.push("Do not use");
  if (state.verificationStatus === "failed") facts.push("Did not reach");
  if (state.note !== null && state.note.trim() !== "") facts.push(state.note.trim());
  return facts.length === 0 ? GAP : facts.join("; ");
}

function recordSection(entity: DirectoryEntityDetail): TabularExportSection {
  const rows: string[][] = [["Kind", entityKindLabel(entity.kind)]];
  if (entity.kind === "person") {
    const person = entity.person;
    if (person.pronouns !== null) rows.push(["Pronouns", pronounShortForm(person.pronouns)]);
    if (person.dateOfBirth !== null) rows.push(["Born", dateText(person.dateOfBirth)]);
    if (person.dateOfDeath !== null) rows.push(["Died", dateText(person.dateOfDeath)]);
    else if (person.deceased) rows.push(["Died", "Deceased, date not recorded"]);
  } else {
    const legal = organizationLegalNameAside(entity.organization);
    if (legal !== null) rows.push(["Legal name", legal]);
  }
  return { title: "Record", headers: ["Field", "Value"], rows };
}

function namesSection(names: readonly DirectoryNameEntry[]): TabularExportSection {
  return {
    title: "Names",
    headers: ["Name", "Kind", "In use"],
    rows: names.map((entry) => [
      entry.displayName ?? entry.normalizedDisplay,
      entry.isCurrent
        ? `${nameRoleLabel(entry.nameRole)} (current)`
        : nameRoleLabel(entry.nameRole),
      period(entry.validFrom, entry.validTo),
    ]),
  };
}

function contactSection(points: DirectoryContactPoints): TabularExportSection {
  return {
    title: "Contact",
    headers: ["Way to reach", "Kind", "Use", "Notes"],
    rows: [
      ...points.emails.map((entry) => [
        entry.address,
        "Email",
        entry.contactUse === null ? GAP : contactUseLabel(entry.contactUse),
        standing(entry.state, entry.isPrimary),
      ]),
      ...points.phones.map((entry) => [
        entry.extension === null ? entry.number : `${entry.number} x${entry.extension}`,
        phoneKindLabel(entry.contactSystem, entry.contactUse),
        entry.contactUse === null ? GAP : contactUseLabel(entry.contactUse),
        standing(entry.state, entry.isPrimary),
      ]),
    ],
  };
}

function addressSection(points: DirectoryContactPoints): TabularExportSection {
  return {
    title: "Addresses",
    headers: ["Address", "Use", "Kind", "Notes"],
    rows: points.addresses.map((entry) => [
      addressLines(entry).join(", "),
      entry.addressUse === null ? GAP : addressUseLabel(entry.addressUse),
      addressTypeLabel(entry.addressType),
      standing(entry.state, entry.isPrimary),
    ]),
  };
}

function relationshipsSection(
  name: string,
  edges: readonly DirectoryEdgeEntry[],
): TabularExportSection {
  return {
    title: "Relationships",
    headers: ["Relationship", "Role", "In effect"],
    rows: edges.map((edge) => {
      const entry = EDGE_TYPES.find((candidate) => candidate.edgeType === edge.edgeType) ?? {
        reading: UNKNOWN_EDGE_READING,
      };
      const far = edge.farDisplayName ?? UNNAMED_ENTITY;
      return [
        edgeSentence(name, entry, far, edge.direction),
        edge.role ?? GAP,
        period(edge.validFrom, edge.validTo),
      ];
    }),
  };
}

function mattersSection(matters: readonly DirectoryEntityMatterParty[]): TabularExportSection {
  return {
    title: "Matters",
    headers: ["Matter", "Number", "Role", "Capacity"],
    rows: matters.map((party) => [
      party.matterTitle ?? GAP,
      party.matterNumber ?? GAP,
      party.role,
      party.capacity === null || party.capacity === "" ? GAP : party.capacity,
    ]),
  };
}

/** The printout's document. A list the record holds nothing in is left out rather than printed empty. */
export function recordPrintout(
  parts: RecordPrintoutParts,
  generatedAt: Date = new Date(),
): TabularExportDocument {
  const name = directoryEntityName(parts.entity);
  const sections = [
    recordSection(parts.entity),
    namesSection(parts.names),
    contactSection(parts.contactPoints),
    addressSection(parts.contactPoints),
    relationshipsSection(name, parts.edges),
    mattersSection(parts.matters),
  ].filter((section) => section.rows.length > 0);
  return { title: name, generatedAt, sections };
}

/** Every page of one list, or the first failure. */
async function everyPage<Row>(
  readPage: (cursor: string | undefined) => Promise<ApiOutcome<Page<Row>>>,
): Promise<ApiOutcome<Row[]>> {
  const rows: Row[] = [];
  let cursor: string | undefined;
  // Sequential by nature: each page names the next one through its cursor.
  for (;;) {
    const outcome = await readPage(cursor);
    if (outcome.kind !== "ok") return outcome;
    rows.push(...outcome.value.data);
    if (outcome.value.nextCursor === null) return { kind: "ok", value: rows };
    cursor = outcome.value.nextCursor;
  }
}

/** Reads what a printout is made from, as the record holds it now. Null when any part fails. */
export async function readRecordPrintoutParts(
  fetchImpl: typeof fetch,
  entity: DirectoryEntityDetail,
  entityId: string,
): Promise<RecordPrintoutParts | null> {
  const [names, contactPoints, edges, matters] = await Promise.all([
    everyPage((cursor) => readDirectoryNames(fetchImpl, entityId, cursor)),
    readDirectoryContactPoints(fetchImpl, entityId),
    everyPage((cursor) => readDirectoryEdges(fetchImpl, entityId, cursor)),
    everyPage((cursor) => readDirectoryEntityMatterParties(fetchImpl, entityId, cursor)),
  ]);
  if (
    names.kind !== "ok" ||
    contactPoints.kind !== "ok" ||
    edges.kind !== "ok" ||
    matters.kind !== "ok"
  ) {
    return null;
  }
  return {
    entity,
    names: names.value,
    contactPoints: contactPoints.value,
    edges: edges.value,
    matters: matters.value,
  };
}
