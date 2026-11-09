import { FileManagerValidationError } from "@magna-carta/file-manager/validation";
import {
  createDocumentType,
  deactivateDocumentType,
  updateDocumentType,
} from "@magna-carta/file-manager/document-type-service";
import type { DocumentTypeId } from "@magna-carta/identifiers/types";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  registerClassificationTypeRoutes,
  type ClassificationTypeRouteConfig,
} from "./classification-type-routes.ts";

// Document types: per-firm document classification labels, mirroring matter types (soft-deactivate
// only, name/code uniqueness owned by the file-manager package). Reads are open to any authenticated
// firm member, writes require files:manageDocumentTypes. One instance of the shared classification-
// type route shape — the behavior lives in classification-type-routes.ts; this binds it to the
// file-manager service and contract.

const config: ClassificationTypeRouteConfig = {
  pathPrefix: "document-types",
  operationNamespace: "documentTypes",
  managePermission: "files:manageDocumentTypes",
  managePermissionDescription: "The session member lacks files:manageDocumentTypes",
  idEntityType: "documentType",
  tableName: "document_type",
  noun: "document type",
  schemaPrefix: "DocumentType",
  descriptions: {
    create:
      "Creates a document type (a per-firm document classification label with an optional code).",
    list: "Lists the firm's document types (active and deactivated), ordered by name.",
    update: "Updates a document type's name or code.",
    deactivate:
      "Soft-deactivates a document type (historical documents keep their type; it is never deleted).",
  },
  service: {
    create: async (database, input, options) => {
      const created = await createDocumentType(database, input, options);
      return { id: created.documentTypeId, effect: created.effect };
    },
    update: (database, id, patch, options) =>
      updateDocumentType(database, id as DocumentTypeId, patch, options),
    deactivate: (database, id, options) =>
      deactivateDocumentType(database, id as DocumentTypeId, options),
  },
  isValidationError: (error): error is FileManagerValidationError =>
    error instanceof FileManagerValidationError,
  errorCodes: {
    unknown: "unknown-document-type",
    nameTaken: "document-type-name-taken",
    codeTaken: "document-type-code-taken",
  },
};

export function registerDocumentTypesRoutes(
  app: Parameters<typeof registerClassificationTypeRoutes>[0],
  chokepoint: Chokepoint,
): void {
  registerClassificationTypeRoutes(app, chokepoint, config);
}
