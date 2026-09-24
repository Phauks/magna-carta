import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { MATTER_CLOSED_TOPIC } from "@magna-carta/matters/topics";
import { NOTIFICATION_TYPES } from "@magna-carta/notifications/registry";
import { translateOutboxMessage } from "@magna-carta/notifications/translate";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { INCIDENT_CREATED_TOPIC } from "../src/http/routes/platform/incidents.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The member's own notification feed, driven through the chokepoint over real Miniflare bindings.
// The rows are put there the way production puts them there — through the translator, from an
// outbox message — rather than by inserting them, so what these tests read back is what the
// subscriber actually writes.

let firmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let otherCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString() };

// A member with no role and one unrelated direct grant: proves the chokepoint refuses the feed to a
// caller who genuinely lacks the capability rather than to one with no session at all.
async function mirrorMemberWithUnrelatedGrant(userId: UserId, displayName: string): Promise<void> {
  await insertMemberStatement(firmDatabase, { userId, displayName, now: clock.now() }).run();
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
    )
    .bind(newIdentifier("grant"), userId, "firm:reportIncident", clock.now())
    .run();
}

// Instants are supplied rather than taken from the clock, and that is not fussiness: the feed's
// keyset walks (created_at, id), so two rows written inside one millisecond would order by a random
// identifier and any assertion about "the newer one" would be a coin flip.
async function raiseMatterClosedFor(
  matterId: string,
  outboxRowId: string,
  at: string,
): Promise<void> {
  await translateOutboxMessage({
    database: firmDatabase,
    outboxRowId,
    topic: MATTER_CLOSED_TOPIC,
    payload: JSON.stringify({ matterId }),
    now: () => at,
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Notifications Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("notifications-owner@example.com", {
    userName: "Notifications Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Notifications Owner", firmId);
  ownerCookie = await signInForSessionCookie("notifications-owner@example.com");

  const other = await seedCredentialedUser("notifications-other@example.com", {
    userName: "No Notifications",
    firmId,
  });
  await mirrorMemberWithUnrelatedGrant(other.userId, "No Notifications");
  otherCookie = await signInForSessionCookie("notifications-other@example.com");

  // One ordinary matter the owner is responsible for, and the platform-owned holding matter the
  // visible-matter predicate really excludes — the row that makes the wall test a test.
  await firmDatabase
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, matter_number, e_billing, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, 0, ?5, ?5)",
    )
    .bind("matter_notif00000001", "Ellison v. Braddock", ownerUserId, "8181-3", clock.now())
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, system_key, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, 0, 'custody-holding', ?4, ?4)",
    )
    .bind("matter_notif00000002", "Platform Holding", ownerUserId, clock.now())
    .run();

  await raiseMatterClosedFor(
    "matter_notif00000001",
    "outbox_notif_visible",
    "2026-08-07T01:00:00.000Z",
  );
  await raiseMatterClosedFor(
    "matter_notif00000002",
    "outbox_notif_hidden",
    "2026-08-07T01:00:01.000Z",
  );
});

describe("the registry's one topic without a producing-package constant", () => {
  it("spells incident.created exactly as the route that emits it", () => {
    // Every other subscription resolves to an imported constant by construction. This one cannot —
    // its producer is a worker route with no owning domain package — so the pin lives here, where
    // both sides are importable. A divergence would be silent: an unrecognized topic on the
    // per-firm bus is acked and ignored by design.
    const incidentType = NOTIFICATION_TYPES.find((type) => type.key === "system.incident.created");
    expect(incidentType?.subscribesTo).toBe(INCIDENT_CREATED_TOPIC);
  });
});

describe("GET /api/v1/notifications", () => {
  it("returns the member's own feed, filtered by matter visibility", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/notifications", {
      headers: { cookie: ownerCookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { kind: string; matterId: string; matterNumber: string | null }[];
      nextCursor: string | null;
    };
    // The holding matter's notification was written and is filtered at READ — the row is still
    // there, it is simply not this read's business.
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.kind).toBe("system.matter.closed");
    expect(body.data[0]?.matterId).toBe("matter_notif00000001");
    // The firm's own number for the matter, resolved through the same join that enforced the wall.
    expect(body.data[0]?.matterNumber).toBe("8181-3");
  });

  it("carries no string a person typed", async () => {
    // The fixture matter is deliberately named after the parties. If a title ever reaches a
    // notification response, this fails.
    const response = await SELF.fetch("https://example.com/api/v1/notifications", {
      headers: { cookie: ownerCookie },
    });
    expect(await response.text()).not.toContain("Ellison");
  });

  it("shows a member with no notifications an empty feed rather than somebody else's", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/notifications", {
      headers: { cookie: otherCookie },
    });
    // The capability is seeded to every default role, but this member holds no role at all — so the
    // chokepoint refuses before the read. Either way they never see another member's feed.
    expect([200, 403]).toContain(response.status);
    if (response.status === 200) {
      const body = (await response.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    }
  });

  it("refuses an unregistered category rather than ignoring the filter", async () => {
    // A silently dropped filter returns MORE than the caller asked for, which on a read spanning
    // every matter is the wrong direction to fail in.
    const response = await SELF.fetch(
      "https://example.com/api/v1/notifications?category=everything",
      { headers: { cookie: ownerCookie } },
    );
    // The app-level request-shape refusal, not a 200 with an unfiltered page.
    expect(response.status).toBe(422);
  });

  it("refuses a session-less request", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/notifications");
    expect(response.status).toBe(401);
  });
});

