import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import { z } from "zod";

// What the connected-accounts routes accept and return, as plain zod named with `.meta({ id })`.
// The route module in apps/api-worker declares routes over these and restates no field; the rule
// and its reasoning are in docs/conventions/api.md (_Where a contract shape lives_).

export const CALENDAR_PROVIDERS = ["microsoft"] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];

export const ConnectedAccountProvider = z
  .object({
    provider: z.enum(CALENDAR_PROVIDERS),
    available: z
      .boolean()
      .describe(
        "Whether this deployment can connect an account at the provider. False means nobody has " +
          "registered the deployment with the provider, and a screen offers no connection.",
      ),
  })
  .meta({ id: "ConnectedAccountProvider" });

export const ConnectedAccount = z
  .object({
    id: z.string(),
    provider: z.enum(CALENDAR_PROVIDERS),
    accountLabel: z
      .string()
      .nullable()
      .describe("The account as the provider names it: the member's own sign-in address there."),
    status: z.enum(["connected", "degraded", "needs_reauth", "disabled"]),
    connectedAt: z.string(),
  })
  .meta({ id: "ConnectedAccount" });

export const ConnectedAccountList = z
  .object({ providers: z.array(ConnectedAccountProvider), accounts: z.array(ConnectedAccount) })
  .meta({ id: "ConnectedAccountList" });

export const ConnectedAccountSignInStart = z
  .object({
    authorizationUrl: z
      .string()
      .describe("The provider's own sign-in page. The browser is sent to it as a whole page."),
  })
  .meta({ id: "ConnectedAccountSignInStart" });

export const ConnectedAccountDisconnectAck = z
  .object({ id: z.string(), status: z.literal("disconnected") })
  .meta({ id: "ConnectedAccountDisconnectAck" });

// CALENDAR SYNC SETTINGS: what the firm lets leave, and what a member chose to send.

const SYNC_DETAIL = z
  .enum(["full", "minimal"])
  .describe(
    "How much of an event the firm lets leave: `full`, or `minimal` for the matter number and the " +
      "event type and nothing else.",
  );

const SYNC_SCOPE = z
  .enum(["mine", "my_matters"])
  .describe(
    "Whose events of the type are sent: `mine` is the ones the member takes part in (for " +
      "deadlines, the ones on a matter they are responsible for); `my_matters` is every one on a " +
      "matter they are assigned to.",
  );

const SYNC_SUBJECT_KEY = z
  .string()
  .min(1)
  .max(64)
  .describe("An event type's id, or `deadline` for deadlines as one kind.");

export const CalendarSyncSubject = z
  .object({
    subject: SYNC_SUBJECT_KEY,
    kind: z.enum(["eventType", "deadline"]),
    name: z.string().nullable().describe("The event type's name. Null for the deadline kind."),
    category: z.enum(["litigation", "transaction", "firm", "other"]).nullable(),
    mayLeave: z.boolean().describe("Whether the firm lets this subject be synced at all."),
    detail: SYNC_DETAIL,
  })
  .meta({ id: "CalendarSyncSubject" });

export const CalendarSyncProviderCalendar = z
  .object({
    remoteId: z.string(),
    name: z.string(),
    isDefault: z.boolean(),
    canWrite: z.boolean(),
  })
  .meta({ id: "CalendarSyncProviderCalendar" });

export const CalendarSyncRule = z
  .object({
    subject: SYNC_SUBJECT_KEY,
    calendarRemoteId: z.string(),
    calendarName: z
      .string()
      .describe(
        "The calendar's name when the rule was saved, shown when the provider is unreachable.",
      ),
    scope: SYNC_SCOPE,
  })
  .meta({ id: "CalendarSyncRule" });

export const CalendarSyncShownCalendar = z
  .object({
    calendarRemoteId: z.string(),
    calendarName: z
      .string()
      .describe("The calendar's name when it was chosen, shown when the provider is unreachable."),
  })
  .meta({ id: "CalendarSyncShownCalendar" });

export const CalendarSyncSettings = z
  .object({
    account: ConnectedAccount.nullable().describe(
      "The member's connected account, or null when they have connected none.",
    ),
    calendars: z
      .array(CalendarSyncProviderCalendar)
      .nullable()
      .describe(
        "The account's calendars as the provider lists them now. Null when there is no account or " +
          "the provider could not be asked, in which case rules can be read and not changed.",
      ),
    subjects: z.array(CalendarSyncSubject),
    rules: z.array(CalendarSyncRule),
    shownCalendars: z
      .array(CalendarSyncShownCalendar)
      .describe(
        "The account's calendars the member chose to be shown their own events from. Empty until " +
          "they choose one.",
      ),
  })
  .meta({ id: "CalendarSyncSettings" });

// One page of the catalog is far below this; the cap exists so a request cannot be made of rows.
const MAXIMUM_SUBJECTS_PER_REQUEST = 500;

