import { env, runInDurableObject, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { appendRate, createRateCard } from "@magna-carta/timekeeping/rate-service";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import type { LiveTimerDurableObject } from "../src/timer/live-timer-durable-object.ts";
import type { TimerState } from "../src/timer/timer-runtime.ts";
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

// Backdate the DO's startedAt by the given number of minutes so the elapsed math produces a
// non-zero durationMinutes. Necessary because tests start and stop timers in sub-second time,
// which would trigger the zero-duration billing guard (a correct guard for production).
async function backdateTimerStart(
  firmId: string,
  userId: string,
  minutesAgo: number,
): Promise<void> {
  const stub = env.DURABLE_TIMER.get(env.DURABLE_TIMER.idFromName(`${firmId}:${userId}`));
  await runInDurableObject(stub, async (_instance: LiveTimerDurableObject, state) => {
    const current = await state.storage.get<TimerState>("timer");
    if (current === null || current === undefined) return;
    const backdated = new Date(Date.parse(current.startedAt) - minutesAgo * 60_000).toISOString();
    await state.storage.put("timer", {
      ...current,
      startedAt: backdated,
      lastActivityAt: backdated,
    });
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

    // Backdate the start so the elapsed time exceeds the zero-duration billing guard (which refuses
    // sub-60-second runs that round to 0 minutes). In production, timers run for real minutes.
    await backdateTimerStart(poolFirmId, ownerUserId, 30);

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

describe("idempotent stop-commits collapse to one entry", () => {
  it("derives one chokepoint key + one timeEntry handle from the live_run_id (sequential replay)", async () => {
    // Two sequential stop-commits against the same liveRunId must both return 201 with the identical
    // timeEntryId and leave exactly one row. The first commit wins and writes the idempotency record;
    // the tombstone (written before discard) lets the second request find already-committed on the DO
    // and replay the stored response from the idempotency record — without re-reading live DO state.
    const start = await post("/api/v1/timer/start", {});
    const { liveRunId } = (await start.json()) as { liveRunId: string };
    await post("/api/v1/timer/bind", { matterId, narrative: "Idempotent stop" });

    // Backdate so the stop-commit produces a non-zero durationMinutes and is not refused by the
    // zero-duration billing guard.
    await backdateTimerStart(poolFirmId, ownerUserId, 30);

    const before = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM time_entry WHERE live_run_id = ?1",
    )
      .bind(liveRunId)
      .first<{ c: number }>();
    expect(before?.c).toBe(0);

    // First stop-commit: the winner commits the entry and writes the tombstone.
    const first = await post("/api/v1/timer/stop-commit", {});
    expect(first.status).toBe(201);
    const { timeEntryId: idFirst } = (await first.json()) as { timeEntryId: string };

    // Second stop-commit: the DO returns already-committed (tombstone), the route replays the stored 201.
    const second = await post("/api/v1/timer/stop-commit", {});
    expect(second.status).toBe(201);
    const { timeEntryId: idSecond } = (await second.json()) as { timeEntryId: string };
    expect(idFirst).toBe(idSecond);

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
    // Ensure the DO is fully reset: start (clears any tombstone from a prior committed run) then
    // discard (clears the live timer state), leaving a truly idle DO.
    await post("/api/v1/timer/start", {});
    await post("/api/v1/timer/discard", {});
    const stop = await post("/api/v1/timer/stop-commit", {});
    expect(stop.status).toBe(409);
  });
});

describe("zero-duration guard on stop-commit", () => {
  it("returns 422 when the timer run rounds to 0 minutes (sub-60-second run), keeping the run open", async () => {
    // Start, bind, and immediately stop — the run has elapsed < 1 minute so durationMinutes = 0.
    // The guard must refuse with 422 and NOT mark the run committed, so the timer can still be
    // discarded or kept running.
    const start = await post("/api/v1/timer/start", { matterId });
    expect(start.status).toBe(200);
    const { liveRunId } = (await start.json()) as { liveRunId: string };

    // Bind in case the start didn't bind (defensive)
    await post("/api/v1/timer/bind", { matterId, narrative: "Zero-duration run" });

    const stop = await post("/api/v1/timer/stop-commit", {});
    // The run is shorter than 60 seconds so it rounds to 0 — refuse with 422.
    expect(stop.status).toBe(422);
    const body = (await stop.json()) as { title?: string };
    expect(body.title).toMatch(/too short/i);

    // The run must still be open (not committed, not discarded) — the timer state is not idle.
    const read = await get("/api/v1/timer/read");
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as { status: string };
    // Status is committing (stopAndCommit transitioned it) but the entry was not persisted.
    expect(readBody.status).not.toBe("idle");

    // Confirm no entry was written for this run.
    const row = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM time_entry WHERE live_run_id = ?1",
    )
      .bind(liveRunId)
      .first<{ c: number }>();
    expect(row?.c).toBe(0);

    // Clean up: discard the lingering committing run so it doesn't affect later tests.
    await post("/api/v1/timer/discard", {});
  });
});
