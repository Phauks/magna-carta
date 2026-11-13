/*
 * The assembly input area's headless model: what a template version's field list becomes when it is
 * laid against the firm's merge-field catalog, and whether what a person has typed is enough to
 * assemble with.
 *
 * All of it is pure, and deliberately so. The rules worth getting right here — which fields a person
 * actually has to fill in, what an unrecognized placeholder does to the form, whether a typed amount
 * is a number — are rules about data, and asserting them through a rendered form would be both
 * slower and less complete than asserting them directly.
 *
 * VALUES ARE STRINGS, keyed by merge-field key. A form's fields carry text; interpreting text as a
 * date or an amount is a step, not an assumption, and keeping the state serializable means a
 * half-filled form can be handed around (draft, restore, hand-off) without a codec. The typed value
 * objects appear at the boundary where an assembly is actually submitted.
 */
import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import {
  mergeFieldGroupLabel,
  MERGE_FIELD_GROUP_ORDER,
  MERGE_FIELD_VALUE_TYPE_LABELS,
  type MergeFieldCatalog,
  type MergeFieldGroup,
  type MergeFieldSensitivity,
  type MergeFieldValueType,
  type TemplateFieldManifest,
} from "@magna-carta/merge-field-catalog-contract/types";
import { findCatalogEntry } from "@magna-carta/merge-field-catalog-contract/catalog-grouping";

/**
 * What happens to this field when the document is assembled — the single most useful thing to know
 * about a field, and the thing the input area exists to make legible.
 */
export type AssemblyFieldDisposition =
  /** Filled from firm data. Shown as context, with no input. */
  | "automatic"
  /** Filled from firm data WHEN the data is there; a person may need to supply it. */
  | "conditional"
  /** Nobody can fill it but a person. */
  | "manual"
  /** The firm's data cannot supply it and no input is offered — it renders as an absence. */
  | "unavailable"
  /** The catalog has no such field. The template cannot be assembled until this is resolved. */
  | "unrecognized";

export interface AssemblyInputField {
  readonly key: string;
  readonly label: string;
  readonly valueType: MergeFieldValueType;
  readonly valueTypeLabel: string;
  readonly description: string;
  /** One sentence saying where the value comes from, or why it may be missing. */
  readonly availabilityNote: string;
  /** Illustrative sample of how the field renders. Never real firm data. */
  readonly exampleRendering: string;
  /** How many times the placeholder appears in the document. */
  readonly occurrences: number;
  /** The per-placeholder format the template author asked for, when they asked for one. */
  readonly format?: string;
  readonly disposition: AssemblyFieldDisposition;
  readonly sensitivity: MergeFieldSensitivity;
  /** Whether this field gets an input control at all. */
  readonly requiresEntry: boolean;
  /** Whether leaving it empty blocks the assembly. */
  readonly required: boolean;
}

export interface AssemblyInputGroup {
  readonly group: MergeFieldGroup;
  readonly label: string;
  readonly fields: readonly AssemblyInputField[];
}

export interface AssemblyInputPlan {
  readonly templateVersionId: string;
  readonly templateName: string;
  readonly groups: readonly AssemblyInputGroup[];
  /** Fields a person has to fill in. The honest answer to "how much work is this?". */
  readonly entryFieldCount: number;
  /** Fields that fill themselves. */
  readonly automaticFieldCount: number;
  /** Placeholder keys the catalog does not carry. Non-empty means the template is not usable. */
  readonly unrecognizedKeys: readonly string[];
  /** Fields binding a protected value, so a surface can warn before an audited decrypt happens. */
  readonly protectedKeys: readonly string[];
}

/** Values as the form holds them: merge-field key to the text a person typed. */
export type AssemblyInputValues = Readonly<Record<string, string>>;

const UNRECOGNIZED_GROUP: MergeFieldGroup = "custom";

/**
 * An unrecognized placeholder still needs a row, because a person has to be told about it. It gets
 * a field of its own with the key standing in for the label — the one place a key is shown as the
 * subject, precisely because there is no human label to show.
 */
function unrecognizedField(key: string, occurrences: number): AssemblyInputField {
  return {
    key,
    label: key,
    valueType: "text",
    valueTypeLabel: MERGE_FIELD_VALUE_TYPE_LABELS.text,
    description: "This placeholder does not match any merge field the firm has.",
    availabilityNote:
      "Nothing will fill it. Either the template's placeholder is misspelled, or the field needs adding to the firm's merge fields.",
    exampleRendering: "",
    occurrences,
    disposition: "unrecognized",
    sensitivity: "ordinary",
    requiresEntry: false,
    required: false,
  };
}

