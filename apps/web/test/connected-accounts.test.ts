import { describe, expect, it } from "vitest";
import {
  noticeForOutcome,
  OUTLOOK_CALENDAR_REQUEST,
  signInOutcomeFrom,
  statusSentence,
} from "../src/lib/calendar-sync/connected-accounts.ts";

describe("the word the return address carries", () => {
  it("is read when it is one this page knows", () => {
    expect(signInOutcomeFrom(new URLSearchParams("outcome=connected"))).toBe("connected");
    expect(signInOutcomeFrom(new URLSearchParams("outcome=declined"))).toBe("declined");
  });

  it("is nothing when absent, or when somebody typed their own", () => {
    expect(signInOutcomeFrom(new URLSearchParams(""))).toBeNull();
    expect(signInOutcomeFrom(new URLSearchParams("outcome=<script>"))).toBeNull();
  });
});

describe("what each outcome tells the member", () => {
  it("says on connecting that nothing syncs yet", () => {
    const notice = noticeForOutcome("connected");
    expect(notice.tone).toBe("success");
    expect(notice.description).toContain("Nothing syncs yet");
  });

  it("says nothing was connected for every other outcome", () => {
    for (const outcome of ["declined", "expired", "unavailable", "failed"] as const) {
      const notice = noticeForOutcome(outcome);
      expect(notice.tone).not.toBe("success");
      expect(`${notice.title} ${notice.description}`.toLowerCase()).toContain("not");
    }
  });
});

describe("a connection's health", () => {
  it("tells a member asked to sign in again what to do about it", () => {
    expect(statusSentence("needs_reauth")).toContain("Connect the account again");
    expect(statusSentence("connected")).toBe("Connected.");
  });
});

describe("the permission request", () => {
  it("states what is granted and nothing that is not", () => {
    expect(OUTLOOK_CALENDAR_REQUEST.grants).toHaveLength(3);
    const everything = [OUTLOOK_CALENDAR_REQUEST.heading, ...OUTLOOK_CALENDAR_REQUEST.grants].join(
      " ",
    );
    expect(everything).not.toMatch(/\b(not|never|cannot|will not)\b/i);
    expect(everything.toLowerCase()).not.toContain("mail");
  });
});
