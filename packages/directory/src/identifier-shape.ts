/*
 * What each kind of sealed identifier is made of, and whether a typed value has that shape.
 *
 * The type decides the fields. A social security number is nine digits and nothing else; a
 * driver's licence is a number that means nothing without the region that issued it; an account is
 * useless as a bare number, because a number with nothing it is held with cannot be used or even
 * recognized, and it comes with a username and a secret that belong to it. So every type declares
 * its fields here, once, and both the API and the screen refuse a value that does not fit BEFORE it
 * is sealed: a sealed value cannot be checked afterwards without the reveal permission and an audit
 * row, so the moment to be strict is the moment it is typed.
 *
 * Nothing in this file touches a database or a key. It is imported by the web app for the live
 * refusal beside the field and by the API for the refusal on the wire, so the two never disagree.
 *
 * Two things a type carries that the sealed value does not:
 * - the LABEL: the plaintext part of an identifier that a list may show without a reveal — the
 *   region that issued a licence, the jurisdiction that issued a bar number, who an account is
 *   held with. Not sensitive on its own, and the only reason a list of sealed things is readable.
 * - the MASK: what a list shows for the sealed value — its last digits, never more.
 */
import type { EntityKind, IdentifierType } from "./types.ts";

export type IdentifierFieldKey = "label" | "number" | "username" | "secret";

export interface IdentifierField {
  readonly key: IdentifierFieldKey;
  /** The field's name in the reader's words. */
  readonly label: string;
  /** How the field is entered: digits that format as typed, free text, or a secret that is hidden. */
  readonly entry: "digits" | "text" | "secret";
  readonly required: boolean;
}

export interface IdentifierShape {
  readonly type: IdentifierType;
  readonly label: string;
  readonly appliesTo: EntityKind | "both";
  /**
   * Whether the firm can match this identifier without decrypting it. An indexed type is what makes
   * a conflicts hit near-certain; an unindexed one is held for the record and compared only against
   * a candidate set a name already narrowed.
   */
  readonly indexed: boolean;
  readonly fields: readonly IdentifierField[];
}

const NUMBER: IdentifierField = { key: "number", label: "Number", entry: "digits", required: true };

export const IDENTIFIER_SHAPES: readonly IdentifierShape[] = [
  {
    type: "ssn",
    label: "Social security number",
    appliesTo: "person",
    indexed: true,
    fields: [NUMBER],
  },
  {
    type: "ssn_last_four",
    label: "Social security last four",
    appliesTo: "person",
    indexed: false,
    fields: [NUMBER],
  },
  {
    type: "ein",
    label: "Employer identification number",
    appliesTo: "organization",
    indexed: true,
    fields: [NUMBER],
  },
  {
    type: "drivers_license",
    label: "Driver's license",
    appliesTo: "person",
    indexed: true,
    fields: [
      { key: "label", label: "Issued by", entry: "text", required: true },
      { key: "number", label: "Number", entry: "text", required: true },
    ],
  },
  {
    type: "bar_number",
    label: "Bar number",
    appliesTo: "person",
    indexed: false,
    fields: [
      { key: "label", label: "Jurisdiction", entry: "text", required: true },
      { key: "number", label: "Number", entry: "text", required: true },
    ],
  },
  {
    type: "account",
    label: "Account",
    appliesTo: "both",
    indexed: true,
    fields: [
      { key: "label", label: "Held with", entry: "text", required: true },
      { key: "number", label: "Account number", entry: "text", required: true },
      { key: "username", label: "Username", entry: "text", required: false },
      { key: "secret", label: "Secret", entry: "secret", required: false },
    ],
  },
];

export function identifierShape(type: IdentifierType): IdentifierShape {
  const shape = IDENTIFIER_SHAPES.find((entry) => entry.type === type);
  if (shape === undefined) throw new Error(`identifier-shape: no shape for ${type}`);
  return shape;
}

/** The types this side of the directory can hold. Nothing else is ever offered. */
export function identifierShapesFor(kind: EntityKind): readonly IdentifierShape[] {
  return IDENTIFIER_SHAPES.filter(
    (shape) => shape.appliesTo === "both" || shape.appliesTo === kind,
  );
}

export function identifierTypeLabel(type: string): string {
  return IDENTIFIER_SHAPES.find((entry) => entry.type === type)?.label ?? type;
}

/** What a person typed, field by field. Absent and empty are the same thing. */
export interface IdentifierParts {
  readonly number?: string | null;
  readonly label?: string | null;
  readonly username?: string | null;
  readonly secret?: string | null;
}

/** A value that fits its type: what is sealed, what is shown beside it, and what the list shows. */
export interface CheckedIdentifier {
  readonly ok: true;
  /** The plaintext that is sealed. Canonical: the SSN with its dashes, the licence region-prefixed. */
  readonly value: string;
  /** The plaintext part a list shows without a reveal, or null where the type has none. */
  readonly label: string | null;
}

export interface RefusedIdentifier {
  readonly ok: false;
  /** One sentence beside the field, naming what the value needs. */
  readonly reason: string;
}

export type IdentifierCheck = CheckedIdentifier | RefusedIdentifier;

