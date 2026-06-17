import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DirectoryNameId,
  DirectoryOrganizationId,
  DirectoryPersonId,
  MatterPartyId,
} from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.ts";
import { normalizeName } from "./normalize-name.ts";
import { phoneticCodes } from "./phonetics.ts";
import {
  insertNameStatement,
  insertOrganizationStatement,
  insertPersonStatement,
  insertPhoneticCodeStatements,
} from "./statements.ts";

// Organization-suffix heuristic. A client display name is treated as an organization when it carries
// one of these legal-form tokens as a whole word (case-insensitive). This is a one-time best-effort
// classification of legacy display strings — a clerk can always re-type an entity later; it never
// deduplicates, so a wrong guess costs only an extra review, not a data merge.
const ORGANIZATION_SUFFIX_PATTERN =
  /\b(LLC|Inc|Corp|Corporation|Ltd|LP|LLP|PLLC|Co|Company|Trust|Foundation|Association|Pty|GmbH|AG|SA|NV|BV|PLC)\b/i;

interface LegacyMatterRow {
  readonly id: string;
  readonly client_display_name: string | null;
}

// Build the statements that create an organization entity (entity row + current name row + phonetic
// codes) from a legacy display string. Mirrors createOrganization but binds the ids the caller mints
// so the matter_party link can reference the new entity id within the same batch.
function organizationStatements(
  database: BatchDatabase,
  organizationId: DirectoryOrganizationId,
  nameId: DirectoryNameId,
  displayName: string,
  now: string,
): SqlStatement[] {
  const normalizedDisplay = normalizeName(displayName);
  const codes = phoneticCodes(normalizedDisplay);
  return [
    insertOrganizationStatement(database, {
      id: organizationId,
      legalName: displayName,
      displayName,
      status: "active",
      needsReview: 0,
      createdAt: now,
    }),
    insertNameStatement(database, {
      id: nameId,
      entityId: organizationId,
      entityKind: "organization",
      nameRole: "current",
      prefix: null,
      given: null,
      middle: null,
      family: null,
      suffix: null,
      normalizedDisplay,
      isCurrent: true,
      validFrom: now,
      validTo: null,
      createdAt: now,
    }),
    ...insertPhoneticCodeStatements(database, nameId, codes),
  ];
}

// Build the statements that create a person entity from a legacy display string. A blank or
// whitespace-only name yields a provisional person — all name fields null, needs_review=1, no name
// row to seed the conflicts corpus with — flagged for a clerk to complete. A non-blank name splits on
// the first space (given before, family after; a single token is the family name).
function personStatements(
  database: BatchDatabase,
  personId: DirectoryPersonId,
  nameId: DirectoryNameId,
  displayName: string,
  now: string,
): SqlStatement[] {
  const trimmed = displayName.trim();

  if (trimmed.length === 0) {
    // Provisional: nothing trustworthy to structure or to index. Just the entity row, flagged.
    return [
      insertPersonStatement(database, {
        id: personId,
        prefix: null,
        given: null,
        middle: null,
        family: null,
        suffix: null,
        displayName: "",
        status: "active",
        needsReview: 1,
        createdAt: now,
      }),
    ];
  }

  const firstSpace = trimmed.indexOf(" ");
  const given = firstSpace === -1 ? null : trimmed.slice(0, firstSpace).trim();
  const family = firstSpace === -1 ? trimmed : trimmed.slice(firstSpace + 1).trim();

  const normalizedDisplay = normalizeName(trimmed);
  // Phonetics block on the family name (the surname is the conflicts-blocking token), falling back to
  // the whole string when there is no separate given part.
  const phoneticSource = family.length > 0 ? family : trimmed;
  const codes = phoneticCodes(normalizeName(phoneticSource));

  return [
    insertPersonStatement(database, {
      id: personId,
      prefix: null,
      given: given && given.length > 0 ? given : null,
      middle: null,
      family: family.length > 0 ? family : null,
      suffix: null,
      displayName: trimmed,
      status: "active",
      needsReview: 0,
      createdAt: now,
    }),
    insertNameStatement(database, {
      id: nameId,
      entityId: personId,
      entityKind: "person",
      nameRole: "current",
      prefix: null,
      given: given && given.length > 0 ? given : null,
      middle: null,
      family: family.length > 0 ? family : null,
      suffix: null,
      normalizedDisplay,
      isCurrent: true,
      validFrom: now,
      validTo: null,
      createdAt: now,
    }),
    ...insertPhoneticCodeStatements(database, nameId, codes),
  ];
}

// Backfills the 1·1 display-only client fields into the directory: for every matter carrying a
// client_display_name, find-or-create a directory entity (organization vs person by the suffix
// heuristic; blank → a provisional needs_review person) and link it as role='client'.
//
// The migration never deduplicates on a bare display string — two matters with the same name get two
// distinct entities, because a string match is not identity (auto-merge on a name is exactly what the
// directory exists to prevent). It is idempotent: a matter that already has a client link is skipped,
// so a re-run is a no-op.
export async function migrateClientDisplayFields(
  database: BatchDatabase,
  options: DirectoryWriteOptions,
): Promise<void> {
  const { results: matters } = await database
    .prepare(
      `SELECT id, client_display_name FROM matter WHERE client_display_name IS NOT NULL ORDER BY id ASC`,
    )
    .all<LegacyMatterRow>();

  for (const matterRow of matters) {
    const displayName = matterRow.client_display_name;
    if (displayName === null) continue;

    // Idempotency guard: a matter that already has a client party is left untouched.
    const { results: existing } = await database
      .prepare(
        `SELECT id FROM matter_party WHERE matter_id = ?1 AND role = 'client' AND deleted_at IS NULL LIMIT 1`,
      )
      .bind(matterRow.id)
      .all<{ id: string }>();
    if (existing.length > 0) continue;

    const now = options.clock.now();
    // Pre-minted for both org and non-blank-person paths; blank-person path emits no name row
    // but the identifier is consumed by the random sequence to keep downstream seeds stable.
    const nameId: DirectoryNameId = newIdentifier("directoryName", options.randomSource);
    const matterPartyId: MatterPartyId = newIdentifier("matterParty", options.randomSource);

    const trimmed = displayName.trim();
    const isOrganization = trimmed.length > 0 && ORGANIZATION_SUFFIX_PATTERN.test(trimmed);

    let entityId: string;
    let entityStatements: SqlStatement[];
    let auditEvent: string;
    if (isOrganization) {
      const organizationId = newIdentifier("directoryOrganization", options.randomSource);
      entityId = organizationId;
      entityStatements = organizationStatements(database, organizationId, nameId, trimmed, now);
      auditEvent = "directory.organization.created";
    } else {
      const personId = newIdentifier("directoryPerson", options.randomSource);
      entityId = personId;
      entityStatements = personStatements(database, personId, nameId, trimmed, now);
      auditEvent = "directory.person.created";
    }

    const statements: SqlStatement[] = [
      ...entityStatements,
      database
        .prepare(
          `INSERT INTO matter_party (id, matter_id, entity_id, role, valid_from, valid_to, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, 'client', NULL, NULL, ?4, ?4, NULL)`,
        )
        .bind(matterPartyId, matterRow.id, entityId, now),
      directoryAuditStatement(database, options, auditEvent, entityId),
      directoryAuditStatement(database, options, "directory.matter_party.linked", matterPartyId),
    ];

    await commitEffectBatch(database, { statements, outboxMessages: [] }, { now: () => now });
  }
}
