// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { passwordResetEmailText, passwordResetScreenLink } from "../src/password-reset-link.ts";
import { confirmationEmailText } from "../src/http/routes/session/registrations.ts";

/*
 * The two joining mails a person actually has to act on: the registration confirmation and the
 * password reset. Both carry a clickable link to the screen that spends the token — the property
 * under test is that the link goes to the SCREEN (which spends nothing on open) and that the typed
 * fallback still travels, so a mail client that refuses links is not a dead end.
 */

describe("confirmationEmailText", () => {
  const text = confirmationEmailText("https://app.example.test", "tok-abc123");

  it("links at the confirmation screen with the token in the query", () => {
    expect(text).toContain("https://app.example.test/register/confirm?token=tok-abc123");
  });

  it("carries the bare code as the typed fallback", () => {
    expect(text).toContain("\n\ntok-abc123\n\n");
  });

  it("names the expiry so an old mail explains itself", () => {
    expect(text).toContain("24 hours");
  });
});

describe("passwordResetScreenLink", () => {
  it("derives the origin from the request when one exists", () => {
    const link = passwordResetScreenLink({
      token: "reset-token",
      requestUrl: "https://app.example.test/api/auth/request-password-reset",
      appBaseUrl: "https://wrong.example.test",
    });
    expect(link).toBe("https://app.example.test/login/reset-password?token=reset-token");
  });

  it("falls back to APP_BASE_URL for the paths that have no request", () => {
    // The firm-provision consumer's owner-activation mail is this case: a queue consumer serves
    // nobody, so the deployment's own configured origin is the only one there is.
    const link = passwordResetScreenLink({
      token: "reset-token",
      appBaseUrl: "https://app.example.test/",
    });
    expect(link).toBe("https://app.example.test/login/reset-password?token=reset-token");
  });

  it("degrades to the bare path when neither exists, so the dev terminal still shows a usable line", () => {
    const link = passwordResetScreenLink({ token: "reset-token" });
    expect(link).toBe("/login/reset-password?token=reset-token");
  });

  it("keeps the token query-safe", () => {
    const link = passwordResetScreenLink({ token: "a+b&c" });
    expect(link).toBe("/login/reset-password?token=a%2Bb%26c");
  });
});

describe("passwordResetEmailText", () => {
  it("carries the link and says the token is single-use and expiring", () => {
    const text = passwordResetEmailText("https://app.example.test/login/reset-password?token=x");
    expect(text).toContain("https://app.example.test/login/reset-password?token=x");
    expect(text).toContain("works once");
    expect(text).toContain("one hour");
  });
});
