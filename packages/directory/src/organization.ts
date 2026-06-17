import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DirectoryNameId, DirectoryOrganizationId } from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.js";
import { normalizeName } from "./normalize-name.js";
import { phoneticCodes } from "./phonetics.js";
import {
  insertNameStatement,
  insertOrganizationStatement,
  insertPhoneticCodeStatements,
  selectOrganizationStatement,
  type OrganizationStatus,
} from "./statements.js";

// The caller-supplied fields for a new organization. legalName is the only required field;
// display_name defaults to legalName if not supplied. There is no idempotency context at this layer —
// that is threaded at the route boundary — so the batch carries no idempotency record.
export interface CreateOrganizationInput {
  readonly legalName: string;
  readonly displayName?: string | null;
}

// The typed organization projection returned by readOrganization.
export interface Organization {
  readonly id: DirectoryOrganizationId;
  readonly legalName: string | null;
  readonly displayName: string | null;
  readonly status: OrganizationStatus;
  readonly mergedIntoId: string | null;
}

export async function createOrganization(
  database: BatchDatabase,
  input: CreateOrganizationInput,
  options: DirectoryWriteOptions,
): Promise<DirectoryOrganizationId> {
  const organizationId = newIdentifier("directoryOrganization", options.randomSource);
  const nameId: DirectoryNameId = newIdentifier("directoryName", options.randomSource);
  const now = options.clock.now();

  const legalName = input.legalName.trim();
  const displayName = (input.displayName ?? legalName).trim();
  const normalizedDisplay = normalizeName(legalName);

  // Phonetic codes are computed on the full normalized legal name because the entire legal name
  // is the conflicts-blocking token for organizations — unlike persons (where only the family
  // name is encoded), an organization has no surname component, so omitting any part of the name
  // would reduce blocking precision. "Acme Legal Pty Ltd" and "Acme Holdings Pty Ltd" must block
  // separately, which requires encoding the full string.
  const codes = phoneticCodes(normalizedDisplay);

  const statements: SqlStatement[] = [
    insertOrganizationStatement(database, {
      id: organizationId,
      legalName,
      displayName,
      status: "active",
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
    directoryAuditStatement(database, options, "directory.organization.created", organizationId),
  ];

  await commitEffectBatch(
    database,
    {
      statements,
      outboxMessages: [{ topic: "directory.entity.created", payload: { organizationId } }],
    },
    { now: () => now },
  );

  return organizationId;
}

export async function readOrganization(
  database: BatchDatabase,
  organizationId: DirectoryOrganizationId,
): Promise<Organization> {
  const { results } = await selectOrganizationStatement(database, organizationId).all<{
    id: string;
    legal_name: string | null;
    display_name: string | null;
    status: OrganizationStatus;
    merged_into_id: string | null;
  }>();
  const row = results[0];
  if (!row) throw new Error(`directory organization not found: ${organizationId}`);
  return {
    id: row.id as DirectoryOrganizationId,
    legalName: row.legal_name,
    displayName: row.display_name,
    status: row.status,
    mergedIntoId: row.merged_into_id,
  };
}
