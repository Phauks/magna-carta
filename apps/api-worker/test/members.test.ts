import { createExecutionContext, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { fingerprintRequest } from "@magna-carta/data-access/canonical";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import worker from "../src/index.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  captureResetToken,
  mirrorMemberWithOwnerRole,
  postJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The pool firm is seeded once here and every test attaches its users to it. Its per-firm data lives
// in the firm's FirmDatabase Durable Object (addressed by firmId, self-migrating on first access).
let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Members Test Firm" })).firmId;
});

// Mirrors the invite endpoint's own write: a user row with NO credential account row.
async function directInsertUser(email: string, name: string): Promise<{ userId: string }> {
  const { firmId } = await seedFirm();
  const userId = newIdentifier("user");
  await env.DB_CONTROL.prepare(
    'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id) VALUES (?1, ?2, ?3, 0, ?4, ?4, ?5)',
  )
    .bind(userId, name, email, Date.now(), firmId)
    .run();
  return { userId };
}

// The build-time verification: on better-auth 1.6.16, does the password-reset flow work for a user
// row with NO credential account row? It does — the pinned
// resetPassword handler creates the credential account when none exists (dist/api/routes/
// password.mjs), so PATH A (direct-insert user via the effect batch, activation via the reset
// link) is the landed path. This test is the empirical pin; a library bump that breaks the claim
// fails here, not in production.
describe("invitation activation — Path A verification", () => {
  it("activates a direct-inserted user with no credential account via the password-reset flow", async () => {
    const email = "activation-invitee@example.com";
    const { userId } = await directInsertUser(email, "Activation Invitee");

    const noAccountYet = await env.DB_CONTROL.prepare("SELECT id FROM account WHERE user_id = ?1")
      .bind(userId)
      .first();
    expect(noAccountYet).toBeNull();

    // The activation email must travel through the injected SendEmail port — capture it.
    const { auth, token, sentEmails } = await captureResetToken(email);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.to).toBe(email);

    const newPassword = "a-sufficiently-long-password";
    const reset = await auth.api.resetPassword({ body: { newPassword, token } });
    expect(reset.status).toBe(true);

    // Path A's crux: the reset CREATED the credential account for the account-less user.
    const account = await env.DB_CONTROL.prepare(
      "SELECT provider_id, password FROM account WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ provider_id: string; password: string | null }>();
    expect(account?.provider_id).toBe("credential");
    expect(account?.password).not.toBeNull();

    // Completing the reset proves mailbox possession, so the onPasswordReset hook marks the email
    // verified — without it, requireEmailVerification would lock every invitee out at sign-in.
    const userRow = await env.DB_CONTROL.prepare('SELECT email_verified FROM "user" WHERE id = ?1')
      .bind(userId)
      .first<{ email_verified: number }>();
    expect(userRow?.email_verified).toBe(1);

    // End-to-end proof: the activated invitee can sign in.
    const signInResponse = await postJson("/api/auth/sign-in/email", {
      email,
      password: newPassword,
    });
    expect(signInResponse.status).toBe(200);
  });
});

async function postMembers(
  body: unknown,
  options: { cookie?: string; idempotencyKey?: string } = {},
): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/members", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options.idempotencyKey === undefined
        ? {}
        : { "Idempotency-Key": options.idempotencyKey }),
    },
    body: JSON.stringify(body),
  });
}

// Seeds a credentialed user on the resolvable pool firm, grants Admin (which carries
// firm:manageMembers), and signs in — the inviting principal for the happy paths.
async function signInAsOwner(email: string): Promise<string> {
  const { userId } = await seedCredentialedUser(email, { firmId: poolFirmId });
  await mirrorMemberWithOwnerRole(userId, "Inviting Owner", poolFirmId);
  return signInForSessionCookie(email);
}

