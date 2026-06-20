import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CustomFieldId, CustomFieldValueId } from "@magna-carta/identifiers/types";
import { customFieldAuditStatement } from "./audit.ts";
import { classifyCoercion, type CoercedValue, type RawStoredValue } from "./coercion.ts";
import {
  flipCurrentValueStatement,
  insertCurrentValueStatement,
} from "./custom-field-value-statements.ts";
import { updateCustomFieldFlagsStatement } from "./custom-field-statements.ts";
import {
  runCustomFieldEffect,
  type CustomFieldWriteOptions,
  type ReplayFlag,
} from "./run-custom-field-effect.ts";
import { CustomFieldError, type CustomFieldKind } from "./types.ts";

// One field's current value, paired with its target row, ready to classify for a kind change.
interface CurrentValueForConvert {
  readonly targetRowId: string;
  readonly raw: RawStoredValue;
}

// A custom_field_value row as read for conversion. The picklist label rides along from the joined
// picklist_option.name so toRaw can rebuild the RawStoredValue without a second query.
interface ConvertValueDbRow {
  readonly targetRowId: string;
  readonly value_text: string | null;
  readonly value_number: number | null;
  readonly value_date: string | null;
  readonly value_option_id: string | null;
  readonly value_reference_id: string | null;
  readonly option_label: string | null;
}

// The kind families that share each storage column, so a stored value can be mapped back to the
// RawStoredValue variant the classifier expects using the field's current kind as the discriminant.
const TEXT_FAMILY: readonly CustomFieldKind[] = ["single-line", "multi-line", "url", "email"];
const NUMBER_FAMILY: readonly CustomFieldKind[] = ["number", "currency"];
const DATE_FAMILY: readonly CustomFieldKind[] = ["date", "time"];

// Rebuild the classifier's RawStoredValue from the populated storage column, discriminated by the
// field's current kind. A picklist row carries its label from the joined picklist_option.name.
function toRaw(row: ConvertValueDbRow, fromKind: CustomFieldKind): RawStoredValue {
  if (TEXT_FAMILY.includes(fromKind)) {
    return {
      kind: fromKind as "single-line" | "multi-line" | "url" | "email",
      text: row.value_text ?? "",
    };
  }
  if (NUMBER_FAMILY.includes(fromKind)) {
    return { kind: fromKind as "number" | "currency", number: row.value_number ?? 0 };
  }
  if (DATE_FAMILY.includes(fromKind)) {
    return { kind: fromKind as "date" | "time", date: row.value_date ?? "" };
  }
  if (fromKind === "checkbox") {
    return { kind: "checkbox", checkbox: row.value_number ?? 0 };
  }
  if (fromKind === "matter-reference" || fromKind === "contact-reference") {
    // Reference kinds carry no coercible scalar — they cannot be converted to another kind.
    // Throwing here makes the restriction explicit rather than silently falling through to a
    // picklist-shaped raw value that the classifier would park (masking the real problem).
    throw new Error(
      `reference kinds are not convertible: cannot retype a ${fromKind} field to another kind`,
    );
  }
  // picklist: label text is the coercible scalar.
  return { kind: "picklist", optionLabel: row.option_label ?? "" };
}

// The five value columns of custom_field_value, all null. A coerced value populates exactly one,
// satisfying the table's one-value CHECK constraint.
type ValueColumns = Pick<
  Parameters<typeof insertCurrentValueStatement>[1],
  "valueText" | "valueNumber" | "valueDate" | "valueOptionId" | "valueReferenceId"
>;

const EMPTY_VALUE_COLUMNS: ValueColumns = {
  valueText: null,
  valueNumber: null,
  valueDate: null,
  valueOptionId: null,
  valueReferenceId: null,
};

// Map a CoercedValue onto the single InsertValueRow column it targets. A typed switch over the
// discriminant — no dynamic key, no cast — so the storage column and its value stay in lockstep.
function columnsFromCoerced(coerced: CoercedValue): ValueColumns {
  switch (coerced.column) {
    case "value_text":
      return { ...EMPTY_VALUE_COLUMNS, valueText: coerced.text };
    case "value_number":
      return { ...EMPTY_VALUE_COLUMNS, valueNumber: coerced.number };
    case "value_date":
      return { ...EMPTY_VALUE_COLUMNS, valueDate: coerced.date };
  }
}

async function loadCurrentValues(
  database: BatchDatabase,
  fieldId: CustomFieldId,
  fromKind: CustomFieldKind,
): Promise<CurrentValueForConvert[]> {
  const { results } = await database
    .prepare(
      `SELECT value.target_row_id AS targetRowId, value.value_text, value.value_number, value.value_date, value.value_option_id, value.value_reference_id, option.name AS option_label
       FROM custom_field_value AS value
       LEFT JOIN picklist_option AS option ON option.id = value.value_option_id
       WHERE value.field_id = ?1 AND value.is_current = 1`,
    )
    .bind(fieldId)
    .all<ConvertValueDbRow>();
  return results.map((row) => ({ targetRowId: row.targetRowId, raw: toRaw(row, fromKind) }));
}

