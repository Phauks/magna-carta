import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { setCookies, liveCookie } from "./support/test-auth.ts";
import { createAuth } from "../src/auth.ts";
import { consumeFirmProvision } from "../src/background/firm-provision-consumer.ts";
import { generateConfirmationToken, confirmationTokenHash } from "../src/joining-secrets.ts";

// THE WHOLE WALK, once: a stranger registers, confirms, the firm is built off the request path, and
// the owner signs in with a password they set through the emailed link. This is the test that says
// "a working login" rather than "four routes that each answer correctly".
//
// The confirmation token is planted rather than read out of an email because the outbound port is
// the app's own wiring and this suite is about the state machine, not about delivery — the token's
// hash is written directly, which is exactly what the route would have stored.

// The password a registering visitor chooses. Long enough for the server's published minimum, and
// the same value the sign-in at the end of the walk presents — which is the property under test.
const OWNER_PASSWORD = "a-sufficiently-long-owner-password";

let nextClientAddress = 0;
function freshClientAddress(): string {
  nextClientAddress += 1;
  return `192.0.2.${nextClientAddress % 250}`;
}

function postAnonymous(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      "cf-connecting-ip": freshClientAddress(),
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

describe("founding a firm from the open internet", () => {
  it("registers, confirms, provisions off the request path, and signs the owner in", async () => {
    const email = "founder@example.com";

    // 1. Register. One row, one email, and nothing that costs money.
    const started = await postAnonymous("/api/v1/registrations", {
      role: "foundFirm",
      email,
      name: "Amara Osei",
      password: OWNER_PASSWORD,
      firmName: "Osei and Company",
    });
    expect(started.status).toBe(202);
    expect(await started.json()).toEqual({ next: "checkEmail" });

    const pending = await env.DB_CONTROL.prepare(
      "SELECT id, status, firm_display_name FROM registration WHERE email = ?1",
    )
      .bind(email)
      .first<{ id: string; status: string; firm_display_name: string }>();
    expect(pending?.status).toBe("pending");
    expect(pending?.firm_display_name).toBe("Osei and Company");

    // Nothing beyond that one row: no firm, no user. That split is the anti-abuse control — an
    // unconfirmed registration must cost a row and nothing else — so it is asserted, not assumed.
    const userBefore = await env.DB_CONTROL.prepare('SELECT id FROM "user" WHERE email = ?1')
      .bind(email)
      .first();
    expect(userBefore).toBeNull();

    // 2. Confirm, with the token the route would have mailed.
    const token = generateConfirmationToken();
    await env.DB_CONTROL.prepare("UPDATE registration SET confirmation_hash = ?2 WHERE id = ?1")
      .bind(pending?.id ?? "", await confirmationTokenHash(token))
      .run();

    const confirmed = await postAnonymous("/api/v1/registrations/confirmations", { token });
    const confirmedBody = (await confirmed.json()) as Record<string, unknown>;
    expect(confirmed.status, JSON.stringify(confirmedBody)).toBe(200);
    // `next: "signIn"` is the whole point of the reflow: the owner's credential is committed with
    // their user row by the provisioning batch, so there is no second mail to wait for.
    expect(confirmedBody).toEqual({ email, status: "provisioning", next: "signIn" });

    // The work is QUEUED rather than done inline: the handler answered without creating a bucket
    // or minting a key, and the row describing the work committed with the status flip that
    // authorized it. The row's own status is deliberately NOT asserted — the confirming request
    // schedules a best-effort sweep, so it may legitimately be dispatched already by the time this
    // reads, and pinning it would be pinning a race rather than the contract.
    const queued = await env.DB_CONTROL.prepare(
      "SELECT id, topic, payload FROM outbox WHERE topic = 'firm.provision'",
    ).first<{ id: string; topic: string; payload: string }>();
    expect(queued).not.toBeNull();

    // 3. The consumer does the building. Called directly, exactly as the cron sweep calls it — and
    // safe to call even if that sweep has already run, which is the property the race demands.
    await consumeFirmProvision(env, {
      id: queued?.id ?? "",
      topic: "firm.provision",
      payload: queued?.payload ?? "",
      attempts: 0,
    } as Parameters<typeof consumeFirmProvision>[1]);

    const firm = await env.DB_CONTROL.prepare(
      "SELECT id, name, display_name, status, owner_user_id, wrapped_firm_key FROM firm WHERE name = ?1",
    )
      .bind(pending?.id ?? "")
      .first<{
        id: string;
        name: string;
        display_name: string;
        status: string;
        owner_user_id: string;
        wrapped_firm_key: string | null;
      }>();
    expect(firm?.status).toBe("active");
    // The human name is the display name; the UNIQUE name column holds the registration handle, so
    // the next firm called Osei and Company is not refused and nobody can probe for this one.
    expect(firm?.display_name).toBe("Osei and Company");
    expect(firm?.name).toBe(pending?.id);
    expect(firm?.wrapped_firm_key).not.toBeNull();

    const owner = await env.DB_CONTROL.prepare(
      'SELECT id, email_verified FROM "user" WHERE email = ?1',
    )
      .bind(email)
      .first<{ id: string; email_verified: number }>();
    expect(owner?.id).toBe(firm?.owner_user_id);
    // VERIFIED, because the token that got here travelled by mail and spending it is the same
    // possession proof email verification asks for. It used to be 0, which meant the account was
    // unusable until a second mail arrived.
    expect(owner?.email_verified).toBe(1);

    // THE CREDENTIAL EXISTS, committed in the same batch as the owner. This is the assertion that
    // would have caught the production failure: a `user` row with no credential `account` row is an
    // account nobody can ever sign in to, and sign-in's only symptom is a log line reading
    // "Credential account not found".
    const credential = await env.DB_CONTROL.prepare(
      "SELECT provider_id, password FROM account WHERE user_id = ?1 AND provider_id = 'credential'",
    )
      .bind(owner?.id ?? "")
      .first<{ provider_id: string; password: string | null }>();
    expect(credential).not.toBeNull();
    expect(credential?.password ?? "").not.toBe("");
    // The stored value is a VERIFIER, never the password.
    expect(credential?.password).not.toBe(OWNER_PASSWORD);

    // 4. The owner signs in with the password they chose at registration — no second mail, no reset
    // link, no activation step. Through SELF.fetch, so it is Better Auth's own sign-in endpoint
    // verifying the credential this platform wrote.
    const signedIn = await SELF.fetch("https://example.com/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        "cf-connecting-ip": freshClientAddress(),
      },
      body: JSON.stringify({ email, password: OWNER_PASSWORD }),
    });
    expect(signedIn.status).toBe(200);
    expect(liveCookie(setCookies(signedIn), "session_token")).toBeDefined();

    // The session is real enough to reach the app.
    const me = await SELF.fetch("https://example.com/api/v1/me", {
      headers: { cookie: liveCookie(setCookies(signedIn), "session_token")?.pair ?? "" },
    });
    expect([200, 404]).toContain(me.status);
  });

  it("is safe to redeliver — a second pass finds the firm already built and does nothing twice", async () => {
    const email = "redelivery@example.com";
    await postAnonymous("/api/v1/registrations", {
      role: "foundFirm",
      email,
      name: "Bo Lindqvist",
      password: OWNER_PASSWORD,
      firmName: "Lindqvist Chambers",
    });
    const pending = await env.DB_CONTROL.prepare("SELECT id FROM registration WHERE email = ?1")
      .bind(email)
      .first<{ id: string }>();
    const token = generateConfirmationToken();
    await env.DB_CONTROL.prepare("UPDATE registration SET confirmation_hash = ?2 WHERE id = ?1")
      .bind(pending?.id ?? "", await confirmationTokenHash(token))
      .run();
    await postAnonymous("/api/v1/registrations/confirmations", { token });

    const queued = await env.DB_CONTROL.prepare(
      "SELECT id, payload FROM outbox WHERE topic = 'firm.provision' AND payload LIKE '%' || ?1 || '%'",
    )
      .bind(pending?.id ?? "")
      .first<{ id: string; payload: string }>();
    const row = {
      id: queued?.id ?? "",
      topic: "firm.provision",
      payload: queued?.payload ?? "",
      attempts: 0,
    } as Parameters<typeof consumeFirmProvision>[1];

    // At-least-once is the delivery guarantee, so the second pass is the case that matters. It
    // must not mint a second key, insert a second owner, or throw — the provisioner's own state
    // guards are what make that true, and this is the assertion that keeps them wired up.
    await consumeFirmProvision(env, row);
    await consumeFirmProvision(env, row);

    const owners = await env.DB_CONTROL.prepare(
      'SELECT COUNT(*) AS total FROM "user" WHERE email = ?1',
    )
      .bind(email)
      .first<{ total: number }>();
    expect(owners?.total).toBe(1);

    const firms = await env.DB_CONTROL.prepare("SELECT COUNT(*) AS total FROM firm WHERE name = ?1")
      .bind(pending?.id ?? "")
      .first<{ total: number }>();
    expect(firms?.total).toBe(1);
  });

  it("will not confirm the same registration twice", async () => {
    const email = "double-confirm@example.com";
    await postAnonymous("/api/v1/registrations", {
      role: "foundFirm",
      email,
      name: "Cai Zhou",
      password: OWNER_PASSWORD,
      firmName: "Zhou Legal",
    });
    const pending = await env.DB_CONTROL.prepare("SELECT id FROM registration WHERE email = ?1")
      .bind(email)
      .first<{ id: string }>();
    const token = generateConfirmationToken();
    await env.DB_CONTROL.prepare("UPDATE registration SET confirmation_hash = ?2 WHERE id = ?1")
      .bind(pending?.id ?? "", await confirmationTokenHash(token))
      .run();

    expect((await postAnonymous("/api/v1/registrations/confirmations", { token })).status).toBe(
      200,
    );
    // A confirmation link left in a mailbox is not a standing key to a second firm.
    const replay = await postAnonymous("/api/v1/registrations/confirmations", { token });
    expect(replay.status).toBe(422);

    const queuedCount = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS total FROM outbox WHERE topic = 'firm.provision' AND payload LIKE '%' || ?1 || '%'",
    )
      .bind(pending?.id ?? "")
      .first<{ total: number }>();
    expect(queuedCount?.total).toBe(1);
  });

  it("supersedes an earlier unconfirmed registration rather than leaving two live links", async () => {
    const email = "supersede@example.com";
    await postAnonymous("/api/v1/registrations", {
      role: "foundFirm",
      email,
      name: "Dara Nolan",
      password: OWNER_PASSWORD,
      firmName: "Nolan Law",
    });
    await postAnonymous("/api/v1/registrations", {
      role: "foundFirm",
      email,
      name: "Dara Nolan",
      password: OWNER_PASSWORD,
      firmName: "Nolan Law",
    });

    const rows = await env.DB_CONTROL.prepare(
      "SELECT status, COUNT(*) AS total FROM registration WHERE email = ?1 GROUP BY status",
    )
      .bind(email)
      .all<{ status: string; total: number }>();
    const byStatus = Object.fromEntries(rows.results.map((row) => [row.status, row.total]));
    expect(byStatus["pending"]).toBe(1);
    expect(byStatus["superseded"]).toBe(1);
  });
});

