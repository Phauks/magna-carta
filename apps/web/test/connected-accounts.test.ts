import { describe, expect, it } from "vitest";
import {
  noticeForOutcome,
  calendarRequestFor,
  providerFrom,
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
    for (const outcome of [
      "declined",
      "expired",
      "unavailable",
      "failed",
      "other-account",
    ] as const) {
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
  it.each(["microsoft", "google"] as const)(
    "states what is granted at %s and nothing that is not",
    (provider) => {
      const request = calendarRequestFor(provider);
      expect(request.grants).toHaveLength(3);
      const everything = [request.heading, ...request.grants].join(" ");
      expect(everything).not.toMatch(/\b(not|never|cannot|will not)\b/i);
      expect(everything.toLowerCase()).not.toContain("mail");
    },
  );
});

describe("the provider a return names", () => {
  it("is read when it is one this page knows, and is nothing otherwise", () => {
    expect(providerFrom(new URLSearchParams("provider=google"))).toBe("google");
    expect(providerFrom(new URLSearchParams("provider=microsoft"))).toBe("microsoft");
    expect(providerFrom(new URLSearchParams("provider=elsewhere"))).toBeNull();
  });

  it("names the provider's own product and company in what the member is told", () => {
    expect(noticeForOutcome("connected", "google").title).toBe("Google Calendar connected");
    expect(noticeForOutcome("failed", "google").description).toContain("Google did not complete");
    expect(noticeForOutcome("connected").title).toBe("Outlook connected");
    expect(statusSentence("needs_reauth", "google")).toContain("Google is asking");
  });

  it("tells a member with an account already connected to disconnect it first", () => {
    const notice = noticeForOutcome("other-account", "google");
    expect(notice.tone).toBe("warning");
    expect(notice.description).toContain("Disconnect it first");
  });
});
