import { isMatterAssetClass, matterAssetClassDeclaration } from "./classes.ts";
import {
  CIVIL_DATE_PATTERN,
  MATTER_ASSET_ENCUMBRANCE_KINDS,
  MATTER_ASSET_IDENTIFIER_KINDS,
  MATTER_ASSET_VALUATION_BASES,
  MAX_IDENTIFIER_DISPLAY_SUFFIX,
  MAX_MATTER_ASSET_BATCH,
  MAX_MATTER_ASSET_SCHEDULE,
  REFUSED_CREDENTIAL_IDENTIFIER_NAMES,
  type MatterAssetClass,
  type MatterAssetEncumbranceKind,
  type MatterAssetIdentifierKind,
  type MatterAssetValuationBasis,
} from "./types.ts";

// Every refusal this subsystem raises, as a code the route maps to a problem type. Codes — never
// messages — drive the mapping, so a message can be reworded without changing the contract.
export type MatterAssetValidationCode =
  // Shape refusals. The schema carries the same checks, so these exist to turn a database abort into
  // a named refusal a caller can act on rather than to be the only guard.
  | "matter-asset-empty-description"
  | "matter-asset-invalid-date"
  | "matter-asset-unknown-class"
  | "matter-asset-class-unavailable"
  // A type whose class differs from the asset's. A firm that files a retirement account under
  // `vehicle` has made a data-entry error, not expressed a preference.
  | "matter-asset-type-class-mismatch"
  // An attempt to change an asset's class after creation. A class change is a delete-and-recreate
  // wearing an update: it orphans the attribute row and moves the asset to a different merge
  // subject. The answer is to delete the row and add it again, which is cheap because it is minutes
  // old and soft delete already exists.
  | "matter-asset-class-frozen"
  // Any attempt to edit or remove a recorded valuation. There is no route that could reach this, and
  // the database refuses it too — the code exists so that if one is ever written the refusal has a
  // name rather than surfacing as an unexplained abort.
  | "matter-asset-valuation-append-only"
  // A figure whose amount and currency do not agree, or a correction that changes currency mid-history.
  | "matter-asset-currency-mismatch"
  | "matter-asset-unknown-basis"
  // A request naming a password, passphrase, seed or recovery phrase, private key, personal
  // identification number, or safe combination. Its own code, because the refusal is explainable —
  // the right home for a secret whose disclosure IS a transfer of the asset is a sealed envelope in
  // the custody register — rather than a validation shrug.
  | "matter-asset-credential-storage-refused"
  | "matter-asset-unknown-identifier-kind"
  | "matter-asset-identifier-empty"
  // More rows in one bulk call than a single commit will take. REFUSED, never truncated.
  | "matter-asset-batch-too-large"
  // More assets on a matter than one schedule read returns. A schedule is read whole, so the answer is
  // a named refusal rather than a page: a firm that filed the first five hundred rows of an inventory
  // and never saw the rest could not tell that from an inventory of five hundred.
  | "matter-asset-schedule-too-large"
  // A valuation naming an encumbrance that hangs off a different asset. Writing it would put a
  // mortgage balance under a house it does not charge, and the equity of both would be wrong.
  | "matter-asset-encumbrance-not-on-asset"
  | "matter-asset-unknown-encumbrance"
  | "matter-asset-unknown-encumbrance-kind"
  // A custody item handle that names nothing in this firm. The link is what says "the firm holds the
  // physical original of this scheduled thing", and a link to nothing says the opposite of nothing.
  | "matter-asset-unknown-custody-item"
  // A share of the form n/0, or one part supplied without the other.
  | "matter-asset-invalid-share"
  // An interest label outside the list the firm has configured. Only ever raised once a firm HAS
  // configured one — an empty catalog constrains nothing.
  | "matter-asset-interest-role-not-in-catalog"
  // A file, or an asset, that belongs to a different matter. Linking one would put a deed on a house
  // in a case nobody could find it from.
  | "matter-asset-document-matter-mismatch"
  // Ordinary lookups.
  | "matter-asset-unknown-asset"
  | "matter-asset-unknown-asset-type"
  | "matter-asset-unknown-valuation"
  | "matter-asset-unknown-document-link"
  | "matter-asset-unknown-identifier"
  // Catalog uniqueness, raised by the shared classification-type shape.
  | "matter-asset-type-name-taken"
  | "matter-asset-type-code-taken"
  | "matter-asset-empty-type-name";