describe("POST /api/v1/members", () => {
  it("answers an unauthenticated request with a 401 problem", async () => {
    const response = await postMembers(
      { email: "nobody@example.com", name: "Nobody" },
      { idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/unauthenticated",
      status: 401,
    });
    expect(body["errorId"]).toMatch(/^error_/);
  });

  it("demands the Idempotency-Key header with a 400 problem (x-mc-idempotency: required)", async () => {
    const sessionCookie = await signInAsOwner("invite-no-key@example.com");
    const response = await postMembers(
      { email: "keyless@example.com", name: "Keyless" },
      { cookie: sessionCookie },
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/idempotency-key-missing",
      status: 400,
    });
    expect(body["errorId"]).toMatch(/^error_/);
  });

  it("answers 403 when the member lacks firm:manageMembers", async () => {
    // Credentialed and firm-resolvable, but never mirrored into the member table — no roles,
    // no grants, no permissions.
    await seedCredentialedUser("invite-powerless@example.com", { firmId: poolFirmId });
    const sessionCookie = await signInForSessionCookie("invite-powerless@example.com");

    const response = await postMembers(
      { email: "blocked@example.com", name: "Blocked Invitee" },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/permission-denied",
      status: 403,
    });
    // The within-firm denial (a trusted insider, visible-but-denied) carries the request→grant
    // seam — distinct from the silent 404 structural absence above.
    expect(body["requestAccess"]).toBe(true);
    expect(body["errorId"]).toMatch(/^error_/);
  });

  it("answers 404 when the inviter has been DEACTIVATED — absent at the chokepoint, never a 403 oracle", async () => {
    // A full Admin whose member row was then deactivated. Under the chokepoint a DEACTIVATED
    // member is structural ABSENCE: the firm-context gate (step 3a) returns null → 404, BEFORE the
    // permission gate runs — so a deactivated insider is indistinguishable from no such firm/member,
    // never a 403 confirming the account exists but was turned off. (This is the unified semantics
    // /v1/me already had for a deactivated member; the chokepoint now gives every authenticated route
    // the same 404, retiring the route-local 403.)
    const { userId } = await seedCredentialedUser("invite-deactivated@example.com", {
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Deactivated Inviter", poolFirmId);
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("UPDATE member SET status = 'deactivated' WHERE user_id = ?1")
      .bind(userId)
      .run();
    const sessionCookie = await signInForSessionCookie("invite-deactivated@example.com");

    const response = await postMembers(
      { email: "blocked-by-deactivation@example.com", name: "Blocked Invitee" },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/not-found",
      status: 404,
    });
    // No requestAccess on a 404 — structural absence is silent, never the within-firm 403 seam.
    expect("requestAccess" in body).toBe(false);
    expect(body["errorId"]).toMatch(/^error_/);
  });

  it("creates the user, outbox row, and audit row in one batch, then sends the activation email", async () => {
    const sessionCookie = await signInAsOwner("invite-owner@example.com");

    const response = await postMembers(
      { email: "Invitee@Example.com", name: "Invited Member" },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; email: string; name: string };
    expect(body.id).toMatch(/^user_/);
    // Stored lowercased — Better Auth's email lookups lowercase their input.
    expect(body.email).toBe("invitee@example.com");
    expect(body.name).toBe("Invited Member");

    // The user row: unverified, no credential account (activation creates it — Path A).
    const userRow = await env.DB_CONTROL.prepare(
      'SELECT name, email_verified FROM "user" WHERE id = ?1',
    )
      .bind(body.id)
      .first<{ name: string; email_verified: number }>();
    expect(userRow).toEqual({ name: "Invited Member", email_verified: 0 });

    // The member.provision outbox row rode the same batch (canonical-JSON payload, sorted keys).
    // Storage is shared across this file's tests, so reads are scoped by the invited user's id.
    const outboxRow = await env.DB_CONTROL.prepare(
      "SELECT topic, payload, status FROM outbox WHERE payload LIKE '%' || ?1 || '%'",
    )
      .bind(body.id)
      .first<{ topic: string; payload: string; status: string }>();
    expect(outboxRow?.topic).toBe("member.provision");
    // pending OR dispatched: the invite fires a best-effort request-path sweep on commit (the R1
    // latency optimization), which may consume this row before the assertion reads it. Its status
    // is incidental here — the row's enqueued topic + payload is what this test pins.
    expect(["pending", "dispatched"]).toContain(outboxRow?.status);
    const payload = JSON.parse(outboxRow?.payload ?? "{}") as Record<string, unknown>;
    expect(payload).toEqual({
      displayName: "Invited Member",
      firmId: poolFirmId,
      roleName: null,
      userId: body.id,
    });

    // The member.invited audit row names the inviting actor and the invited user.
    const auditRow = await env.DB_CONTROL.prepare(
      "SELECT user_id, metadata FROM auth_audit WHERE event = 'member.invited' AND metadata LIKE '%' || ?1 || '%'",
    )
      .bind(body.id)
      .first<{ user_id: string; metadata: string }>();
    expect(auditRow?.user_id).toMatch(/^user_/);
    expect(JSON.parse(auditRow?.metadata ?? "{}")).toMatchObject({ invitedUserId: body.id });

    // requestPasswordReset ran after the commit: its reset-password verification row exists.
    const verificationRow = await env.DB_CONTROL.prepare(
      "SELECT identifier FROM verification WHERE value = ?1",
    )
      .bind(body.id)
      .first<{ identifier: string }>();
    expect(verificationRow?.identifier).toMatch(/^reset-password:/);
  });

  it("replays the stored response for a repeated Idempotency-Key without re-running the effect", async () => {
    const sessionCookie = await signInAsOwner("invite-replay-owner@example.com");
    const idempotencyKey = crypto.randomUUID();
    const requestBody = { email: "replayed@example.com", name: "Replayed Invitee" };

    const first = await postMembers(requestBody, { cookie: sessionCookie, idempotencyKey });
    expect(first.status).toBe(201);
    const firstBody = await first.text();

    const second = await postMembers(requestBody, { cookie: sessionCookie, idempotencyKey });
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await second.text()).toBe(firstBody);

    // The effect ran once: one user row for the email, one outbox row, one activation email.
    const userCount = await env.DB_CONTROL.prepare(
      'SELECT COUNT(*) AS count FROM "user" WHERE email = ?1',
    )
      .bind("replayed@example.com")
      .first<{ count: number }>();
    expect(userCount?.count).toBe(1);
    const invitedId = (JSON.parse(firstBody) as { id: string }).id;
    const outboxCount = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS count FROM outbox WHERE payload LIKE '%' || ?1 || '%'",
    )
      .bind(invitedId)
      .first<{ count: number }>();
    expect(outboxCount?.count).toBe(1);
    const verificationCount = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS count FROM verification WHERE value = ?1",
    )
      .bind(invitedId)
      .first<{ count: number }>();
    expect(verificationCount?.count).toBe(1);
  });

  it("answers a duplicate email with a 422 problem and commits nothing", async () => {
    const sessionCookie = await signInAsOwner("invite-duplicate-owner@example.com");

    const first = await postMembers(
      { email: "taken@example.com", name: "First Invitee" },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(first.status).toBe(201);
    const outboxCountBefore = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS count FROM outbox",
    ).first<{ count: number }>();

    // A NEW Idempotency-Key (a genuinely new request) for an already-taken email: the user
    // INSERT trips UNIQUE(user.email) inside the batch, the whole batch rolls back, and the
    // handler maps the surfaced conflict to a 422 problem.
    const duplicate = await postMembers(
      { email: "taken@example.com", name: "Second Invitee" },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(duplicate.status).toBe(422);
    expect(duplicate.headers.get("content-type")).toContain("application/problem+json");
    const body = (await duplicate.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/email-in-use",
      status: 422,
    });
    expect(body["errorId"]).toMatch(/^error_/);

    // Nothing from the rolled-back batch survives: still one user for the email, and the
    // duplicate attempt added no outbox row.
    const userCount = await env.DB_CONTROL.prepare(
      'SELECT COUNT(*) AS count FROM "user" WHERE email = ?1',
    )
      .bind("taken@example.com")
      .first<{ count: number }>();
    expect(userCount?.count).toBe(1);
    const outboxCountAfter = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS count FROM outbox",
    ).first<{ count: number }>();
    expect(outboxCountAfter?.count).toBe(outboxCountBefore?.count);
  });

  it("answers a reused Idempotency-Key with a DIFFERENT payload as a 422 problem — the middleware pre-decision IS the common path", async () => {
    const sessionCookie = await signInAsOwner("mismatch-common-owner@example.com");
    const idempotencyKey = crypto.randomUUID();
    const first = await postMembers(
      { email: "mismatch-common-a@example.com", name: "First Payload" },
      { cookie: sessionCookie, idempotencyKey },
    );
    expect(first.status).toBe(201);

    // Same key, different body: the data-access middleware's pre-decision answers WITHOUT the
    // handler running — and it must answer the route contract's application/problem+json shape
    // (via the conflictResponse hook), never its generic JSON default.
    const mismatch = await postMembers(
      { email: "mismatch-common-b@example.com", name: "Second Payload" },
      { cookie: sessionCookie, idempotencyKey },
    );
    expect(mismatch.status).toBe(422);
    expect(mismatch.headers.get("content-type")).toContain("application/problem+json");
    const body = (await mismatch.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/idempotency-fingerprint-mismatch",
      title: "Idempotency-Key reused",
      status: 422,
      instance: "/api/v1/members",
    });
    expect(body["errorId"]).toMatch(/^error_/);

    // The mismatching request executed nothing: no user row for the second email.
    const userCount = await env.DB_CONTROL.prepare(
      'SELECT COUNT(*) AS count FROM "user" WHERE email = ?1',
    )
      .bind("mismatch-common-b@example.com")
      .first<{ count: number }>();
    expect(userCount?.count).toBe(0);
  });

  it("answers an in-progress Idempotency-Key as a 409 problem on the middleware pre-decision", async () => {
    const sessionCookie = await signInAsOwner("in-progress-owner@example.com");
    const idempotencyKey = crypto.randomUUID();
    const requestBody = { email: "in-progress-invitee@example.com", name: "In Progress Invitee" };
    // Seed the reserved record a still-running first request would hold, under the firm-scoped
    // stored key and the exact fingerprint the middleware derives for this method + path + body.
    const fingerprint = await fingerprintRequest({
      method: "POST",
      path: "/api/v1/members",
      body: requestBody,
    });
    await env.DB_CONTROL.prepare(
      "INSERT INTO idempotency_key (id, key, fingerprint, status, created_at) VALUES (?1, ?2, ?3, 'in_progress', ?4)",
    )
      .bind(
        crypto.randomUUID(),
        `${poolFirmId}:${idempotencyKey}`,
        fingerprint,
        new Date().toISOString(),
      )
      .run();

    const response = await postMembers(requestBody, { cookie: sessionCookie, idempotencyKey });
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/idempotency-key-conflict",
      title: "Request in progress",
      status: 409,
      instance: "/api/v1/members",
    });
    expect(body["errorId"]).toMatch(/^error_/);
  });

  // Auth precedes idempotency: the route's middleware chain resolves the session and the
  // firm:manageMembers permission BEFORE any idempotency processing, so unauthenticated and
  // unpermitted callers never touch the idempotency table — no stored-response replay, no
  // key-existence oracle. The slice 0·5 chokepoint formalizes this ordering globally.
  it("never replays or reveals an idempotency record to an unauthenticated caller — existing and unknown keys answer identically", async () => {
    const sessionCookie = await signInAsOwner("oracle-owner@example.com");
    const idempotencyKey = crypto.randomUUID();
    const requestBody = { email: "oracle-invitee@example.com", name: "Oracle Invitee" };
    const seeded = await postMembers(requestBody, { cookie: sessionCookie, idempotencyKey });
    expect(seeded.status).toBe(201);

    // The control: an unknown key — every unauthenticated answer must be FIELD-IDENTICAL to it.
    const control = await postMembers(requestBody, { idempotencyKey: crypto.randomUUID() });
    expect(control.status).toBe(401);
    expect(control.headers.get("Idempotency-Replayed")).toBeNull();
    expect(control.headers.get("content-type")).toContain("application/problem+json");
    const controlBody = (await control.json()) as Record<string, unknown>;
    expect(controlBody).toMatchObject({
      type: "https://api.magnacarta.esq/problems/unauthenticated",
      status: 401,
    });
    expect(controlBody["errorId"]).toMatch(/^error_/);

    const probes = [
      // The leaked-key replay: exact key + exact body must NOT answer the stored 201 (which
      // carries the invited usr_ id).
      await postMembers(requestBody, { idempotencyKey }),
      // The existence oracle: exact key + different body must NOT answer the 422
      // fingerprint-mismatch that distinguishes a live key from a dead one.
      await postMembers({ email: "oracle-probe@example.com", name: "Probe" }, { idempotencyKey }),
    ];
    // Field-complete comparison: status, content-type, no replay header, and the FULL body —
    // only the per-response errorId is removed before the deep-equal. Any divergent field
    // (title, detail, instance, an extra key, …) is an oracle distinguishing live keys from dead.
    delete controlBody["errorId"];
    delete controlBody["correlationId"];
    for (const probe of probes) {
      expect(probe.status).toBe(control.status);
      expect(probe.headers.get("content-type")).toBe(control.headers.get("content-type"));
      expect(probe.headers.get("Idempotency-Replayed")).toBeNull();
      const probeBody = (await probe.json()) as Record<string, unknown>;
      expect(probeBody["errorId"]).toMatch(/^error_/);
      delete probeBody["errorId"];
      delete probeBody["correlationId"];
      expect(probeBody).toEqual(controlBody);
    }
  });

  it("answers 403 to a session without firm:manageMembers regardless of idempotency-record state", async () => {
    const ownerCookie = await signInAsOwner("mismatch-target-owner@example.com");
    const idempotencyKey = crypto.randomUUID();
    const requestBody = { email: "mismatch-target-invitee@example.com", name: "Mismatch Target" };
    const seeded = await postMembers(requestBody, { cookie: ownerCookie, idempotencyKey });
    expect(seeded.status).toBe(201);

    // Credentialed on the same firm but never mirrored into the member table — no permissions.
    await seedCredentialedUser("mismatch-powerless@example.com", { firmId: poolFirmId });
    const powerlessCookie = await signInForSessionCookie("mismatch-powerless@example.com");

    // The control: the powerless session with an UNKNOWN key — every record-state probe must be
    // FIELD-IDENTICAL to it.
    const control = await postMembers(requestBody, {
      cookie: powerlessCookie,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(control.status).toBe(403);
    expect(control.headers.get("Idempotency-Replayed")).toBeNull();
    expect(control.headers.get("content-type")).toContain("application/problem+json");
    const controlBody = (await control.json()) as Record<string, unknown>;
    expect(controlBody).toMatchObject({
      type: "https://api.magnacarta.esq/problems/permission-denied",
      status: 403,
    });
    expect(controlBody["errorId"]).toMatch(/^error_/);

    const probes = [
      // Exact key + exact body: no replay of the stored 201.
      await postMembers(requestBody, { cookie: powerlessCookie, idempotencyKey }),
      // Exact key + different body: 403, never the 422 fingerprint-mismatch leak that would
      // confirm the key exists.
      await postMembers(
        { email: "mismatch-probe@example.com", name: "Probe" },
        { cookie: powerlessCookie, idempotencyKey },
      ),
    ];
    // Field-complete comparison against the unknown-key control — see the unauthenticated oracle
    // test above for the rationale; only the per-response errorId is removed before the deep-equal.
    delete controlBody["errorId"];
    delete controlBody["correlationId"];
    for (const probe of probes) {
      expect(probe.status).toBe(control.status);
      expect(probe.headers.get("content-type")).toBe(control.headers.get("content-type"));
      expect(probe.headers.get("Idempotency-Replayed")).toBeNull();
      const probeBody = (await probe.json()) as Record<string, unknown>;
      expect(probeBody["errorId"]).toMatch(/^error_/);
      delete probeBody["errorId"];
      delete probeBody["correlationId"];
      expect(probeBody).toEqual(controlBody);
    }
  });

  it("scopes idempotency keys to the firm: another firm's key neither replays nor poisons", async () => {
    // Firm A is the pool firm; firm B lives on the second dev-pool database.
    const firmACookie = await signInAsOwner("cross-firm-a-owner@example.com");
    const firmB = await seedFirm({ name: "Cross-Firm Test Firm" });
    const { userId: firmBOwnerId } = await seedCredentialedUser("cross-firm-b-owner@example.com", {
      firmId: firmB.firmId,
    });
    await mirrorMemberWithOwnerRole(firmBOwnerId, "Cross-Firm Owner", firmB.firmId);
    const firmBCookie = await signInForSessionCookie("cross-firm-b-owner@example.com");

    // Cross-firm replay: firm B presenting firm A's exact key + body must NOT receive firm A's
    // stored 201 (the invited usr_ id). The request executes FRESH for firm B — proven by the
    // fresh effect tripping UNIQUE(user.email) into the email-in-use 422, never a replay.
    const replayKey = crypto.randomUUID();
    const firmABody = { email: "cross-firm-invitee@example.com", name: "Cross-Firm Invitee" };
    const firmAFirst = await postMembers(firmABody, {
      cookie: firmACookie,
      idempotencyKey: replayKey,
    });
    expect(firmAFirst.status).toBe(201);
    const stolenReplay = await postMembers(firmABody, {
      cookie: firmBCookie,
      idempotencyKey: replayKey,
    });
    expect(stolenReplay.headers.get("Idempotency-Replayed")).toBeNull();
    expect(stolenReplay.status).toBe(422);
    expect((await stolenReplay.json()) as Record<string, unknown>).toMatchObject({
      type: "https://api.magnacarta.esq/problems/email-in-use",
      title: "Email already in use",
    });

    // Cross-firm poisoning: firm A's key with firm B's own payload executes FRESH for firm B —
    // under a global key namespace this was a 422 fingerprint-mismatch denial of service.
    const sharedKey = crypto.randomUUID();
    const firmASecond = await postMembers(
      { email: "cross-firm-second@example.com", name: "Second Invitee" },
      { cookie: firmACookie, idempotencyKey: sharedKey },
    );
    expect(firmASecond.status).toBe(201);
    const firmAInvitedId = ((await firmASecond.json()) as { id: string }).id;
    const firmBFresh = await postMembers(
      { email: "cross-firm-b-invitee@example.com", name: "Firm B Invitee" },
      { cookie: firmBCookie, idempotencyKey: sharedKey },
    );
    expect(firmBFresh.status).toBe(201);
    expect(firmBFresh.headers.get("Idempotency-Replayed")).toBeNull();
    const firmBInvitedId = ((await firmBFresh.json()) as { id: string }).id;
    expect(firmBInvitedId).not.toBe(firmAInvitedId);

    // The control-plane table holds one record PER FIRM SCOPE for the shared client key —
    // the documented `${firmId}:${clientKey}` control-plane stored-key convention.
    const storedRows = await env.DB_CONTROL.prepare(
      "SELECT key FROM idempotency_key WHERE key IN (?1, ?2)",
    )
      .bind(`${poolFirmId}:${sharedKey}`, `${firmB.firmId}:${sharedKey}`)
      .all<{ key: string }>();
    expect(storedRows.results.map((row) => row.key).sort()).toEqual(
      [`${poolFirmId}:${sharedKey}`, `${firmB.firmId}:${sharedKey}`].sort(),
    );

    // Within-firm semantics are unchanged: firm B retrying its own request still replays.
    const firmBReplay = await postMembers(
      { email: "cross-firm-b-invitee@example.com", name: "Firm B Invitee" },
      { cookie: firmBCookie, idempotencyKey: sharedKey },
    );
    expect(firmBReplay.status).toBe(201);
    expect(firmBReplay.headers.get("Idempotency-Replayed")).toBe("true");
  });

  it("mirrors the invitee through the request-path waitUntil sweep, with NO manual cron sweep", async () => {
    // R1: the route schedules a best-effort sweep on its executionCtx after committing the invite,
    // so a fast-activating invitee doesn't sit at permissions: [] until the next */5 cron. Driving
    // the worker through worker.fetch + a captured execution context lets the test await that
    // waitUntil (waitOnExecutionContext) — proving the member row lands WITHOUT runScheduledSweep
    // ever being called by the test. (The e2e keeps its explicit sweeps for determinism; production
    // gets both the cron AND this request-path sweep.)
    const sessionCookie = await signInAsOwner("request-path-sweep-owner@example.com");
    const executionContext = createExecutionContext();
    const request = new Request("https://example.com/api/v1/members", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: sessionCookie,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        email: "request-path-sweep-invitee@example.com",
        name: "Request Path Invitee",
      }),
    });

    const response = await worker.fetch(request, env, executionContext);
    expect(response.status).toBe(201);
    const invitedUserId = ((await response.json()) as { id: string }).id;

    // Await the route's waitUntil(runScheduledSweep) — no manual sweep call anywhere in this test.
    await waitOnExecutionContext(executionContext);

    const memberResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT display_name, status FROM member WHERE user_id = ?1")
      .bind(invitedUserId)
      .all<{ display_name: string; status: string }>();
    expect(memberResult.results[0]).toEqual({
      display_name: "Request Path Invitee",
      status: "active",
    });
  });

  it("emits the route into the OpenAPI document with the native operationId and x-mc metadata", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      paths: Record<string, { post?: Record<string, unknown> }>;
    };
    const operation = document.paths["/api/v1/members"]?.post;
    expect(operation).toBeDefined();
    expect(operation?.["operationId"]).toBe("members.invite");
    expect(operation).toMatchObject({
      "x-mc-operationId": "members.invite",
      "x-mc-surface": "app",
      "x-mc-authenticated": true,
      "x-mc-permission": "firm:manageMembers",
      "x-mc-resource": "firm",
      "x-mc-audited": true,
      "x-mc-idempotency": "required",
    });
  });
});
