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
  | "field-in-use"
  | "kind-immutable-during-convert"
  | "convert-has-parked-values"
  | "reference-kind-handle-mismatch"
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
