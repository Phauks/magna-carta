import { describe, expect, it } from "vitest";
import { checkFilingConflict, DKIM_VERDICT_UNVERIFIED } from "../src/seams.ts";
import { EMAIL_FILED_TOPIC, EMAIL_FILING_OUTBOX_TOPICS } from "../src/topics.ts";

describe("seams placed for later slices", () => {
  it("the filing-time conflict hook is a no-op returning no conflict (the engine drops in behind it)", () => {
    const result = checkFilingConflict({
      firmId: "firm_x",
      matterId: "matter_x",
      emailMessageId: "emailMessage_x",
      participantAddresses: ["a@example.com", "b@example.com"],
    });
    expect(result.hasConflict).toBe(false);
    expect(result.holds).toEqual([]);
  });

  it("the DKIM verdict boundary defaults unverified — recorded, never adjudicated here", () => {
    expect(DKIM_VERDICT_UNVERIFIED).toBe("unverified");
  });
});

describe("the outbox topics this package's write paths publish", () => {
  it("names the filing topic once, so a subscriber cannot spell it differently", () => {
    // The spelling is a wire contract with the notification registry and with the per-firm bus. A
    // typo does not throw anywhere — an unrecognized topic is acked and ignored by design — so the
    // constant is the only thing standing between a rename and a silently undelivered notification.
    expect(EMAIL_FILED_TOPIC).toBe("email.filed");
    expect(EMAIL_FILING_OUTBOX_TOPICS).toEqual([EMAIL_FILED_TOPIC]);
  });
});
