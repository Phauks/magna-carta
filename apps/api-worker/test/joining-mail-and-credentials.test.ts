import { createExecutionContext, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { createMemoryLogger, type MemoryLogger } from "@magna-carta/telemetry/logger";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import { consumeFirmProvision } from "../src/background/firm-provision-consumer.ts";
import { confirmationTokenHash, generateConfirmationToken } from "../src/joining-secrets.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { liveCookie, setCookies } from "./support/test-auth.ts";

// TWO FAILURES THAT LOOKED LIKE ONE, and this file is the regression for both.
//
// THE FIRST: a `user` row was created with no credential `account` row, on every joining path, on
// the theory that the mailed password-reset link would bring one into being. It does — Better Auth's
// reset endpoint creates a missing credential account before setting the password — but it only does
// so if the mail ARRIVES and somebody acts on it. A deployment whose outbound mail is not configured
// therefore produced accounts nobody could ever sign in to, whose only symptom is the library
// logging "Credential account not found" at sign-in. Registration now collects the password and
// commits the credential with the account, so the account is usable the moment it exists.
//
// THE SECOND: every one of those sends was awaited with no guard, after the work had committed. A
// throwing adapter escaped the handler and became a 500 — telling a caller that a registration which
// really was written had failed, and putting the reason in an unhandled exception instead of a
// counted, correlated failure. Cloudflare Email Sending is in beta, where a destination may need
// verifying before it will accept a send, so this is an ordinary state on the day mail is switched
// on rather than a rare one.
//
// THE ADAPTER IS DRIVEN THROUGH THE PRODUCTION WIRING, never injected: `emailAdapterForEnv` selects
// the real Cloudflare adapter when SEND_EMAIL and EMAIL_FROM are both present (app.ts), so an env
// carrying a binding whose `send` throws exercises exactly the path a deployment takes. The same
// trick the unreachable-scan-engine seam uses.

const TEST_PASSWORD = "a-sufficiently-long-test-password";

// A bound Cloudflare Email Sending binding that refuses every send — the beta's unverified-
// destination rejection, in the shape the adapter meets it.
const refusingEmailBinding = {
  send: () => Promise.reject(new Error("destination address is not verified")),
};

// The one thing that must never reach a log: the body of a message, and the token inside it.
const BODY_MARKERS = [
  "Open this link to confirm",
  "Set your Magna Carta password",
  "/register/confirm",
];

let nextClientAddress = 0;
function freshClientAddress(): string {
  nextClientAddress += 1;
  return `198.51.100.${nextClientAddress % 250}`;
}

interface DataPoint {
  blobs?: string[];
  doubles?: number[];
  indexes?: string[];
}

interface Harness {
  /** The request-scoped logger, which the routes' own guards write to. */
  readonly logger: MemoryLogger;
  /**
   * Every Analytics Engine point the PRODUCTION logger wrote. The port guard around Better Auth's
   * adapter has no request to borrow a logger from, so it writes through the per-env Workers logger
   * — which means the only way to observe it is the binding that logger writes to. Capturing it
   * here tests the real wiring rather than an injected stand-in.
   */
  readonly dataPoints: DataPoint[];
  post(path: string, body: unknown): Promise<Response>;
}

/** The app over an env whose mail is bound and refuses, with both sinks the test can read back. */
function refusingMailHarness(): Harness {
  const logger = createMemoryLogger();
  const dataPoints: DataPoint[] = [];
  const app = createApp({ loggerForEnv: () => logger });
  const mailRefusingEnv = {
    ...env,
    SEND_EMAIL: refusingEmailBinding,
    EMAIL_FROM: "no-reply@example.com",
    TELEMETRY: {
      writeDataPoint: (point: DataPoint) => {
        dataPoints.push(point);
      },
    },
  } as unknown as typeof env;
  return {
    logger,
    dataPoints,
    post: async (path, body) => {
      const executionContext = createExecutionContext();
      const response = await app.request(
        `https://example.com${path}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://example.com",
            "cf-connecting-ip": freshClientAddress(),
          },
          body: JSON.stringify(body),
        },
        mailRefusingEnv,
        executionContext,
      );
      await waitOnExecutionContext(executionContext);
      return response;
    },
  };
}

/** Every string any event or counter carried, so a body can be searched for across all of them. */
function loggedStrings(logger: MemoryLogger): string {
  return JSON.stringify([logger.events, logger.counts]);
}

async function plantConfirmationToken(registrationId: string): Promise<string> {
  const token = generateConfirmationToken();
  await env.DB_CONTROL.prepare("UPDATE registration SET confirmation_hash = ?2 WHERE id = ?1")
    .bind(registrationId, await confirmationTokenHash(token))
    .run();
  return token;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

describe("a person who registers can sign in with the password they chose", () => {
  it("creates the credential account with the user, through the production route", async () => {
    const email = "chosen-password@example.com";
    const started = await SELF.fetch("https://example.com/api/v1/registrations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        "cf-connecting-ip": freshClientAddress(),
      },
      body: JSON.stringify({ email, name: "Priya Raman", password: TEST_PASSWORD }),
    });
    expect(started.status).toBe(202);

    const registration = await env.DB_CONTROL.prepare(
      "SELECT id, credential_hash FROM registration WHERE email = ?1",
    )
      .bind(email)
      .first<{ id: string; credential_hash: string | null }>();
    // The verifier is on the row, and it is NOT the password: the plaintext exists only inside the
    // request that received it.
    expect(registration?.credential_hash ?? "").not.toBe("");
    expect(registration?.credential_hash).not.toBe(TEST_PASSWORD);

    const token = await plantConfirmationToken(registration?.id ?? "");
    const confirmed = await SELF.fetch("https://example.com/api/v1/registrations/confirmations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        "cf-connecting-ip": freshClientAddress(),
      },
      body: JSON.stringify({ token }),
    });
    expect(confirmed.status).toBe(200);
    // No second mail AND no front door: the token only ever travelled by email, so spending it is
    // the possession proof a session rests on. The screen is told so — "signedIn", not "signIn".
    expect(await confirmed.json()).toEqual({ email, status: "accountCreated", next: "signedIn" });

    // And the session really came back on that response, rather than the word for one.
    const confirmationCookie = liveCookie(setCookies(confirmed), "session_token");
    expect(confirmationCookie).toBeDefined();
    const bootstrap = await SELF.fetch("https://example.com/api/v1/me", {
      headers: { cookie: confirmationCookie?.pair ?? "", accept: "application/json" },
    });
    expect(bootstrap.status).toBe(200);
    expect(await bootstrap.json()).toMatchObject({ user: { email }, firm: null });

    const created = await env.DB_CONTROL.prepare(
      'SELECT id, email_verified FROM "user" WHERE email = ?1',
    )
      .bind(email)
      .first<{ id: string; email_verified: number }>();
    // The row is inserted UNVERIFIED and verified by the act that mints the session, so a verified
    // column here is also the evidence that act ran.
    expect(created?.email_verified).toBe(1);

    // THE ASSERTION THAT WOULD HAVE CAUGHT THE PRODUCTION FAILURE.
    const credential = await env.DB_CONTROL.prepare(
      "SELECT password FROM account WHERE user_id = ?1 AND provider_id = 'credential'",
    )
      .bind(created?.id ?? "")
      .first<{ password: string | null }>();
    expect(credential).not.toBeNull();
    expect(credential?.password ?? "").not.toBe("");

    // And the end of it: the password is still a working credential, so somebody who signs out, or
    // who confirms on one device and signs in on another, is not left holding a password nothing
    // accepts. Better Auth's own sign-in verifies what this platform wrote.
    const signedIn = await SELF.fetch("https://example.com/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        "cf-connecting-ip": freshClientAddress(),
      },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    });
    expect(signedIn.status).toBe(200);
  });

  it("refuses a door that creates an account with no password, naming the field", async () => {
    const refused = await SELF.fetch("https://example.com/api/v1/registrations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        "cf-connecting-ip": freshClientAddress(),
      },
      body: JSON.stringify({ email: "no-password@example.com", name: "No Password" }),
    });
    expect(refused.status).toBe(422);
    const problem = (await refused.json()) as { errors?: { path: string; code: string }[] };
    expect(problem.errors?.[0]?.path).toBe("password");

    // Nothing was written for a request that could not be completed.
    const rows = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS total FROM registration WHERE email = ?1",
    )
      .bind("no-password@example.com")
      .first<{ total: number }>();
    expect(rows?.total).toBe(0);
  });

  it("still lets the two invitation doors through with no password at all", async () => {
    // They create nothing and are redeemed elsewhere, so the requirement must not reach them —
    // including from a client built before the field existed.
    const response = await SELF.fetch("https://example.com/api/v1/registrations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        "cf-connecting-ip": freshClientAddress(),
      },
      body: JSON.stringify({
        role: "clientOfFirm",
        email: "no-password-invited@example.com",
        name: "Invited Person",
      }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ next: "redeemInvitation" });
  });
});

describe("a confirmation email that will not send", () => {
  it("answers a retryable 503 with an Error ID, and keeps the registration it committed", async () => {
    const harness = refusingMailHarness();
    const email = "mail-refused@example.com";
    const response = await harness.post("/api/v1/registrations", {
      email,
      name: "Unreachable Mailbox",
      password: TEST_PASSWORD,
    });

    // NOT a 500 (the caller can act on this) and NOT a 202 (nothing was sent, and saying "check
    // your email" would point somebody at an inbox that will never receive anything).
    expect(response.status).toBe(503);
    const problem = (await response.json()) as {
      type: string;
      errorId: string;
      retryAfterSeconds?: number;
    };
    expect(problem.type).toBe("https://api.magnacarta.esq/problems/mail-undeliverable");
    expect(problem.errorId).toMatch(/^error_/);
    expect(problem.retryAfterSeconds).toBeGreaterThan(0);

    // THE COMMITTED WORK SURVIVES. The row was written before the mail and stays written, which is
    // what makes "try again" a real remedy: a second registration supersedes this one.
    const registration = await env.DB_CONTROL.prepare(
      "SELECT status FROM registration WHERE email = ?1",
    )
      .bind(email)
      .first<{ status: string }>();
    expect(registration?.status).toBe("pending");

    // The failure is COUNTED, under the route that owed the mail and the class of message it was.
    const counted = harness.logger.counts.find((row) => row.metric === "email.delivery_failed");
    expect(counted?.dimensions).toEqual({
      surface: "POST /api/v1/registrations",
      messageClass: "registration-confirmation",
    });

    // And NOTHING logged carries the message body or the token inside it.
    const logged = loggedStrings(harness.logger);
    for (const marker of BODY_MARKERS) expect(logged).not.toContain(marker);
    expect(logged).not.toContain(email);
  });

  it("answers the address-in-use branch identically, so an outage is not an existence oracle", async () => {
    const taken = "mail-refused-taken@example.com";
    await env.DB_CONTROL.prepare(
      'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id) ' +
        "VALUES (?1, ?2, ?3, 1, ?4, ?4, NULL)",
    )
      .bind(newIdentifier("user"), "Already Here", taken, Date.now())
      .run();

    const harness = refusingMailHarness();
    const response = await harness.post("/api/v1/registrations", {
      email: taken,
      name: "Already Here",
      password: TEST_PASSWORD,
    });
    expect(response.status).toBe(503);
    // Same type, same shape — the two branches send to the same address through the same adapter,
    // so they fail together and must answer together.
    const problem = (await response.json()) as { type: string };
    expect(problem.type).toBe("https://api.magnacarta.esq/problems/mail-undeliverable");
    expect(
      harness.logger.counts.find((row) => row.metric === "email.delivery_failed")?.dimensions,
    ).toEqual({
      surface: "POST /api/v1/registrations",
      messageClass: "registration-address-in-use",
    });
  });
});

describe("the activation mail a legacy registration still owes", () => {
  it("keeps the account and says so, rather than 503-ing a token that is already spent", async () => {
    const email = "legacy-no-credential@example.com";
    // A registration written before passwords were chosen at registration: no credential_hash.
    const registrationId = newIdentifier("registration");
    const token = generateConfirmationToken();
    await env.DB_CONTROL.prepare(
      "INSERT INTO registration (id, role, email, display_name, confirmation_hash, status, " +
        "expires_at, created_at, credential_hash) VALUES (?1, 'account', ?2, ?3, ?4, 'pending', ?5, ?6, NULL)",
    )
      .bind(
        registrationId,
        email,
        "Legacy Person",
        await confirmationTokenHash(token),
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        new Date().toISOString(),
      )
      .run();

    const harness = refusingMailHarness();
    const response = await harness.post("/api/v1/registrations/confirmations", { token });

    // 200, not 503: the token is SPENT, so "try again" would be advice that cannot work, and the
    // account really was created. `checkEmail` is what this route can honestly say — whether the
    // reset mail left is not knowable here, because Better Auth awaits the send and swallows what
    // it throws (runInBackgroundOrAwait), so the endpoint resolves identically either way.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      email,
      status: "accountCreated",
      next: "checkEmail",
    });

    const created = await env.DB_CONTROL.prepare('SELECT id FROM "user" WHERE email = ?1')
      .bind(email)
      .first<{ id: string }>();
    expect(created).not.toBeNull();

    // WHERE THE FAILURE IS VISIBLE: the port guard app.ts wraps around the adapter it hands the
    // library. Without it, a reset mail that never left would be a line in a third-party logger and
    // nothing else. This is the assertion that keeps that guard wired in.
    // Blob 1 is the metric name and the rest follow the catalog's declared dimension order
    // (surface, then messageClass) — the Analytics Engine column contract.
    const counted = harness.dataPoints.find(
      (point) => point.blobs?.[0] === "email.delivery_failed",
    );
    expect(counted?.blobs).toEqual(["email.delivery_failed", "better-auth", "password-reset"]);

    // Nothing anywhere carries the body or the token — neither sink.
    const logged = loggedStrings(harness.logger) + JSON.stringify(harness.dataPoints);
    for (const marker of BODY_MARKERS) expect(logged).not.toContain(marker);
  });
});

describe("the firm-provision consumer, which has no response to carry an Error ID", () => {
  it("finishes provisioning even when the activation mail it still owes will not send", async () => {
    const email = "consumer-mail-refused@example.com";
    const registrationId = newIdentifier("registration");
    await env.DB_CONTROL.prepare(
      "INSERT INTO registration (id, role, email, display_name, firm_display_name, " +
        "confirmation_hash, status, expires_at, created_at, credential_hash) " +
        "VALUES (?1, 'foundFirm', ?2, ?3, ?4, ?5, 'confirmed', ?6, ?7, NULL)",
    )
      .bind(
        registrationId,
        email,
        "Consumer Owner",
        "Consumer Owner Legal",
        await confirmationTokenHash(generateConfirmationToken()),
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        new Date().toISOString(),
      )
      .run();

    const mailRefusingEnv = {
      ...env,
      SEND_EMAIL: refusingEmailBinding,
      EMAIL_FROM: "no-reply@example.com",
    } as unknown as typeof env;

    // A send that throws must NOT escape: a redelivery finds the firm already active and never
    // reaches the mail again, so throwing would burn the relay's attempts, skip the registration →
    // firm write below, and still mail nobody.
    await expect(
      consumeFirmProvision(mailRefusingEnv, {
        id: newIdentifier("outbox"),
        topic: "firm.provision",
        payload: JSON.stringify({
          registrationId,
          firmDisplayName: "Consumer Owner Legal",
          owner: { email, name: "Consumer Owner" },
        }),
        aggregate_key: null,
        seq: null,
        attempts: 0,
        created_at: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();

    const firm = await env.DB_CONTROL.prepare("SELECT status FROM firm WHERE name = ?1")
      .bind(registrationId)
      .first<{ status: string }>();
    expect(firm?.status).toBe("active");

    // The write that a throw would have skipped.
    const recorded = await env.DB_CONTROL.prepare("SELECT firm_id FROM registration WHERE id = ?1")
      .bind(registrationId)
      .first<{ firm_id: string | null }>();
    expect(recorded?.firm_id).not.toBeNull();
  });

  it("sends nothing at all when the owner chose a password, and commits their credential", async () => {
    const email = "consumer-with-password@example.com";
    const registrationId = newIdentifier("registration");
    // The hash Better Auth's own hasher would have produced is irrelevant to this assertion — what
    // matters is that whatever the registration stored is what lands on the credential row.
    const storedVerifier = "scrypt:placeholder-verifier-value";
    await env.DB_CONTROL.prepare(
      "INSERT INTO registration (id, role, email, display_name, firm_display_name, " +
        "confirmation_hash, status, expires_at, created_at, credential_hash) " +
        "VALUES (?1, 'foundFirm', ?2, ?3, ?4, ?5, 'confirmed', ?6, ?7, ?8)",
    )
      .bind(
        registrationId,
        email,
        "Password Owner",
        "Password Owner Legal",
        await confirmationTokenHash(generateConfirmationToken()),
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        new Date().toISOString(),
        storedVerifier,
      )
      .run();

    // The binding REFUSES every send, so a path that still tried to mail would fail this outright.
    const mailRefusingEnv = {
      ...env,
      SEND_EMAIL: refusingEmailBinding,
      EMAIL_FROM: "no-reply@example.com",
    } as unknown as typeof env;

    await consumeFirmProvision(mailRefusingEnv, {
      id: newIdentifier("outbox"),
      topic: "firm.provision",
      payload: JSON.stringify({
        registrationId,
        firmDisplayName: "Password Owner Legal",
        owner: { email, name: "Password Owner" },
      }),
      aggregate_key: null,
      seq: null,
      attempts: 0,
      created_at: new Date().toISOString(),
    });

    const owner = await env.DB_CONTROL.prepare(
      'SELECT id, email_verified FROM "user" WHERE email = ?1',
    )
      .bind(email)
      .first<{ id: string; email_verified: number }>();
    expect(owner?.email_verified).toBe(1);

    const credential = await env.DB_CONTROL.prepare(
      "SELECT password FROM account WHERE user_id = ?1 AND provider_id = 'credential'",
    )
      .bind(owner?.id ?? "")
      .first<{ password: string | null }>();
    expect(credential?.password).toBe(storedVerifier);
  });
});
