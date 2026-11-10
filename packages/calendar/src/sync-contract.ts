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
