import {
  MAX_DESCRIPTION_LENGTH,
  MAX_KEPT_AT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_RECIPIENTS,
  type InOutParty,
  type InOutPartyInput,
} from "./types.ts";

// Every refusal this subsystem raises, as a code the route maps to a problem type. Codes, never
// messages, drive the mapping, so a message can be reworded without changing the contract.
export type InOutValidationCode =
  | "in-out-empty-description"
  | "in-out-description-too-long"
  | "in-out-invalid-party"
  | "in-out-no-recipients"
  | "in-out-too-many-recipients"
  | "in-out-field-too-long"
  | "in-out-unknown-matter"
  | "in-out-unknown-member"
  // The entry is not one this firm holds, or it has already moved on. Kept apart because they are
  // fixed differently: the first by naming another entry, the second by reading the log again.
  | "in-out-unknown-entry"
  | "in-out-not-waiting"
  | "in-out-unknown-recipient"
  | "in-out-unknown-packet";

export class InOutValidationError extends Error {
  constructor(
    readonly code: InOutValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "InOutValidationError";
  }
}

function refuse(code: InOutValidationCode, message: string): never {
  throw new InOutValidationError(code, message);
}

export function normalizeDescription(description: string): string {
  const normalized = description.trim();
  if (normalized.length === 0) {
    refuse("in-out-empty-description", "say what was dropped off");
  }
  if (normalized.length > MAX_DESCRIPTION_LENGTH) {
    refuse(
      "in-out-description-too-long",
      `a description is at most ${String(MAX_DESCRIPTION_LENGTH)} characters`,
    );
  }
  return normalized;
}

/** An optional free-text field: trimmed, and empty becomes absent rather than an empty string. */
export function normalizeOptionalText(
  value: string | null | undefined,
  limit: number,
  field: string,
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > limit) {
    refuse("in-out-field-too-long", `${field} is at most ${String(limit)} characters`);
  }
  return normalized;
}

export function normalizeKeptAt(value: string | null | undefined): string | null {
  return normalizeOptionalText(value, MAX_KEPT_AT_LENGTH, "where it is kept");
}

export function normalizeNotes(value: string | null | undefined): string | null {
  return normalizeOptionalText(value, MAX_NOTES_LENGTH, "the notes");
}

// One person, as the write will store them. The kind decides which identity is required and the other
// two are dropped, so a caller cannot store a member id on a typed name and have the two disagree.
export function normalizeParty(input: InOutPartyInput): InOutParty {
  const name = input.name.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    refuse("in-out-invalid-party", `a name is between 1 and ${String(MAX_NAME_LENGTH)} characters`);
  }
  switch (input.kind) {
    case "member": {
      const userId = input.userId ?? "";
      if (!userId.startsWith("user_"))
        refuse("in-out-invalid-party", "a member needs their user id");
      return { kind: "member", userId, entityId: null, name };
    }
    case "entity": {
      const entityId = input.entityId ?? "";
      if (!entityId.startsWith("directory")) {
        refuse("in-out-invalid-party", "a Directory person or organization needs its id");
      }
      return { kind: "entity", userId: null, entityId, name };
    }
    case "external":
      return { kind: "external", userId: null, entityId: null, name };
  }
}

// The people an entry is To. At least one, because an entry nobody may collect is one the desk
// cannot hand over; a person named twice is kept once.
export function normalizeRecipients(inputs: readonly InOutPartyInput[]): InOutParty[] {
  if (inputs.length === 0) refuse("in-out-no-recipients", "say who it is to");
  if (inputs.length > MAX_RECIPIENTS) {
    refuse("in-out-too-many-recipients", `an entry is to at most ${String(MAX_RECIPIENTS)} people`);
  }
  const seen = new Set<string>();
  const recipients: InOutParty[] = [];
  for (const input of inputs) {
    const party = normalizeParty(input);
    const key = `${party.kind}:${party.userId ?? party.entityId ?? party.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(party);
  }
  return recipients;
}
