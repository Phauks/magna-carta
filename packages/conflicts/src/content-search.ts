import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// THE FIRM'S OWN RECORDS AS A PLACE A CHECK LOOKS: calls, texts, email, tasks and Magnus
// conversations.
//
// The Directory answers "do we know this party?". These answer a different question a firm is asked
// just as often: "have we heard of this party?" A prospect who telephoned last spring, an opposing
// company named in a task, a person a lawyer asked Magnus about. None of them need to be a Directory
// record for that history to exist, so each is searched where it actually lives.
//
// HOW A PARTY IS LOOKED FOR, and why it is not the Directory's matcher. Messages and conversations
// are prose, not name rows: there is no phonetic code or trigram index over them, and a fuzzy match
// against free text would surface every message containing a common surname. So two kinds of
// evidence, both stated in the record:
//
//   - IDENTITY, tier 1: the record is linked to the party's Directory record, or its number or
//     address is one the Directory holds for the party.
//   - THE NAME AS WRITTEN, tier 2: one of the party's names appears in the record's text, compared
//     whole and without regard to case. "Acme Holdings" is looked for as "Acme Holdings", never as
//     "Acme" and "Holdings" apart.
//
// WHAT IS NOT SEARCHED, so the report can say so. An email's body lives in the firm's storage as the
// original message rather than in the database, so email is searched by its people and its subject
// and not by its body. Document text is Files, which is not this module.
//
// Every record the firm holds is in reach, including those not filed to any matter and Magnus
// conversations saved to General: the owner's ruling of 2026-11-10 is that there is no such thing as
// a private Magnus conversation, and a check that skipped the unfiled would miss the first contact,
// which is usually where an unfiled message comes from.

export const MESSAGING_CHANNELS = ["calls", "texts", "email"] as const;
export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

// The matter statuses a task is offered under in the panel. A task with no matter at all is searched
// whenever tasks are, because no status can be asked of it.
export const TASK_MATTER_STATUSES = ["consultations", "open", "closed", "archived"] as const;
export type TaskMatterStatus = (typeof TASK_MATTER_STATUSES)[number];

// The same four options for Files. Archived there means files a member deleted from a matter, which
// the firm keeps (a file is only ever soft-deleted) and a conflicts check must still be able to read.
export const FILE_MATTER_STATUSES = TASK_MATTER_STATUSES;
export type FileMatterStatus = TaskMatterStatus;

// What a check is asked to search beyond the Directory. An empty list (or false) is a place not asked
// for, which the record keeps apart from a place asked for and searched.
export interface PlacesRequest {
  readonly messaging: readonly MessagingChannel[];
  readonly tasks: readonly TaskMatterStatus[];
  readonly magnus: boolean;
  readonly files: readonly FileMatterStatus[];
}

export const NO_PLACES: PlacesRequest = Object.freeze({
  messaging: [],
  tasks: [],
  magnus: false,
  files: [],
});

// Reads a places request from anywhere it can arrive: a stored run request, a request body. Anything
// unrecognized is dropped rather than refused, so an old row reads as asking for nothing more.
export function readPlacesRequest(value: unknown): PlacesRequest {
  if (typeof value !== "object" || value === null) return NO_PLACES;
  const record = value as Record<string, unknown>;
  const pick = <T extends string>(entry: unknown, allowed: readonly T[]): T[] =>
    Array.isArray(entry) ? allowed.filter((option) => entry.includes(option)) : [];
  return {
    messaging: pick(record["messaging"], MESSAGING_CHANNELS),
    tasks: pick(record["tasks"], TASK_MATTER_STATUSES),
    magnus: record["magnus"] === true,
    files: pick(record["files"], FILE_MATTER_STATUSES),
  };
}

export function asksForAnyPlace(places: PlacesRequest): boolean {
  return (
    places.messaging.length > 0 ||
    places.tasks.length > 0 ||
    places.magnus ||
    places.files.length > 0
  );
}

