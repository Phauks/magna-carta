import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { appendRate, createRateCard } from "@magna-carta/timekeeping/rate-service";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The timer HTTP surface over a live Durable Object: start/bind/stop-commit mints exactly one entry
// tagged source=timer with its live_run_id set; an unbound timer refuses to commit (422); two racing
// stop-commits collapse to one entry (the chokepoint key + the time_entry.live_run_id partial UNIQUE,
// both derived from the same live_run_id); and the DO clears after a confirmed commit.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let matterId: string;
const clock = { now: () => new Date().toISOString() };

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (await seedFirm({ name: "Timer Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("timer-owner@example.com", {
    userName: "Timer Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Timer Owner");
  ownerCookie = await signInForSessionCookie("timer-owner@example.com");

  // A numbering scheme is required before matters can be created (the matter POST 422s without one).
  await SELF.fetch("https://example.com/api/v1/numbering-scheme", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      segments: [
        { kind: "literal", text: "TM-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });

  const created = await SELF.fetch("https://example.com/api/v1/matters", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      title: "Doe v. Roe",
      status: "open",
      responsibleMemberId: ownerUserId,
    }),
  });
  matterId = ((await created.json()) as { matterId: string }).matterId;

  const card = await createRateCard(
    env.DB_FIRM_POOL_1,
    { name: "Standard" },
    { clock, actorUserId: ownerUserId },
  );
  await commitEffectBatch(env.DB_FIRM_POOL_1, card.effect, { now: clock.now });
  const rate = await appendRate(
    env.DB_FIRM_POOL_1,
    {
      rateCardId: card.rateCardId,
      tier: "timekeeper",
      scopedId: ownerUserId,
      rateE4: 3_000_000,
      currency: "USD",
      validFrom: "2026-01-01",
    },
    { clock, actorUserId: ownerUserId },
  );
  await commitEffectBatch(env.DB_FIRM_POOL_1, rate.effect, { now: clock.now });
});

function headers(withKey = true): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie: ownerCookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
}

async function get(path: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie: ownerCookie },
  });
}

describe("timer start -> bind -> stop-commit", () => {
  it("mints exactly one entry tagged source=timer with its live_run_id set", async () => {
    const start = await post("/api/v1/timer/start", {});
    expect(start.status).toBe(200);
    const { liveRunId } = (await start.json()) as { liveRunId: string };
    expect(liveRunId).toBeTruthy();

    expect(
      (await post("/api/v1/timer/bind", { matterId, narrative: "Negotiated settlement" })).status,
    ).toBe(200);

    const stop = await post("/api/v1/timer/stop-commit", {});
    expect(stop.status).toBe(201);
    const { timeEntryId } = (await stop.json()) as { timeEntryId: string };

    const row = await env.DB_FIRM_POOL_1.prepare(
      "SELECT source, live_run_id, status FROM time_entry WHERE id = ?1",
    )
      .bind(timeEntryId)
      .first<{ source: string; live_run_id: string | null; status: string }>();
    expect(row?.source).toBe("timer");
    expect(row?.live_run_id).toBe(liveRunId);
    expect(row?.status).toBe("draft");

    // The DO cleared after the confirmed commit: a fresh read reports no live timer.
    const read = await get("/api/v1/timer/read");
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as { status: string };
    expect(readBody.status).toBe("idle");
  });
});

describe("an unbound timer cannot commit", () => {
  it("refuses stop-commit with 422 when no matter is bound", async () => {
    expect((await post("/api/v1/timer/start", {})).status).toBe(200);
    const stop = await post("/api/v1/timer/stop-commit", {});
    expect(stop.status).toBe(422);
    await post("/api/v1/timer/discard", {});
  });
});

describe("two racing stop-commits collapse to one entry", () => {
  it("derives one chokepoint key + one timeEntry handle from the live_run_id", async () => {
    const start = await post("/api/v1/timer/start", {});
    const { liveRunId } = (await start.json()) as { liveRunId: string };
    await post("/api/v1/timer/bind", { matterId, narrative: "Concurrent stop" });

    const before = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM time_entry WHERE live_run_id = ?1",
    )
      .bind(liveRunId)
      .first<{ c: number }>();
    expect(before?.c).toBe(0);

    const [a, b] = await Promise.all([
      post("/api/v1/timer/stop-commit", {}),
      post("/api/v1/timer/stop-commit", {}),
    ]);
    // Both requests must succeed with 201: the first commits, the second replays the same result.
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    // Both must return the identical timeEntryId — the idempotent replay yields the first entry handle.
    const { timeEntryId: idA } = (await a.json()) as { timeEntryId: string };
    const { timeEntryId: idB } = (await b.json()) as { timeEntryId: string };
    expect(idA).toBe(idB);

    const after = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM time_entry WHERE live_run_id = ?1",
    )
      .bind(liveRunId)
      .first<{ c: number }>();
    expect(after?.c).toBe(1);
  });
});

describe("idle timer stop-commit", () => {
  it("returns 409 when no timer is running", async () => {
    // Ensure the DO is cleared first (discard any leftover)
    await post("/api/v1/timer/discard", {});
    const stop = await post("/api/v1/timer/stop-commit", {});
    expect(stop.status).toBe(409);
  });
});
