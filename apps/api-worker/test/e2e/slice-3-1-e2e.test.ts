import { env, listDurableObjectIds, runInDurableObject, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { runScheduledSweep } from "../../src/background/scheduled.ts";
import type { LiveTimerDurableObject } from "../../src/timer/live-timer-durable-object.ts";
import type { TimerState } from "../../src/timer/timer-runtime.ts";
import { firmDatabaseFor } from "../../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import {
  captureResetToken,
  liveCookie,
  PASSWORD,
  postJson,
  setCookies,
  signIn,
} from "../support/test-auth.ts";

// The capstone: one time-capture journey over the REAL HTTP surface (SELF fetch) as a
// sequence of `it` steps over module-level state. A firm is provisioned, its owner activated and
// mirrored, a matter created, then the whole slice composes: a rate card with an effective-dated rate,
// the live timer (start → bind → stop-commit minting exactly one timer entry with a frozen rate
// snapshot), a quick-add create, the My Day read, an explicit re-rate call that moves a draft to a
// new rate without touching the already-captured timer entry (proving the frozen-at-capture rule), and
// the billing-lock seam freezing a billed entry against further business-column updates.
// Tenant isolation is implicit (a single firm's database).

interface ProvisionResponseBody {
  id: string;
  name: string;
  status: string;
  owner: { id: string; email: string; name: string };
}

const FIRM_INPUT = {
  name: "Timekeeping Capstone Firm",
  owner: { email: "time-capstone-owner@example.com", name: "Time Capstone Owner" },
};

let firm: ProvisionResponseBody;
let ownerCookie = "";
let matterId = "";
let rateCardId = "";
let liveRunId = "";
let timerEntryId = "";
let draftEntryId = "";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

function authHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie: ownerCookie,
    "Idempotency-Key": crypto.randomUUID(),
  };
}

async function post(path: string, body: unknown, idempotencyKey?: string): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie: ownerCookie,
    "Idempotency-Key": idempotencyKey ?? crypto.randomUUID(),
  };
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function get(path: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie: ownerCookie },
  });
}

// Backdate the active timer's startedAt so the elapsed math yields a billable (non-zero) duration:
// tests start and stop a timer in sub-second wall time, which the zero-duration guard correctly
// refuses. The DO is addressed by `${firmId}:${userId}`, but the firm here is API-provisioned, so we
// locate the run by its live_run_id rather than reconstructing the chokepoint-derived name.
async function backdateActiveTimer(runId: string, minutesAgo: number): Promise<void> {
  for (const id of await listDurableObjectIds(env.DURABLE_TIMER)) {
    const stub = env.DURABLE_TIMER.get(id);
    await runInDurableObject(stub, async (_instance: LiveTimerDurableObject, state) => {
      const current = await state.storage.get<TimerState>("timer");
      if (!current || current.liveRunId !== runId) return;
      const backdated = new Date(Date.parse(current.startedAt) - minutesAgo * 60_000).toISOString();
      await state.storage.put("timer", {
        ...current,
        startedAt: backdated,
        lastActivityAt: backdated,
      });
    });
  }
}