// Whether any place other than Files was asked for: those are searched in the firm's own database,
// Files through the file contents index.
export function asksForRecordPlaces(places: PlacesRequest): boolean {
  return places.messaging.length > 0 || places.tasks.length > 0 || places.magnus;
}

// Where one result was found. Identifiers, a matter and an instant only: never a subject line, a
// message or a task title, because the log is append-only and outlives every one of those records.
// A reader resolves what it may see through the record's own surface.
export const FOUND_IN_KINDS = [
  "call",
  "text",
  "email",
  "task",
  "magnus_conversation",
  "file",
] as const;
export type FoundInKind = (typeof FOUND_IN_KINDS)[number];

export interface FoundIn {
  readonly kind: FoundInKind;
  readonly id: string;
  readonly matterId: string | null;
  readonly at: string | null;
}

export function readFoundIn(json: string | null): FoundIn | null {
  if (json === null) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const kind = parsed["kind"];
    if (
      typeof kind !== "string" ||
      !(FOUND_IN_KINDS as readonly string[]).includes(kind) ||
      typeof parsed["id"] !== "string"
    ) {
      return null;
    }
    return {
      kind: kind as FoundInKind,
      id: parsed["id"],
      matterId: typeof parsed["matterId"] === "string" ? parsed["matterId"] : null,
      at: typeof parsed["at"] === "string" ? parsed["at"] : null,
    };
  } catch {
    return null;
  }
}

// The number each matter is known by, for saying where a result was filed: its matter number once it
// has one, otherwise its consultation or intake number. One read for every result of a check.
export async function readMatterNumbers(
  database: SqlDatabase,
  matterIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const numbers = new Map<string, string>();
  const ids = [...new Set(matterIds.filter((id): id is string => id !== null))];
  for (const chunk of chunks(ids, MAX_BOUND_PARAMETERS)) {
    const { results } = await database
      .prepare(
        `SELECT id, COALESCE(matter_number, consultation_number, intake_number) AS number
           FROM matter WHERE id IN (${placeholders(chunk.length)})`,
      )
      .bind(...chunk)
      .all<{ id: string; number: string | null }>();
    for (const row of results) if (row.number !== null) numbers.set(row.id, row.number);
  }
  return numbers;
}

// Every stored result's place, with its matter's number, keyed by the result's id: one read for a
// whole check rather than one per result.
export async function resolveFoundIns(
  database: SqlDatabase,
  hitRows: readonly { readonly id: string; readonly found_in_json: string | null }[],
): Promise<Map<string, (FoundIn & { readonly matterNumber: string | null }) | null>> {
  const places = hitRows.map((row) => [row.id, readFoundIn(row.found_in_json)] as const);
  const numbers = await readMatterNumbers(
    database,
    places.map(([, place]) => place?.matterId ?? null),
  );
  return new Map(
    places.map(([id, place]) => [
      id,
      place === null
        ? null
        : {
            ...place,
            matterNumber: place.matterId === null ? null : (numbers.get(place.matterId) ?? null),
          },
    ]),
  );
}

// ---- what a party is looked for by ----------------------------------------------------------------

export interface PartyNeedles {
  readonly entityId: string;
  // The party's names as a person would write them, each at least NAME_FLOOR characters.
  readonly names: readonly string[];
  // Email addresses, lowercased.
  readonly emails: readonly string[];
  // The digits of each phone number's national part, at least NUMBER_FLOOR of them.
  readonly phoneDigits: readonly string[];
}

// A name shorter than this is not looked for in prose: "Al" or "Li" would surface every message that
// contains the two letters, which buries the results instead of finding one. The record names the
// floor, so a reader can tell a name that was skipped from one that was searched.
export const NAME_FLOOR = 3;

// A national number with fewer digits than this is an extension or a short code, and a tail match on
// it would land on unrelated numbers.
export const NUMBER_FLOOR = 7;

// D1 binds at most 100 parameters to one statement.
export const MAX_BOUND_PARAMETERS = 100;

export function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    out.push(values.slice(start, start + size));
  }
  return out;
}

export function placeholders(count: number, offset = 0): string {
  return Array.from({ length: count }, (_, index) => `?${String(index + 1 + offset)}`).join(", ");
}

