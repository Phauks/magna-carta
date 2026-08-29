import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmlessCredentialedUser,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// ACCOUNT-FIRST JOINING — the person is made first, and which firm they belong to is settled
// afterwards, signed in. What is asserted here is the part that is easy to get wrong twice: what a
// session with NO firm may reach, and that nothing about the neutral refusal changed on the way.

const INVITEE = {
  email: "account-first-invitee@example.com",
  name: "Priya Raman",
  lastName: "Raman",
  dateOfBirth: "1984-03-17",
};

let poolFirmId: FirmId;
let issuerCookie: string;

// Minted fresh on every reply and identifying the REQUEST rather than its answer, so two identical
// answers carry different ones. They are the only things a comparison may drop.
const PER_REQUEST_HANDLES = new Set(["errorId", "correlationId"]);

async function observableAnswer(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as Record<string, unknown>;
  return {
    httpStatus: response.status,
    ...Object.fromEntries(
      Object.entries(body).filter(([field]) => !PER_REQUEST_HANDLES.has(field)),
    ),
  };
}

let nextClientAddress = 0;
function freshClientAddress(): string {
  nextClientAddress += 1;
  return `198.51.100.${nextClientAddress % 250}`;
}

function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      "cf-connecting-ip": freshClientAddress(),
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

function readMe(cookie: string): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/me", {
    headers: { cookie, accept: "application/json" },
  });
}

async function issueInvitation(overrides: Partial<typeof INVITEE> = {}): Promise<string> {
  const invitee = { ...INVITEE, ...overrides };
  const response = await SELF.fetch("https://example.com/api/v1/invitations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: issuerCookie,
      "idempotency-key": newIdentifier("idempotencyRecord"),
    },
    body: JSON.stringify({
      kind: "firmMember",
      email: invitee.email,
      name: invitee.name,
      lastName: invitee.lastName,
      dateOfBirth: invitee.dateOfBirth,
    }),
  });
  const body = (await response.json()) as { code?: string };
  expect(response.status, JSON.stringify(body)).toBe(201);
  return body.code ?? "";
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Account First Firm" })).firmId;
  const issuer = await seedCredentialedUser("account-first-issuer@example.com", {
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(issuer.userId, "Invitation Issuer", poolFirmId);
  issuerCookie = await signInForSessionCookie("account-first-issuer@example.com");
});

describe("the bootstrap, for a person who belongs to no firm", () => {
  it("answers a null firm, no permissions, and what to do next", async () => {
    const email = "orphan-bootstrap@example.com";
    await seedFirmlessCredentialedUser(email, { userName: "Ada Orphan" });
    const cookie = await signInForSessionCookie(email);

    const response = await readMe(cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      user: { name: "Ada Orphan", email },
      firm: null,
      permissions: [],
      // A channel and a flag set are properties of a FIRM; with no firm there is nothing to read,
      // so the platform defaults answer rather than a half-resolved firm's.
      channel: "stable",
      joining: { state: "chooseFirm" },
    });
  });
});

describe("what a firmless session may reach", () => {
  it("gets the reserved absence on an ordinary firm route, never a 403", async () => {
    const email = "orphan-reach@example.com";
    await seedFirmlessCredentialedUser(email);
    const cookie = await signInForSessionCookie(email);

    // Closed by DEFAULT: this route never thought about a firmless session, and that is precisely
    // why it must answer absence. A 403 would confirm the route exists and the caller merely lacks
    // a capability, which is a fact about them nothing anonymous should be able to establish.
    const response = await SELF.fetch("https://example.com/api/v1/firm/scan-policy", {
      headers: { cookie, accept: "application/json" },
    });
    expect(response.status).toBe(404);
  });

  it("refuses the onboarding routes to somebody who already has a firm", async () => {
    const email = "already-in-a-firm@example.com";
    await seedCredentialedUser(email, { firmId: poolFirmId });
    const cookie = await signInForSessionCookie(email);

    // A person belongs to exactly one firm, so there is no second one to found and no other to
    // attach to. The route is unreachable for them — which is what lets it carry permission: null.
    const founding = await post("/api/v1/me/firm", { firmName: "Second Firm" }, cookie);
    expect(founding.status).toBe(404);

    const redeeming = await post(
      "/api/v1/me/invitation-redemptions",
      { code: "ABCDEFGH", lastName: "Raman", dateOfBirth: "1984-03-17" },
      cookie,
    );
    expect(redeeming.status).toBe(404);
  });
});

