/*
 * The joining surface's honest inventory of what each step actually does — across BOTH halves of
 * joining, the signed-out one (registering a person) and the signed-in one (settling which firm
 * they belong to), because they are one act and a reader asking "how far does this carry" is asking
 * about the whole of it.
 *
 * Same rule as the sign-in surface's register of unbuilt capabilities
 * (apps/web/src/lib/auth/unbuilt-capabilities.ts) and the Documents surface's loop inventory
 * (apps/web/src/lib/documents/document-loop-availability.ts): a control is never rendered as though
 * it worked. The difference here is that the three routes behind these screens are all real and all
 * answer — what varies is how far the answer carries. The steps that stop short of where a visitor
 * would expect them to end are written down here so the screens can say it instead of leaving
 * somebody to discover it by clicking.
 *
 * Verified against apps/api-worker/src/http/routes/session/registrations.ts, apps/api-worker/src/http/routes/session/invitations.ts
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
   * `unbuilt` — there is no route at all. Rendered as a sentence, never as a control.
   */
  reach: "live" | "partial" | "unbuilt";
  /** One sentence: what actually happens when this step is taken, stated without euphemism. */
  behaviour: string;
}

export const JOINING_STEPS: readonly JoiningStep[] = [
  {
    id: "register-account",
    label: "Create an account",
    reach: "live",
    behaviour:
      "Records the registration and mails the address a confirmation token. Nothing is asked about a firm, because a person does not have one yet. A taken address and a free one answer identically; the difference is in the mail, which goes to the address in question.",
  },
  {
    id: "confirm-registration",
    label: "Confirm the registration from the email",
    reach: "live",
    behaviour:
      "Spending the token creates the account and sends the link that sets its password. The mail carries a link that lands on the confirmation screen with the field filled, plus the bare code for a mail client that will not open links; either way the token is spent only on a deliberate press, never by a link preview.",
  },
  {
    id: "found-firm",
    label: "Start a new law firm",
    reach: "live",
    behaviour:
      "Queues the firm's build with the signed-in account as its owner, and answers that it is under way rather than that it is ready. The bootstrap call reports when it has arrived; a second press never starts a second firm.",
  },
  {
    id: "redeem-invitation",
    label: "Redeem an invitation",
    reach: "live",
    behaviour:
      "Checks the code, surname and date of birth against one digest over all three and, when they match, joins the signed-in account to the inviting firm. The invitation must name this account's own address, which is what the mailed password link used to prove. Every unsuccessful combination is one identical refusal.",
  },
  {
    id: "join-firm-by-asking",
    label: "Ask a firm to let you in",
    reach: "unbuilt",
    behaviour:
      "Firms aren't listed publicly. Ask the person who invited you for an invitation code.",
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
