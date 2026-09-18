/*
 * Which of the firm's trust accounts this matter's Trust section reads against.
 *
 * EVERY READ AND WRITE ON THIS SURFACE NAMES ONE ACCOUNT (trust-api.ts). A firm commonly holds one,
 * so asking the reader to pick it every time would be a control that has one answer; a firm with an
 * account per office holds several, and there the choice is a real one and worth remembering. So
 * the rule is: take the reader's own remembered choice where it is still on the roster, and
 * otherwise take the first OPEN account by name.
 *
 * A CLOSED ACCOUNT STAYS PICKABLE AND IS NEVER PICKED FOR ANYBODY. A matter's history may sit in an
 * account the firm has since closed, so hiding it would hide the record; choosing it by default
 * would open the section on an account nothing can be posted into. Those are two different
 * judgments and this file makes both.
 *
 * The choice is a pure function so it can be read and tested without a browser: it is the one rule
 * the section's whole shape follows from, and a rule that only runs inside a component is a rule
 * nobody can check.
 */
import type { PreferenceCodec } from "$lib/preferences/persisted-preference.ts";
import type { TrustAccountListing } from "./trust-api.ts";

/** Where the reader's chosen account is remembered, per browser. */
export const TRUST_ACCOUNT_PREFERENCE_KEY = "magna-carta-trust-account";

/**
 * The codec for that memory: an account identifier, or nothing remembered.
 *
 * It is deliberately not a string-union preference — the allowed values are the firm's own accounts,
 * which this browser cannot know at module load. A remembered identifier that is no longer on the
 * roster is folded away by the choice below rather than by the codec, because "the account was
 * closed and removed" is a fact about the firm, not a corrupt payload.
 */
export function trustAccountPreference(): PreferenceCodec<string | null> {
  return {
    storageKey: TRUST_ACCOUNT_PREFERENCE_KEY,
    decode(raw) {
      return raw === null || raw === "" ? null : raw;
    },
    encode(value) {
      return value ?? "";
    },
  };
}

/** The accounts a picker offers, in the order it offers them: by name, so the list is scannable. */
export function trustAccountsInPickingOrder(
  accounts: readonly TrustAccountListing[],
): readonly TrustAccountListing[] {
  return accounts.toSorted(
    (one, other) => one.name.localeCompare(other.name) || (one.id < other.id ? -1 : 1),
  );
}

/**
 * The account this section opens on, or null where the firm has none to open on.
 *
 * Null means one of two facts, and the surface tells them apart by whether the roster is empty: a
 * firm that has opened no trust account at all, or a firm whose accounts are all closed and whose
 * reader has not picked one of them. Both are facts the section states rather than failures.
 */
export function chooseTrustAccount(
  accounts: readonly TrustAccountListing[],
  rememberedAccountId: string | null,
): string | null {
  if (accounts.length === 0) return null;
  // A remembered choice is the reader's own, including a closed account they went looking for.
  const remembered = accounts.find((account) => account.id === rememberedAccountId);
  if (remembered !== undefined) return remembered.id;
  const open = trustAccountsInPickingOrder(accounts).find((account) => account.status === "open");
  return open?.id ?? null;
}
