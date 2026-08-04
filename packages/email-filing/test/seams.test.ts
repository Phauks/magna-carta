import { describe, expect, it } from "vitest";
import {
  checkFilingConflict,
  DKIM_VERDICT_UNVERIFIED,
  raiseEmailFiledNotification,
} from "../src/seams.ts";

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

  it("the notifications raise-point is callable and carries no body (a no-op until Notifications ships)", () => {
    expect(() =>
      raiseEmailFiledNotification({
        firmId: "firm_x",
        matterId: "matter_x",
        emailMessageId: "emailMessage_x",
      }),
    ).not.toThrow();
  });

  it("the DKIM verdict boundary defaults unverified — recorded, never adjudicated here", () => {
    expect(DKIM_VERDICT_UNVERIFIED).toBe("unverified");
  });
});
