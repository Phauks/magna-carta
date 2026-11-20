import { env } from "cloudflare:test";
import { createMemoryLogger } from "@magna-carta/telemetry/logger";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import type {
  HumanVerificationOutcome,
  HumanVerificationPort,
} from "../src/http/human-verification/human-verification-port.ts";
import { HUMAN_VERIFICATION_TOKEN_HEADER } from "../src/http/human-verification/human-verification-gate.ts";
import {
  resolveHumanVerificationPort,
  resolveTurnstileKeys,
} from "../src/http/human-verification/human-verification-wiring.ts";
import { verifierNotConfigured } from "../src/http/human-verification/human-verification-port.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// The bot check beyond the two joining writes: the public site-key read the screens draw the widget
// with, the both-keys rule that keeps the switch-on order safe, and the gate on Better Auth's
// sign-in and reset-request endpoints.

let nextClientAddress = 0;
function freshClientAddress(): string {
  nextClientAddress += 1;
  return `203.0.113.${nextClientAddress % 250}`;
}

function verifierAnswering(outcome: HumanVerificationOutcome): HumanVerificationPort {
  return { verify: () => Promise.resolve(outcome) };
}

function appWith(options: Parameters<typeof createApp>[0] = {}) {
  return createApp({ ...options, loggerForEnv: () => createMemoryLogger() });
}

async function post(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await app.request(
    `https://example.com${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        "cf-connecting-ip": freshClientAddress(),
        ...headers,
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

describe("the both-keys rule", () => {
  it("switches the check on only when the site key and the secret are both set", () => {
    expect(resolveTurnstileKeys({ ...env, TURNSTILE_SECRET_KEY: "secret" })).toBeNull();
    expect(resolveTurnstileKeys({ ...env, TURNSTILE_SITE_KEY: "site" })).toBeNull();
    expect(
      resolveTurnstileKeys({ ...env, TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "" }),
    ).toBeNull();
    expect(
      resolveTurnstileKeys({ ...env, TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" }),
    ).toEqual({ siteKey: "site", secretKey: "secret" });
  });

  it("leaves a secret with no site key unenforced, so no screen is asked for what it cannot mint", () => {
    expect(resolveHumanVerificationPort({ ...env, TURNSTILE_SECRET_KEY: "secret" })).toBe(
      verifierNotConfigured,
    );
  });
});

describe("the public site-key read", () => {
  it("answers null while the bot check is not set up", async () => {
    const response = await appWith().request(
      "https://example.com/api/v1/human-verification",
      {},
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ siteKey: null });
  });

  it("answers the site key, and never the secret, once both keys are set", async () => {
    const response = await appWith().request(
      "https://example.com/api/v1/human-verification",
      {},
      { ...env, TURNSTILE_SITE_KEY: "0x4AAA-site", TURNSTILE_SECRET_KEY: "0x4AAA-secret" },
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ siteKey: "0x4AAA-site" });
    expect(text).not.toContain("0x4AAA-secret");
  });
});

describe("signing in and asking for a reset email", () => {
  const refusing = { port: verifierAnswering({ decision: "refused", reason: "token-missing" }) };

  it("refuses a sign-in with no solution with the bot check's own 403", async () => {
    const response = await post(
      appWith({ humanVerification: refusing }),
      "/api/auth/sign-in/email",
      {
        email: "nobody@example.com",
        password: "a-sufficiently-long-test-password",
      },
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { type?: string };
    expect(body.type).toBe("https://api.magnacarta.esq/problems/human-verification-required");
  });

  it("refuses a reset request with no solution on the same terms", async () => {
    const response = await post(
      appWith({ humanVerification: refusing }),
      "/api/auth/request-password-reset",
      { email: "nobody@example.com" },
    );
    expect(response.status).toBe(403);
  });

  it("hands a solved sign-in on to Better Auth, which answers the credential itself", async () => {
    const response = await post(
      appWith({ humanVerification: { port: verifierAnswering({ decision: "verified" }) } }),
      "/api/auth/sign-in/email",
      { email: "nobody@example.com", password: "a-sufficiently-long-test-password" },
      { [HUMAN_VERIFICATION_TOKEN_HEADER]: "a-solved-challenge" },
    );
    expect(response.status).toBe(401);
  });

  it("leaves sign-in working exactly as before while the bot check is not set up", async () => {
    const response = await post(appWith(), "/api/auth/sign-in/email", {
      email: "nobody@example.com",
      password: "a-sufficiently-long-test-password",
    });
    expect(response.status).toBe(401);
  });

  it("does not gate the session read", async () => {
    const response = await appWith({ humanVerification: refusing }).request(
      "https://example.com/api/auth/get-session",
      {},
      env,
    );
    expect(response.status).not.toBe(403);
  });
});
