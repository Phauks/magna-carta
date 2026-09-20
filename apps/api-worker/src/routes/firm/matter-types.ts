import { MatterValidationError } from "@magna-carta/matters/validation";
import {
  createMatterType,
  deactivateMatterType,
  updateMatterType,
} from "@magna-carta/matters/matter-type-service";
import type { MatterTypeId } from "@magna-carta/identifiers/types";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  registerClassificationTypeRoutes,
  type ClassificationTypeRouteConfig,
} from "./classification-type-routes.ts";

// Matter types: per-firm classification rows (name + optional short code, soft-deactivate only). The
// matters package owns name/code uniqueness; reads are open to any authenticated firm member, writes
// require matters:manageTypes. One instance of the shared classification-type route shape — the
// behavior lives in classification-type-routes.ts; this binds it to the matters service and contract.

const config: ClassificationTypeRouteConfig = {
  pathPrefix: "matter-types",
  operationNamespace: "matterTypes",
  managePermission: "matters:manageTypes",
  managePermissionDescription: "The session member lacks matters:manageTypes",
  idEntityType: "matterType",
  tableName: "matter_type",
  noun: "matter type",
  schemaPrefix: "MatterType",
  descriptions: {
    create: "Creates a matter type (name plus an optional short code used by numbering schemes).",
    list: "Lists the firm's matter types (active and deactivated), ordered by name.",
    update: "Updates a matter type's name or code.",
    deactivate:
      "Soft-deactivates a matter type (historical matters keep their type; it is never deleted).",
  },
  service: {
    create: async (database, input, options) => {
      const created = await createMatterType(database, input, options);
      return { id: created.matterTypeId, effect: created.effect };
    },
    update: (database, id, patch, options) =>
      updateMatterType(database, id as MatterTypeId, patch, options),
    deactivate: (database, id, options) =>
      deactivateMatterType(database, id as MatterTypeId, options),
  },
  isValidationError: (error): error is MatterValidationError =>
    error instanceof MatterValidationError,
  errorCodes: {
    unknown: "unknown-matter-type",
    nameTaken: "type-name-taken",
    codeTaken: "type-code-taken",
  },
};

export function registerMatterTypesRoutes(
  app: Parameters<typeof registerClassificationTypeRoutes>[0],
  chokepoint: Chokepoint,
): void {
  registerClassificationTypeRoutes(app, chokepoint, config);
}
