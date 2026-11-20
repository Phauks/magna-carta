/*
 * A client's referral as a screen reads and edits it: the choices the Source field offers, the line
 * the record window's header says, and the draft the About card and New Person edit.
 *
 * Pure, so the rules are tested without a browser:
 *
 *   - A RETIRED SOURCE IS NEVER OFFERED, AND NEVER HIDDEN WHERE IT STANDS. The choices are the
 *     firm's live sources in the firm's order; a record already recorded under a retired one keeps
 *     it as its current choice, marked retired, so opening the card never quietly changes it.
 *   - THE HEADER NAMES THE PERSON FIRST. "Referred by Daniel Okafor (Another Attorney)" when both
 *     are set, "Referred by Website" for a source alone, "Referred by Daniel Okafor" for a person
 *     alone, and nothing when neither is.
 */
import type { EntityReferral, ReferralSource } from "./referral-api.ts";

/** The word after a retired source wherever it is shown. */
export const RETIRED_SOURCE_MARK = "(retired)";

/** What the Referred By field says beneath itself. */
export const REFERRED_BY_HINT =
  "Optional. Leave blank for a source with no person, such as Google.";

/** The value the Source field holds for "no source". */
export const NO_SOURCE_VALUE = "";

export interface ReferralSourceChoice {
  value: string;
  label: string;
}

/** The Source field's choices: none, then the live sources, then the current one if it is retired. */
export function referralSourceChoices(
  sources: readonly ReferralSource[],
  currentSourceId: string | null,
): ReferralSourceChoice[] {
  const ordered = sources.toSorted((left, right) => left.position - right.position);
  const choices: ReferralSourceChoice[] = [{ value: NO_SOURCE_VALUE, label: "None" }];
  for (const source of ordered) {
    if (!source.archived) choices.push({ value: source.id, label: source.name });
    else if (source.id === currentSourceId) {
      choices.push({ value: source.id, label: `${source.name} ${RETIRED_SOURCE_MARK}` });
    }
  }
  return choices;
}

/** The referral as the header line says it, or null where nothing is recorded. */
export interface ReferralHeaderLine {
  /** The person or organization who referred, opened in the window when pressed. */
  readonly referrer: { readonly entityId: string; readonly name: string } | null;
  /** The source: in brackets after a person, alone without one. */
  readonly sourceName: string | null;
}

export function referralHeaderLine(referral: EntityReferral | null): ReferralHeaderLine | null {
  if (referral === null) return null;
  const referrer =
    referral.referrer === null
      ? null
      : {
          entityId: referral.referrer.mergedIntoId ?? referral.referrer.entityId,
          name: referral.referrer.displayName ?? "an unnamed record",
        };
  const sourceName = referral.source?.name ?? null;
  if (referrer === null && sourceName === null) return null;
  return { referrer, sourceName };
}

/** The header line as one string, for a printout or a test: what the screen draws, in words. */
export function referralHeaderText(line: ReferralHeaderLine): string {
  if (line.referrer === null) return `Referred by ${line.sourceName ?? ""}`;
  return line.sourceName === null
    ? `Referred by ${line.referrer.name}`
    : `Referred by ${line.referrer.name} (${line.sourceName})`;
}

/** What the About card's Referral row and New Person hold while they are edited. */
export interface ReferralDraft {
  sourceId: string;
  referrer: { identifier: string; name: string; kind: "person" | "organization" } | null;
}

export function emptyReferralDraft(): ReferralDraft {
  return { sourceId: NO_SOURCE_VALUE, referrer: null };
}

export function referralDraftFrom(referral: EntityReferral | null): ReferralDraft {
  if (referral === null) return emptyReferralDraft();
  const referrer = referral.referrer;
  return {
    sourceId: referral.source?.id ?? NO_SOURCE_VALUE,
    referrer:
      referrer === null
        ? null
        : {
            identifier: referrer.entityId,
            name: referrer.displayName ?? "",
            kind: referrer.entityId.startsWith("directoryOrganization_")
              ? "organization"
              : "person",
          },
  };
}

/** The write a draft asks for. Both null removes the referral. */
export function referralPayload(draft: ReferralDraft): {
  sourceId: string | null;
  referrerEntityId: string | null;
} {
  return {
    sourceId: draft.sourceId === NO_SOURCE_VALUE ? null : draft.sourceId,
    referrerEntityId: draft.referrer?.identifier ?? null,
  };
}

/** Whether the draft says something the record does not. */
export function referralDraftChanged(
  draft: ReferralDraft,
  referral: EntityReferral | null,
): boolean {
  const asked = referralPayload(draft);
  return (
    asked.sourceId !== (referral?.source?.id ?? null) ||
    asked.referrerEntityId !== (referral?.referrer?.entityId ?? null)
  );
}

/** Whether a draft records anything at all; an empty one is not written for a new record. */
export function referralDraftIsEmpty(draft: ReferralDraft): boolean {
  const asked = referralPayload(draft);
  return asked.sourceId === null && asked.referrerEntityId === null;
}
