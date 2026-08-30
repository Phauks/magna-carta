/*
 * The one place that decides what a client may see.
 *
 * A firm writes two kinds of text on a charge. One is written FOR the client and is the whole
 * point of the bill; the other is written for the firm about the client's matter, and the client
 * must never read it. Keeping the second out of a printed sheet by asking every caller to leave it
 * out is not a guarantee, it is a habit: the first caller who forgets hands a client the firm's
 * private note about their own case, and nothing in the code was ever going to stop it.
 *
 * So the exclusion is made once, structurally, here:
 *
 *   1. `INTERNAL_ONLY_FIELD_KEYS` names the fields that are internal by definition.
 *   2. A record still carrying one CANNOT be handed to a sheet at all — the type rejects it, so it
 *      is a compile error rather than a runtime hope.
 *   3. `clientFacingRecord()` is the only way through, and it removes those fields for real.
 *   4. A field selection cannot name one either: the key type excludes them, and the selector
 *      drops them again at runtime for a caller reaching in from untyped code.
 *
 * The sheet itself accepts no snippet, no HTML and no caller-supplied formatter, so what this
 * module refuses to select genuinely has no other route onto the paper.
 */
import type { PrintSheetField } from "./types.ts";

/**
 * The fields that exist for the firm alone. Internal is not the same as hidden: this text is shown
 * on the record, read back, and carried when a charge moves between ledgers. What it may never do
 * is reach anything the client receives.
 */
export const INTERNAL_ONLY_FIELD_KEYS = ["internalMemo", "memo"] as const;

export type InternalOnlyFieldKey = (typeof INTERNAL_ONLY_FIELD_KEYS)[number];

/**
 * The shape of a record that provably carries no internal-only text: those keys are typed as
 * absent, so a record that still has one is not assignable and the compiler says so at the call.
 */
export type WithoutInternalText = { readonly [Key in InternalOnlyFieldKey]?: never };

/**
 * A record as a client-facing surface may see it — the same record with its internal-only text
 * removed from the value AND from the type. `clientFacingRecord()` produces one; there is no other
 * constructor, which is what makes the removal real rather than declared.
 */
export type ClientFacingRecord<TRecord> = Omit<TRecord, InternalOnlyFieldKey> & WithoutInternalText;

/**
 * The keys of a record that a printed field may name: its string-valued keys, minus the
 * internal-only ones. Naming an excluded key in a field selection does not compile.
 */
export type PrintableFieldKey<TRecord> = Exclude<
  {
    [Key in Extract<keyof TRecord, string>]-?: NonNullable<TRecord[Key]> extends string
      ? Key
      : never;
  }[Extract<keyof TRecord, string>],
  InternalOnlyFieldKey
>;

/**
 * One printed field, said in terms of the record it comes from: which value it states, what the
 * paper calls it, and optionally the key holding that same value in its other literacy (the clock
 * form of a duration whose decimal hours lead).
 */
export interface PrintSheetFieldSpecification<TRecord> {
  readonly key: PrintableFieldKey<TRecord>;
  readonly label: string;
  readonly secondaryKey?: PrintableFieldKey<TRecord>;
}

/** Read one value as text, or nothing. Anything that is not text has nothing to print. */
function readTextValue(record: object, key: string): string | undefined {
  const value = (record as Readonly<Record<string, unknown>>)[key];
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text === "" ? undefined : text;
}

function isInternalOnlyKey(key: string): boolean {
  return (INTERNAL_ONLY_FIELD_KEYS as readonly string[]).includes(key);
}

/**
 * Strip a record's internal-only text and hand back what a client-facing surface may read.
 *
 * The keys are deleted, not blanked, so nothing downstream can reach them by any name — and the
 * returned type no longer admits them, so the compiler carries the same fact forward.
 */
export function clientFacingRecord<TRecord extends object>(
  record: TRecord,
): ClientFacingRecord<TRecord> {
  const projection: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isInternalOnlyKey(key)) continue;
    projection[key] = value;
  }
  // The loop above is what the return type asserts: every internal-only key has been removed.
  return projection as ClientFacingRecord<TRecord>;
}

/**
 * Select the fields a sheet states from a record.
 *
 * A field with nothing recorded in it is omitted rather than printed empty: a sheet is an account
 * of what was recorded, and a labelled blank claims a fact that does not exist.
 *
 * The internal-only guard is repeated at runtime because the type only protects callers who are
 * type-checked; JavaScript reaching in from outside gets the same answer.
 */
export function printSheetFields<TRecord extends WithoutInternalText>(
  record: TRecord,
  specifications: readonly PrintSheetFieldSpecification<TRecord>[],
): PrintSheetField[] {
  const fields: PrintSheetField[] = [];
  for (const specification of specifications) {
    const { key, secondaryKey } = specification;
    if (isInternalOnlyKey(key)) continue;
    const value = readTextValue(record, key);
    if (value === undefined) continue;
    const secondary =
      secondaryKey === undefined || isInternalOnlyKey(secondaryKey)
        ? undefined
        : readTextValue(record, secondaryKey);
    fields.push(
      secondary === undefined
        ? { label: specification.label, value }
        : {
            label: specification.label,
            value,
            secondary,
          },
    );
  }
  return fields;
}
