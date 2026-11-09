import { z } from "zod";
import { paginated } from "@magna-carta/data-access/pagination-contract";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_RECIPIENT_STATES } from "./types.ts";

// The notification feed's contract: what its API returns, and the one request body it accepts, as
// plain zod. Each component is named with zod's own metadata (`.meta({ id })`), which the contract
// emitter reads as the component's name, so the route module in apps/api-worker declares its routes
// over these without restating a field. Path and query parameters stay with the routes: they are
// addressing, not domain shape (docs/conventions/api.md, _Where a contract shape lives_).

export const NotificationCategoryEnum = z.enum(NOTIFICATION_CATEGORIES);
export const NotificationStateEnum = z.enum(NOTIFICATION_RECIPIENT_STATES);

export const NotificationItem = z
  .object({
    id: z.string(),
    kind: z.string(),
    category: NotificationCategoryEnum,
    severity: z.enum(["informational", "attention", "critical"]),
    state: NotificationStateEnum,
    subjectKind: z.string(),
    subjectId: z.string(),
    matterId: z.string().nullable(),
    // The firm's own number for the matter, resolved at read time through the visibility join. Not
    // the title: a matter title is client-identifying by construction, because firms name matters
    // after the parties and the dispute.
    matterNumber: z.string().nullable(),
    occurredAt: z.string(),
    createdAt: z.string(),
    readAt: z.string().nullable(),
    dismissedAt: z.string().nullable(),
    // The declared non-privileged slot: identifiers, integers, booleans, declared enum labels, and
    // dates. A registered type cannot declare a free-text field.
    facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable(),
    link: z.string(),
  })
  .meta({ id: "NotificationItem" });

// The feed page carries ONE field beyond the uniform envelope: a cursor naming the NEWEST row it
// returned. `nextCursor` cannot serve here — it names the page's oldest row and is null at the end
// of the record, which is exactly the common case of a member with one page of notifications.
// Without this field a client has only two ways to offer "mark all read": mint the cursor itself,
// which puts the cursor's encoding in a second place and guarantees the two drift, or fire one
// request per visible row, which is neither atomic nor able to clear the aged-out tally. So the
// route that mints cursors hands this one back too.
export const NotificationPage = paginated(NotificationItem)
  .extend({
    readThroughCursor: z.string().nullable(),
  })
  .meta({ id: "NotificationPage" });

export const UnreadCountResponse = z
  .object({
    unreadCount: z.number().int(),
    // What the retention sweep took from this member while it was still unread. Reported BESIDE the
    // live count and never folded into it: they are different facts — one is work waiting, the
    // other is work that aged out — and adding them would produce a number that means neither.
    // Surfaced rather than dropped because "there is nothing to see" is a claim the platform is not
    // in a position to make about a member who was away; what the swept pointers pointed at (the
    // matter timeline, the deadline, the audit log) is all still there.
    sweptUnreadCount: z.number().int(),
    sweptUnreadOldestOccurredAt: z.string().nullable(),
  })
  .meta({ id: "NotificationUnreadCountResponse" });

export const MarkReadResponse = z
  .object({ id: z.string(), state: NotificationStateEnum })
  .meta({ id: "NotificationMarkResponse" });

export const MarkAllReadRequest = z
  .object({
    // The cursor from a page the caller actually rendered. REQUIRED, and the reason is not
    // ceremony: without it "mark all read" would silently clear items that arrived after the page
    // was drawn — the member is saying "these", not "whatever is there when this lands" — and it
    // would become an unbounded UPDATE over a member's whole history.
    throughCursor: z.string(),
  })
  .meta({ id: "NotificationMarkAllReadRequest" });

export const MarkAllReadResponse = z
  .object({
    // What the badge now says, re-read under the same visibility filter. Reported instead of "how
    // many did I just clear" because that is the number the caller actually needs and the one this
    // route can answer honestly: a driver-reported changed-row count is not uniform across the
    // batch adapters this runs on, and inventing a plausible number would be worse than not
    // offering one.
    remainingUnreadCount: z.number().int(),
  })
  .meta({ id: "NotificationMarkAllReadResponse" });
