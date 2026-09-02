import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Context } from "hono";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { ResolvedSession } from "../../src/chokepoint/chokepoint.ts";
import { createChokepointPorts } from "../../src/chokepoint/ports.ts";
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
    const result = await resolveFirmContext()(contextWithEnv(), session);
    expect(result).toBeNull();
  });

  it("returns a firm context for a PRESENT firm row (the gate keys on the missing row, not a blanket null)", async () => {
    // Contrast case: with the firm row present the resolver proceeds past the row gate, addresses the
    // firm's DO for the member-active check, and returns the context (a never-mirrored user is the
    // self-healing window, not an absence). This is the path the absent case must NOT reach.
    const firmId = (await seedFirm({ name: "Firm Absence Present Firm" })).firmId;
    const session: ResolvedSession = { userId: newIdentifier("user"), firmId };
    const result = await resolveFirmContext()(contextWithEnv(), session);
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

    const before = await resolver(contextWithEnv(), session);
    expect(await before?.readFirmName()).toBe("Chambers Before The Rename");

    await env.DB_CONTROL.prepare("UPDATE firm SET display_name = ?2 WHERE id = ?1")
      .bind(firmId, "Chambers After The Rename")
      .run();

    const after = await resolver(contextWithEnv(), session);
    expect(await after?.readFirmName()).toBe("Chambers After The Rename");
  });
});
