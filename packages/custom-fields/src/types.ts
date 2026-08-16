export const CUSTOM_FIELD_KINDS = [
  "checkbox",
  "date",
  "time",
  "number",
  "currency",
  "picklist",
  "single-line",
  "multi-line",
  "url",
  "email",
  "matter-reference",
  "contact-reference",
] as const;
export type CustomFieldKind = (typeof CUSTOM_FIELD_KINDS)[number];

// The record axes a firm may hang its own fields on. ONE HOME: the drizzle column's enum, the
// define-field request schema, and every scoped read derive from this array rather than restating
// it, and packages/custom-fields/test/schema-name-sync.test.ts pins the column to it — a target the
// writer accepts but a reader does not recognise is a field a firm can create and never use.
//
// `attachment_id` narrows a field within its target and means something different on each: a matter
// type on `matter`, a directory category on `entity`, and an asset class on `matterAsset`. It stays
// an unvalidated handle on all three, because the engine has never known what the axis on the other
// side of it contains, and importing three domain packages to find out would invert the dependency
// direction this one is built to avoid.
export const CUSTOM_FIELD_TARGETS = ["matter", "entity", "matterAsset"] as const;
export type CustomFieldTarget = (typeof CUSTOM_FIELD_TARGETS)[number];

export function isCustomFieldKind(value: string): value is CustomFieldKind {
  return (CUSTOM_FIELD_KINDS as readonly string[]).includes(value);
}

export function isCustomFieldTarget(value: string): value is CustomFieldTarget {
  return (CUSTOM_FIELD_TARGETS as readonly string[]).includes(value);
}

export type CustomFieldErrorCode =
  | "unknown-field"
  | "field-archived"
  | "field-in-use"
  // Reserved seam: thrown when a convert is attempted while a field's converting flag is already
  // set (the concurrent-convert guard). Not yet thrown — the converting-flag guard is not built.
  | "kind-immutable-during-convert"
  | "convert-has-parked-values"
  | "convert-too-many-values"
  | "reference-kind-not-convertible"
  | "reference-kind-handle-mismatch"
  | "value-kind-mismatch"
  | "value-not-a-scaled-integer"
  | "value-text-too-long"
  | "unknown-picklist-option"
  | "picklist-option-archived"
  | "number-scale-out-of-range"
  // Reserved seam: thrown when protect is requested on a reference or picklist kind, which is not
  // a supported protect target. Not yet thrown — the protect-kind rejection path is not built.
  | "cannot-protect-reference-or-picklist-kind"
  | "too-many-fields-for-scope"
  | "too-many-fields-for-firm"
  | "too-many-options-for-field"
  | "option-in-use"
  | "purge-not-yet-enabled";

export class CustomFieldError extends Error {
  readonly code: CustomFieldErrorCode;
  constructor(code: CustomFieldErrorCode, message: string) {
    super(message);
    this.name = "CustomFieldError";
    this.code = code;
  }
}