/**
 * Whether a field gets an input control. `manual` always does; `conditional` does too, because a
 * value the firm's data MIGHT supply is exactly the case where a person needs the chance to supply
 * it themselves — offering nothing there is how a blank reaches a filing.
 */
function requiresEntry(disposition: AssemblyFieldDisposition): boolean {
  return disposition === "manual" || disposition === "conditional";
}

/**
 * Whether leaving it empty blocks the assembly. Only `manual` does: a `conditional` field left
 * empty is an absence the firm's data may still cover, and blocking on it would stop a person
 * assembling a document that is in fact complete.
 */
function isRequired(disposition: AssemblyFieldDisposition): boolean {
  return disposition === "manual";
}

/**
 * Lay a template version's placeholders against the catalog and produce the form's shape.
 *
 * Within a group, fields needing entry come FIRST, then everything else in document order. A form
 * whose work is scattered through read-only context rows reads as longer than it is, and the first
 * question anyone has is what they have to do.
 */
export function buildAssemblyInputPlan(
  manifest: TemplateFieldManifest,
  catalog: MergeFieldCatalog,
): AssemblyInputPlan {
  // Merge duplicate placeholder rows defensively: a manifest should carry one row per key, and a
  // form that rendered the same field twice would let two inputs disagree about one value.
  const occurrencesByKey = new Map<string, number>();
  const formatByKey = new Map<string, string>();
  const keysInDocumentOrder: string[] = [];
  for (const placeholder of manifest.placeholders) {
    const seen = occurrencesByKey.get(placeholder.key);
    occurrencesByKey.set(placeholder.key, (seen ?? 0) + placeholder.occurrences);
    if (seen === undefined) keysInDocumentOrder.push(placeholder.key);
    if (placeholder.format !== undefined && !formatByKey.has(placeholder.key)) {
      formatByKey.set(placeholder.key, placeholder.format);
    }
  }

  const fieldsByGroup = new Map<MergeFieldGroup, AssemblyInputField[]>();
  const unrecognizedKeys: string[] = [];
  const protectedKeys: string[] = [];

  for (const key of keysInDocumentOrder) {
    const occurrences = occurrencesByKey.get(key) ?? 0;
    const entry = findCatalogEntry(catalog, key);
    if (entry === null) {
      unrecognizedKeys.push(key);
      const bucket = fieldsByGroup.get(UNRECOGNIZED_GROUP) ?? [];
      bucket.push(unrecognizedField(key, occurrences));
      fieldsByGroup.set(UNRECOGNIZED_GROUP, bucket);
      continue;
    }
    const disposition: AssemblyFieldDisposition = entry.availability;
    if (entry.sensitivity === "protected") protectedKeys.push(key);
    const format = formatByKey.get(key);
    const bucket = fieldsByGroup.get(entry.group) ?? [];
    bucket.push({
      key,
      label: entry.label,
      valueType: entry.valueType,
      valueTypeLabel: MERGE_FIELD_VALUE_TYPE_LABELS[entry.valueType],
      description: entry.description,
      availabilityNote: entry.availabilityNote,
      exampleRendering: entry.exampleRendering,
      occurrences,
      ...(format === undefined ? {} : { format }),
      disposition,
      sensitivity: entry.sensitivity,
      requiresEntry: requiresEntry(disposition),
      required: isRequired(disposition),
    });
    fieldsByGroup.set(entry.group, bucket);
  }

  const groups: AssemblyInputGroup[] = [];
  // A heading this build's registry does not know still gets rendered, at the end. Dropping it would
  // drop the fields under it — and a person who cannot see a field they have to fill in ends up typing
  // its value into the finished document by hand, which is the failure the whole area exists to avoid.
  const knownGroups = new Set(MERGE_FIELD_GROUP_ORDER);
  const unknownGroups = [...fieldsByGroup.keys()].filter((group) => !knownGroups.has(group));
  for (const group of [...MERGE_FIELD_GROUP_ORDER, ...unknownGroups]) {
    const fields = fieldsByGroup.get(group);
    if (!fields || fields.length === 0) continue;
    const needingEntry = fields.filter((field) => field.requiresEntry);
    const rest = fields.filter((field) => !field.requiresEntry);
    groups.push({
      group,
      label: mergeFieldGroupLabel(group),
      fields: [...needingEntry, ...rest],
    });
  }

  const allFields = groups.flatMap((group) => group.fields);
  return {
    templateVersionId: manifest.templateVersionId,
    templateName: manifest.templateName,
    groups,
    entryFieldCount: allFields.filter((field) => field.requiresEntry).length,
    automaticFieldCount: allFields.filter((field) => field.disposition === "automatic").length,
    unrecognizedKeys,
    protectedKeys,
  };
}