function addName(names: Map<string, string>, ...parts: (string | null | undefined)[]): void {
  const name = parts
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .map((part) => part.trim())
    .join(" ")
    .replaceAll(/\s+/gu, " ");
  if (name.length >= NAME_FLOOR && !names.has(name.toLowerCase())) {
    names.set(name.toLowerCase(), name);
  }
}

// Everything each party is looked for by, in four set-valued reads rather than four per party.
//
// The names follow the check's name roles, the same setting the Directory search records: a party
// who married is looked for under the maiden name exactly when the Directory search looks for it.
// `null` roles means every role.
export async function readPartyNeedles(
  database: SqlDatabase,
  entityIds: readonly string[],
  nameRoles: readonly string[] | null,
): Promise<PartyNeedles[]> {
  const ids = [...new Set(entityIds)];
  const names = new Map<string, Map<string, string>>(ids.map((id) => [id, new Map()]));
  const emails = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  const phones = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));

  for (const chunk of chunks(ids, MAX_BOUND_PARAMETERS)) {
    const inList = placeholders(chunk.length);
    const people = await database
      .prepare(
        `SELECT id, name_given, name_family, display_name FROM directory_person
          WHERE id IN (${inList}) AND deleted_at IS NULL`,
      )
      .bind(...chunk)
      .all<{
        id: string;
        name_given: string | null;
        name_family: string | null;
        display_name: string | null;
      }>();
    for (const row of people.results) {
      const target = names.get(row.id);
      if (target === undefined) continue;
      addName(target, row.display_name);
      addName(target, row.name_given, row.name_family);
    }

    const organizations = await database
      .prepare(
        `SELECT id, legal_name, display_name FROM directory_organization
          WHERE id IN (${inList}) AND deleted_at IS NULL`,
      )
      .bind(...chunk)
      .all<{ id: string; legal_name: string | null; display_name: string | null }>();
    for (const row of organizations.results) {
      const target = names.get(row.id);
      if (target === undefined) continue;
      addName(target, row.display_name);
      addName(target, row.legal_name);
    }

    // A person's other names: former, maiden, alias and the rest, as the check's roles allow.
    const roleFilter =
      nameRoles === null || nameRoles.length === 0
        ? ""
        : `AND name_role IN (${placeholders(nameRoles.length, chunk.length)})`;
    const nameRows = await database
      .prepare(
        `SELECT entity_id, name_given, name_middle, name_family FROM directory_name
          WHERE entity_id IN (${inList}) AND entity_kind = 'person' AND deleted_at IS NULL ${roleFilter}`,
      )
      .bind(...chunk, ...(nameRoles ?? []))
      .all<{
        entity_id: string;
        name_given: string | null;
        name_middle: string | null;
        name_family: string | null;
      }>();
    for (const row of nameRows.results) {
      const target = names.get(row.entity_id);
      if (target === undefined) continue;
      addName(target, row.name_given, row.name_family);
      addName(target, row.name_given, row.name_middle, row.name_family);
    }

    const emailRows = await database
      .prepare(
        `SELECT entity_id, address, normalized_address FROM directory_email WHERE entity_id IN (${inList})`,
      )
      .bind(...chunk)
      .all<{ entity_id: string; address: string; normalized_address: string | null }>();
    for (const row of emailRows.results) {
      const address = (row.normalized_address ?? row.address).trim().toLowerCase();
      if (address.includes("@")) emails.get(row.entity_id)?.add(address);
    }

    const phoneRows = await database
      .prepare(
        `SELECT entity_id, number, national_number FROM directory_phone WHERE entity_id IN (${inList})`,
      )
      .bind(...chunk)
      .all<{ entity_id: string; number: string; national_number: string | null }>();
    for (const row of phoneRows.results) {
      const digits = (row.national_number ?? row.number).replaceAll(/\D/gu, "");
      if (digits.length >= NUMBER_FLOOR) phones.get(row.entity_id)?.add(digits);
    }
  }

  return ids.map((entityId) => ({
    entityId,
    names: [...(names.get(entityId)?.values() ?? [])],
    emails: [...(emails.get(entityId) ?? [])],
    phoneDigits: [...(phones.get(entityId) ?? [])],
  }));
}