function digitsOf(value: string): string {
  return value.replaceAll(/[^0-9]/g, "");
}

function trimmed(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** Nine digits grouped 3-2-4 as far as they go, so the field reads as the number is typed. */
export function formatSocialSecurityNumber(typed: string): string {
  const digits = digitsOf(typed).slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/** Nine digits grouped 2-7. */
export function formatEmployerIdentificationNumber(typed: string): string {
  const digits = digitsOf(typed).slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/** The field's text after a keystroke: a digits type takes only digits and groups them. */
export function formatIdentifierEntry(type: IdentifierType, typed: string): string {
  switch (type) {
    case "ssn":
      return formatSocialSecurityNumber(typed);
    case "ein":
      return formatEmployerIdentificationNumber(typed);
    case "ssn_last_four":
      return digitsOf(typed).slice(0, 4);
    default:
      return typed;
  }
}

/** The sealed plaintext of an account: the number with the username and secret that belong to it. */
export interface AccountValue {
  readonly number: string;
  readonly username: string | null;
  readonly secret: string | null;
}

export function sealedAccountValue(account: AccountValue): string {
  return JSON.stringify({
    number: account.number,
    username: account.username,
    secret: account.secret,
  });
}

/** Reads an account's sealed plaintext back. A value sealed before accounts were paired is a bare number. */
export function parseAccountValue(sealed: string): AccountValue {
  try {
    const parsed: unknown = JSON.parse(sealed);
    if (typeof parsed === "object" && parsed !== null && "number" in parsed) {
      const record = parsed as { number?: unknown; username?: unknown; secret?: unknown };
      return {
        number: typeof record.number === "string" ? record.number : "",
        username: typeof record.username === "string" ? record.username : null,
        secret: typeof record.secret === "string" ? record.secret : null,
      };
    }
  } catch {
    // Not JSON: the bare number an earlier build sealed.
  }
  return { number: sealed, username: null, secret: null };
}

/** The account number inside a sealed account value, for the blind index. */
export function accountNumberOf(sealed: string): string {
  return parseAccountValue(sealed).number;
}

/**
 * Whether the parts fit the type. Returns what to seal and what to label, or one sentence naming
 * what is missing. The sentence is the refusal beside the field and the detail on the wire.
 */
export function checkIdentifier(type: IdentifierType, parts: IdentifierParts): IdentifierCheck {
  const number = trimmed(parts.number);
  const label = trimmed(parts.label);
  switch (type) {
    case "ssn": {
      const digits = digitsOf(number);
      if (digits.length !== 9 || digits !== digitsOf(formatSocialSecurityNumber(number))) {
        return { ok: false, reason: "Nine digits, as 123-45-6789." };
      }
      return { ok: true, value: formatSocialSecurityNumber(digits), label: null };
    }
    case "ssn_last_four": {
      const digits = digitsOf(number);
      if (digits.length !== 4) return { ok: false, reason: "The last four digits, as 6789." };
      return { ok: true, value: digits, label: null };
    }
    case "ein": {
      const digits = digitsOf(number);
      if (digits.length !== 9) return { ok: false, reason: "Nine digits, as 12-3456789." };
      return { ok: true, value: formatEmployerIdentificationNumber(digits), label: null };
    }
    case "drivers_license": {
      if (label === "") return { ok: false, reason: "The state or country that issued it." };
      if (number === "") return { ok: false, reason: "The licence number." };
      if (!/^[A-Za-z0-9 -]{1,32}$/.test(number)) {
        return { ok: false, reason: "Letters and digits only, up to 32." };
      }
      // Region-qualified, because a licence number is unique only within the region that issued it.
      return { ok: true, value: `${label.toUpperCase()}:${number.toUpperCase()}`, label };
    }
    case "bar_number": {
      if (label === "") return { ok: false, reason: "The jurisdiction that admitted them." };
      if (number === "") return { ok: false, reason: "The bar number." };
      if (!/^[A-Za-z0-9 -]{1,32}$/.test(number)) {
        return { ok: false, reason: "Letters and digits only, up to 32." };
      }
      return { ok: true, value: number, label };
    }
    case "account": {
      if (label === "") return { ok: false, reason: "Who the account is held with." };
      if (number === "") return { ok: false, reason: "The account number." };
      if (number.length > 64) return { ok: false, reason: "Up to 64 characters." };
      const username = trimmed(parts.username);
      const secret = parts.secret ?? "";
      return {
        ok: true,
        value: sealedAccountValue({
          number,
          username: username === "" ? null : username,
          secret: secret === "" ? null : secret,
        }),
        label,
      };
    }
  }
}

/** What a list shows for a sealed value: its last digits or characters, never more. */
export function maskedIdentifier(type: IdentifierType, lastCharacters: string | null): string {
  const tail = lastCharacters ?? "";
  switch (type) {
    case "ssn":
      return `•••-••-${tail === "" ? "••••" : tail}`;
    case "ein":
      return `••-•••••${tail === "" ? "••" : tail}`;
    case "ssn_last_four":
      return tail === "" ? "••••" : tail;
    default:
      return tail === "" ? "••••" : `•••• ${tail}`;
  }
}
