/*
 * The joining surface's honest inventory of what each step actually does.
 *
 * Same rule as the sign-in surface's register of unbuilt capabilities
 * (apps/web-worker/src/lib/auth/unbuilt-capabilities.ts) and the Documents surface's loop inventory
 * (apps/web-worker/src/lib/documents/document-loop-availability.ts): a control is never rendered as though
 * it worked. The difference here is that the three routes behind these screens are all real and all
 * answer — what varies is how far the answer carries. Two steps stop short of where a visitor would
 * expect them to end, and this module is where that is written down so the screens can say it
 * instead of leaving somebody waiting for an email that reads nothing like a link.
 *
 * Verified against apps/api-worker/src/routes/registrations.ts, apps/api-worker/src/routes/invitations.ts
 * and apps/api-worker/src/email-port.ts. Delete an entry, or move it to `live`, when the gap closes;
 * every consumer follows from here rather than from a flag flipped in several screens.
 */

export interface JoiningStep {
  /** A stable key so a screen can ask about one step without matching on prose. */
  id: string;
  /** What the person is trying to do. */
  label: string;
  /**
   * `live` — the route answers and the step finishes where the person expects.
   * `partial` — the route answers, but something outside it is missing, so the step lands short.
   */
  reach: "live" | "partial";
  /** One sentence: what actually happens when this step is taken, stated without euphemism. */
  behaviour: string;
}

export const JOINING_STEPS: readonly JoiningStep[] = [
  {
    id: "choose-role",
    label: "Say which of the three you are",
    reach: "live",
    behaviour:
      "A client of a firm and someone who works at one both go to invitation redemption; only founding a firm goes anywhere else. The fork is decided in the browser rather than by a round trip, because the answer is a constant the registration route would only repeat.",
  },
  {
    id: "found-firm",
    label: "Start a new law firm",
    reach: "live",
    behaviour:
      "Records the registration and mails the address a confirmation token. A taken address and a free one answer identically; the difference is in the mail, which goes to the address in question.",
  },
  {
    id: "confirm-registration",
    label: "Confirm the registration from the email",
    reach: "partial",
    behaviour:
      "Spending the token is real — the firm's build is queued and the owner is sent the link that sets their password. What is missing is the LINK: the confirmation mail carries the bare token as its whole body, so nothing to click arrives and the token has to be typed in. The screen reads a token out of the address bar as well, so it already works the day the mail carries a URL.",
  },
  {
    id: "redeem-invitation",
    label: "Redeem an invitation",
    reach: "live",
    behaviour:
      "Checks the code, surname and date of birth against one digest over all three and, when they match, creates the account and sends the link that sets its password. Every unsuccessful combination is one identical refusal.",
  },
  {
    id: "agreements",
    label: "Read the Terms of Service and the Privacy Policy",
    reach: "partial",
    behaviour:
      "Both acknowledgements gate the submit, so nobody registers without ticking them. Neither document is published yet, so the two links have no page to open, and no route records that the acknowledgement was given — the gate is in the browser only.",
  },
  {
    id: "choose-credential",
    label: "Choose a passkey or a password while registering",
    reach: "partial",
    behaviour:
      "Neither is chosen here. There is no passkey route to register a credential against, and a password is set afterwards through the emailed link rather than on this form — which is also what proves the mailbox belongs to the person filling it in.",
  },
];

export function joiningStep(id: string): JoiningStep {
  const found = JOINING_STEPS.find((step) => step.id === id);
  if (found === undefined) {
    throw new Error(`No joining step is registered under "${id}".`);
  }
  return found;
}