// ---- the search -----------------------------------------------------------------------------------

export interface ContentHit {
  readonly entityId: string;
  readonly tier: 1 | 2;
  readonly matchedFields: readonly string[];
  readonly foundIn: FoundIn;
}

// A LIKE pattern matching the text anywhere, with the wildcard characters in it taken literally.
function containsPattern(text: string): string {
  return `%${text.replaceAll(/[\\%_]/gu, (character) => `\\${character}`)}%`;
}

// The digits of a stored number, in SQL. The call log keeps what a member typed — "(702) 555-0143"
// — rather than a canonical form, so the comparison strips the punctuation the log admits.
const DIGITS_OF_COUNTERPARTY = ["+", " ", "(", ")", "-", ".", "x", "#", "*"].reduce(
  (expression, character) => `REPLACE(${expression}, '${character}', '')`,
  "counterparty_number",
);

// Collects one result per party per record, merging the reasons it was found.
class HitCollector {
  private readonly byKey = new Map<
    string,
    { entityId: string; tier: 1 | 2; fields: string[]; foundIn: FoundIn }
  >();

  add(entityId: string, foundIn: FoundIn, tier: 1 | 2, field: string): void {
    const key = `${entityId}\u0000${foundIn.kind}\u0000${foundIn.id}`;
    const existing = this.byKey.get(key);
    if (existing === undefined) {
      this.byKey.set(key, { entityId, tier, fields: [field], foundIn });
      return;
    }
    if (tier < existing.tier) existing.tier = tier;
    if (!existing.fields.includes(field)) existing.fields.push(field);
  }

  hits(): ContentHit[] {
    return [...this.byKey.values()]
      .map((entry) => ({
        entityId: entry.entityId,
        tier: entry.tier,
        matchedFields: entry.fields,
        foundIn: entry.foundIn,
      }))
      .toSorted(
        (left, right) =>
          left.tier - right.tier ||
          (right.foundIn.at ?? "").localeCompare(left.foundIn.at ?? "") ||
          left.foundIn.id.localeCompare(right.foundIn.id) ||
          left.entityId.localeCompare(right.entityId),
      );
  }
}

// Which parties' names a piece of text contains.
function namesIn(
  text: string | null,
  parties: readonly PartyNeedles[],
): { entityId: string; name: string }[] {
  if (text === null || text === "") return [];
  const haystack = text.toLowerCase();
  const found: { entityId: string; name: string }[] = [];
  for (const party of parties) {
    const name = party.names.find((candidate) => haystack.includes(candidate.toLowerCase()));
    if (name !== undefined) found.push({ entityId: party.entityId, name });
  }
  return found;
}

// A clause matching any of the given LIKE patterns in any of the given columns, with each pattern
// bound once and referenced from every column.
function anyContains(columns: readonly string[], patternCount: number, offset: number): string {
  if (patternCount === 0) return "0";
  const terms: string[] = [];
  for (const column of columns) {
    for (let index = 0; index < patternCount; index += 1) {
      terms.push(`${column} LIKE ?${String(offset + index + 1)} ESCAPE '\\'`);
    }
  }
  return `(${terms.join(" OR ")})`;
}

// Name patterns are bound in groups that leave room for the other parameters a query needs.
const NAME_PATTERNS_PER_QUERY = 60;

function namePatternGroups(parties: readonly PartyNeedles[]): string[][] {
  const patterns = [...new Set(parties.flatMap((party) => party.names))].map(containsPattern);
  return patterns.length === 0 ? [] : chunks(patterns, NAME_PATTERNS_PER_QUERY);
}

const CHANNELS_BY_KIND: Readonly<Record<"call" | "text", readonly string[]>> = {
  call: ["voice"],
  text: ["sms", "mms"],
};