export type AssemblyIssueSeverity = "error" | "warning";

export interface AssemblyValidationIssue {
  /** The merge-field key the issue is about, or null for an issue about the template itself. */
  readonly key: string | null;
  /** What to call it in the summary. */
  readonly label: string;
  readonly severity: AssemblyIssueSeverity;
  /** One sentence, addressed to the person filling the form. */
  readonly message: string;
}

export interface AssemblyValidationSummary {
  readonly issues: readonly AssemblyValidationIssue[];
  readonly errorCount: number;
  readonly warningCount: number;
  /** Whether the form can be submitted. Warnings never block; errors always do. */
  readonly ready: boolean;
}

/*
 * A plain decimal amount, optionally signed, with at most two fractional digits. This is a SHAPE
 * check on what a person typed, not money arithmetic: amounts are minor units at the boundary where
 * an assembly is submitted, and the money package owns every calculation. The dedicated money input
 * control replaces this hand-rolled check when it is built.
 */
const DECIMAL_AMOUNT_PATTERN = /^-?\d+(\.\d{1,2})?$/;
const PLAIN_NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;
const BOOLEAN_VALUES = new Set(["yes", "no"]);

/** Whether an ISO date string names a day that exists (rejects 2026-02-30). */
const isRealCalendarDate = isCivilDate;

/** The per-type shape check. Returns a message, or null when the text is acceptable. */
function typeIssueMessage(field: AssemblyInputField, value: string): string | null {
  switch (field.valueType) {
    case "money":
      return DECIMAL_AMOUNT_PATTERN.test(value)
        ? null
        : "Enter an amount as digits, with at most two decimal places.";
    case "number":
      return PLAIN_NUMBER_PATTERN.test(value) ? null : "Enter a number.";
    case "date":
      return isRealCalendarDate(value) ? null : "Choose a date.";
    case "boolean":
      return BOOLEAN_VALUES.has(value.toLowerCase()) ? null : "Choose yes or no.";
    default:
      return null;
  }
}

/**
 * Check a filled form against its plan.
 *
 * Absence is the failure this guards: the most dangerous outcome in document assembly is a blank
 * where a party name should be, filed without anyone noticing. So a required field left empty is an
 * ERROR, a conditional field left empty is a WARNING that names what will happen, and a template
 * with an unrecognized placeholder is an error that blocks regardless of what has been typed.
 */
export function validateAssemblyInput(
  plan: AssemblyInputPlan,
  values: AssemblyInputValues,
): AssemblyValidationSummary {
  const issues: AssemblyValidationIssue[] = [];

  for (const key of plan.unrecognizedKeys) {
    issues.push({
      key,
      label: key,
      severity: "error",
      message:
        "This placeholder does not match any of the firm's merge fields, so nothing can fill it.",
    });
  }

  for (const group of plan.groups) {
    for (const field of group.fields) {
      if (field.disposition === "unrecognized") continue;
      const value = (values[field.key] ?? "").trim();

      if (value === "") {
        if (field.required) {
          issues.push({
            key: field.key,
            label: field.label,
            severity: "error",
            message: "This field has no value and nothing will fill it in.",
          });
        } else if (field.disposition === "conditional") {
          issues.push({
            key: field.key,
            label: field.label,
            severity: "warning",
            message:
              "If left empty, this comes from the matter, or stays blank if the matter has none.",
          });
        }
        continue;
      }

      const message = typeIssueMessage(field, value);
      if (message !== null) {
        issues.push({ key: field.key, label: field.label, severity: "error", message });
      }
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  return {
    issues,
    errorCount,
    warningCount: issues.length - errorCount,
    ready: errorCount === 0,
  };
}

/** The blank form: every field that takes an input, mapped to an empty value. */
export function emptyAssemblyInputValues(plan: AssemblyInputPlan): Record<string, string> {
  const values: Record<string, string> = {};
  for (const group of plan.groups) {
    for (const field of group.fields) {
      if (field.requiresEntry) values[field.key] = "";
    }
  }
  return values;
}
