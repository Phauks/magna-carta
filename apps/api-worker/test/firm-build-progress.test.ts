import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { readJoiningState } from "../src/joining-state.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// WHAT A PERSON WAITING ON A WORKSPACE IS TOLD, and the gap at the end of it.
//
// Two facts are pinned here, and the second is the one that was actually broken.
//
// The first is that the build REPORTS ITSELF: provisioning leaves its marks on the firm's own row —
// a bucket recorded, a key wrapped, the status flipped — and the bootstrap reads them, so a waiting
// screen can name the step it is on instead of showing a spinner. The reading is taken from the
// database rather than tracked anywhere, which is what makes a resumed build report what it has
// actually done rather than what a counter believed.
//
// The second is that A FIRM EXISTING IS NOT A WORKSPACE SOMEBODY CAN USE. Activation attaches the
// account to the firm in the control plane; the member record that every permission resolves
// through is written into the FIRM's own database afterwards, by a queued message. Between the two
// the bootstrap used to answer a firm and an empty permission list, which is indistinguishable from
// a member holding no role — so the app let them in and refused them every screen. The membership
// state is what tells those two apart, and it is asserted through the real route.

let poolFirmId: FirmId;

function readMe(cookie: string): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/me", {
    headers: { cookie, accept: "application/json" },
  });
}

/** A confirmed founding registration whose firm is not recorded yet — a build under way. */
async function seedFoundingRegistration(email: string): Promise<string> {
  const registrationId = newIdentifier("registration");
  const now = new Date().toISOString();
  await env.DB_CONTROL.prepare(
    "INSERT INTO registration (id, role, email, display_name, firm_display_name, " +
      "confirmation_hash, status, expires_at, confirmed_at, created_at) " +
      "VALUES (?1, 'foundFirm', ?2, 'Fay Founder', 'Founder and Co', ?3, 'confirmed', ?4, ?4, ?4)",
  )
    .bind(registrationId, email, `unused-${registrationId}`, now)
    .run();
  return registrationId;
}

/**
 * The half-built firm as the provisioner leaves it, keyed by the registration handle — which IS a
 * self-serve firm's `name`, and the only way to find a firm whose id nothing has recorded yet.
 */
async function seedHalfBuiltFirm(
  registrationId: string,
  marks: { bucketName?: string; wrappedFirmKey?: string; status?: string },
): Promise<void> {
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, display_name, status, bucket_name, wrapped_firm_key, created_at) " +
      "VALUES (?1, ?2, 'Founder and Co', ?3, ?4, ?5, ?6)",
  )
    .bind(
      newIdentifier("firm"),
      registrationId,
      marks.status ?? "provisioning",
      marks.bucketName ?? null,
      marks.wrappedFirmKey ?? null,
      new Date().toISOString(),
    )
    .run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Build Progress Firm" })).firmId;
});

