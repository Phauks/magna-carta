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
    expect(result?.firmName).toBe("Firm Absence Present Firm");
  });
});
