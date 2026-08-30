/*
 * The pronoun editor's model: five forms and a verb number, recorded whole or not at all.
 *
 * The all-or-nothing rule is the whole reason this is a module rather than five bound inputs. A
 * half-recorded set is what puts one set's "she" and another's "them" in the same sentence of a
 * document that gets filed, served, and read by people who were not in the room, and that failure
 * is invisible on the page. So the draft answers one question — is this a complete set, an empty
 * one, or neither — and the screen's save control reads that answer rather than deciding for itself.
 *
 * NOTHING HERE INFERS. There is no derivation from a given name, a courtesy title, or any other
 * field, and there must never be one. An unstated set is an unstated fact.
 */
import type { PronounSet, PronounVerbNumber } from "./directory-api.ts";
import { PRONOUN_FORMS, type PronounFormEntry } from "./directory-vocabulary.ts";

/** The five forms as free text, plus the verb agreement, exactly as the boxes hold them. */
export interface PronounDraft {
  subject: string;
  object: string;
  possessiveDeterminer: string;
  possessivePronoun: string;
  reflexive: string;
  verbNumber: PronounVerbNumber;
}

/**
 * An empty draft. The verb number starts singular because a value is required to render the
 * control at all; it means nothing until the forms beside it are filled, and it is never a guess
 * about a person, only the initial position of a control.
 */
export function emptyPronounDraft(): PronounDraft {
  return {
    subject: "",
    object: "",
    possessiveDeterminer: "",
    possessivePronoun: "",
    reflexive: "",
    verbNumber: "singular",
  };
}

/** The stated set as a draft, or an empty draft where the person stated none. */
export function pronounDraftFrom(pronouns: PronounSet | null): PronounDraft {
  if (pronouns === null) return emptyPronounDraft();
  return {
    subject: pronouns.subject,
    object: pronouns.object,
    possessiveDeterminer: pronouns.possessiveDeterminer,
    possessivePronoun: pronouns.possessivePronoun,
    reflexive: pronouns.reflexive,
    verbNumber: pronouns.verbNumber,
  };
}

/**
 * What a draft amounts to.
 *
 * `complete` and `empty` are both savable — one records the set, the other clears it. `partial` is
 * the state the save control refuses, and the state the contract itself would refuse.
 */
export type PronounDraftState = "complete" | "empty" | "partial";

/**
 * One form as written, defensively: a draft that somehow arrives without a form reads as UNFILLED
 * rather than throwing. The whole point of this module is that a set nobody finished is refused, so
 * a missing field has to land in the refused state, not in a stack trace.
 */
function written(draft: PronounDraft, form: PronounFormEntry["form"]): string {
  return (draft[form] ?? "").trim();
}

export function pronounDraftState(draft: PronounDraft): PronounDraftState {
  const filled = PRONOUN_FORMS.filter((entry) => written(draft, entry.form) !== "");
  if (filled.length === PRONOUN_FORMS.length) return "complete";
  if (filled.length === 0) return "empty";
  return "partial";
}

/** The forms still to be filled on a partly written draft, named so the screen can say which. */
export function missingPronounForms(draft: PronounDraft): readonly string[] {
  return PRONOUN_FORMS.filter((entry) => written(draft, entry.form) === "").map(
    (entry) => entry.label,
  );
}

/**
 * What the draft sends: the complete set, or null to clear the one on file. A partial draft has
 * nothing to send, which is why it answers undefined rather than a half set.
 */
export function pronounDraftPayload(draft: PronounDraft): PronounSet | null | undefined {
  const state = pronounDraftState(draft);
  if (state === "partial") return undefined;
  if (state === "empty") return null;
  return {
    subject: written(draft, "subject"),
    object: written(draft, "object"),
    possessiveDeterminer: written(draft, "possessiveDeterminer"),
    possessivePronoun: written(draft, "possessivePronoun"),
    reflexive: written(draft, "reflexive"),
    verbNumber: draft.verbNumber,
  };
}
