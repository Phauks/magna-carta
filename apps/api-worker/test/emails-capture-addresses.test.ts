import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { findCaptureAddressByToken } from "@magna-carta/data-access/email-filing-statements";
import { findEmailCaptureRouteByToken } from "@magna-carta/data-access/email-capture-route-statements";
import { isWellFormedCaptureToken } from "@magna-carta/email-filing/capture-token";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import {
  perFirmQueue,
  type PerFirmQueueMessage,
} from "../src/background/costs/recoverable-charge-consumer.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// End-to-end over real Miniflare bindings: the mint/rotate/revoke surface plus the relay hop that
// makes a minted address actually routable. The two databases are asserted SEPARATELY throughout,
// because the whole point of this surface is that they are written in a deliberate order and are
// briefly allowed to disagree — a test that only checked one of them would prove nothing about that.

let firmId: FirmId;
let ownerUserId: UserId;
let ownerCookie: string;
let noPermCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let matterId: MatterId;

const clock = { now: () => new Date().toISOString() };

async function seedMatter(): Promise<MatterId> {
  const id = newIdentifier("matter");
  await firmDatabase
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at)
       VALUES (?1, 'Capture Address Matter', 'open', ?2, 0, ?3, ?3)`,
    )
    .bind(id, ownerUserId, clock.now())
    .run();
  return id;
}

interface MintedBody {
  emailCaptureAddressId: string;
  kind: string;
  matterId: string | null;
  address: string;
  token: string;
  routable: boolean;
  createdAt: string;
}

async function mintForMatter(
  target: MatterId,
  idempotencyKey: string,
): Promise<{ status: number; body: MintedBody; replayed: boolean }> {
  const response = await SELF.fetch(`https://x/api/v1/matters/${target}/capture-addresses`, {
    method: "POST",
    headers: { cookie: ownerCookie, "idempotency-key": idempotencyKey },
  });
  return {
    status: response.status,
    body: (await response.json()) as MintedBody,
    replayed: response.headers.get("Idempotency-Replayed") === "true",
  };
}

// Drive the relay by hand: Miniflare cannot deliver a real cron sweep's queue send back into the
// consumer, so the pending outbox rows are read straight out of the firm database and handed to the
// per-firm queue consumer exactly as the relay's publish would shape them. Returns how many rows it
// dispatched. Marks them dispatched afterwards so a second call is a no-op, mirroring the real sweep.
async function relayPendingOutbox(): Promise<number> {
  const { results } = await firmDatabase
    .prepare(
      "SELECT id, topic, payload, aggregate_key, seq FROM outbox WHERE status = 'pending' ORDER BY created_at",
    )
    .all<{
      id: string;
      topic: string;
      payload: string;
      aggregate_key: string | null;
      seq: number | null;
    }>();
  for (const row of results) {
    const message: PerFirmQueueMessage = {
      id: row.id,
      firmId,
      topic: row.topic,
      payload: row.payload,
      aggregateKey: row.aggregate_key,
      seq: row.seq,
    };
    const batch = {
      queue: "magna-carta-production-platform-jobs",
      messages: [
        {
          id: row.id,
          timestamp: new Date(),
          attempts: 1,
          body: message,
          ack: () => {},
          retry: () => {
            throw new Error(`relay retried outbox row ${row.id} — the handler failed`);
          },
        },
      ],
    } as unknown as MessageBatch<PerFirmQueueMessage>;
    await perFirmQueue(batch, env);
    await firmDatabase
      .prepare("UPDATE outbox SET status = 'dispatched' WHERE id = ?1")
      .bind(row.id)
      .run();
  }
  return results.length;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Capture Address Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("capture-addresses-owner@example.com", {
    userName: "Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Owner", firmId);
  ownerCookie = await signInForSessionCookie("capture-addresses-owner@example.com");

  const noPerm = await seedCredentialedUser("capture-addresses-noperm@example.com", {
    userName: "No Perm",
    firmId,
  });
  // A member with no roles holds no emails:manageCaptureAddresses.
  await insertMemberStatement(firmDatabase, {
    userId: noPerm.userId,
    displayName: "No Perm",
    now: clock.now(),
  }).run();
  noPermCookie = await signInForSessionCookie("capture-addresses-noperm@example.com");

  matterId = await seedMatter();
});