async function searchCallsAndTexts(
  database: SqlDatabase,
  parties: readonly PartyNeedles[],
  kinds: readonly ("call" | "text")[],
  collector: HitCollector,
): Promise<void> {
  if (kinds.length === 0) return;
  const channels = kinds.flatMap((kind) => CHANNELS_BY_KIND[kind]);
  const channelList = channels.map((channel) => `'${channel}'`).join(", ");
  interface Row {
    id: string;
    channel: string;
    matter_id: string | null;
    occurred_at: string;
    counterparty_entity_id: string | null;
    digits: string;
    caller_id_name: string | null;
    body: string | null;
    summary: string | null;
  }
  const columns = `id, channel, matter_id, occurred_at, counterparty_entity_id,
    ${DIGITS_OF_COUNTERPARTY} AS digits, caller_id_name, body, summary`;
  const rows = new Map<string, Row>();

  // Identity: the record is linked to the party, or its number is one of the party's.
  const entityIds = parties.map((party) => party.entityId);
  for (const chunk of chunks(entityIds, MAX_BOUND_PARAMETERS)) {
    const { results } = await database
      .prepare(
        `SELECT ${columns} FROM communication
          WHERE channel IN (${channelList}) AND counterparty_entity_id IN (${placeholders(chunk.length)})`,
      )
      .bind(...chunk)
      .all<Row>();
    for (const row of results) rows.set(row.id, row);
  }
  const numbers = [...new Set(parties.flatMap((party) => party.phoneDigits))];
  for (const chunk of chunks(numbers, MAX_BOUND_PARAMETERS)) {
    const tails = chunk.map((_, index) => `${DIGITS_OF_COUNTERPARTY} LIKE ?${String(index + 1)}`);
    const { results } = await database
      .prepare(
        `SELECT ${columns} FROM communication
          WHERE channel IN (${channelList}) AND (${tails.join(" OR ")})`,
      )
      .bind(...chunk.map((digits) => `%${digits}`))
      .all<Row>();
    for (const row of results) rows.set(row.id, row);
  }
  // The name as written: in the caller ID, the message, or the summary a member wrote.
  for (const group of namePatternGroups(parties)) {
    const { results } = await database
      .prepare(
        `SELECT ${columns} FROM communication
          WHERE channel IN (${channelList})
            AND ${anyContains(["caller_id_name", "body", "summary"], group.length, 0)}`,
      )
      .bind(...group)
      .all<Row>();
    for (const row of results) rows.set(row.id, row);
  }

  for (const row of rows.values()) {
    const kind = row.channel === "voice" ? "call" : "text";
    const foundIn: FoundIn = { kind, id: row.id, matterId: row.matter_id, at: row.occurred_at };
    for (const party of parties) {
      if (row.counterparty_entity_id === party.entityId) {
        collector.add(party.entityId, foundIn, 1, `the ${kind} is linked to the party's record`);
      }
      if (party.phoneDigits.some((digits) => row.digits.endsWith(digits))) {
        collector.add(party.entityId, foundIn, 1, `the number is one of the party's phone numbers`);
      }
    }
    for (const hit of namesIn(row.caller_id_name, parties)) {
      collector.add(hit.entityId, foundIn, 2, `"${hit.name}" is the caller ID name`);
    }
    for (const hit of namesIn(row.body, parties)) {
      const where = kind === "text" ? "the message" : "the call's notes";
      collector.add(hit.entityId, foundIn, 2, `"${hit.name}" is named in ${where}`);
    }
    for (const hit of namesIn(row.summary, parties)) {
      collector.add(hit.entityId, foundIn, 2, `"${hit.name}" is named in the summary`);
    }
  }
}

