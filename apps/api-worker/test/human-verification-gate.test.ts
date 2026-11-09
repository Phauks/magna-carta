import { env } from "cloudflare:test";
import { createMemoryLogger, type MemoryLogger } from "@magna-carta/telemetry/logger";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import type {
  HumanVerificationOutcome,
  HumanVerificationPort,
} from "../src/http/human-verification/human-verification-port.ts";
import { HUMAN_VERIFICATION_TOKEN_HEADER } from "../src/http/human-verification/human-verification-gate.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// The password a registering visitor now chooses on the form. Registration commits it with the
// account at confirmation, so every body that opens an account-creating door carries one.
const TEST_PASSWORD = "a-sufficiently-long-test-password";

// The gate as a caller meets it: through the real registration route, which is the platform's only
// self-serve write from the open internet. The verifier is injected rather than reached, because the
// facts under test are what each OUTCOME becomes at the edge — a status, a problem type, a metric —
// and none of those should depend on Cloudflare answering. The adapter's own mapping from siteverify
// responses to outcomes is covered in turnstile-verifier.test.ts.

// The route's rate-limit bucket is the platform's tightest and is IP-keyed, so every request gets its
// own caller address; a test that shared one would be measuring the limiter, not the gate.
let nextClientAddress = 0;
function freshClientAddress(): string {
  nextClientAddress += 1;
  return `198.51.100.${nextClientAddress % 250}`;
}

let nextEmail = 0;
function freshEmail(): string {
  nextEmail += 1;
  return `human-verification-${nextEmail}@example.com`;
}

/** A verifier that answers one scripted outcome, whatever it is asked. */
function verifierAnswering(outcome: HumanVerificationOutcome): HumanVerificationPort {
  return { verify: () => Promise.resolve(outcome) };
}

interface Harness {
  readonly logger: MemoryLogger;
  register(headers?: Record<string, string>): Promise<Response>;
  redeem(headers?: Record<string, string>): Promise<Response>;
}