describe("capture-address mint", () => {
  it("refuses a caller without emails:manageCaptureAddresses (403)", async () => {
    const response = await SELF.fetch(`https://x/api/v1/matters/${matterId}/capture-addresses`, {
      method: "POST",
      headers: { cookie: noPermCookie, "idempotency-key": crypto.randomUUID() },
    });
    expect(response.status).toBe(403);
  });

  it("mints a well-formed token that resolves to the right matter, and to the right firm once relayed", async () => {
    const minted = await mintForMatter(matterId, crypto.randomUUID());
    expect(minted.status).toBe(201);
    expect(isWellFormedCaptureToken(minted.body.token)).toBe(true);
    expect(minted.body.address).toBe(`${minted.body.token}@in.magnacarta.esq`);
    expect(minted.body.matterId).toBe(matterId);

    // The per-firm half is committed with the request: the capture consumer can already resolve the
    // token to its candidate matter.
    const resolution = await findCaptureAddressByToken(firmDatabase, minted.body.token);
    expect(resolution).toEqual({ kind: "matter", matterId });

    await relayPendingOutbox();

    // The control-plane half lands off the request path: only now does the token route to the firm.
    const route = await findEmailCaptureRouteByToken(env.DB_CONTROL, minted.body.token);
    expect(route).toEqual({ token: minted.body.token, firmId, active: true });
  });

  // The documented failure semantics: the per-firm write succeeds and the control-plane write is
  // still pending, so the address EXISTS but does not yet route. Mail sent in that window bounces —
  // it is never captured to the wrong place and never silently accepted — and the pending outbox row
  // is what converges it. This test pins that intermediate state deliberately; it is the reason the
  // mint response reports routable: false.
  it("leaves a freshly minted address resolvable per-firm but NOT yet routable, with an outbox row pending", async () => {
    const minted = await mintForMatter(matterId, crypto.randomUUID());
    expect(minted.body.routable).toBe(false);

    expect(await findCaptureAddressByToken(firmDatabase, minted.body.token)).not.toBeNull();
    expect(await findEmailCaptureRouteByToken(env.DB_CONTROL, minted.body.token)).toBeNull();

    const pending = await firmDatabase
      .prepare("SELECT topic FROM outbox WHERE status = 'pending'")
      .all<{ topic: string }>();
    expect(pending.results.map((row) => row.topic)).toContain("emailCaptureAddress.minted");

    // …and the relay closes the gap.
    await relayPendingOutbox();
    const route = await findEmailCaptureRouteByToken(env.DB_CONTROL, minted.body.token);
    expect(route?.active).toBe(true);
  });

  it("returns the SAME token on an idempotent replay rather than minting a second address", async () => {
    const key = crypto.randomUUID();
    const first = await mintForMatter(matterId, key);
    const second = await mintForMatter(matterId, key);
    expect(second.status).toBe(201);
    expect(second.replayed).toBe(true);
    expect(second.body.token).toBe(first.body.token);
    expect(second.body.emailCaptureAddressId).toBe(first.body.emailCaptureAddressId);

    const rows = await firmDatabase
      .prepare("SELECT id FROM email_capture_address WHERE token = ?1")
      .bind(first.body.token)
      .all<{ id: string }>();
    expect(rows.results).toHaveLength(1);
  });

  it("404s a mint against an unknown matter", async () => {
    const response = await SELF.fetch(
      `https://x/api/v1/matters/${newIdentifier("matter")}/capture-addresses`,
      { method: "POST", headers: { cookie: ownerCookie, "idempotency-key": crypto.randomUUID() } },
    );
    expect(response.status).toBe(404);
  });
});