export class MatterAssetValidationError extends Error {
  constructor(
    readonly code: MatterAssetValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "MatterAssetValidationError";
  }
}

function refuse(code: MatterAssetValidationCode, message: string): never {
  throw new MatterAssetValidationError(code, message);
}

export function assertNonEmptyDescription(description: string): void {
  if (description.trim().length === 0) {
    refuse("matter-asset-empty-description", "an asset needs a description");
  }
}

export function assertCivilDate(value: string, field: string): void {
  if (!CIVIL_DATE_PATTERN.test(value)) {
    refuse("matter-asset-invalid-date", `${field} must be a civil date of the form YYYY-MM-DD`);
  }
  // The pattern alone accepts 2026-02-30. A round trip through the calendar catches a rollover,
  // which matters here because a valuation dated a day that does not exist resolves against nothing
  // and silently drops off a schedule.
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  const sameDate =
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day;
  if (!sameDate)
    refuse("matter-asset-invalid-date", `${field} is not a date that exists: ${value}`);
}

export function assertOptionalCivilDate(value: string | null | undefined, field: string): void {
  if (value === null || value === undefined) return;
  assertCivilDate(value, field);
}

// Narrows an untrusted class string, and refuses a class the registry declares but whose attribute
// table has not shipped with its own code — so a caller learns "not yet" rather than "no such thing".
// Every class the registry declares is available today; the arm stays because the registry is what
// decides, and an eleventh class declared ahead of its table would need exactly this answer again.
export function assertAvailableClass(value: string): MatterAssetClass {
  if (!isMatterAssetClass(value)) {
    refuse("matter-asset-unknown-class", `no such asset class: ${value}`);
  }
  const declaration = matterAssetClassDeclaration(value);
  if (declaration === undefined || !declaration.available) {
    refuse(
      "matter-asset-class-unavailable",
      `the ${value} class is declared but its structured attributes have not shipped yet`,
    );
  }
  return value;
}

// An asset's type must belong to the asset's class — the type system's one invariant, enforced here
// because a foreign key cannot see the class column on the other side of it.
export function assertTypeMatchesClass(
  assetClass: MatterAssetClass,
  typeClass: MatterAssetClass,
): void {
  if (assetClass === typeClass) return;
  refuse(
    "matter-asset-type-class-mismatch",
    `an asset of class ${assetClass} cannot take a type declared under ${typeClass}`,
  );
}

export function assertBasis(value: string): MatterAssetValuationBasis {
  const bases: readonly string[] = MATTER_ASSET_VALUATION_BASES;
  if (!bases.includes(value)) {
    refuse("matter-asset-unknown-basis", `no such valuation basis: ${value}`);
  }
  return value as MatterAssetValuationBasis;
}

// An amount with no currency cannot be interpreted, and a currency with no amount says nothing.
export function assertAmountShape(
  amountMinor: number | null | undefined,
  currency: string | null | undefined,
): void {
  const hasAmount = amountMinor !== null && amountMinor !== undefined;
  const hasCurrency = currency !== null && currency !== undefined && currency.length > 0;
  if (hasAmount === hasCurrency) return;
  refuse(
    "matter-asset-currency-mismatch",
    "a valuation carries an amount and a currency together, or neither",
  );
}

export function assertShare(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): void {
  const hasNumerator = numerator !== null && numerator !== undefined;
  const hasDenominator = denominator !== null && denominator !== undefined;
  if (hasNumerator !== hasDenominator) {
    refuse(
      "matter-asset-invalid-share",
      "a share is a numerator and a denominator together, or neither — an unstated share is not zero",
    );
  }
  if (hasDenominator && denominator <= 0) {
    refuse("matter-asset-invalid-share", "a share denominator must be greater than zero");
  }
  if (hasNumerator && numerator < 0) {
    refuse("matter-asset-invalid-share", "a share numerator cannot be negative");
  }
}