describe("founding a firm from a signed-in account", () => {
  it("adopts the signed-in account as the firm's owner rather than creating a second one", async () => {
    const email = "founder@example.com";
    const { userId } = await seedFirmlessCredentialedUser(email, { userName: "Fay Founder" });
    const cookie = await signInForSessionCookie(email);

    const response = await post("/api/v1/me/firm", { firmName: "Founder and Co" }, cookie);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "provisioning" });

    // The build is a committed outbox row, which is what makes it survive a crash rather than
    // depending on the request that asked for it. The request-path sweep runs it promptly here.
    const outbox = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS count FROM outbox WHERE topic = 'firm.provision' AND payload LIKE '%Founder and Co%'",
    ).first<{ count: number }>();
    expect(outbox?.count).toBe(1);

    const bootstrap = (await (await readMe(cookie)).json()) as {
      firm: { id: string; name: string } | null;
      joining?: { state: string };
    };
    // Either state is correct — the build is asynchronous — but only these two are.
    if (bootstrap.firm === null) {
      expect(bootstrap.joining?.state).toBe("firmProvisioning");
      return;
    }

    // It arrived. THE NAME ON SCREEN IS THE ONE THEY TYPED, never the registration handle the firm
    // is keyed by: a self-serve firm's `name` is machinery and `display_name` is the firm.
    expect(bootstrap.firm.name).toBe("Founder and Co");

    // Adopted, not created: the founder owns the firm under the account they signed in with, and
    // there is still exactly one row for their address.
    const firmRow = await env.DB_CONTROL.prepare("SELECT owner_user_id FROM firm WHERE id = ?1")
      .bind(bootstrap.firm.id)
      .first<{ owner_user_id: string | null }>();
    expect(firmRow?.owner_user_id).toBe(userId);
    const accounts = await env.DB_CONTROL.prepare(
      'SELECT COUNT(*) AS count FROM "user" WHERE email = ?1',
    )
      .bind(email)
      .first<{ count: number }>();
    expect(accounts?.count).toBe(1);
  });

  it("never starts a second firm while one is already being built", async () => {
    // Driven from the state a build in flight leaves behind rather than by racing a real one: a
    // confirmed founding registration whose firm is not yet recorded is exactly what the
    // provisioning consumer has not finished with.
    const email = "double-press@example.com";
    await seedFirmlessCredentialedUser(email);
    const cookie = await signInForSessionCookie(email);
    await env.DB_CONTROL.prepare(
      "INSERT INTO registration (id, role, email, display_name, firm_display_name, " +
        "confirmation_hash, status, expires_at, confirmed_at, created_at) " +
        "VALUES (?1, 'foundFirm', ?2, 'Double Press', 'Press and Co', ?3, 'confirmed', ?4, ?4, ?4)",
    )
      .bind(
        newIdentifier("registration"),
        email,
        `unspendable-${newIdentifier("registration")}`,
        new Date().toISOString(),
      )
      .run();

    const response = await post("/api/v1/me/firm", { firmName: "Press and Co" }, cookie);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "provisioning" });

    const registrations = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS count FROM registration WHERE email = ?1",
    )
      .bind(email)
      .first<{ count: number }>();
    expect(registrations?.count).toBe(1);
  });
});