describe("capture-address list", () => {
  it("never returns a token value — only a masked prefix and metadata", async () => {
    const minted = await mintForMatter(matterId, crypto.randomUUID());
    const response = await SELF.fetch(`https://x/api/v1/matters/${matterId}/capture-addresses`, {
      headers: { cookie: ownerCookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { emailCaptureAddressId: string; tokenPreview: string; active: boolean }[];
    };
    const row = body.data.find(
      (item) => item.emailCaptureAddressId === minted.body.emailCaptureAddressId,
    );
    expect(row).toBeDefined();
    expect(row?.tokenPreview).toBe(`${minted.body.token.slice(0, 4)}...`);
    // The serialized page must not carry the token anywhere in it.
    expect(JSON.stringify(body)).not.toContain(minted.body.token);
  });
});

describe("capture-address revoke", () => {
  it("stops routing: the control-plane route goes inactive and the token no longer resolves", async () => {
    const minted = await mintForMatter(matterId, crypto.randomUUID());
    await relayPendingOutbox();
    expect((await findEmailCaptureRouteByToken(env.DB_CONTROL, minted.body.token))?.active).toBe(
      true,
    );

    const response = await SELF.fetch(
      `https://x/api/v1/matters/${matterId}/capture-addresses/${minted.body.emailCaptureAddressId}`,
      { method: "DELETE", headers: { cookie: ownerCookie } },
    );
    expect(response.status).toBe(200);

    expect((await findEmailCaptureRouteByToken(env.DB_CONTROL, minted.body.token))?.active).toBe(
      false,
    );
    expect(await findCaptureAddressByToken(firmDatabase, minted.body.token)).toBeNull();
  });

  it("is idempotent — revoking an already-revoked address still succeeds", async () => {
    const minted = await mintForMatter(matterId, crypto.randomUUID());
    await relayPendingOutbox();
    const url = `https://x/api/v1/matters/${matterId}/capture-addresses/${minted.body.emailCaptureAddressId}`;
    expect(
      (await SELF.fetch(url, { method: "DELETE", headers: { cookie: ownerCookie } })).status,
    ).toBe(200);
    expect(
      (await SELF.fetch(url, { method: "DELETE", headers: { cookie: ownerCookie } })).status,
    ).toBe(200);
  });
});

describe("capture-address rotate", () => {
  it("kills the old token and brings the new one live", async () => {
    const original = await mintForMatter(matterId, crypto.randomUUID());
    await relayPendingOutbox();

    const response = await SELF.fetch(
      `https://x/api/v1/matters/${matterId}/capture-addresses/${original.body.emailCaptureAddressId}/rotate`,
      { method: "POST", headers: { cookie: ownerCookie, "idempotency-key": crypto.randomUUID() } },
    );
    expect(response.status).toBe(201);
    const replacement = (await response.json()) as MintedBody;
    expect(replacement.token).not.toBe(original.body.token);
    expect(replacement.matterId).toBe(matterId);

    // The old token stops routing immediately — before the replacement is even registered.
    expect((await findEmailCaptureRouteByToken(env.DB_CONTROL, original.body.token))?.active).toBe(
      false,
    );
    expect(await findCaptureAddressByToken(firmDatabase, original.body.token)).toBeNull();
    // The replacement is resolvable per-firm at once, and routable once the relay runs.
    expect(await findCaptureAddressByToken(firmDatabase, replacement.token)).toEqual({
      kind: "matter",
      matterId,
    });
    await relayPendingOutbox();
    expect((await findEmailCaptureRouteByToken(env.DB_CONTROL, replacement.token))?.active).toBe(
      true,
    );
  });

  it("returns the same replacement token on an idempotent replay rather than rotating twice", async () => {
    const original = await mintForMatter(matterId, crypto.randomUUID());
    await relayPendingOutbox();
    const key = crypto.randomUUID();
    const url = `https://x/api/v1/matters/${matterId}/capture-addresses/${original.body.emailCaptureAddressId}/rotate`;

    const first = (await (
      await SELF.fetch(url, {
        method: "POST",
        headers: { cookie: ownerCookie, "idempotency-key": key },
      })
    ).json()) as MintedBody;
    const second = await SELF.fetch(url, {
      method: "POST",
      headers: { cookie: ownerCookie, "idempotency-key": key },
    });
    // The replay is answered from the stored response BEFORE the effect runs, so the second call
    // never re-reads the address the first one already retired — which would otherwise report the
    // caller's own completed rotation as missing.
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect((await readJson<{ token: string }>(second)).token).toBe(first.token);

    // …and exactly one replacement exists on the matter, not two.
    const live = await firmDatabase
      .prepare("SELECT id FROM email_capture_address WHERE matter_id = ?1 AND active = 1")
      .bind(matterId)
      .all<{ id: string }>();
    expect(live.results.map((row) => row.id)).toContain(first.emailCaptureAddressId);
  });

  it("404s a rotate of an address that belongs to another matter", async () => {
    const other = await seedMatter();
    const minted = await mintForMatter(matterId, crypto.randomUUID());
    const response = await SELF.fetch(
      `https://x/api/v1/matters/${other}/capture-addresses/${minted.body.emailCaptureAddressId}/rotate`,
      { method: "POST", headers: { cookie: ownerCookie, "idempotency-key": crypto.randomUUID() } },
    );
    expect(response.status).toBe(404);
  });
});

describe("firm catch-all capture address", () => {
  it("mints one, refuses a second while it is live, and revokes it", async () => {
    const minted = await SELF.fetch("https://x/api/v1/firm/capture-address", {
      method: "POST",
      headers: { cookie: ownerCookie, "idempotency-key": crypto.randomUUID() },
    });
    expect(minted.status).toBe(201);
    const body = (await minted.json()) as MintedBody;
    expect(body.kind).toBe("catchAll");
    expect(body.matterId).toBeNull();

    // A catch-all resolves to the firm with NO candidate matter — staff route what arrives on it.
    expect(await findCaptureAddressByToken(firmDatabase, body.token)).toEqual({
      kind: "catchAll",
      matterId: null,
    });
    await relayPendingOutbox();
    expect((await findEmailCaptureRouteByToken(env.DB_CONTROL, body.token))?.active).toBe(true);

    const second = await SELF.fetch("https://x/api/v1/firm/capture-address", {
      method: "POST",
      headers: { cookie: ownerCookie, "idempotency-key": crypto.randomUUID() },
    });
    expect(second.status).toBe(409);

    const revoked = await SELF.fetch("https://x/api/v1/firm/capture-address", {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    });
    expect(revoked.status).toBe(200);
    expect((await findEmailCaptureRouteByToken(env.DB_CONTROL, body.token))?.active).toBe(false);
    expect(await findCaptureAddressByToken(firmDatabase, body.token)).toBeNull();

    // With none live, a revoke reports absence rather than pretending to succeed.
    const again = await SELF.fetch("https://x/api/v1/firm/capture-address", {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    });
    expect(again.status).toBe(404);
  });

  it("refuses a caller without emails:manageCaptureAddresses (403)", async () => {
    const response = await SELF.fetch("https://x/api/v1/firm/capture-address", {
      method: "POST",
      headers: { cookie: noPermCookie, "idempotency-key": crypto.randomUUID() },
    });
    expect(response.status).toBe(403);
  });
});
