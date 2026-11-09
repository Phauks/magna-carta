import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Context } from "hono";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { ResolvedSession } from "../../src/http/chokepoint/chokepoint.ts";
import type { RouteMeta } from "../../src/http/contracts/route-meta.ts";
import { createChokepointPorts } from "../../src/http/chokepoint/ports.ts";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { seedFirm } from "../support/test-auth.ts";

// The chokepoint's structural-absence gate (step 3a) runs through the REAL production resolver
// (ports.ts makeResolveFirmContext): it reads the control-plane firm row FIRST and returns null —
// which the chokepoint maps to a 404, no existence oracle — when no firm row exists, BEFORE it ever
// addresses the per-firm FirmDatabase Durable Object. A phantom firmId is never auto-provisioned into
// a DO. (D1's user.firm_id foreign key keeps a live session from pointing at an absent firm; this is
// the defensive gate for a hard-deleted firm with a lingering session, exercised here against the
// real resolver rather than a fake.)

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

// The resolver only reads c.env; a minimal Context carrying the test env satisfies its contract.
function contextWithEnv(): Context {
  return { env } as unknown as Context;
}

// The resolver reads only meta.firmDatabaseOutage, but it takes a whole RouteMeta — a route's own
// shape, not a flag in isolation, is what decides whether an unreachable firm database is fatal.
const READ_META: RouteMeta = {
  operationId: "meta.versions",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};
const TOLERATING_META: RouteMeta = { ...READ_META, firmDatabaseOutage: "tolerate" };

// resolveFirmContext uses neither the auth instance nor the rate limiter, so stubs suffice to build
// the production port bundle.
function resolveFirmContext() {
  return createChokepointPorts(() => undefined as never, {
    check: () => Promise.resolve({ allowed: true }),
  } as never).resolveFirmContext;
}

describe("chokepoint firm-absence gate (real resolver)", () => {
  it("returns null (the 404 mapping) for a session whose firm row is absent — the DO is never addressed", async () => {
    // A firmId with no control-plane firm row: the gate's first read finds nothing and short-circuits
    // before firmDatabaseFor is ever called, so no FirmDatabase DO is created for the phantom firm.
    const session: ResolvedSession = {
      userId: newIdentifier("user"),
      firmId: newIdentifier("firm"),
    };
    const result = await resolveFirmContext()(contextWithEnv(), session, READ_META);
    expect(result).toBeNull();
  });

  it("returns a firm context for a PRESENT firm row (the gate keys on the missing row, not a blanket null)", async () => {
    // Contrast case: with the firm row present the resolver proceeds past the row gate, addresses the
    // firm's DO for the member-active check, and returns the context (a never-mirrored user is the
    // self-healing window, not an absence). This is the path the absent case must NOT reach.
    const firmId = (await seedFirm({ name: "Firm Absence Present Firm" })).firmId;
    const session: ResolvedSession = { userId: newIdentifier("user"), firmId };
    const result = await resolveFirmContext()(contextWithEnv(), session, READ_META);
    expect(result).not.toBeNull();
    expect(await result?.readFirmName()).toBe("Firm Absence Present Firm");
  });

  // A FIRM CAN BE RENAMED, and the row read behind the firm context is cached per isolate — so the
  // name is deliberately NOT part of what that cache answers for. This drives the resolver twice
  // through one cached minute, renaming the firm in between: the second read must report the new
  // name. Cache the name and this test reports the old one, which is exactly the bug it exists for.
  it("reports a renamed firm's new name within the row cache's window", async () => {
    const firmId = (await seedFirm({ name: "Chambers Before The Rename" })).firmId;
    // The row cache only ever stores a PROVISIONED row, so a firm with no bucket would miss the
    // cache on both reads below and the test would pass whether or not the name were cached —
    // vacuous. Giving it a bucket is what puts the second read on the cached path this is about.
    await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
      .bind(firmId)
      .run();
    const session: ResolvedSession = { userId: newIdentifier("user"), firmId };
    // The same resolver instance across both reads — a fresh one would carry an empty cache and
    // could pass while the cached path stayed broken.
    const resolver = resolveFirmContext();

    const before = await resolver(contextWithEnv(), session, READ_META);
    expect(await before?.readFirmName()).toBe("Chambers Before The Rename");

    await env.DB_CONTROL.prepare("UPDATE firm SET display_name = ?2 WHERE id = ?1")
      .bind(firmId, "Chambers After The Rename")
      .run();

    const after = await resolver(contextWithEnv(), session, READ_META);
    expect(await after?.readFirmName()).toBe("Chambers After The Rename");
  });
});

// A firm database that cannot be reached AT ALL is neither of the gate's two answers above. The
// per-firm lineage is applied in the FirmDatabase durable object's constructor, so a migration that
// cannot complete makes every read against that firm throw — including the member-active check the
// gate itself runs. Which meant the fault took down the diagnostic reads whose subject IS the fault.
describe("chokepoint firm-database outage gate (real resolver, unreachable firm database)", () => {
  // A namespace whose stub rejects every read: what a durable object with a failing constructor
  // looks like from the caller's side. The control plane stays real, so the resolver gets past the
  // firm-row gate and fails exactly where production failed — on the member-active check.
  function contextWithUnreachableFirmDatabase(): Context {
    const stub = {
      runRead: () => Promise.reject(new Error("CHECK constraint failed: matter_status_check")),
    };
    return {
      env: { ...env, FIRM_DATABASE: { idFromName: (name: string) => name, get: () => stub } },
    } as unknown as Context;
  }

  it("fails closed by default — an unverifiable membership is never admitted", async () => {
    const firmId = (await seedFirm({ name: "Firm With Unreachable Database" })).firmId;
    const session: ResolvedSession = { userId: newIdentifier("user"), firmId };
    // Not null: null is ABSENCE, which would answer 404 and quietly tell a caller the firm is gone.
    // The read must reject, so the route answers 500 and the fault stays visible as a fault.
    await expect(
      resolveFirmContext()(contextWithUnreachableFirmDatabase(), session, READ_META),
    ).rejects.toThrow(/matter_status_check/u);
  });

  it("admits a route that tolerates the outage, so the diagnostic reads still answer", async () => {
    const firmId = (await seedFirm({ name: "Firm With Tolerated Outage" })).firmId;
    const session: ResolvedSession = { userId: newIdentifier("user"), firmId };
    const result = await resolveFirmContext()(
      contextWithUnreachableFirmDatabase(),
      session,
      TOLERATING_META,
    );
    // The context is built from the control plane alone — enough for a diagnostic to report the
    // outage, and carrying no firm data, because the database that holds it is the one that is down.
    expect(result).not.toBeNull();
    expect(await result?.readFirmName()).toBe("Firm With Tolerated Outage");
  });
});