describe("recovery codes are recognisable and typeable", () => {
  it("mints MC-prefixed codes over an alphabet with no confusable glyphs", async () => {
    // Reached through the configured plugin rather than a re-implementation here, so this asserts
    // what a member is actually handed rather than what a copy of the generator would produce.
    const context = await createAuth(env, () => Promise.resolve()).$context;
    const twoFactorPlugin = context.options.plugins?.find((plugin) => plugin.id === "two-factor");
    expect(twoFactorPlugin).toBeDefined();
    const generate = (
      twoFactorPlugin as unknown as {
        options?: { backupCodeOptions?: { customBackupCodesGenerate?: () => string[] } };
      }
    ).options?.backupCodeOptions?.customBackupCodesGenerate;
    expect(generate).toBeTypeOf("function");

    const codes = generate?.() ?? [];
    expect(codes).toHaveLength(10);
    for (const code of codes) {
      // The MC prefix makes a code recognisable on a printed sheet beside another service's codes.
      expect(code.startsWith("MC")).toBe(true);
      // The random part is at least the library default's ten characters — the prefix adds no
      // entropy, so it is on top of the code rather than instead of part of it.
      expect(code.length - 2).toBeGreaterThanOrEqual(10);
      // And none of the glyph pairs that get mistyped off paper.
      expect(code.slice(2)).toMatch(/^[A-HJ-NP-Z2-9]+$/);
    }
    // Distinct codes, which is the one thing a broken generator gets wrong silently.
    expect(new Set(codes).size).toBe(codes.length);
  });
});
