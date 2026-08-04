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
export type CustomFieldTarget = "matter" | "entity";

export function isCustomFieldKind(value: string): value is CustomFieldKind {
  return (CUSTOM_FIELD_KINDS as readonly string[]).includes(value);
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
