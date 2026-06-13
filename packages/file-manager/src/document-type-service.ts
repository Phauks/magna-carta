import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DocumentTypeId } from "@magna-carta/identifiers/types";
import { fileAuditStatement, type AuditContext } from "./audit.ts";
import {
  deactivateDocumentTypeStatement,
  insertDocumentTypeStatement,
  selectDocumentTypeIdByCodeStatement,
  selectDocumentTypeIdByNameStatement,
  selectDocumentTypeStatement,
  updateDocumentTypeStatement,
} from "./document-type-statements.ts";
import { FileManagerValidationError } from "./validation.ts";

// Document types mirror matter types: per-firm classification labels, soft-deactivate only, name/code
// uniqueness pre-checked as named codes with the UNIQUE indexes as backstop.
export type DocumentTypeServiceOptions = AuditContext;

interface StoredDocumentType {
  readonly id: DocumentTypeId;
  readonly name: string;
  readonly code: string | null;
  readonly active: number;
}

async function loadDocumentType(
  database: SqlDatabase,
  id: DocumentTypeId,
): Promise<StoredDocumentType | undefined> {
  const { results } = await selectDocumentTypeStatement(database, id).all<StoredDocumentType>();
  return results[0];
}

async function assertNameAvailable(
  database: SqlDatabase,
  name: string,
  excludeId?: DocumentTypeId,
): Promise<void> {
  const { results } = await selectDocumentTypeIdByNameStatement(database, name).all<{
    id: DocumentTypeId;
  }>();
  if (results.some((row) => row.id !== excludeId)) {
    throw new FileManagerValidationError(
      "document-type-name-taken",
      `document type name already in use: ${name}`,
    );
  }
}

async function assertCodeAvailable(
  database: SqlDatabase,
  code: string,
  excludeId?: DocumentTypeId,
): Promise<void> {
  const { results } = await selectDocumentTypeIdByCodeStatement(database, code).all<{
    id: DocumentTypeId;
  }>();
  if (results.some((row) => row.id !== excludeId)) {
    throw new FileManagerValidationError(
      "document-type-code-taken",
      `document type code already in use: ${code}`,
    );
  }
}

export async function createDocumentType(
  database: SqlDatabase,
  input: { name: string; code?: string | null },
  options: DocumentTypeServiceOptions,
): Promise<{ documentTypeId: DocumentTypeId; effect: EffectWrite }> {
  if (input.name.trim().length === 0) {
    throw new FileManagerValidationError(
      "empty-document-type-name",
      "a document type needs a name",
    );
  }
  const code = input.code ?? null;
  await assertNameAvailable(database, input.name);
  if (code !== null) await assertCodeAvailable(database, code);
  const documentTypeId = newIdentifier("documentType", options.randomSource);
  return {
    documentTypeId,
    effect: {
      statements: [
        insertDocumentTypeStatement(database, {
          id: documentTypeId,
          name: input.name,
          code,
          createdAt: options.clock.now(),
        }),
        fileAuditStatement(database, options, "documentType.created", documentTypeId),
      ],
      outboxMessages: [],
    },
  };
}

export async function updateDocumentType(
  database: SqlDatabase,
  documentTypeId: DocumentTypeId,
  patch: { name?: string; code?: string | null },
  options: DocumentTypeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await loadDocumentType(database, documentTypeId);
  if (existing === undefined) {
    throw new FileManagerValidationError(
      "unknown-document-type",
      `no such document type: ${documentTypeId}`,
    );
  }
  const name = patch.name ?? existing.name;
  if (name.trim().length === 0) {
    throw new FileManagerValidationError(
      "empty-document-type-name",
      "a document type needs a name",
    );
  }
  const code = patch.code !== undefined ? patch.code : existing.code;
  if (name !== existing.name) await assertNameAvailable(database, name, documentTypeId);
  if (code !== null && code !== existing.code) {
    await assertCodeAvailable(database, code, documentTypeId);
  }
  return {
    effect: {
      statements: [
        updateDocumentTypeStatement(database, documentTypeId, name, code, options.clock.now()),
        fileAuditStatement(database, options, "documentType.updated", documentTypeId),
      ],
      outboxMessages: [],
    },
  };
}

export async function deactivateDocumentType(
  database: SqlDatabase,
  documentTypeId: DocumentTypeId,
  options: DocumentTypeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await loadDocumentType(database, documentTypeId);
  if (existing === undefined) {
    throw new FileManagerValidationError(
      "unknown-document-type",
      `no such document type: ${documentTypeId}`,
    );
  }
  return {
    effect: {
      statements: [
        deactivateDocumentTypeStatement(database, documentTypeId, options.clock.now()),
        fileAuditStatement(database, options, "documentType.deactivated", documentTypeId),
      ],
      outboxMessages: [],
    },
  };
}
