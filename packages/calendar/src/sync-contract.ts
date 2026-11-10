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
