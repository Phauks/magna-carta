/*
 * The joining surface's wording, which on this surface is a security property rather than a copy
 * decision — so it is asserted rather than eyeballed.
 *
 * The property under test is the one the whole redemption design turns on: ONE sentence for every
 * unsuccessful combination. The last case in this file is the guard on it — the refusal must not
 * vary with anything the server sends, because the moment it does, the form starts telling a
 * stranger which of three facts they already have right.
 */
import { describe, expect, it } from "vitest";
import type { JoiningOutcome } from "../src/lib/auth/joining-api.ts";
import {
  CONFIRMATION_MAIL_UNAVAILABLE,
  CONFIRMATION_REFUSED,
  JOINING_UNAVAILABLE,
  REDEMPTION_REFUSED,
  REGISTRATION_REFUSED,
  TOO_MANY_ATTEMPTS,
  joiningErrorMessage,
  joiningSupportErrorId,
  lockoutFrom,
} from "../src/routes/register/joining-messages.ts";

function refusal(status: number, extra: Record<string, unknown> = {}): JoiningOutcome<unknown> {
  return { kind: "problem", problem: { status, ...extra } };
}

describe("joiningErrorMessage", () => {
  it("renders the step's own refusal for a verdict on what was entered", () => {
    expect(joiningErrorMessage(refusal(422), REDEMPTION_REFUSED)).toBe(REDEMPTION_REFUSED);
    expect(joiningErrorMessage(refusal(422), CONFIRMATION_REFUSED)).toBe(CONFIRMATION_REFUSED);
  });

  it("does not treat a rate limit as a verdict", () => {
    // Showing the refusal on a 429 would tell somebody a correct code was wrong.
    expect(joiningErrorMessage(refusal(429), REDEMPTION_REFUSED)).toBe(TOO_MANY_ATTEMPTS);
  });

  it("does not treat an outage as a verdict", () => {
    expect(joiningErrorMessage(refusal(500), REDEMPTION_REFUSED)).toBe(JOINING_UNAVAILABLE);
    expect(joiningErrorMessage({ kind: "transport" }, REDEMPTION_REFUSED)).toBe(
      JOINING_UNAVAILABLE,
    );
  });

  it("says the same thing whatever detail the server sent with the refusal", () => {
    // The constant is rendered instead of the server's `detail` precisely so that a change to the
    // wording on the other side of the wire cannot turn one answer into a per-field one.
    const wrongCode = refusal(422, {
      type: "invitation-not-redeemable",
      detail: "the code is unknown",
      attemptsRemaining: 4,
    });
    const wrongBirthday = refusal(422, {
      type: "invitation-not-redeemable",
      detail: "the date of birth does not match",
      attemptsRemaining: 3,
    });
    expect(joiningErrorMessage(wrongCode, REDEMPTION_REFUSED)).toBe(
      joiningErrorMessage(wrongBirthday, REDEMPTION_REFUSED),
    );
  });

  it("names none of the three facts, so the sentence cannot single one out", () => {
    // The refusal lists all three together or it is not neutral; what it must never do is mention
    // one on its own, which is what a per-field message would read as.
    const mentioned = ["code", "last name", "date of birth"].filter((fact) =>
      REDEMPTION_REFUSED.includes(fact),
    );
    expect(mentioned).toHaveLength(3);
  });
});

describe("joiningSupportErrorId", () => {
  it("surfaces the correlation handle for a server fault, which is what support looks up", () => {
    expect(joiningSupportErrorId(refusal(500, { errorId: "error_abc" }))).toBe("error_abc");
  });

  it("shows nothing for a refusal, where an ID would read as blame for what was typed", () => {
    expect(joiningSupportErrorId(refusal(422, { errorId: "error_abc" }))).toBeNull();
    expect(joiningSupportErrorId(refusal(429, { errorId: "error_abc" }))).toBeNull();
  });

  it("shows nothing when the server sent none, or nothing answered at all", () => {
    expect(joiningSupportErrorId(refusal(500))).toBeNull();
    expect(joiningSupportErrorId({ kind: "transport" })).toBeNull();
  });
});

describe("lockoutFrom", () => {
  it("reports a countdown only when the refusal carried one", () => {
    expect(lockoutFrom({ status: 422, retryAfterSeconds: 900 })).toBe(900);
    expect(lockoutFrom({ status: 422 })).toBeNull();
  });
});

describe("a confirmation email that would not send", () => {
  // The server answers this as a 503 carrying its own problem type, because the remedy is precise:
  // nothing was lost and pressing the button again really does send a fresh mail. The generic
  // 5xx sentence would talk somebody out of the one action that works.
  const mailUndeliverable = (): JoiningOutcome<unknown> =>
    refusal(503, {
      type: "https://api.magnacarta.esq/problems/mail-undeliverable",
      errorId: "error_mail",
    });

  it("gets its own sentence rather than the generic outage one", () => {
    expect(joiningErrorMessage(mailUndeliverable(), REGISTRATION_REFUSED)).toBe(
      CONFIRMATION_MAIL_UNAVAILABLE,
    );
    expect(joiningErrorMessage(mailUndeliverable(), REGISTRATION_REFUSED)).not.toBe(
      JOINING_UNAVAILABLE,
    );
  });

  it("never reads as a verdict on what was typed", () => {
    // It is a fault, not a refusal, so the step's own refusal sentence must not appear.
    expect(joiningErrorMessage(mailUndeliverable(), REGISTRATION_REFUSED)).not.toBe(
      REGISTRATION_REFUSED,
    );
  });

  it("still surfaces an Error ID, because it is a server fault support can look up", () => {
    expect(joiningSupportErrorId(mailUndeliverable())).toBe("error_mail");
  });

  it("leaves an ordinary 5xx on the generic sentence", () => {
    expect(joiningErrorMessage(refusal(500), REGISTRATION_REFUSED)).toBe(JOINING_UNAVAILABLE);
  });
});