export const CalendarSyncRulesReplace = z
  .object({
    rules: z
      .array(
        z.object({
          subject: SYNC_SUBJECT_KEY,
          calendarRemoteId: z.string().min(1).max(512),
          scope: SYNC_SCOPE,
        }),
      )
      .max(MAXIMUM_SUBJECTS_PER_REQUEST)
      .describe("The member's whole rule set. A subject absent from it is not synced."),
  })
  .meta({ id: "CalendarSyncRulesReplace" });

export const CalendarSyncFirmLimits = z
  .object({ subjects: z.array(CalendarSyncSubject) })
  .meta({ id: "CalendarSyncFirmLimits" });

export const CalendarSyncFirmLimitsSet = z
  .object({
    limits: z
      .array(z.object({ subject: SYNC_SUBJECT_KEY, mayLeave: z.boolean(), detail: SYNC_DETAIL }))
      .min(1)
      .max(MAXIMUM_SUBJECTS_PER_REQUEST)
      .describe("The subjects to set. A subject not named keeps the limit it has."),
  })
  .meta({ id: "CalendarSyncFirmLimitsSet" });

// COPIES A MEMBER CHANGED IN THEIR OWN CALENDAR: what was sent, and what is there now.

export const CalendarSyncCopyReading = z
  .object({
    title: z.string(),
    location: z.string().nullable(),
    startsOn: z.string().describe("The first day, as YYYY-MM-DD."),
    startsAtTime: z
      .string()
      .nullable()
      .describe("The wall-clock start as HH:MM, or null when the copy takes the whole day."),
    endsOn: z.string().describe("The last day the copy covers, as YYYY-MM-DD."),
    endsAtTime: z.string().nullable(),
    timeZone: z
      .string()
      .describe("The zone the event was recorded in. Both sides of a difference are read in it."),
  })
  .meta({ id: "CalendarSyncCopyReading" });

export const CalendarSyncIssue = z
  .object({
    localKind: z.enum(["matter_event", "firm_event", "deadline"]),
    localId: z.string(),
    kind: z
      .enum(["changed", "removed", "not_sent"])
      .describe(
        "`changed`: the copy in the member's calendar no longer reads as it was sent. " +
          "`removed`: the copy is no longer in the member's calendar. " +
          "`not_sent`: the provider would not take the event, so there is no copy.",
      ),
    sent: CalendarSyncCopyReading.describe(
      "The event as it was sent to the member's calendar, at the detail the firm allows.",
    ),
    found: CalendarSyncCopyReading.nullable().describe(
      "The copy as the member's calendar holds it now. Null when the copy is gone.",
    ),
    detectedAt: z.string(),
  })
  .meta({ id: "CalendarSyncIssue" });

export const CalendarSyncIssueList = z
  .object({ issues: z.array(CalendarSyncIssue) })
  .meta({ id: "CalendarSyncIssueList" });

// A MEMBER'S OWN EVENTS, SHOWN BACK TO THEM: which calendars, and what is in them.

// An account holds a handful of calendars; the cap exists so a request cannot be made of rows.
const MAXIMUM_SHOWN_CALENDARS = 50;

export const CalendarSyncShownCalendarsReplace = z
  .object({
    calendarRemoteIds: z
      .array(z.string().min(1).max(512))
      .max(MAXIMUM_SHOWN_CALENDARS)
      .describe(
        "The member's whole choice of calendars to be shown. A calendar absent from it is no " +
          "longer read, and what was read from it is removed.",
      ),
  })
  .meta({ id: "CalendarSyncShownCalendarsReplace" });

const CIVIL_DAY = z.string().refine(isCivilDate, "must be a real day written YYYY-MM-DD");

export const CalendarSyncAccountEventWindow = z
  .object({
    from: CIVIL_DAY.describe("The window's first day, as YYYY-MM-DD."),
    to: CIVIL_DAY.describe("The window's last day, as YYYY-MM-DD."),
  })
  .meta({ id: "CalendarSyncAccountEventWindow" });

export const CalendarSyncAccountEvent = z
  .object({
    id: z.string().describe("The provider's own identifier for the event."),
    calendarRemoteId: z.string(),
    calendarName: z.string().nullable(),
    title: z.string(),
    location: z.string().nullable(),
    wholeDay: z.boolean(),
    startsOn: z
      .string()
      .nullable()
      .describe("The first day of a whole-day event, as YYYY-MM-DD. Null on a timed one."),
    endsOn: z
      .string()
      .nullable()
      .describe("The last day a whole-day event covers. Null on a timed one."),
    startsAt: z
      .string()
      .nullable()
      .describe(
        "The instant a timed event starts. Null on a whole-day one. The reader's screen decides " +
          "which day and hour that is.",
      ),
    endsAt: z.string().nullable(),
  })
  .meta({ id: "CalendarSyncAccountEvent" });

export const CalendarSyncAccountEventList = z
  .object({
    shownCalendars: z
      .array(CalendarSyncShownCalendar)
      .describe(
        "The calendars these events are read from: the member's own choice. Empty when they " +
          "have no account or chose none, in which case there is nothing to show them.",
      ),
    events: z.array(CalendarSyncAccountEvent),
    truncated: z
      .boolean()
      .describe("True when the window held more events than one answer carries."),
  })
  .meta({ id: "CalendarSyncAccountEventList" });
