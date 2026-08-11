import {
  NEUTRAL_PRONOUNS,
  type PronounAgreement,
  type PronounDeclension,
} from "./expression/pronoun.ts";
import type { MergeValue } from "./types.ts";

// A Directory person's stored pronoun columns, as the merge reads project them, turned into the
// declension the expression language spends and the label a document prints.
//
// ONE PLACE, TWO CONSUMERS. Both the party read and the staffing read join a directory_person row
// and both need exactly this projection, so it is written once here rather than twice with a chance
// of disagreeing about what a half-recorded row means.

// The six columns, as either read projects them.
export interface PronounColumnValues {
  readonly pronounSubject: string | null;
  readonly pronounObject: string | null;
  readonly pronounPossessiveDeterminer: string | null;
  readonly pronounPossessivePronoun: string | null;
  readonly pronounReflexive: string | null;
  readonly pronounVerbNumber: string | null;
}

function present(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

// The person's recorded declension, or undefined when they stated none.
//
// ALL SIX OR NONE, re-checked here and not merely trusted. The table's CHECK already refuses a
// partial row, and this read still refuses to build a declension out of one, because the failure it
// prevents — "she" in one clause and "them" in the next, in a document that goes out — is invisible
// on the page and expensive to a real person. A row that is somehow partial reads as unrecorded, and
// the helpers answer with the neutral set, which is wrong about nobody.
export function declensionFromColumns(row: PronounColumnValues): PronounDeclension | undefined {
  const subject = present(row.pronounSubject);
  const object = present(row.pronounObject);
  const possessiveDeterminer = present(row.pronounPossessiveDeterminer);
  const possessivePronoun = present(row.pronounPossessivePronoun);
  const reflexive = present(row.pronounReflexive);
  const verbNumber = present(row.pronounVerbNumber);
  if (
    subject === undefined ||
    object === undefined ||
    possessiveDeterminer === undefined ||
    possessivePronoun === undefined ||
    reflexive === undefined ||
    (verbNumber !== "singular" && verbNumber !== "plural")
  ) {
    return undefined;
  }
  const agreement: PronounAgreement = verbNumber;
  return { subject, object, possessiveDeterminer, possessivePronoun, reflexive, agreement };
}

// How a stated set PRINTS when a document names it rather than uses it — the subject and object
// forms joined by a slash, the way people write their own. Derived from the same forms a sentence
// renders, so the printed label and the printed pronouns can never disagree.
export function pronounLabelValue(row: PronounColumnValues): MergeValue | undefined {
  const declension = declensionFromColumns(row);
  if (declension === undefined) return undefined;
  return { kind: "text", text: `${declension.subject}/${declension.object}` };
}

export { NEUTRAL_PRONOUNS };
export type { PronounDeclension };