async function searchEmail(
  database: SqlDatabase,
  parties: readonly PartyNeedles[],
  collector: HitCollector,
): Promise<void> {
  // The first matter a message is filed on, if any; a message filed on several is found once per
  // party and opens on its first.
  const matterOf = `(SELECT MIN(link.matter_id) FROM email_matter_link AS link
      WHERE link.email_message_id = message.id AND link.state = 'filed')`;
  const at = "COALESCE(message.sent_at, message.received_at)";

  interface ParticipantRow {
    message_id: string;
    matter_id: string | null;
    at: string;
    directory_entity_id: string | null;
    address: string | null;
    display_name: string | null;
  }
  const participants = new Map<string, ParticipantRow>();
  const participantColumns = `message.id AS message_id, ${matterOf} AS matter_id, ${at} AS at,
    participant.directory_entity_id, lower(participant.address) AS address, participant.display_name`;
  const from = `email_participant AS participant
    JOIN email_message AS message ON message.id = participant.email_message_id`;
  const remember = (row: ParticipantRow): void => {
    participants.set(
      `${row.message_id}\u0000${row.directory_entity_id ?? ""}\u0000${row.address ?? ""}\u0000${row.display_name ?? ""}`,
      row,
    );
  };

  const entityIds = parties.map((party) => party.entityId);
  for (const chunk of chunks(entityIds, MAX_BOUND_PARAMETERS)) {
    const { results } = await database
      .prepare(
        `SELECT ${participantColumns} FROM ${from}
          WHERE participant.directory_entity_id IN (${placeholders(chunk.length)})`,
      )
      .bind(...chunk)
      .all<ParticipantRow>();
    results.forEach(remember);
  }
  const addresses = [...new Set(parties.flatMap((party) => party.emails))];
  for (const chunk of chunks(addresses, MAX_BOUND_PARAMETERS)) {
    const { results } = await database
      .prepare(
        `SELECT ${participantColumns} FROM ${from}
          WHERE lower(participant.address) IN (${placeholders(chunk.length)})`,
      )
      .bind(...chunk)
      .all<ParticipantRow>();
    results.forEach(remember);
  }
  for (const group of namePatternGroups(parties)) {
    const { results } = await database
      .prepare(
        `SELECT ${participantColumns} FROM ${from}
          WHERE ${anyContains(["participant.display_name"], group.length, 0)}`,
      )
      .bind(...group)
      .all<ParticipantRow>();
    results.forEach(remember);
  }

  for (const row of participants.values()) {
    const foundIn: FoundIn = {
      kind: "email",
      id: row.message_id,
      matterId: row.matter_id,
      at: row.at,
    };
    for (const party of parties) {
      if (row.directory_entity_id === party.entityId) {
        collector.add(party.entityId, foundIn, 1, "a sender or recipient is the party's record");
      }
      if (row.address !== null && party.emails.includes(row.address)) {
        collector.add(party.entityId, foundIn, 1, "a sender or recipient is the party's address");
      }
    }
    for (const hit of namesIn(row.display_name, parties)) {
      collector.add(hit.entityId, foundIn, 2, `"${hit.name}" is a sender or recipient's name`);
    }
  }

  for (const group of namePatternGroups(parties)) {
    const { results } = await database
      .prepare(
        `SELECT message.id AS message_id, ${matterOf} AS matter_id, ${at} AS at, message.subject
           FROM email_message AS message
          WHERE ${anyContains(["message.subject"], group.length, 0)}`,
      )
      .bind(...group)
      .all<{ message_id: string; matter_id: string | null; at: string; subject: string | null }>();
    for (const row of results) {
      const foundIn: FoundIn = {
        kind: "email",
        id: row.message_id,
        matterId: row.matter_id,
        at: row.at,
      };
      for (const hit of namesIn(row.subject, parties)) {
        collector.add(hit.entityId, foundIn, 2, `"${hit.name}" is named in the subject`);
      }
    }
  }
}

// The matter statuses each panel option stands for. Hold is an open matter paused.
export const MATTER_STATUSES_BY_OPTION: Readonly<
  Record<Exclude<TaskMatterStatus, "archived">, readonly string[]>
> = {
  consultations: ["intake", "consultation"],
  open: ["open", "hold"],
  closed: ["closed"],
};

