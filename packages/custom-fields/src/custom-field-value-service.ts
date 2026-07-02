import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CustomFieldId, CustomFieldValueId } from "@magna-carta/identifiers/types";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { customFieldAuditStatement } from "./audit.ts";
import { runCustomFieldEffect, type CustomFieldWriteOptions } from "./run-custom-field-effect.ts";
import {
  flipCurrentValueStatement,
  insertCurrentValueStatement,
} from "./custom-field-value-statements.ts";
import { CustomFieldError } from "./types.ts";

export type CustomFieldValueInput =
  | { kind: "text"; text: string }
  | { kind: "number"; number: number }
  | { kind: "date"; date: string }
  | { kind: "picklist"; optionId: string }
  | {
      kind: "reference";
      referenceId: string;
      referenceKind: "matter-reference" | "contact-reference";
    };

function columnsFor(value: CustomFieldValueInput) {
  const empty = {
    valueText: null,
    valueNumber: null,
    valueDate: null,
    valueOptionId: null,
    valueReferenceId: null,
  };
  switch (value.kind) {
    case "text":
      return { ...empty, valueText: value.text };
    case "number":
      return { ...empty, valueNumber: value.number };
    case "date":
      return { ...empty, valueDate: value.date };
    case "picklist":
      return { ...empty, valueOptionId: value.optionId };
    case "reference": {
      const ok =
        value.referenceKind === "matter-reference"
          ? value.referenceId.startsWith("matter_")
          : value.referenceId.startsWith("directoryPerson_") ||
            value.referenceId.startsWith("directoryOrganization_");
      if (!ok)
        throw new CustomFieldError(
          "reference-kind-handle-mismatch",
          `Handle ${value.referenceId} is not valid for ${value.referenceKind}.`,
        );
      return { ...empty, valueReferenceId: value.referenceId };
    }
  }
}

export async function setCustomFieldValue(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId; targetRowId: string; value: CustomFieldValueInput },
  options: CustomFieldWriteOptions,
) {
  const columns = columnsFor(input.value); // throws on a bad reference handle before any write
  const valueId = newIdentifier("customFieldValue", options.randomSource) as CustomFieldValueId;
  return runCustomFieldEffect<{ customFieldValueId: CustomFieldValueId }>(
    database,
    options,
    200,
    () => {
      const now = options.clock.now();
      return {
        statements: [
          flipCurrentValueStatement(database, input.fieldId, input.targetRowId, now),
          insertCurrentValueStatement(database, {
            id: valueId,
            fieldId: input.fieldId,
            targetRowId: input.targetRowId,
            ...columns,
            now,
            createdBy: options.actorUserId,
          }),
          customFieldAuditStatement(database, options, "custom_field.value_set", valueId),
        ],
        outboxMessages: [],
        value: { customFieldValueId: valueId },
      };
    },
  );
}

export async function clearCustomFieldValue(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId; targetRowId: string },
  options: CustomFieldWriteOptions,
) {
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      flipCurrentValueStatement(database, input.fieldId, input.targetRowId, options.clock.now()),
      customFieldAuditStatement(database, options, "custom_field.value_cleared", input.fieldId),
    ],
    outboxMessages: [],
    value: { ok: true as const },
  }));
}
