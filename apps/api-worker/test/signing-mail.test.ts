// @node-runtime
// The mails an outside signer receives: what they carry, and what they leave out.
import { describe, expect, it } from "vitest";
import {
  accessCodeEmail,
  lastDayOf,
  signingReminderEmail,
  signingRequestEmail,
  type SigningLetterFacts,
} from "../src/signing/signing-mail.ts";

const facts: SigningLetterFacts = {
  firmName: "Goldsmith Law",
  senderName: "Trevor Goldsmith",
  subject: "Please sign",
  message: "  The engagement letter we discussed.  ",
  title: "Engagement.pdf",
  lastDay: lastDayOf("2026-12-13T17:30:00.000Z"),
  origin: "https://app.example.com",
  token: "abc.def",
  needsCode: true,
};

describe("a signer's mail", () => {
  it("names the sender, the document and the last moment, and carries the link", () => {
    const mail = signingRequestEmail(facts);
    expect(mail.subject).toBe("Please sign");
    expect(mail.text).toContain("Trevor Goldsmith at Goldsmith Law");
    expect(mail.text).toContain("Engagement.pdf");
    expect(mail.text).toContain("The engagement letter we discussed.\n\n");
    expect(mail.text).toContain("https://app.example.com/sign/abc.def");
    expect(mail.text).toContain("one-time code");
    expect(mail.text).toContain("Dec 13, 2026, 5:30 PM UTC");
    expect(mail.text).toContain("UTC");
  });

  it("says nothing of a code when none is needed, and a reminder says it is one", () => {
    expect(signingRequestEmail({ ...facts, needsCode: false }).text).not.toContain("one-time code");
    const reminder = signingReminderEmail(facts);
    expect(reminder.subject).toBe("Reminder: Please sign");
    expect(reminder.text).toContain("is waiting for you to sign");
  });

  it("writes the last moment in UTC and says so", () => {
    expect(lastDayOf("2026-12-13T23:30:00.000Z")).toBe("Dec 13, 2026, 11:30 PM UTC");
  });

  it("mails a code alone, without the link", () => {
    const mail = accessCodeEmail({ firmName: "Goldsmith Law", code: "012345", minutes: 10 });
    expect(mail.text).toContain("012345");
    expect(mail.text).toContain("10 minutes");
    expect(mail.text).not.toContain("/sign/");
  });
});