describe("what the bootstrap says while a firm is being built", () => {
  it("reports nothing under way for somebody who has not asked for a firm", async () => {
    expect(await readJoiningState(env.DB_CONTROL, "nobody-here@example.com")).toEqual({
      state: "chooseFirm",
    });
  });

  it("reports a build that has not started a single step yet", async () => {
    // The request is committed and the consumer has not run. Every step false is the honest answer,
    // and it is what the screen opens on — not an empty sequence, and not a step marked done to
    // avoid showing one that has not happened.
    const email = "build-not-started@example.com";
    await seedFoundingRegistration(email);
    expect(await readJoiningState(env.DB_CONTROL, email)).toEqual({
      state: "firmProvisioning",
      build: {
        firmRecord: false,
        fileStorage: false,
        encryptionKey: false,
        activated: false,
        stalled: false,
      },
    });
  });

  it("reports each mark the build leaves, in the order the build leaves them", async () => {
    const email = "build-part-way@example.com";
    const registrationId = await seedFoundingRegistration(email);
    await seedHalfBuiltFirm(registrationId, { bucketName: "magna-carta-founder-and-co" });

    // The bucket is recorded and the key is not — the real intermediate state, and the one a
    // spinner cannot express.
    expect(await readJoiningState(env.DB_CONTROL, email)).toEqual({
      state: "firmProvisioning",
      build: {
        firmRecord: true,
        fileStorage: true,
        encryptionKey: false,
        activated: false,
        stalled: false,
      },
    });

    await env.DB_CONTROL.prepare("UPDATE firm SET wrapped_firm_key = 'wrapped' WHERE name = ?1")
      .bind(registrationId)
      .run();
    expect((await readJoiningState(env.DB_CONTROL, email)).build).toMatchObject({
      encryptionKey: true,
      activated: false,
    });

    // The activation batch flips the status and records the owner in one commit, so the status is
    // what "the last step landed" is read from.
    await env.DB_CONTROL.prepare("UPDATE firm SET status = 'active' WHERE name = ?1")
      .bind(registrationId)
      .run();
    expect((await readJoiningState(env.DB_CONTROL, email)).build).toMatchObject({
      activated: true,
      stalled: false,
    });
  });

  it("reports a build whose work was dead-lettered as stopped", async () => {
    // The one state on the waiting screen that will not clear by waiting: the relay never
    // re-dispatches a failed row on its own. A screen that could not say this would leave somebody
    // watching work that has stopped.
    const email = "build-stalled@example.com";
    const registrationId = await seedFoundingRegistration(email);
    await seedHalfBuiltFirm(registrationId, { bucketName: "magna-carta-stalled" });
    await env.DB_CONTROL.prepare(
      "INSERT INTO outbox (id, topic, payload, status, attempts, created_at) " +
        "VALUES (?1, 'firm.provision', ?2, 'failed', 5, ?3)",
    )
      .bind(
        newIdentifier("outbox"),
        JSON.stringify({ registrationId, firmDisplayName: "Founder and Co" }),
        new Date().toISOString(),
      )
      .run();

    expect((await readJoiningState(env.DB_CONTROL, email)).build).toMatchObject({
      fileStorage: true,
      encryptionKey: false,
      stalled: true,
    });
  });

  it("stops reporting a build once the registration records which firm it became", async () => {
    // The consumer's own last statement. Nothing is waiting any more, so there is no build to
    // report — and a person who never asked for one must not be handed a waiting screen.
    const email = "build-finished@example.com";
    const registrationId = await seedFoundingRegistration(email);
    await env.DB_CONTROL.prepare("UPDATE registration SET firm_id = ?2 WHERE id = ?1")
      .bind(registrationId, poolFirmId)
      .run();
    expect(await readJoiningState(env.DB_CONTROL, email)).toEqual({ state: "chooseFirm" });
  });
});

describe("what the bootstrap says about this account's place in its firm", () => {
  it("reports a member whose record has not reached the firm's database as still being written", async () => {
    // The gap, through the real route: the account belongs to the firm and the firm's own database
    // has never heard of it. Answering only `permissions: []` here is what made this look like a
    // role an administrator had forgotten to assign.
    const email = "not-yet-mirrored@example.com";
    await seedCredentialedUser(email, { firmId: poolFirmId });
    const cookie = await signInForSessionCookie(email);

    const body = (await (await readMe(cookie)).json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      firm: { id: poolFirmId },
      permissions: [],
      membership: { state: "provisioning" },
    });
  });

  it("reports a member record the relay has given up on as stopped, not as a wait", async () => {
    // A dead-lettered mirror never clears, and telling somebody to keep waiting for it is the
    // failure this state exists to name. `failed` is terminal — the relay does not re-dispatch it —
    // so the screen says so and points at support instead of at an administrator.
    const email = "mirror-abandoned@example.com";
    const { userId } = await seedCredentialedUser(email, { firmId: poolFirmId });
    await env.DB_CONTROL.prepare(
      "INSERT INTO outbox (id, topic, payload, status, attempts, created_at) " +
        "VALUES (?1, 'member.provision', ?2, 'failed', 5, ?3)",
    )
      .bind(
        newIdentifier("outbox"),
        JSON.stringify({ userId, firmId: poolFirmId, displayName: "Abandoned", roleName: null }),
        new Date().toISOString(),
      )
      .run();
    const cookie = await signInForSessionCookie(email);

    const body = (await (await readMe(cookie)).json()) as { membership?: { state: string } };
    expect(body.membership).toEqual({ state: "stalled" });
  });

  it("reports an active membership once the record has landed", async () => {
    const email = "mirrored@example.com";
    const { userId } = await seedCredentialedUser(email, { firmId: poolFirmId });
    await mirrorMemberWithOwnerRole(userId, "Mirrored Member", poolFirmId);
    const cookie = await signInForSessionCookie(email);

    const body = (await (await readMe(cookie)).json()) as {
      permissions: string[];
      membership?: { state: string };
    };
    expect(body.membership).toEqual({ state: "active" });
    expect(body.permissions.length).toBeGreaterThan(0);
  });
});
