/*
 * Why a control is refused, in the one sentence the product uses to say it.
 *
 * A refused control is disabled and still drawn, with this line on its title, so a reader learns
 * the capability exists and that their account does not hold it rather than wondering where a
 * control went. The sentence therefore has to say BOTH halves: what was being attempted, and which
 * permission would allow it. A reader told only "this account does not hold billing:finalize" has
 * to work out what that would have let them do, and a reader told only "you cannot finalize" has
 * nothing to take to whoever administers their account.
 *
 * It was written out at seventeen call sites in this form and at seven more in a shorter one that
 * named the permission and not the act. Two wordings for one refusal is one wording that has
 * already drifted, and the shorter one lost the half a reader can act on.
 */

/**
 * The refusal line for a control the account may not use.
 *
 * `act` names what the control would have done, as a gerund phrase that opens the sentence —
 * "Opening a matter", "Recording on the calendar". `permission` is the key exactly as the
 * access-control registry spells it, because that is the string a reader quotes to an administrator.
 */
export function permissionRefusal(act: string, permission: string): string {
  return `${act} needs the ${permission} permission, which this account does not hold.`;
}
