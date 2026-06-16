import {
  createClassificationTypeService,
  type ClassificationTypeServiceOptions,
} from "@magna-carta/data-access/classification-type-service";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { DocumentTypeId } from "@magna-carta/identifiers/types";
import {
  deactivateDocumentTypeStatement,
  insertDocumentTypeStatement,
  selectDocumentTypeIdByCodeStatement,
  selectDocumentTypeIdByNameStatement,
  selectDocumentTypeStatement,
  updateDocumentTypeStatement,
} from "./document-type-statements.ts";
import { FileManagerValidationError, type FileManagerValidationCode } from "./validation.ts";

// Document types mirror matter types: per-firm classification labels, soft-deactivate only, name/code
// uniqueness pre-checked as named codes with the UNIQUE indexes as backstop. They are one instance of
// the shared classification-type shape — the behavior lives in
// @magna-carta/data-access/classification-type-service; this module binds it to the document_type
// table and the File Manager validation error.

export type DocumentTypeServiceOptions = ClassificationTypeServiceOptions;

const service = createClassificationTypeService({
  statements: {
    select: selectDocumentTypeStatement,
    selectIdByName: selectDocumentTypeIdByNameStatement,
    selectIdByCode: selectDocumentTypeIdByCodeStatement,
    insert: insertDocumentTypeStatement,
    update: updateDocumentTypeStatement,
    deactivate: deactivateDocumentTypeStatement,
  },
  idEntityType: "documentType",
  eventPrefix: "documentType",
  noun: "document type",
  errorCodes: {
    emptyName: "empty-document-type-name",
    nameTaken: "document-type-name-taken",
    codeTaken: "document-type-code-taken",
    unknown: "unknown-document-type",
  },
  makeValidationError: (code, message) =>
    new FileManagerValidationError(code as FileManagerValidationCode, message),
});

export async function createDocumentType(
  database: SqlDatabase,
  input: { name: string; code?: string | null },
  options: DocumentTypeServiceOptions,
): Promise<{ documentTypeId: DocumentTypeId; effect: EffectWrite }> {
  const { id, effect } = await service.create(database, input, options);
  return { documentTypeId: id, effect };
}

export function updateDocumentType(
  database: SqlDatabase,
  documentTypeId: DocumentTypeId,
  patch: { name?: string; code?: string | null },
  options: DocumentTypeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  return service.update(database, documentTypeId, patch, options);
}

export function deactivateDocumentType(
  database: SqlDatabase,
  documentTypeId: DocumentTypeId,
  options: DocumentTypeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  return service.deactivate(database, documentTypeId, options);
}
