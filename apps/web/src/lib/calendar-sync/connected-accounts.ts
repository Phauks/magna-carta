/*
 * What the Connected Accounts page says, kept apart from the page so each sentence has a test.
 *
 * The page is returned to from the provider with one word on its address saying what happened.
 * A word and never a message: the address is visible and kept in history. This is where each word
 * becomes a sentence a member can act on.
 */

export type SignInOutcome = "connected" | "declined" | "expired" | "unavailable" | "failed";

const OUTCOMES: readonly SignInOutcome[] = [
  "connected",
  "declined",
  "expired",
  "unavailable",
  "failed",
];

/** The outcome an address carries, or null where it carries none this page knows. */
export function signInOutcomeFrom(searchParams: URLSearchParams): SignInOutcome | null {
  const value = searchParams.get("outcome");
  return OUTCOMES.find((outcome) => outcome === value) ?? null;
}

export interface OutcomeNotice {
  readonly tone: "success" | "warning" | "danger";
  readonly title: string;
  readonly description: string;
}

const NOTICES: Readonly<Record<SignInOutcome, OutcomeNotice>> = {
  connected: {
    tone: "success",
    title: "Outlook connected",
    description: "Nothing syncs yet. Connecting an account copies nothing to or from it.",
  },
  declined: {
    tone: "warning",
    title: "Outlook was not connected",
    description:
      "Microsoft did not grant access to the calendar. If you did not cancel it yourself, your organization's administrator may need to allow it.",
  },
  expired: {
    tone: "warning",
    title: "The sign-in ran out of time",
    description:
      "Nothing was connected. Start again from this page, in this browser, and finish within ten minutes.",
  },
  unavailable: {
    tone: "warning",
    title: "Outlook cannot be connected here yet",
    description: "This workspace has not been registered with Microsoft. Nothing was connected.",
  },
  failed: {
    tone: "danger",
    title: "Outlook could not be connected",
    description:
      "Microsoft did not complete the sign-in, or the calendar could not be read afterwards. Nothing was connected.",
  },
};

export function noticeForOutcome(outcome: SignInOutcome): OutcomeNotice {
  return NOTICES[outcome];
}

export type ConnectionStatus = "connected" | "degraded" | "needs_reauth" | "disabled";

const STATUS_SENTENCES: Readonly<Record<ConnectionStatus, string>> = {
  connected: "Connected.",
  degraded: "Microsoft has been failing intermittently. The connection is being retried.",
  needs_reauth:
    "Microsoft is asking you to sign in again. Connect the account again to restore it.",
  disabled: "This connection has been turned off.",
};

/** What a connection's health means to the member whose account it is. */
export function statusSentence(status: ConnectionStatus): string {
  return STATUS_SENTENCES[status];
}

/** The one window a member is asked in before they leave for Microsoft, and all it says. */
export const OUTLOOK_CALENDAR_REQUEST = {
  heading: "Allow Magna Carta to Use Your Outlook Calendar",
  askedBy: "Calendar Sync",
  grants: [
    "See the calendars in your Outlook account",
    "Add, change and remove events in the calendars you choose",
    "Keep working when you are signed out of Magna Carta",
  ],
} as const satisfies {
  heading: string;
  askedBy: string;
  grants: readonly [string, ...string[]];
};