async function searchTasks(
  database: SqlDatabase,
  parties: readonly PartyNeedles[],
  statuses: readonly TaskMatterStatus[],
  collector: HitCollector,
): Promise<void> {
  const matterStatuses = statuses.flatMap((status) =>
    status === "archived" ? [] : MATTER_STATUSES_BY_OPTION[status],
  );
  const includeArchived = statuses.includes("archived");
  // A live task is in reach when its matter's status was asked for, or when it has no matter; an
  // archived task when Archived was asked for, whatever its matter.
  const statusList = matterStatuses.map((status) => `'${status}'`).join(", ");
  const live =
    matterStatuses.length === 0
      ? "task.matter_id IS NULL"
      : `(task.matter_id IS NULL OR matter.status IN (${statusList}))`;
  const inReach = includeArchived
    ? `((task.archived_at IS NULL AND ${live}) OR task.archived_at IS NOT NULL)`
    : `(task.archived_at IS NULL AND ${live})`;

  for (const group of namePatternGroups(parties)) {
    const { results } = await database
      .prepare(
        `SELECT task.id, task.matter_id, task.created_at, task.title, task.body
           FROM matter_task AS task
           LEFT JOIN matter ON matter.id = task.matter_id
          WHERE ${inReach} AND ${anyContains(["task.title", "task.body"], group.length, 0)}`,
      )
      .bind(...group)
      .all<{
        id: string;
        matter_id: string | null;
        created_at: string;
        title: string;
        body: string | null;
      }>();
    for (const row of results) {
      const foundIn: FoundIn = {
        kind: "task",
        id: row.id,
        matterId: row.matter_id,
        at: row.created_at,
      };
      for (const hit of namesIn(row.title, parties)) {
        collector.add(hit.entityId, foundIn, 2, `"${hit.name}" is named in the title`);
      }
      for (const hit of namesIn(row.body, parties)) {
        collector.add(hit.entityId, foundIn, 2, `"${hit.name}" is named in the description`);
      }
    }
  }
}

async function searchMagnus(
  database: SqlDatabase,
  parties: readonly PartyNeedles[],
  collector: HitCollector,
): Promise<void> {
  for (const group of namePatternGroups(parties)) {
    const { results } = await database
      .prepare(
        `SELECT conversation.id, conversation.matter_id, conversation.created_at,
                conversation.title, turn.speaker, turn.content
           FROM magnus_conversation AS conversation
           LEFT JOIN magnus_turn AS turn ON turn.conversation_id = conversation.id
          WHERE conversation.state != 'deleted'
            AND (${anyContains(["conversation.title"], group.length, 0)}
                 OR ${anyContains(["turn.content"], group.length, 0)})`,
      )
      .bind(...group)
      .all<{
        id: string;
        matter_id: string | null;
        created_at: string;
        title: string | null;
        speaker: string | null;
        content: string | null;
      }>();
    for (const row of results) {
      const foundIn: FoundIn = {
        kind: "magnus_conversation",
        id: row.id,
        matterId: row.matter_id,
        at: row.created_at,
      };
      for (const hit of namesIn(row.title, parties)) {
        collector.add(hit.entityId, foundIn, 2, `"${hit.name}" is named in the title`);
      }
      const speaker = row.speaker === "magnus" ? "Magnus's answer" : "a member's message";
      for (const hit of namesIn(row.content, parties)) {
        collector.add(hit.entityId, foundIn, 2, `"${hit.name}" is named in ${speaker}`);
      }
    }
  }
}

// Every place asked for, searched for every party. Returns one result per party per record, the
// strongest first.
export async function searchContent(
  database: SqlDatabase,
  parties: readonly PartyNeedles[],
  places: PlacesRequest,
): Promise<ContentHit[]> {
  const collector = new HitCollector();
  const callKinds: ("call" | "text")[] = [];
  if (places.messaging.includes("calls")) callKinds.push("call");
  if (places.messaging.includes("texts")) callKinds.push("text");
  await searchCallsAndTexts(database, parties, callKinds, collector);
  if (places.messaging.includes("email")) await searchEmail(database, parties, collector);
  if (places.tasks.length > 0) await searchTasks(database, parties, places.tasks, collector);
  if (places.magnus) await searchMagnus(database, parties, collector);
  return collector.hits();
}