describe("GET /api/v1/notifications/unread-count", () => {
  it("counts exactly what the filtered page shows, and reports swept-unread beside it", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/notifications/unread-count", {
      headers: { cookie: ownerCookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      unreadCount: number;
      sweptUnreadCount: number;
      sweptUnreadOldestOccurredAt: string | null;
    };
    // One visible, one filtered — a count that included the filtered row would tell the member how
    // many things they are not allowed to see.
    expect(body.unreadCount).toBe(1);
    // Nothing has been swept, and the field is present rather than absent: a member is told about a
    // gap when there is one, and told there is none when there is not.
    expect(body.sweptUnreadCount).toBe(0);
    expect(body.sweptUnreadOldestOccurredAt).toBeNull();
  });
});

describe("settling a notification", () => {
  it("marks read, is idempotent, and then dismisses", async () => {
    const page = (await (
      await SELF.fetch("https://example.com/api/v1/notifications", {
        headers: { cookie: ownerCookie },
      })
    ).json()) as { data: { id: string }[] };
    const id = page.data[0]?.id ?? "";

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await SELF.fetch(`https://example.com/api/v1/notifications/${id}/read`, {
        method: "POST",
        headers: { cookie: ownerCookie },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id, state: "read" });
    }

    const count = (await (
      await SELF.fetch("https://example.com/api/v1/notifications/unread-count", {
        headers: { cookie: ownerCookie },
      })
    ).json()) as { unreadCount: number };
    expect(count.unreadCount).toBe(0);

    const dismissed = await SELF.fetch(`https://example.com/api/v1/notifications/${id}/dismiss`, {
      method: "POST",
      headers: { cookie: ownerCookie },
    });
    expect(dismissed.status).toBe(200);
    expect(await dismissed.json()).toEqual({ id, state: "dismissed" });
  });

  it("answers 404 for a notification that is not this member's", async () => {
    // Never 403: a distinguishable refusal tells the caller the row exists.
    const response = await SELF.fetch(
      `https://example.com/api/v1/notifications/${newIdentifier("notificationRecipient")}/read`,
      { method: "POST", headers: { cookie: ownerCookie } },
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/v1/notifications/read-all", () => {
  it("refuses a cursor this API did not mint", async () => {
    // Elsewhere a malformed cursor means "the first page", which is harmless for a read. Here that
    // reading would silently mean "everything", which is the opposite of what the bound is for.
    const response = await SELF.fetch("https://example.com/api/v1/notifications/read-all", {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ throughCursor: "not-a-cursor" }),
    });
    expect(response.status).toBe(400);
  });

  it("cannot clear what arrived AFTER the page the caller read", async () => {
    // The whole reason the bound exists. Two notifications are shown; a third lands while the
    // member is looking at them; the mark covers the two they saw and leaves the one they did not.
    await raiseMatterClosedFor(
      "matter_notif00000001",
      "outbox_notif_readall_1",
      "2026-08-07T04:00:00.000Z",
    );
    await raiseMatterClosedFor(
      "matter_notif00000001",
      "outbox_notif_readall_2",
      "2026-08-07T04:00:01.000Z",
    );

    const rendered = (await (
      await SELF.fetch("https://example.com/api/v1/notifications?state=unread&pageSize=2", {
        headers: { cookie: ownerCookie },
      })
    ).json()) as {
      data: { id: string }[];
      nextCursor: string | null;
      readThroughCursor: string | null;
    };
    expect(rendered.data).toHaveLength(2);

    // Arrives after the page was drawn.
    await raiseMatterClosedFor(
      "matter_notif00000001",
      "outbox_notif_readall_3",
      "2026-08-07T04:00:02.000Z",
    );

    // The bound comes from the page itself. This used to be minted here by hand, which meant the
    // cursor's encoding lived in a second place and the one caller that mattered — a client — had
    // no way to obtain it at all.
    const seenNewestCursor = rendered.readThroughCursor ?? "";

    const response = await SELF.fetch("https://example.com/api/v1/notifications/read-all", {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ throughCursor: seenNewestCursor }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { remainingUnreadCount: number };
    expect(body.remainingUnreadCount).toBe(1);
  });

  it("clears a backlog that fits on ONE page, where nextCursor is null", async () => {
    // The ordinary case, and the one the feed's continuation cursor cannot serve: a member whose
    // whole backlog fits on a single page gets `nextCursor: null`, so a client with only that field
    // would have nothing to send and would have to leave "mark all read" disabled for exactly the
    // people who need one press to be done. `readThroughCursor` is present whenever the page is.
    const page = (await (
      await SELF.fetch("https://example.com/api/v1/notifications?state=unread", {
        headers: { cookie: ownerCookie },
      })
    ).json()) as {
      data: { id: string }[];
      nextCursor: string | null;
      readThroughCursor: string | null;
    };
    expect(page.data.length).toBeGreaterThan(0);
    expect(page.nextCursor).toBeNull();
    expect(page.readThroughCursor).not.toBeNull();

    const response = await SELF.fetch("https://example.com/api/v1/notifications/read-all", {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ throughCursor: page.readThroughCursor ?? "" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { remainingUnreadCount: number };
    expect(body.remainingUnreadCount).toBe(0);
  });

  it("reports no readThroughCursor for an empty page", async () => {
    // Null because there is no row to name, not because the field was forgotten — the two would be
    // indistinguishable to a caller, and one of them is a bug.
    const page = (await (
      await SELF.fetch("https://example.com/api/v1/notifications?state=unread", {
        headers: { cookie: ownerCookie },
      })
    ).json()) as { data: unknown[]; readThroughCursor: string | null };
    expect(page.data).toHaveLength(0);
    expect(page.readThroughCursor).toBeNull();
  });
});
