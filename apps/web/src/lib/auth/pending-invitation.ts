/*
 * An invitation code carried across the account-first flow, and nothing else about the invitation.
 *
 * WHY THIS EXISTS. Somebody who follows a link holding a code, and makes an account before redeeming
 * it, crosses three screens and a mailbox before the field that wants the code appears. Asking them
 * to hold it in their head for that long is how an invitation gets lost — so the code rides along
 * and the joining screen opens with it already filled in.
 *
 * ONLY THE CODE. The surname and the date of birth are the two facts that make a code worth
 * anything: a code alone is a token in a link, and the other two are what stop a forwarded link from
 * being a way in. They are typed once, at the moment of redemption, and are never written down here.
 *
 * PER-TAB, AND CLEARED WHEN SPENT. sessionStorage rather than localStorage, so a code does not
 * outlive the tab that carried it or reach a second person using the same machine — and every access
 * is guarded, because a browser with storage disabled must still let somebody register. The code is
 * not a credential and holding it briefly is not a new exposure: it was in a URL that this browser
 * followed, and it buys nothing on its own.
 */

const PENDING_INVITATION_KEY = "magna-carta.pending-invitation-code";

/** Remember a code the visitor arrived with. A null or blank value clears nothing and stores nothing. */
export function rememberInvitationCode(code: string | null | undefined): void {
  if (code === null || code === undefined || code.trim() === "") return;
  try {
    sessionStorage.setItem(PENDING_INVITATION_KEY, code.trim());
  } catch {
    // Storage disabled or full. The person types the code on the joining screen instead, which is
    // the ordinary path — this is a convenience, and a convenience may never break the flow.
  }
}

/** The code carried this far, or null. */
export function pendingInvitationCode(): string | null {
  try {
    const code = sessionStorage.getItem(PENDING_INVITATION_KEY);
    return code === null || code.trim() === "" ? null : code;
  } catch {
    return null;
  }
}

/** Forget it — called once it has been redeemed, or once the person has been offered it. */
export function forgetInvitationCode(): void {
  try {
    sessionStorage.removeItem(PENDING_INVITATION_KEY);
  } catch {
    // Nothing to do: an unreadable store is also an unwritable one, so there is nothing held.
  }
}
