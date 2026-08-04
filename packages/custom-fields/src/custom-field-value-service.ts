import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CustomFieldId, CustomFieldValueId } from "@magna-carta/identifiers/types";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { customFieldAuditStatement } from "./audit.ts";
import { MAX_VALUE_TEXT_LENGTH } from "./limits.ts";
import { runCustomFieldEffect, type CustomFieldWriteOptions } from "./run-custom-field-effect.ts";
import {
  flipCurrentValueStatement,
  insertCurrentValueStatement,
} from "./custom-field-value-statements.ts";
import { CustomFieldError, type CustomFieldKind } from "./types.ts";

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

// The field kinds each value shape may be written to. A value is only "typed" if the write checks it
// against the definition — otherwise a text value lands in a currency field's record and nothing in
// the engine ever notices.
const KINDS_FOR_VALUE_SHAPE: Record<CustomFieldValueInput["kind"], readonly CustomFieldKind[]> = {
  text: ["single-line", "multi-line", "url", "email"],
  number: ["number", "currency", "checkbox"],
  date: ["date", "time"],
  picklist: ["picklist"],
  reference: ["matter-reference", "contact-reference"],
};

// The definition a value write is validated against, read once per call.
interface CustomFieldDefinitionForWrite {
  readonly kind: CustomFieldKind;
  readonly numberScale: number | null;
  readonly archived: number;
}

async function loadDefinitionForWrite(
  database: BatchDatabase,
  fieldId: CustomFieldId,
): Promise<CustomFieldDefinitionForWrite> {
  const { results } = await database
    .prepare(`SELECT kind, number_scale AS numberScale, archived FROM custom_field WHERE id = ?1`)
    .bind(fieldId)
    .all<CustomFieldDefinitionForWrite>();
  const definition = results[0];
  if (!definition) {
    throw new CustomFieldError(
      "unknown-field",
      "No such custom field: a value cannot be stored against a field that does not exist.",
    );
  }
  if (definition.archived === 1) {
    throw new CustomFieldError(
      "field-archived",
      "This field is archived: its stored values stay readable, but no new value can be written until it is restored.",
    );
  }
  return definition;
}

// Everything the definition declares about a value, enforced before a statement is composed: the value
// shape agrees with the field's kind, a numeric value is a whole count of the minor units the field
// stores (the decimal-to-integer scaling is the route's job — see the package CLAUDE.md — so anything
// fractional arriving here is a scaling mistake, not a value), and text stays inside the per-value
// ceiling that keeps bulk content out of D1.
function assertValueAgreesWithDefinition(
  definition: CustomFieldDefinitionForWrite,
  value: CustomFieldValueInput,
): void {
  const allowedKinds = KINDS_FOR_VALUE_SHAPE[value.kind];
  if (!allowedKinds.includes(definition.kind)) {
    throw new CustomFieldError(
      "value-kind-mismatch",
      `A ${value.kind} value cannot be stored on a ${definition.kind} field.`,
    );
  }
  if (value.kind === "reference" && value.referenceKind !== definition.kind) {
    throw new CustomFieldError(
      "value-kind-mismatch",
      `A ${value.referenceKind} value cannot be stored on a ${definition.kind} field.`,
    );
  }
  if (value.kind === "number" && !Number.isSafeInteger(value.number)) {
    throw new CustomFieldError(
      "value-not-a-scaled-integer",
      `A ${definition.kind} value is stored as a whole number of minor units; ${value.number} is not one.`,
    );
  }
  if (
    value.kind === "number" &&
    definition.kind === "checkbox" &&
    value.number !== 0 &&
    value.number !== 1
  ) {
    throw new CustomFieldError(
      "value-kind-mismatch",
      `A checkbox value is 0 or 1; ${value.number} is neither.`,
    );
  }
  if (value.kind === "text" && value.text.length > MAX_VALUE_TEXT_LENGTH) {
    throw new CustomFieldError(
      "value-text-too-long",
      `A custom-field text value may hold at most ${MAX_VALUE_TEXT_LENGTH} characters.`,
    );
  }
}

// A picklist value names an option, so the option has to exist, belong to THIS field, and still be a
// choice. An option handle that satisfies none of those stores a value that renders blank and reads as
// an empty string wherever the option label is joined — the value is destroyed at the moment it is
// written, silently.
async function assertPicklistOptionIsWritable(
  database: BatchDatabase,
  fieldId: CustomFieldId,
  optionId: string,
): Promise<void> {
  const { results } = await database
    .prepare(`SELECT field_id AS fieldId, archived FROM picklist_option WHERE id = ?1`)
    .bind(optionId)
    .all<{ fieldId: string; archived: number }>();
  const option = results[0];
  if (!option || option.fieldId !== fieldId) {
    throw new CustomFieldError(
      "unknown-picklist-option",
      `Option ${optionId} is not an option of this field.`,
    );
  }
  if (option.archived === 1) {
    throw new CustomFieldError(
      "picklist-option-archived",
      `Option ${optionId} is archived and can no longer be chosen; existing values keep it.`,
    );
  }
}

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
  // Everything the write is checked against is read up front — D1 has no interactive transactions, so
  // no read may happen once the batch is being composed.
  const definition = await loadDefinitionForWrite(database, input.fieldId);
  assertValueAgreesWithDefinition(definition, input.value);
  if (input.value.kind === "picklist") {
    await assertPicklistOptionIsWritable(database, input.fieldId, input.value.optionId);
  }
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
