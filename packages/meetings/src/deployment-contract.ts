import { z } from "zod";

// What this deployment does with a meeting, carried on the session's bootstrap
// (apps/api-worker/src/http/routes/session/me.ts) so a calendar entry's Start can read it before any
// meeting exists to say it. The rule is in docs/conventions/api.md (_Where a contract shape lives_).

/** Whether this deployment opens meetings end-to-end encrypted at all. */
export const MeetingsDeployment = z
  .object({
    endToEndEncryption: z.boolean().meta({
      description:
        "Whether this deployment opens meetings end-to-end encrypted. False, every meeting opens in " +
        "the clear whatever Start asks for.",
    }),
  })
  .meta({ id: "MeetingsDeployment" });