async function fieldKind(
  database: BatchDatabase,
  fieldId: CustomFieldId,
): Promise<CustomFieldKind> {
  const { results } = await database
    .prepare(`SELECT kind FROM custom_field WHERE id = ?1`)
    .bind(fieldId)
    .all<{ kind: CustomFieldKind }>();
  const row = results[0];
  if (!row) throw new CustomFieldError("unknown-field", "No such custom field.");
  return row.kind;
}

// Count how each current value would land under a kind change without writing anything: a clean
// mechanical coercion, a value that needs an admin-confirmed rule, or one with no path (parked).
export async function previewConvert(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId; toKind: CustomFieldKind },
): Promise<{ clean: number; needsRule: number; parked: { targetRowId: string }[] }> {
  const fromKind = await fieldKind(database, input.fieldId);
  const values = await loadCurrentValues(database, input.fieldId, fromKind);
  let clean = 0;
  let needsRule = 0;
  const parked: { targetRowId: string }[] = [];
  for (const value of values) {
    const classification = classifyCoercion(value.raw, fromKind, input.toKind);
    if (classification.outcome === "clean") clean += 1;
    else if (classification.outcome === "needs-rule") needsRule += 1;
    else parked.push({ targetRowId: value.targetRowId });
  }
  return { clean, needsRule, parked };
}

// A field with at most this many current values has its Apply run inline in one effect-batch; above
// it, the route sets converting = 1 and offloads the coercion to the Queue-driven background pass. The
// ceiling is calibrated against the load profile: the per-field convert preview scan (the same load +
// classify Apply performs) measures well under a millisecond over a field carrying one value per record
// of its type, and Apply adds two statements per clean value to one batch. 500 keeps the inline batch
// within a request's work budget with wide margin while covering every realistic per-field value count
// (the firm volume profile's busiest single-field corpus is far smaller); only a field retyped across a
// very large record population crosses it and earns the background pass. Re-derive against the load
// profile, never raise on a guess.
export const CONVERT_INLINE_VALUE_LIMIT = 500;

// Retype a field non-destructively. Every original current row is flipped to history; clean values
// gain a freshly coerced current row; parked values are left cleared (their history endures, so the
// change is reversible). The whole batch commits atomically with the kind update and one audit event.
//
// The bulk path runs this same work in a Queue consumer after the route sets converting = 1 once a
// field's current-value count crosses CONVERT_INLINE_VALUE_LIMIT. Inline, Apply is bounded by the
// field's current value count under that ceiling.
export async function applyConvert(
  database: BatchDatabase,
  input: {
    fieldId: CustomFieldId;
    toKind: CustomFieldKind;
    parkedDisposition: "park" | "block";
  },
  options: CustomFieldWriteOptions,
): Promise<{ ok: true } & ReplayFlag> {
  const fromKind = await fieldKind(database, input.fieldId);
  const values = await loadCurrentValues(database, input.fieldId, fromKind);
  const classified = values.map((value) => ({
    value,
    classification: classifyCoercion(value.raw, fromKind, input.toKind),
  }));

  if (
    input.parkedDisposition === "block" &&
    classified.some(
      (entry) =>
        entry.classification.outcome === "parked" || entry.classification.outcome === "needs-rule",
    )
  ) {
    throw new CustomFieldError(
      "convert-has-parked-values",
      "Some values cannot be converted automatically (parked or unresolved). Resolve or re-rule them, or choose to park them.",
    );
  }

  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => {
    const now = options.clock.now();
    const statements: SqlStatement[] = [];
    for (const { value, classification } of classified) {
      // Every original current row moves to history, whatever its outcome.
      statements.push(flipCurrentValueStatement(database, input.fieldId, value.targetRowId, now));
      if (classification.outcome === "clean") {
        // A clean value gains a new coerced current row.
        const valueId = newIdentifier(
          "customFieldValue",
          options.randomSource,
        ) as CustomFieldValueId;
        statements.push(
          insertCurrentValueStatement(database, {
            id: valueId,
            fieldId: input.fieldId,
            targetRowId: value.targetRowId,
            ...columnsFromCoerced(classification.coerced),
            now,
            createdBy: options.actorUserId,
          }),
        );
      }
      // needs-rule (without a confirmed rule) and parked: the original is now history and no new
      // current row replaces it, so the value reads as cleared until it is resolved manually.
    }
    statements.push(
      updateCustomFieldFlagsStatement(database, input.fieldId, { kind: input.toKind }),
    );
    statements.push(
      customFieldAuditStatement(database, options, "custom_field.kind_changed", input.fieldId),
    );
    return { statements, outboxMessages: [], value: { ok: true } };
  });
}
