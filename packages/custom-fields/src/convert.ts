import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CustomFieldId, CustomFieldValueId } from "@magna-carta/identifiers/types";
import { customFieldAuditStatement } from "./audit.ts";
import {
  classifyCoercion,
  type Classification,
  type CoercedValue,
  type CoercionScale,
  type RawStoredValue,
} from "./coercion.ts";
import { effectiveNumberScale } from "./number-scale.ts";
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
const TEXT_FAMILY: ReadonlySet<CustomFieldKind> = new Set<CustomFieldKind>([
  "single-line",
  "multi-line",
  "url",
  "email",
]);
const NUMBER_FAMILY: readonly CustomFieldKind[] = ["number", "currency"];
const DATE_FAMILY: readonly CustomFieldKind[] = ["date", "time"];

// Rebuild the classifier's RawStoredValue from the populated storage column, discriminated by the
// field's current kind. A picklist row carries its label from the joined picklist_option.name.
function toRaw(row: ConvertValueDbRow, fromKind: CustomFieldKind): RawStoredValue {
  if (TEXT_FAMILY.has(fromKind)) {
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

// The field facts a conversion is planned against: what the values are today, and what their digits
// mean. Read once up front — D1 has no interactive transactions, so nothing may be read mid-batch.
interface ConvertFieldDefinition {
  readonly kind: CustomFieldKind;
  readonly numberScale: number | null;
}

async function fieldDefinition(
  database: BatchDatabase,
  fieldId: CustomFieldId,
): Promise<ConvertFieldDefinition> {
  const { results } = await database
    .prepare(`SELECT kind, number_scale AS numberScale FROM custom_field WHERE id = ?1`)
    .bind(fieldId)
    .all<ConvertFieldDefinition>();
  const row = results[0];
  if (!row) throw new CustomFieldError("unknown-field", "No such custom field.");
  return row;
}

// A reference value is a handle into another table, not a scalar with a textual or numeric reading,
// so no coercion exists in either direction. Refusing up front — before any value is loaded — makes
// the answer the same for a field with a thousand values and one with none, and gives the route a
// typed refusal to map instead of an unhandled throw.
function assertConvertibleKinds(fromKind: CustomFieldKind, toKind: CustomFieldKind): void {
  const referenceKind =
    fromKind === "matter-reference" || fromKind === "contact-reference"
      ? fromKind
      : toKind === "matter-reference" || toKind === "contact-reference"
        ? toKind
        : null;
  if (referenceKind !== null) {
    throw new CustomFieldError(
      "reference-kind-not-convertible",
      `reference kinds are not convertible: a ${referenceKind} field cannot be retyped, and no other kind can be retyped to one.`,
    );
  }
}

// A field keeps its number_scale across a retype, so the target's minor-unit exponent is that same
// scale read under the new kind — which is exactly where the magnitude shifts: a plain number field
// (whole units) retyped to currency starts meaning cents, so 500 has to become 50000 to still be $500.
function conversionScale(
  definition: ConvertFieldDefinition,
  toKind: CustomFieldKind,
): CoercionScale {
  return {
    from: effectiveNumberScale(definition.kind, definition.numberScale),
    to: effectiveNumberScale(toKind, definition.numberScale),
  };
}

// One current value with the outcome it would land on under the kind change. Preview and apply both
// run this, so the counts an admin approves are produced by the same classification apply commits.
async function classifyCurrentValues(
  database: BatchDatabase,
  fieldId: CustomFieldId,
  toKind: CustomFieldKind,
): Promise<{ value: CurrentValueForConvert; classification: Classification }[]> {
  const definition = await fieldDefinition(database, fieldId);
  assertConvertibleKinds(definition.kind, toKind);
  const scale = conversionScale(definition, toKind);
  const values = await loadCurrentValues(database, fieldId, definition.kind);
  return values.map((value) => ({
    value,
    classification: classifyCoercion(value.raw, definition.kind, toKind, scale),
  }));
}

// Count how each current value would land under a kind change without writing anything: a clean
// mechanical coercion, a value that needs an admin-confirmed rule, or one with no path (parked).
export async function previewConvert(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId; toKind: CustomFieldKind },
): Promise<{ clean: number; needsRule: number; parked: { targetRowId: string }[] }> {
  const entries = await classifyCurrentValues(database, input.fieldId, input.toKind);
  let clean = 0;
  let needsRule = 0;
  const parked: { targetRowId: string }[] = [];
  for (const { value, classification } of entries) {
    if (classification.outcome === "clean") clean += 1;
    else if (classification.outcome === "needs-rule") needsRule += 1;
    else parked.push({ targetRowId: value.targetRowId });
  }
  return { clean, needsRule, parked };
}

// A field with at most this many current values has its Apply run inline in one effect-batch; above it
// Apply refuses, and the Queue-driven background pass (which will also set converting = 1) is what
// eventually serves those fields. The ceiling is calibrated against the load profile: the per-field convert preview scan (the same load +
// classify Apply performs) measures well under a millisecond over a field carrying one value per record
// of its type, and Apply adds two statements per clean value to one batch. 500 keeps the inline batch
// within a request's work budget with wide margin while covering every realistic per-field value count
// (the firm volume profile's busiest single-field corpus is far smaller); only a field retyped across a
// very large record population crosses it and earns the background pass. Re-derive against the load
// profile, never raise on a guess.
export const CONVERT_INLINE_VALUE_LIMIT = 500;

// Refuse before loading anything when the field carries more current values than one inline batch may
// hold. Until the Queue-driven background pass exists there is no other path, so the honest answer is
// a refusal — not an atomic batch of tens of thousands of statements that would exhaust the request's
// work budget and time out mid-retype.
async function assertWithinInlineConvertLimit(
  database: BatchDatabase,
  fieldId: CustomFieldId,
): Promise<void> {
  const { results } = await database
    .prepare(`SELECT COUNT(*) AS n FROM custom_field_value WHERE field_id = ?1 AND is_current = 1`)
    .bind(fieldId)
    .all<{ n: number }>();
  const count = results[0]?.n ?? 0;
  if (count > CONVERT_INLINE_VALUE_LIMIT) {
    throw new CustomFieldError(
      "convert-too-many-values",
      `This field holds ${count} values; at most ${CONVERT_INLINE_VALUE_LIMIT} can be retyped in one pass. The background pass for larger fields is not yet built.`,
    );
  }
}

// Retype a field non-destructively. Every original current row is flipped to history; clean values
// gain a freshly coerced current row (re-expressed at the target kind's scale, so a magnitude never
// shifts by a power of ten); parked values are left cleared (their history endures, so the change is
// reversible). The whole batch commits atomically with the kind update and one audit event.
//
// The bulk path will run this same work in a Queue consumer after the route sets converting = 1 once a
// field's current-value count crosses CONVERT_INLINE_VALUE_LIMIT; until that pass is built, a field
// over the ceiling is refused rather than attempted inline.
export async function applyConvert(
  database: BatchDatabase,
  input: {
    fieldId: CustomFieldId;
    toKind: CustomFieldKind;
    parkedDisposition: "park" | "block";
  },
  options: CustomFieldWriteOptions,
): Promise<{ ok: true } & ReplayFlag> {
  await assertWithinInlineConvertLimit(database, input.fieldId);
  const classified = await classifyCurrentValues(database, input.fieldId, input.toKind);

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
    // The kind flips in the same batch as the coerced rows. number_scale is deliberately left alone:
    // it records what the admin declared, and the effective scale is read from it under the new kind
    // (see number-scale.ts) — which is what the values were just re-expressed at. Pinning the computed
    // exponent onto the column instead would leave a field retyped currency → number → currency
    // declaring a scale of zero, a money field that can no longer hold cents.
    statements.push(
      updateCustomFieldFlagsStatement(database, input.fieldId, { kind: input.toKind }),
    );
    statements.push(
      customFieldAuditStatement(database, options, "custom_field.kind_changed", input.fieldId),
    );
    return { statements, outboxMessages: [], value: { ok: true } };
  });
}