export function assertBatchSize(count: number): void {
  if (count <= MAX_MATTER_ASSET_BATCH) return;
  refuse(
    "matter-asset-batch-too-large",
    `a bulk entry takes at most ${MAX_MATTER_ASSET_BATCH} rows in one call; this one carried ${count}`,
  );
}

export function assertScheduleSize(count: number): void {
  if (count <= MAX_MATTER_ASSET_SCHEDULE) return;
  refuse(
    "matter-asset-schedule-too-large",
    `a schedule is read whole and this matter carries more than ${MAX_MATTER_ASSET_SCHEDULE} assets; ` +
      `read the register list, which pages, rather than a schedule that would have to be truncated`,
  );
}

export function assertEncumbranceKind(value: string): MatterAssetEncumbranceKind {
  const kinds: readonly string[] = MATTER_ASSET_ENCUMBRANCE_KINDS;
  if (!kinds.includes(value)) {
    refuse("matter-asset-unknown-encumbrance-kind", `no such encumbrance kind: ${value}`);
  }
  return value as MatterAssetEncumbranceKind;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

// The credential refusal, by NAME. No column in this subsystem holds a password, passphrase, seed or
// recovery phrase, private key, personal identification number, or safe combination — not in
// plaintext and not sealed — so a request that names one is turned away before anything is written
// and with its own code, and the message points at the register that is the correct home for it.
export function assertNotCredentialName(value: string, field: string): void {
  const normalized = normalizeName(value);
  const refused: readonly string[] = REFUSED_CREDENTIAL_IDENTIFIER_NAMES;
  const named = refused.some(
    (credential) => normalized === credential || normalized.includes(credential),
  );
  if (!named) return;
  refuse(
    "matter-asset-credential-storage-refused",
    `${field} names a credential (${value}), and this register stores none: a value whose disclosure ` +
      `IS a transfer of the asset belongs in a sealed envelope in the custody register, where it has a ` +
      `location, a hold, and an append-only record of every hand it has passed through`,
  );
}

// Narrows an untrusted identifier kind. The credential check runs FIRST, so a caller asking to store
// a seed phrase gets the explainable refusal rather than an unknown-kind shrug.
export function assertIdentifierKind(value: string): MatterAssetIdentifierKind {
  assertNotCredentialName(value, "kind");
  const kinds: readonly string[] = MATTER_ASSET_IDENTIFIER_KINDS;
  if (!kinds.includes(value)) {
    refuse("matter-asset-unknown-identifier-kind", `no such identifier kind: ${value}`);
  }
  return value as MatterAssetIdentifierKind;
}

// A suffix is at most four characters, and a row carrying neither a suffix nor a value records
// nothing at all.
export function assertIdentifierShape(
  displaySuffix: string | null | undefined,
  value: string | null | undefined,
): void {
  const hasSuffix = displaySuffix !== null && displaySuffix !== undefined && displaySuffix !== "";
  const hasValue = value !== null && value !== undefined && value !== "";
  if (!hasSuffix && !hasValue) {
    refuse(
      "matter-asset-identifier-empty",
      "an identifier records the last four characters, the full value, or both",
    );
  }
  if (hasSuffix && displaySuffix.length > MAX_IDENTIFIER_DISPLAY_SUFFIX) {
    refuse(
      "matter-asset-identifier-empty",
      `a readable suffix is at most ${MAX_IDENTIFIER_DISPLAY_SUFFIX} characters`,
    );
  }
}

// The last four characters of a value, which is the ONLY part of it any ordinary read returns.
export function displaySuffixOf(value: string): string {
  return value.slice(-MAX_IDENTIFIER_DISPLAY_SUFFIX);
}

export function refuseWith(code: MatterAssetValidationCode, message: string): never {
  refuse(code, message);
}
