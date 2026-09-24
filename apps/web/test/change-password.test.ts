/*
 * What changing a password says (src/lib/account/change-password.ts) — pure, node, no browser.
 *
 * The refusal wording is the whole reason that module exists, so it is the whole of what is pinned
 * here: a wrong current password and a short new one are different mistakes with different
 * remedies, and each has to say which. What is NOT pinned is the call itself — that is Better
 * Auth's endpoint, exercised against a real Worker rather than described by a mock of it.
 */
import { describe, expect, it } from "vitest";
import {
  CHANGE_REFUSED_UNKNOWN,
  passwordChangedMessage,
  passwordChangeRefusal,
} from "../src/lib/account/change-password.ts";

describe("what a refused password change says", () => {
  // Named plainly, which sign-in deliberately does not do. The caller already holds the session, so
  // the distinction reveals nothing they could not establish — and withholding it leaves somebody
  // retyping a new password that was never the problem.
  it("names a wrong current password as the current password", () => {
    const sentence = passwordChangeRefusal("INVALID_PASSWORD");
    expect(sentence).toContain("current password");
    expect(sentence).not.toBe(CHANGE_REFUSED_UNKNOWN);
  });

  it("tells a short or long new password apart from a wrong current one", () => {
    expect(passwordChangeRefusal("PASSWORD_TOO_SHORT")).toContain("too short");
    expect(passwordChangeRefusal("PASSWORD_TOO_LONG")).toContain("too long");
    expect(passwordChangeRefusal("PASSWORD_TOO_SHORT")).not.toBe(
      passwordChangeRefusal("INVALID_PASSWORD"),
    );
  });

  // An account activated by an emailed link has no password to change, and the remedy is that link
  // rather than this dialog. A sentence that did not say so would leave somebody pressing a control
  // that can never work for them.
  it("sends an account with no password at the door that can give it one", () => {
    expect(passwordChangeRefusal("CREDENTIAL_ACCOUNT_NOT_FOUND")).toContain("Forgot Password");
  });

  // The library's own codes change between releases, and its own sentences are written for a
  // developer reading a log. An unrecognised code must therefore still produce something true: that
  // nothing changed, and pressing again is safe.
  it("falls back rather than echoing a code it does not know", () => {
    expect(passwordChangeRefusal("SOME_FUTURE_CODE")).toBe(CHANGE_REFUSED_UNKNOWN);
    expect(passwordChangeRefusal(undefined)).toBe(CHANGE_REFUSED_UNKNOWN);
    expect(CHANGE_REFUSED_UNKNOWN).toContain("not changed");
  });
});

describe("what a successful password change says", () => {
  // The act does two things when asked to, and a confirmation that mentioned only the password
  // would leave somebody wondering whether their other devices were still signed in — which is the
  // question they opened the dialog with.
  it("says what else the act did, and only when it did it", () => {
    expect(passwordChangedMessage(true)).toContain("other devices are signed out");
    expect(passwordChangedMessage(false)).not.toContain("other devices");
    expect(passwordChangedMessage(false)).toContain("changed");
  });
});