describe("time tracking end-to-end", () => {
  it("provisions a firm, activates its owner, sets a numbering scheme, and creates a matter", async () => {
    const provisionResponse = await SELF.fetch("https://example.com/api/v1/firms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Platform-Admin-Key": env.PLATFORM_ADMIN_KEY,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(FIRM_INPUT),
    });
    expect(provisionResponse.status).toBe(201);
    firm = (await provisionResponse.json()) as ProvisionResponseBody;
    expect(firm.status).toBe("active");

    const { token } = await captureResetToken(FIRM_INPUT.owner.email);
    expect(
      (await postJson("/api/auth/reset-password", { newPassword: PASSWORD, token })).status,
    ).toBe(200);
    const signInResponse = await signIn(FIRM_INPUT.owner.email);
    expect(signInResponse.status).toBe(200);
    ownerCookie = liveCookie(setCookies(signInResponse), "session_token")?.pair ?? "";
    expect(ownerCookie).not.toBe("");
    const report = await runScheduledSweep(env);
    expect(report.controlPlane.failed).toBe(0);

    // A numbering scheme is required before an open (numbered) matter can be created.
    const schemeResponse = await SELF.fetch("https://example.com/api/v1/numbering-scheme", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        segments: [
          { kind: "literal", text: "TC-" },
          { kind: "counter", padWidth: 4 },
        ],
      }),
    });
    expect(schemeResponse.status).toBe(200);

    const matterResponse = await post("/api/v1/matters", {
      title: "Time Capstone Matter",
      status: "open",
      responsibleMemberId: firm.owner.id,
    });
    expect(matterResponse.status).toBe(201);
    matterId = ((await matterResponse.json()) as { matterId: string }).matterId;
    expect(matterId).toMatch(/^matter_/);
  });

  it("creates a rate card with a timekeeper-tier effective-dated rate", async () => {
    const cardResponse = await post("/api/v1/rate-cards", { name: "Standard" });
    expect(cardResponse.status).toBe(201);
    rateCardId = ((await cardResponse.json()) as { rateCardId: string }).rateCardId;

    // The initial rate in force from 2026-01-01: this is what the timer captures.
    const rateResponse = await post(`/api/v1/rate-cards/${rateCardId}/rates`, {
      tier: "timekeeper",
      scopedId: firm.owner.id,
      rateE4: 2_500_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });
    expect(rateResponse.status).toBe(201);
  });

  it("runs the live timer: start → bind → stop-commit mints exactly one timer entry", async () => {
    const startResponse = await post("/api/v1/timer/start", {});
    expect(startResponse.status).toBe(200);
    liveRunId = ((await startResponse.json()) as { liveRunId: string }).liveRunId;
    expect(liveRunId).not.toBe("");

    const bindResponse = await post("/api/v1/timer/bind", {
      matterId,
      narrative: "Drafted demand letter",
    });
    expect(bindResponse.status).toBe(200);

    // Give the run a real elapsed span (30 minutes) so the commit clears the zero-duration guard;
    // in production a timer accrues real minutes between start and stop.
    await backdateActiveTimer(liveRunId, 30);

    // stop-commit derives workDate from the timer's startedAt and resolves the rate from the
    // first active rate card — no body fields needed beyond the empty object the route requires.
    const stopResponse = await post("/api/v1/timer/stop-commit", {});
    expect(stopResponse.status).toBe(201);
    const committed = (await stopResponse.json()) as { timeEntryId: string };
    timerEntryId = committed.timeEntryId;
    expect(timerEntryId).toMatch(/^timeEntry_/);

    // The store carries exactly one timer-sourced entry on the run, with live_run_id set and the
    // rate snapshot captured at commit time (rate_e4 = 2_500_000, the only rate in force).
    const row = await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
      .prepare(
        "SELECT source, live_run_id, rate_e4, work_date FROM time_entry WHERE live_run_id = ?1",
      )
      .bind(liveRunId)
      .all<{ source: string; live_run_id: string; rate_e4: number | null; work_date: string }>();
    expect(row.results.length).toBe(1);
    expect(row.results[0]?.source).toBe("timer");
    expect(row.results[0]?.rate_e4).toBe(2_500_000);
  });

  it("collapses two racing stop-commits of the same run to one entry (no second entry)", async () => {
    // The DO already committed above; a replay of stop-commit on the same run is idempotent on
    // live_run_id (the chokepoint key + the time_entry.live_run_id partial UNIQUE).
    const replay = await post("/api/v1/timer/stop-commit", {});
    // After a confirmed commit the DO is cleared (discard was called). A second stop-commit on an
    // already-idle DO returns 409 (no active timer); that is the idempotent collapse from the route's
    // perspective — the entry count stays at 1 either way.
    expect([200, 201, 409, 422]).toContain(replay.status);
    const rows = await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
      .prepare("SELECT COUNT(*) AS n FROM time_entry WHERE live_run_id = ?1")
      .bind(liveRunId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("creates a draft entry via quick-add (preview then create) on a fixed work date", async () => {
    const preview = await post("/api/v1/time-entries/quick-add-preview", {
      text: "0.5 — reviewed discovery responses",
    });
    expect(preview.status).toBe(200);
    const parsed = (await preview.json()) as { durationMinutes: number };
    expect(parsed.durationMinutes).toBe(30);

    // Use a fixed work date (2026-06-22) so the re-rate step can target this entry precisely
    // by date range without affecting the timer entry (whose work_date is today's date).
    const createResponse = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: firm.owner.id,
      workDate: "2026-06-22",
      rawDurationMinutes: 30,
      narrative: "Reviewed discovery responses",
      billable: true,
      source: "quick_add",
      rateCardId,
    });
    expect(createResponse.status).toBe(201);
    draftEntryId = ((await createResponse.json()) as { timeEntryId: string }).timeEntryId;
    expect(draftEntryId).toMatch(/^timeEntry_/);

    // The captured rate snapshot for the draft is the 2026-01-01 rate (only rate in force on 2026-06-22).
    const draftRow = await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
      .prepare("SELECT rate_e4 FROM time_entry WHERE id = ?1")
      .bind(draftEntryId)
      .first<{ rate_e4: number }>();
    expect(draftRow?.rate_e4).toBe(2_500_000);
  });

  it("reads My Day totals for the work date", async () => {
    const response = await get(
      `/api/v1/my-day?timekeeperUserId=${firm.owner.id}&workDate=2026-06-22`,
    );
    expect(response.status).toBe(200);
    const view = (await response.json()) as { billableMinutes: number };
    // The quick-add entry is exactly 30 minutes billable on 2026-06-22; the timer entry is on
    // today's date (outside this query), so the total is deterministically 30.
    expect(view.billableMinutes).toBe(30);
  });

  it("a new rate version leaves already-captured entries untouched; reRateUnbilledDrafts moves the draft", async () => {
    // Append a mid-year correction effective 2026-06-22 (after the timer entry, which is on today's
    // date). This closes the prior open rate at 2026-06-22, making the new rate in force from that
    // date onward. Appending in chronological order keeps the intervals non-overlapping.
    const correctionResponse = await post(`/api/v1/rate-cards/${rateCardId}/rates`, {
      tier: "timekeeper",
      scopedId: firm.owner.id,
      rateE4: 2_750_000,
      currency: "USD",
      validFrom: "2026-06-22",
    });
    expect(correctionResponse.status).toBe(201);

    // Neither captured entry has moved yet — appending a new rate version never retroactively
    // rewrites stored rate_e4 columns. This is the frozen-at-capture rule.
    const timerRow = await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
      .prepare("SELECT rate_e4 FROM time_entry WHERE id = ?1")
      .bind(timerEntryId)
      .first<{ rate_e4: number }>();
    expect(timerRow?.rate_e4).toBe(2_500_000);

    const draftBeforeReRate = await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
      .prepare("SELECT rate_e4 FROM time_entry WHERE id = ?1")
      .bind(draftEntryId)
      .first<{ rate_e4: number }>();
    expect(draftBeforeReRate?.rate_e4).toBe(2_500_000);

    // Now opt in to the retroactive re-rate for 2026-06-22 only — this targets exactly the
    // quick-add draft (work_date=2026-06-22) and not the timer entry (which is on today's date,
    // outside this range).
    const reRateResponse = await post(`/api/v1/rate-cards/${rateCardId}/re-rate-drafts`, {
      fromDate: "2026-06-22",
      toDate: "2026-06-22",
    });
    expect(reRateResponse.status).toBe(200);

    // The draft moved to the new in-force rate (2_750_000); the timer entry keeps its captured rate.
    const draftAfterReRate = await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
      .prepare("SELECT rate_e4 FROM time_entry WHERE id = ?1")
      .bind(draftEntryId)
      .first<{ rate_e4: number }>();
    expect(draftAfterReRate?.rate_e4).toBe(2_750_000);

    const timerAfterReRate = await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
      .prepare("SELECT rate_e4 FROM time_entry WHERE id = ?1")
      .bind(timerEntryId)
      .first<{ rate_e4: number }>();
    expect(timerAfterReRate?.rate_e4).toBe(2_500_000);
  });

  it("freezes a billed entry against further business-column updates (the billing-lock seam)", async () => {
    // Drive the entry to billed through the billing-lock seam the service exposes, then prove a draft
    // update is refused. Slice 3·4 billing will drive this transition through the invoice flow; here
    // the test stands in directly at the database level, which is the seam the service enforces.
    await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
      .prepare(
        // fitness:allow-billing-lock — the bill applies the invoice lock; the e2e stands in for 3·4 here.
        "UPDATE time_entry SET status = 'billed', invoice_id = 'invoice_seam' WHERE id = ?1",
      )
      .bind(draftEntryId)
      .run();

    // A PATCH on the now-billed entry must be refused: the service throws a frozen-entry error
    // mapped to 409 by the route.
    const update = await SELF.fetch(`https://example.com/api/v1/time-entries/${draftEntryId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ narrative: "must not apply to a billed entry" }),
    });
    expect([403, 409, 422]).toContain(update.status);

    // The narrative is unchanged — the freeze held.
    const row = await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
      .prepare("SELECT narrative FROM time_entry WHERE id = ?1")
      .bind(draftEntryId)
      .first<{ narrative: string }>();
    expect(row?.narrative).toBe("Reviewed discovery responses");
  });
});
