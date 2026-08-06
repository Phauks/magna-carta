import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  DocumentTemplateId,
  DocumentTemplateVersionId,
  LocationId,
  MatterTypeId,
  UserId,
} from "@magna-carta/identifiers/types";
import { confirmFieldMappingStatements } from "./field-mapping-statements.ts";
import {
  archiveDocumentTemplateStatement,
  insertDocumentTemplateStatement,
  insertDocumentTemplateVersionStatement,
  insertTemplateFieldBindingStatements,
  readNextTemplateVersionNumber,
} from "./template-statements.ts";
import type { TemplatePreparation } from "./register.ts";
import { manifestKeys } from "./types.ts";

// The catalogue's write paths, composed as effects rather than executed here: the caller commits them
// through the one atomic-batch chokepoint, so the rows and their audit entry ride a single commit and a
// rolled-back batch leaves no half-registered template behind.

// Template objects live under this R2 prefix, which is also the storage-meter prefix dimension they
// meter under — so template bytes are visible in a firm's usage without a second metering mechanism.
export const TEMPLATE_OBJECT_PREFIX = "templates/";

export function templateVersionObjectKey(
  templateId: DocumentTemplateId,
  versionId: DocumentTemplateVersionId,
): string {
  return `${TEMPLATE_OBJECT_PREFIX}${templateId}/${versionId}`;
}

export interface TemplateServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

export interface RegisterTemplateInput {
  readonly name: string;
  readonly description: string | null;
  readonly matterTypeId: MatterTypeId | null;
  readonly locationId: LocationId | null;
  readonly preparation: TemplatePreparation;
  readonly contentSha256: string;
}

export interface RegisteredTemplate {
  readonly templateId: DocumentTemplateId;
  readonly versionId: DocumentTemplateVersionId;
  readonly r2Key: string;
  readonly effect: EffectWrite;
}

function versionStatements(
  database: SqlDatabase,
  templateId: DocumentTemplateId,
  versionId: DocumentTemplateVersionId,
  versionNumber: number,
  input: RegisterTemplateInput,
  options: TemplateServiceOptions,
): SqlStatement[] {
  return [
    insertDocumentTemplateVersionStatement(database, {
      id: versionId,
      templateId,
      versionNumber,
      r2Key: templateVersionObjectKey(templateId, versionId),
      sizeBytes: input.preparation.bytes.byteLength,
      contentSha256: input.contentSha256,
      fieldManifestJson: JSON.stringify(input.preparation.manifest),
      normalizationWarningsJson: JSON.stringify(input.preparation.warnings),
      normalizerVersion: input.preparation.normalizerVersion,
      macroPartsRemoved: input.preparation.removedMacroParts.length,
      createdBy: options.actorUserId,
      createdAt: options.clock.now(),
    }),
    // The binding index, written in the SAME BATCH as the version it derives from. The keys come from
    // every site the manifest records — plain placeholders, block conditions, and computed fields
    // alike — because "which templates break if this key goes away" has to mean all of them, not only
    // the ones that print it.
    ...insertTemplateFieldBindingStatements(
      database,
      versionId,
      manifestKeys(input.preparation.manifest),
    ),
    // The mappings this registration's conversion confirmed ride the same commit as the version they
    // came from: a library entry that survived a rolled-back registration would claim the firm confirmed
    // something it never successfully registered.
    ...confirmFieldMappingStatements(
      database,
      input.preparation.confirmedMergeFieldMappings.map((mapping) => ({
        fieldName: mapping.fieldName,
        mergeKey: mapping.mergeKey,
      })),
      options,
    ),
  ];
}

// Register a new template plus its first version. The version is `pending` until the ingest gate clears
// its stored bytes; the catalogue row's current_version_id stays null until then, so a template is never
// assemblable from bytes nothing has scanned.
export function composeTemplateRegistration(
  database: SqlDatabase,
  input: RegisterTemplateInput,
  options: TemplateServiceOptions,
): RegisteredTemplate {
  const templateId = newIdentifier("documentTemplate", options.randomSource);
  const versionId = newIdentifier("documentTemplateVersion", options.randomSource);
  const now = options.clock.now();
  const statements: SqlStatement[] = [
    insertDocumentTemplateStatement(database, {
      id: templateId,
      name: input.name,
      description: input.description,
      matterTypeId: input.matterTypeId,
      locationId: input.locationId,
      createdBy: options.actorUserId,
      createdAt: now,
    }),
    ...versionStatements(database, templateId, versionId, 1, input, options),
    domainAuditStatement(database, {
      event: "documentTemplate.registered",
      subjectId: templateId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      // Non-privileged counts only: how many fields the template declares and how many macro payloads
      // were removed from it. Never a field key, never a name, never any template content.
      metadata: {
        fieldCount: input.preparation.manifest.fields.length,
        macroPartsRemoved: input.preparation.removedMacroParts.length,
      },
    }),
  ];
  return {
    templateId,
    versionId,
    r2Key: templateVersionObjectKey(templateId, versionId),
    effect: { statements, outboxMessages: [] },
  };
}

// A new version of an existing template. A template is never edited in place; the catalogue row's
// pointer moves once the new version's bytes clear the gate, and superseded versions stay readable
// because an assembly records the exact version it used.
export async function composeTemplateVersionRegistration(
  database: SqlDatabase,
  templateId: DocumentTemplateId,
  input: RegisterTemplateInput,
  options: TemplateServiceOptions,
): Promise<RegisteredTemplate> {
  const versionId = newIdentifier("documentTemplateVersion", options.randomSource);
  const versionNumber = await readNextTemplateVersionNumber(database, templateId);
  const statements: SqlStatement[] = [
    ...versionStatements(database, templateId, versionId, versionNumber, input, options),
    domainAuditStatement(database, {
      event: "documentTemplate.versioned",
      subjectId: versionId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: {
        templateId,
        versionNumber,
        fieldCount: input.preparation.manifest.fields.length,
        macroPartsRemoved: input.preparation.removedMacroParts.length,
      },
    }),
  ];
  return {
    templateId,
    versionId,
    r2Key: templateVersionObjectKey(templateId, versionId),
    effect: { statements, outboxMessages: [] },
  };
}

export function composeTemplateArchive(
  database: SqlDatabase,
  templateId: DocumentTemplateId,
  options: TemplateServiceOptions,
): EffectWrite {
  const now = options.clock.now();
  return {
    statements: [
      archiveDocumentTemplateStatement(database, templateId, now),
      domainAuditStatement(database, {
        event: "documentTemplate.archived",
        subjectId: templateId,
        actorUserId: options.actorUserId,
        clock: options.clock,
        randomSource: options.randomSource,
      }),
    ],
    outboxMessages: [],
  };
}