function harness(options: Parameters<typeof createApp>[0] = {}): Harness {
  const logger = createMemoryLogger();
  const app = createApp({ ...options, loggerForEnv: () => logger });
  const post = async (
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<Response> =>
    await app.request(
      `https://example.com${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": freshClientAddress(),
          ...headers,
        },
        body: JSON.stringify(body),
      },
      env,
    );
  return {
    logger,
    register: (headers = {}) =>
      post(
        "/api/v1/registrations",
        {
          role: "foundFirm",
          email: freshEmail(),
          name: "Ines Duarte",
          password: TEST_PASSWORD,
          firmName: "Duarte Legal",
        },
        headers,
      ),
    redeem: (headers = {}) =>
      post(
        "/api/v1/invitations/redemptions",
        { code: "MCAAAABBBBCCCC", lastName: "Duarte", dateOfBirth: "1980-01-01" },
        headers,
      ),
  };
}

/** The one metric the gate emits, filtered out of everything else the request recorded. */
function decisions(logger: MemoryLogger): Array<Record<string, string>> {
  return logger.counts
    .filter((recorded) => recorded.metric === "human_verification.decided")
    .map((recorded) => recorded.dimensions);
}

async function problemBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

describe("a provisioned verifier, at the front door", () => {
  it("lets a valid solution through and records the pass", async () => {
    const app = harness({
      humanVerification: { port: verifierAnswering({ decision: "verified" }) },
    });

    const response = await app.register({
      [HUMAN_VERIFICATION_TOKEN_HEADER]: "a-solved-challenge",
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ next: "checkEmail" });
    expect(decisions(app.logger)).toEqual([
      { route: "/api/v1/registrations", outcome: "verified", reason: "solved" },
    ]);
  });

  it("refuses a request carrying no solution with 403, and writes no registration row", async () => {
    const app = harness({
      humanVerification: {
        port: verifierAnswering({ decision: "refused", reason: "token-missing" }),
      },
    });

    const before = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS total FROM registration",
    ).first<{ total: number }>();
    const response = await app.register();
    const after = await env.DB_CONTROL.prepare("SELECT COUNT(*) AS total FROM registration").first<{
      total: number;
    }>();

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = await problemBody(response);
    expect(String(body["type"])).toContain("human-verification-required");
    // The refusal is correlatable without being explanatory: an Error ID, and one wording that does
    // not tell a script which of the three refusal reasons it hit.
    expect(body["errorId"]).toMatch(/^error_/);
    expect(body["detail"]).toBe("Complete the verification check and submit the form again.");
    // The gate ran BEFORE the write and before the mail, which is the whole point of its position.
    expect(after?.total).toBe(before?.total);
    expect(decisions(app.logger)).toEqual([
      { route: "/api/v1/registrations", outcome: "refused", reason: "token-missing" },
    ]);
  });

  it("refuses a replayed solution with the same 403 and a distinct telemetry reason", async () => {
    const app = harness({
      humanVerification: {
        port: verifierAnswering({ decision: "refused", reason: "token-already-spent" }),
      },
    });

    const response = await app.register({ [HUMAN_VERIFICATION_TOKEN_HEADER]: "already-spent" });

    expect(response.status).toBe(403);
    // Identical to the caller — a replay must not be distinguishable from a forgery at the edge —
    // and distinguishable to the operator, which is what the counter is for.
    expect((await problemBody(response))["detail"]).toBe(
      "Complete the verification check and submit the form again.",
    );
    expect(decisions(app.logger)).toEqual([
      { route: "/api/v1/registrations", outcome: "refused", reason: "token-already-spent" },
    ]);
  });

  it("answers a verifier that will not answer with a retryable 503 — never a 500", async () => {
    const app = harness({
      humanVerification: {
        port: verifierAnswering({ decision: "unavailable", reason: "verifier-unreachable" }),
      },
    });

    const response = await app.register({
      [HUMAN_VERIFICATION_TOKEN_HEADER]: "a-solved-challenge",
    });

    // The distinction this asserts: our outage is not the caller's fault (not a 403) and not an
    // unexplained fault they can do nothing with (not a 500). It is a wait, with a length on it.
    expect(response.status).toBe(503);
    const body = await problemBody(response);
    expect(String(body["type"])).toContain("service-unavailable");
    expect(body["retryAfterSeconds"]).toBeGreaterThan(0);
    expect(decisions(app.logger)).toEqual([
      { route: "/api/v1/registrations", outcome: "unavailable", reason: "verifier-unreachable" },
    ]);
  });

  it("treats a rejected secret as our problem, reported to the operator and not to the visitor", async () => {
    const app = harness({
      humanVerification: {
        port: verifierAnswering({
          decision: "unavailable",
          reason: "verifier-credential-rejected",
        }),
      },
    });

    const response = await app.register({
      [HUMAN_VERIFICATION_TOKEN_HEADER]: "a-solved-challenge",
    });

    expect(response.status).toBe(503);
    // The caller-facing wording is identical to the unreachable case; only the counter knows which.
    expect((await problemBody(response))["detail"]).toBe(
      "This request cannot be verified right now. Try again shortly.",
    );
    expect(decisions(app.logger)).toEqual([
      {
        route: "/api/v1/registrations",
        outcome: "unavailable",
        reason: "verifier-credential-rejected",
      },
    ]);
  });

  it("guards invitation redemption on the same terms", async () => {
    const app = harness({
      humanVerification: {
        port: verifierAnswering({ decision: "refused", reason: "token-rejected" }),
      },
    });

    const response = await app.redeem({ [HUMAN_VERIFICATION_TOKEN_HEADER]: "not-a-real-token" });

    expect(response.status).toBe(403);
    expect(decisions(app.logger)).toEqual([
      { route: "/api/v1/invitations/redemptions", outcome: "refused", reason: "token-rejected" },
    ]);
  });
});

describe("no verifier provisioned — the shipped state of every environment", () => {
  it("serves the endpoint unprotected and COUNTS the unprotected pass", async () => {
    // No injected port and no TURNSTILE_SECRET_KEY in the pool's environment, so this is the real
    // production resolution path rather than a fake standing in for it.
    const app = harness();

    const response = await app.register();

    expect(response.status).toBe(202);
    // The whole reason this posture is defensible: the absence of protection is a number somebody
    // can alert on, not a checkbox in a runbook. A silent pass here would be the bug.
    expect(decisions(app.logger)).toEqual([
      {
        route: "/api/v1/registrations",
        outcome: "unenforced",
        reason: "verifier-not-configured",
      },
    ]);
  });

  it("refuses instead, with a 503, when the deployment is configured fail-closed", async () => {
    // The other defensible posture, one deployment variable away. Kept exercised so the choice
    // stays a choice rather than becoming an untested branch.
    const app = harness({ humanVerification: { posture: "fail-closed" } });

    const response = await app.register();

    expect(response.status).toBe(503);
    expect(String((await problemBody(response))["type"])).toContain("service-unavailable");
    expect(decisions(app.logger)).toEqual([
      {
        route: "/api/v1/registrations",
        outcome: "unavailable",
        reason: "verifier-not-configured",
      },
    ]);
  });
});

describe("what the gate never records", () => {
  it("puts the solution in no event, no counter dimension and no problem body", async () => {
    const secret = "a-solved-challenge-that-must-never-be-logged";
    const app = harness({
      humanVerification: {
        port: verifierAnswering({ decision: "refused", reason: "token-rejected" }),
      },
    });

    const response = await app.register({ [HUMAN_VERIFICATION_TOKEN_HEADER]: secret });

    // A challenge solution is a bearer credential. The catalogs give it no field to occupy, and this
    // asserts the structure actually holds across everything one request emitted.
    const emitted = JSON.stringify({
      events: app.logger.events,
      counts: app.logger.counts,
      body: await problemBody(response),
    });
    expect(emitted).not.toContain(secret);
  });
});
