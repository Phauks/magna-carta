/*
 * A sealed identifier as it is drafted and as it is listed.
 *
 * The type decides the fields, and the shape check is the directory package's, shared with the
 * API: the screen refuses beside the field with the same sentence the wire would answer with.
 */
import {
  checkIdentifier,
  formatIdentifierEntry,
  identifierShape,
  identifierTypeLabel,
  maskedIdentifier,
  type IdentifierField,
} from "@magna-carta/directory/identifier-shape";
import type {
  DirectoryIdentifierRecord,
  DirectoryIdentifierRequest,
  DirectoryIdentifierType,
} from "./directory-api.ts";

export interface IdentifierDraft {
  readonly type: DirectoryIdentifierType;
  readonly label: string;
  readonly number: string;
  readonly username: string;
  readonly secret: string;
}

export function emptyIdentifierDraft(type: DirectoryIdentifierType): IdentifierDraft {
  return { type, label: "", number: "", username: "", secret: "" };
}

/** The fields the chosen type takes, in the order they are entered. */
export function identifierDraftFields(type: DirectoryIdentifierType): readonly IdentifierField[] {
  return identifierShape(type).fields;
}

/** The number field's text after a keystroke: digits grouped where the type has a form. */
export function identifierNumberAsTyped(type: DirectoryIdentifierType, typed: string): string {
  return formatIdentifierEntry(type, typed);
}

export function identifierDraftStarted(draft: IdentifierDraft): boolean {
  return [draft.label, draft.number, draft.username, draft.secret].some(
    (value) => value.trim() !== "",
  );
}

/** One sentence naming what the draft still needs, or null when it can be added. */
export function identifierDraftRefusal(draft: IdentifierDraft): string | null {
  const checked = checkIdentifier(draft.type, draft);
  return checked.ok ? null : checked.reason;
}

export function identifierRequestFrom(draft: IdentifierDraft): DirectoryIdentifierRequest {
  const request: DirectoryIdentifierRequest = { type: draft.type, number: draft.number.trim() };
  if (draft.label.trim() !== "") request.label = draft.label.trim();
  if (draft.username.trim() !== "") request.username = draft.username.trim();
  if (draft.secret !== "") request.secret = draft.secret;
  return request;
}

/** One line of the list: the type, what it is of, and bullets for the value. */
export interface IdentifierRow {
  readonly id: string;
  readonly type: DirectoryIdentifierType;
  readonly typeLabel: string;
  /** The plaintext part: the issuing region, the jurisdiction, who an account is held with. */
  readonly label: string | null;
  readonly masked: string;
  readonly recordedAt: string | null;
}

export function identifierRowsFrom(
  records: readonly DirectoryIdentifierRecord[],
): readonly IdentifierRow[] {
  return records.map((record) => ({
    id: record.id,
    type: record.type,
    typeLabel: identifierTypeLabel(record.type),
    label: record.label,
    masked: maskedIdentifier(record.type, null),
    recordedAt: record.recordedAt,
  }));
}

export function identifierRowFromDraft(draft: IdentifierDraft, id: string): IdentifierRow {
  return {
    id,
    type: draft.type,
    typeLabel: identifierTypeLabel(draft.type),
    label: draft.label.trim() === "" ? null : draft.label.trim(),
    masked: maskedIdentifier(draft.type, null),
    recordedAt: null,
  };
}