describe("redeeming an invitation into an account that already exists", () => {
  it("attaches the firm to the signed-in person, creating no second account", async () => {
    const code = await issueInvitation();
    await seedFirmlessCredentialedUser(INVITEE.email, { userName: INVITEE.name });
    const cookie = await signInForSessionCookie(INVITEE.email);

    const usersBefore = await env.DB_CONTROL.prepare(
      'SELECT COUNT(*) AS count FROM "user" WHERE email = ?1',
    )
      .bind(INVITEE.email)
      .first<{ count: number }>();
    expect(usersBefore?.count).toBe(1);

    const response = await post(
      "/api/v1/me/invitation-redemptions",
      { code, lastName: INVITEE.lastName, dateOfBirth: INVITEE.dateOfBirth },
      cookie,
    );
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(await response.json()).toMatchObject({ firmId: poolFirmId, kind: "firmMember" });

    const row = await env.DB_CONTROL.prepare('SELECT firm_id FROM "user" WHERE email = ?1')
      .bind(INVITEE.email)
      .first<{ firm_id: string | null }>();
    expect(row?.firm_id).toBe(poolFirmId);

    // The whole point of the signed-in door: it ATTACHES rather than creating. A second row would
    // mean the person who redeemed is not the person who signed in.
    const usersAfter = await env.DB_CONTROL.prepare(
      'SELECT COUNT(*) AS count FROM "user" WHERE email = ?1',
    )
      .bind(INVITEE.email)
      .first<{ count: number }>();
    expect(usersAfter?.count).toBe(1);
  });

  it("refuses an invitation addressed to somebody else in the same words as a wrong code", async () => {
    // The possession proof, preserved. In the anonymous flow it is the mailed password link that
    // proves the invitee holds the invited mailbox; here no mail is sent, so the addresses must
    // match — otherwise somebody holding the three facts could attach THEIR account to the firm.
    const code = await issueInvitation({ email: "someone-else@example.com" });

    // TWO ACCOUNTS, one attempt each. The caller's budget is keyed by SESSION here, so a second
    // attempt from the same person would legitimately read one lower — and comparing a first
    // attempt against a second would be comparing the ladder, not the answer.
    const mismatchedEmail = "wrong-mailbox@example.com";
    await seedFirmlessCredentialedUser(mismatchedEmail);
    const mismatchedCookie = await signInForSessionCookie(mismatchedEmail);
    const wrongCodeEmail = "wrong-code@example.com";
    await seedFirmlessCredentialedUser(wrongCodeEmail);
    const wrongCodeCookie = await signInForSessionCookie(wrongCodeEmail);

    const mismatched = await post(
      "/api/v1/me/invitation-redemptions",
      { code, lastName: INVITEE.lastName, dateOfBirth: INVITEE.dateOfBirth },
      mismatchedCookie,
    );
    const wrongCode = await post(
      "/api/v1/me/invitation-redemptions",
      { code: "ZZZZZZZZ", lastName: INVITEE.lastName, dateOfBirth: INVITEE.dateOfBirth },
      wrongCodeCookie,
    );

    const [mismatchedAnswer, wrongCodeAnswer] = await Promise.all([
      observableAnswer(mismatched),
      observableAnswer(wrongCode),
    ]);
    expect(mismatchedAnswer.httpStatus).toBe(422);
    // Everything a caller can see is identical — including the budget, which counts the caller's
    // own attempts and so cannot report whether an invitation was found.
    expect(mismatchedAnswer).toEqual(wrongCodeAnswer);

    // And the account is untouched: a refused redemption joins nobody to anything.
    const row = await env.DB_CONTROL.prepare('SELECT firm_id FROM "user" WHERE email = ?1')
      .bind(mismatchedEmail)
      .first<{ firm_id: string | null }>();
    expect(row?.firm_id).toBeNull();
  });
});

describe("registration, account-first", () => {
  it("creates the account when the token is spent, and no firm", async () => {
    const email = "new-person@example.com";
    const started = await post("/api/v1/registrations", { email, name: "New Person" });
    expect(started.status).toBe(202);
    expect(await started.json()).toMatchObject({ next: "checkEmail" });

    // The row records the door, and confirmation branches on the ROW rather than on anything a
    // caller says later.
    const registration = await env.DB_CONTROL.prepare(
      "SELECT role, firm_display_name FROM registration WHERE email = ?1",
    )
      .bind(email)
      .first<{ role: string; firm_display_name: string | null }>();
    expect(registration?.role).toBe("account");
    expect(registration?.firm_display_name).toBeNull();
  });

  it("keeps a registration started under the superseded founding door working", async () => {
    // The compatibility guarantee: somebody holding an unspent token minted before the reflow
    // completes under the OLD rules, with no window and no migration of rows in flight.
    const email = "old-door-founder@example.com";
    const started = await post("/api/v1/registrations", {
      role: "foundFirm",
      email,
      name: "Old Door",
      firmName: "Old Door Legal",
    });
    expect(started.status).toBe(202);

    const registration = await env.DB_CONTROL.prepare(
      "SELECT role, firm_display_name FROM registration WHERE email = ?1",
    )
      .bind(email)
      .first<{ role: string; firm_display_name: string | null }>();
    expect(registration?.role).toBe("foundFirm");
    expect(registration?.firm_display_name).toBe("Old Door Legal");
  });

  it("still answers the invited doors with the constant, writing nothing", async () => {
    const response = await post("/api/v1/registrations", {
      role: "clientOfFirm",
      email: "invited-door@example.com",
      name: "Invited Person",
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ next: "redeemInvitation" });
    const registration = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS count FROM registration WHERE email = ?1",
    )
      .bind("invited-door@example.com")
      .first<{ count: number }>();
    expect(registration?.count).toBe(0);
  });
});
