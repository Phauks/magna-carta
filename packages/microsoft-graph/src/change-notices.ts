import { z } from "zod";
import type { ProviderNotice } from "@magna-carta/calendar/sync-port";

// What Microsoft Graph posts to a subscription's address, read into the calendar's terms.
//
// Only two things are taken from a notice: the secret it carries, and whether it is about the
// subscription itself. Which event changed, and how, is deliberately not read. The receiver has not
// yet established who sent the notice when this runs, and a pass that looks at the whole account
// is correct whatever the notice claimed.

const noticeSchema = z.object({
  value: z
    .array(
      z.object({
        clientState: z.string().max(128).optional(),
        lifecycleEvent: z.string().max(64).optional(),
      }),
    )
    .max(1000),
});

const LIFECYCLE: Record<string, NonNullable<ProviderNotice["lifecycle"]>> = {
  reauthorizationRequired: "renew",
  subscriptionRemoved: "replace",
  missed: "missed",
};

// The notices in one posted body. A body that is not Graph's shape holds none. A notice with no
// secret is dropped here, since nothing could ever believe it.
export function readGraphNotices(body: unknown): readonly ProviderNotice[] {
  const parsed = noticeSchema.safeParse(body);
  if (!parsed.success) return [];
  const notices: ProviderNotice[] = [];
  for (const item of parsed.data.value) {
    if (item.clientState === undefined || item.clientState === "") continue;
    const lifecycle =
      item.lifecycleEvent === undefined ? undefined : LIFECYCLE[item.lifecycleEvent];
    // A lifecycle word this reader does not know still means the provider has something to say
    // about the watch; renewing is the answer that is right for all of them.
    notices.push({
      secret: item.clientState,
      ...(item.lifecycleEvent === undefined ? {} : { lifecycle: lifecycle ?? "renew" }),
    });
  }
  return notices;
}
