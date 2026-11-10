import type {
  CitationDraft,
  CitationFieldName,
  CitationFields,
  CitationKind,
  FieldSource,
  FieldValue,
} from "./types.ts";

/*
 * A citation being built, with the member's typing as an override (the owner's rule: read what can
 * be read, and let manual entry win). Every operation returns a new draft.
 *
 *   read     what a link or a lookup found; never replaces a typed value, and a lookup's reading
 *            replaces a link's (the provider knows the name as reported; an address slug does not)
 *   override what the member typed; wins, and is kept when the link is read again
 *   restore  drops the member's value for a field, falling back to what was read ("Undo")
 */

const PRECEDENCE: Readonly<Record<FieldSource, number>> = { link: 0, lookup: 1, typed: 2 };

export function emptyDraft(kind: CitationKind): CitationDraft {
  return { kind, fields: {}, read: {} };
}

/** Starts a draft from what `recognize` or a lookup read. */
export function draftFromReading(
  kind: CitationKind,
  fields: CitationFields,
  source: Exclude<FieldSource, "typed">,
): CitationDraft {
  return applyReading(emptyDraft(kind), fields, source);
}

/** Merges a reading in. Typed values stay; a lookup outranks a link; empty values are ignored. */
export function applyReading(
  draft: CitationDraft,
  fields: CitationFields,
  source: Exclude<FieldSource, "typed">,
): CitationDraft {
  const read: Partial<Record<CitationFieldName, FieldValue>> = { ...draft.read };
  const current: Partial<Record<CitationFieldName, FieldValue>> = { ...draft.fields };
  for (const [name, value] of Object.entries(fields) as [CitationFieldName, string | undefined][]) {
    if (value === undefined || value.trim() === "") continue;
    const previousRead = read[name];
    if (previousRead !== undefined && PRECEDENCE[previousRead.source] > PRECEDENCE[source])
      continue;
    const reading: FieldValue = { value: value.trim(), source };
    read[name] = reading;
    if (current[name]?.source !== "typed") current[name] = reading;
  }
  return { kind: draft.kind, fields: current, read };
}

/** The member's own value for a field. An empty value clears the field outright. */
export function overrideField(
  draft: CitationDraft,
  name: CitationFieldName,
  value: string,
): CitationDraft {
  const fields: Partial<Record<CitationFieldName, FieldValue>> = { ...draft.fields };
  fields[name] = { value, source: "typed" };
  return { ...draft, fields };
}

/** Drops the member's value, restoring what was read (or nothing, if nothing was). */
export function restoreField(draft: CitationDraft, name: CitationFieldName): CitationDraft {
  const fields: Partial<Record<CitationFieldName, FieldValue>> = { ...draft.fields };
  const reading = draft.read[name];
  if (reading === undefined) delete fields[name];
  else fields[name] = reading;
  return { ...draft, fields };
}

/** True when the member's value differs from a value that was read — the case "Undo" is offered for. */
export function isOverridingReading(draft: CitationDraft, name: CitationFieldName): boolean {
  const field = draft.fields[name];
  const reading = draft.read[name];
  return field?.source === "typed" && reading !== undefined && reading.value !== field.value;
}

/** The plain values, for the formatter. Empty typed values count as absent. */
export function draftValues(draft: CitationDraft): CitationFields {
  const values: CitationFields = {};
  for (const [name, field] of Object.entries(draft.fields) as [
    CitationFieldName,
    FieldValue | undefined,
  ][]) {
    if (field !== undefined && field.value.trim() !== "") values[name] = field.value.trim();
  }
  return values;
}

/** A draft of another kind keeps the fields both kinds share — switching kind never loses typing. */
export function changeKind(draft: CitationDraft, kind: CitationKind): CitationDraft {
  return { ...draft, kind };
}
