/*
 * What the Connected Accounts page says, kept apart from the page so each sentence has a test.
 *
 * The page is returned to from the provider with one word on its address saying what happened.
 * A word and never a message: the address is visible and kept in history. This is where each word
 * becomes a sentence a member can act on.
 */

/** The providers a member can connect a calendar account at. */
export type CalendarProvider = "microsoft" | "google";

export const CALENDAR_PROVIDERS: readonly CalendarProvider[] = ["microsoft", "google"];

/** How each provider is named: the product a member connects, who runs it, and their account there. */
export interface ProviderNames {
  readonly product: string;
  readonly company: string;
  readonly account: string;
}

const PROVIDER_NAMES: Readonly<Record<CalendarProvider, ProviderNames>> = {
  microsoft: { product: "Outlook", company: "Microsoft", account: "Microsoft 365 account" },
  google: { product: "Google Calendar", company: "Google", account: "Google account" },
};

export function providerNames(provider: CalendarProvider): ProviderNames {
  return PROVIDER_NAMES[provider];
}

/** The provider an address names, or null where it names none this page knows. */
export function providerFrom(searchParams: URLSearchParams): CalendarProvider | null {
  const value = searchParams.get("provider");
  return CALENDAR_PROVIDERS.find((provider) => provider === value) ?? null;
}

export type SignInOutcome =
  | "connected"
  | "declined"
  | "expired"
  | "unavailable"
  | "failed"
  | "other-account";

const OUTCOMES: readonly SignInOutcome[] = [
  "connected",
  "declined",
  "expired",
  "unavailable",
  "failed",
  "other-account",
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

/** What a return from the provider tells the member. An address naming no provider reads as Outlook's. */
export function noticeForOutcome(
  outcome: SignInOutcome,
  provider: CalendarProvider = "microsoft",
): OutcomeNotice {
  const { product, company } = PROVIDER_NAMES[provider];
  const notices: Readonly<Record<SignInOutcome, OutcomeNotice>> = {
    connected: {
      tone: "success",
      title: `${product} connected`,
      description: "Nothing syncs yet. Connecting an account copies nothing to or from it.",
    },
    declined: {
      tone: "warning",
      title: `${product} was not connected`,
      description: `${company} did not grant access to the calendar. If you did not cancel it yourself, your organization's administrator may need to allow it.`,
    },
    expired: {
      tone: "warning",
      title: "The sign-in ran out of time",
      description:
        "Nothing was connected. Start again from this page, in this browser, and finish within ten minutes.",
    },
    unavailable: {
      tone: "warning",
      title: `${product} cannot be connected here yet`,
      description: `This workspace has not been registered with ${company}. Nothing was connected.`,
    },
    failed: {
      tone: "danger",
      title: `${product} could not be connected`,
      description: `${company} did not complete the sign-in, or the calendar could not be read afterwards. Nothing was connected.`,
    },
    "other-account": {
      tone: "warning",
      title: `${product} was not connected`,
      description:
        "You already have a calendar account connected. Disconnect it first, then connect this one.",
    },
  };
  return notices[outcome];
}

export type ConnectionStatus = "connected" | "degraded" | "needs_reauth" | "disabled";

/** What a connection's health means to the member whose account it is. */
export function statusSentence(
  status: ConnectionStatus,
  provider: CalendarProvider = "microsoft",
): string {
  const { company } = PROVIDER_NAMES[provider];
  const sentences: Readonly<Record<ConnectionStatus, string>> = {
    connected: "Connected.",
    degraded: `${company} has been failing intermittently. The connection is being retried.`,
    needs_reauth: `${company} is asking you to sign in again. Connect the account again to restore it.`,
    disabled: "This connection has been turned off.",
  };
  return sentences[status];
}

export interface CalendarRequest {
  readonly heading: string;
  readonly askedBy: string;
  readonly grants: readonly [string, ...string[]];
}

/** The one window a member is asked in before they leave for the provider, and all it says. */
export function calendarRequestFor(provider: CalendarProvider): CalendarRequest {
  const { product } = PROVIDER_NAMES[provider];
  const account = provider === "microsoft" ? "Outlook account" : "Google account";
  return {
    heading: `Allow Magna Carta to Use Your ${product}`,
    askedBy: "Calendar Sync",
    grants: [
      `See the calendars in your ${account}`,
      "Add, change and remove events in the calendars you choose",
      "Keep working when you are signed out of Magna Carta",
    ],
  };
}
