import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { UserId } from "@magna-carta/identifiers/types";
import {
  createNotificationPolicyReader,
  readMemberNotificationPreferences,
  readTrustComplianceRecipients,
  resolveCategoryPreference,
  resolveNotificationPreferencesForMember,
  writeFirmNotificationPreferencesStatement,
  writeMemberNotificationPreferencesStatement,
  writeTrustComplianceRecipientsStatement,
  MAX_TRUST_COMPLIANCE_RECIPIENTS,
  NOTIFICATION_PREFERENCES_KEY,
  notificationPreferencesDefinition,
} from "../src/preferences.ts";
import {
  defaultEmailCadenceFor,
  MANDATORY_CATEGORIES,
  NOTIFICATION_CATEGORIES,
} from "../src/types.ts";

type Database = ReturnType<typeof createMigratedNodeDatabase>["database"];

const NOW = "2026-08-16T02:00:00.000Z";
const MEMBER = "user_member000000000" as UserId;
const OTHER = "user_other0000000000" as UserId;

function database(): Database {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedActiveMember(
  firmDatabase: Database,
  userId: string,
  status: "active" | "deactivated" = "active",
): Promise<void> {
  await firmDatabase
    .prepare(
      "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
    )
    .bind(userId, `Member ${userId}`, status, NOW)
    .run();
}

describe("the preference value", () => {
  it("declares exactly one entry per category, so adding a category cannot silently have no switch", () => {
    // The schema is written out category by category rather than generated, which buys inferred
    // types and costs exactly this test. Without it a twelfth category would be un-settable and
    // nothing would say so.
    const shape = notificationPreferencesDefinition.schema as unknown as {
      shape: Record<string, unknown>;
    };
    expect(Object.keys(shape.shape).sort()).toEqual([...NOTIFICATION_CATEGORIES].sort());
  });

  it("defaults to on in app everywhere, and to a daily mail except for the two watched categories", async () => {
    const resolved = await resolveNotificationPreferencesForMember(database(), MEMBER);
    for (const category of NOTIFICATION_CATEGORIES) {
      const entry = resolved.get(category);
      expect(entry?.inApp, category).toBe("on");
      expect(entry?.email, category).toBe(defaultEmailCadenceFor(category));
    }
    expect(resolved.get("jobs")?.email).toBe("off");
    expect(resolved.get("system")?.email).toBe("off");
    expect(resolved.get("deadlines")?.email).toBe("daily");
  });

  it("stores a member's choice sparsely and reads it back unresolved", async () => {
    const firmDatabase = database();
    await writeMemberNotificationPreferencesStatement(
      firmDatabase,
      MEMBER,
      { billing: { inApp: "off" } },
      NOW,
    ).run();
    // Only what the member actually chose — not the firm's tier, and not today's recommendation
    // frozen into a row that would stop tracking the recommendation the day it changes.
    expect(await readMemberNotificationPreferences(firmDatabase, MEMBER)).toEqual({
      billing: { inApp: "off" },
    });
    expect(await readMemberNotificationPreferences(firmDatabase, OTHER)).toEqual({});
  });

  it("falls through to the default rather than bricking the read on a corrupt stored value", async () => {
    const firmDatabase = database();
    await firmDatabase
      .prepare(
        "INSERT INTO scoped_setting (key, scope_tier, scoped_id, value, updated_at) VALUES (?1, 'user', ?2, ?3, ?4)",
      )
      .bind(NOTIFICATION_PREFERENCES_KEY, MEMBER, "not json", NOW)
      .run();
    const resolved = await resolveNotificationPreferencesForMember(firmDatabase, MEMBER);
    expect(resolved.get("billing")?.inApp).toBe("on");
  });

  it("reads only the asking member's tier, never another member's", async () => {
    const firmDatabase = database();
    await writeMemberNotificationPreferencesStatement(
      firmDatabase,
      OTHER,
      { billing: { inApp: "off" } },
      NOW,
    ).run();
    const resolved = await resolveNotificationPreferencesForMember(firmDatabase, MEMBER);
    expect(resolved.get("billing")?.inApp).toBe("on");
    expect(resolved.get("billing")?.memberChoice).toBeNull();
  });
});

describe("the firm policy floor", () => {
  it("lets a member silence a non-mandatory category in app", () => {
    const resolved = resolveCategoryPreference("billing", { inApp: "off" }, null);
    expect(resolved.inApp).toBe("off");
    expect(resolved.inAppLockedBy).toBeNull();
    expect(resolved.inAppSuppressionReason).toBe("member-preference");
  });

  it("lets a firm RAISE the in-app floor, and the member cannot lower it back", () => {
    const resolved = resolveCategoryPreference("billing", { inApp: "off" }, { inApp: "on" });
    expect(resolved.inApp).toBe("on");
    expect(resolved.inAppLockedBy).toBe("firm-policy");
    expect(resolved.inAppSuppressionReason).toBeNull();
  });

  it("treats a firm's in-app OFF as a default a member may raise, not a ceiling", () => {
    // A floor binds upward only. A firm has no legitimate interest in preventing somebody from
    // hearing about their own work, so the firm's off is the firm's recommendation and the member's
    // on wins over it.
    expect(resolveCategoryPreference("billing", { inApp: "on" }, { inApp: "off" }).inApp).toBe(
      "on",
    );
    // And with no member choice at all it stands, attributed to the firm rather than to the member.
    const unset = resolveCategoryPreference("billing", null, { inApp: "off" });
    expect(unset.inApp).toBe("off");
    expect(unset.inAppSuppressionReason).toBe("firm-policy");
  });

  it("ignores an in-app OFF on a mandatory category, from EITHER tier", () => {
    for (const category of MANDATORY_CATEGORIES) {
      const bothOff = resolveCategoryPreference(category, { inApp: "off" }, { inApp: "off" });
      expect(bothOff.inApp, category).toBe("on");
      expect(bothOff.inAppLockedBy, category).toBe("mandatory");
      expect(bothOff.inAppSuppressionReason, category).toBeNull();
    }
  });

  it("still lets a member set a mandatory category's EMAIL cadence to off", () => {
    // Forcing a copy into a mailbox the firm may not administer is a different act from putting a
    // row in a feed the platform controls, and only the second is non-optional.
    for (const category of MANDATORY_CATEGORIES) {
      expect(resolveCategoryPreference(category, { email: "off" }, null).email, category).toBe(
        "off",
      );
    }
  });

  it("never lets a firm force a member's email cadence UPWARD", () => {
    expect(resolveCategoryPreference("deadlines", { email: "off" }, { email: "daily" }).email).toBe(
      "off",
    );
    expect(
      resolveCategoryPreference("deadlines", { email: "weekly" }, { email: "daily" }).email,
    ).toBe("weekly");
  });

  it("lets a firm's cadence stand where the member has expressed none", () => {
    expect(resolveCategoryPreference("jobs", null, { email: "weekly" }).email).toBe("weekly");
  });
});

describe("the trust-compliance designation", () => {
  let firmDatabase: Database;
  beforeEach(() => {
    firmDatabase = database();
  });

  it("resolves to nobody until a firm configures it", async () => {
    // An audience nobody has configured resolves to nobody, never to the firm: defaulting it would
    // be inventing a disclosure out of an absent setting.
    expect(await readTrustComplianceRecipients(firmDatabase)).toEqual([]);
  });

  it("stores the list canonically, so a reordered rewrite is the same bytes", async () => {
    await writeTrustComplianceRecipientsStatement(firmDatabase, [OTHER, MEMBER, MEMBER], NOW).run();
    expect(await readTrustComplianceRecipients(firmDatabase)).toEqual([MEMBER, OTHER]);
  });

  it("refuses a list longer than the cap at the WRITE, loudly", () => {
    // A designation is a small named group. A list the size of a firm's staff is a firm using this
    // as a broadcast, which the mandatory in-app row on the trust category already does better.
    const tooMany = Array.from(
      { length: MAX_TRUST_COMPLIANCE_RECIPIENTS + 1 },
      (_entry, index) => `user_designated${index}`,
    );
    expect(() => writeTrustComplianceRecipientsStatement(firmDatabase, tooMany, NOW)).toThrow();
  });
});

describe("the per-pass policy reader", () => {
  it("answers repeated members from one read rather than one read per event", async () => {
    // A firm's overdue deadlines resolve to the same handful of people hundreds of times over. The
    // cache is what keeps the sweep's query count from doubling for an answer that cannot change
    // inside a pass.
    const firmDatabase = database();
    await writeFirmNotificationPreferencesStatement(
      firmDatabase,
      { billing: { inApp: "on" } },
      NOW,
    ).run();

    let reads = 0;
    const counting = {
      prepare(sql: string) {
        if (sql.includes(NOTIFICATION_PREFERENCES_KEY) || sql.includes("scoped_setting")) reads++;
        return firmDatabase.prepare(sql);
      },
    } as unknown as Database;

    const reader = createNotificationPolicyReader(counting);
    await reader.preferencesFor([MEMBER, OTHER]);
    await reader.preferencesFor([MEMBER]);
    await reader.preferencesFor([OTHER, MEMBER]);
    expect(reads).toBe(1);

    // A member it has not seen costs exactly one more read, and only for that member.
    await reader.preferencesFor([MEMBER, "user_third0000000000" as UserId]);
    expect(reads).toBe(2);
  });

  it("reads the firm's designation once for the whole pass", async () => {
    const firmDatabase = database();
    await seedActiveMember(firmDatabase, MEMBER);
    await writeTrustComplianceRecipientsStatement(firmDatabase, [MEMBER], NOW).run();
    let reads = 0;
    const counting = {
      prepare(sql: string) {
        if (sql.includes("scoped_setting")) reads++;
        return firmDatabase.prepare(sql);
      },
    } as unknown as Database;
    const reader = createNotificationPolicyReader(counting);
    expect(await reader.trustComplianceRecipients()).toEqual([MEMBER]);
    expect(await reader.trustComplianceRecipients()).toEqual([MEMBER]);
    expect(reads).toBe(1);
  });

  it("drops a designated member who has left, while the configuration still names them", async () => {
    // The stored list is the firm's configuration and outlives a departure by design — the firm
    // removes a name when it decides to. But a fan-out must not keep addressing somebody who cannot
    // sign in, and this audience reaches email where a deactivated member's feed does not. So the
    // API's read still shows the departed name (there is nothing to remove otherwise) and the
    // fan-out's read does not.
    const firmDatabase = database();
    await seedActiveMember(firmDatabase, MEMBER);
    await seedActiveMember(firmDatabase, OTHER, "deactivated");
    await writeTrustComplianceRecipientsStatement(firmDatabase, [MEMBER, OTHER], NOW).run();

    expect(await readTrustComplianceRecipients(firmDatabase)).toEqual([MEMBER, OTHER]);
    expect(await createNotificationPolicyReader(firmDatabase).trustComplianceRecipients()).toEqual([
      MEMBER,
    ]);
  });
});
