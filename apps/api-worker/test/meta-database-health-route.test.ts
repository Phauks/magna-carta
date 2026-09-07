/*
 * GET /api/v1/meta/database-health end to end, against the real bindings the test pool provides.
 * The collector's decision rules are covered against fakes in meta-database-health.test.ts; what
 * only a real run can establish is here:
 *
 * - The two statements this route composes by hand actually parse and mean what they say —
 *   the migration-ledger read against a live FirmDatabase Durable Object, and the outbox backlog
 *   read against a live control-plane D1. Both are swallowed into an "unknown" row on failure,
 *   which is right for an outage and terrible for a typo: a broken statement would answer forever
 *   with a row that looks like a considered verdict. Nothing but a real execution catches that.
 * - The route is reachable by the session it exists for. A member with no roles at all — the state
 *   that makes every other screen answer 403 — must get a 200 here and be told what is wrong,
 *   because a gated version of this route would refuse exactly the person asking.
 */
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { controlPlaneHeadSchemaVersion } from "../src/control-plane-migrations.ts";
import { perFirmHeadSchemaVersion } from "../src/per-firm-migrations.ts";
import { seedCredentialedUser, seedFirm, signInForSessionCookie } from "./support/test-auth.ts";

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Database Health Test Firm" })).firmId;
});

function readHealth(cookie: string): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/meta/database-health", { headers: { cookie } });
}

describe("GET /api/v1/meta/database-health", () => {
  it("rejects an unauthenticated caller", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/meta/database-health");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("answers the member whose mirror has not landed — the session it exists for", async () => {
    // No member row in the firm's database at all, so this account's permission set is empty and
    // every permission-gated route refuses it. This one must not.
    await seedCredentialedUser("health-unmirrored@example.com", {
      userName: "Unmirrored",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("health-unmirrored@example.com");
    const response = await readHealth(cookie);
    expect(response.status).toBe(200);
    const health = (await response.json()) as {
      membership: { state: string; roles: string[]; permissionCount: number };
      firmDatabase: { state: string; roundTripMilliseconds: number | null };
      firmSchema: { state: string; appliedCount: number; appliedHead: string | null };
      controlPlane: {
        state: string;
        roundTripMilliseconds: number | null;
        bucketProvisioned: boolean;
      };
      provisioning: { state: string; pending: number; deadLettered: number };
      observedAt: string;
    };
    expect(health.membership).toMatchObject({ state: "missing", roles: [], permissionCount: 0 });
    // And the rest of the read still answers, so the panel names the one thing that is wrong. Both
    // legs are timed: every request crosses both, so a panel that measured one of them could report
    // a healthy firm while the leg that resolves the caller was the slow one.
    expect(health.firmDatabase.state).toBe("reachable");
    expect(health.firmDatabase.roundTripMilliseconds).toBeGreaterThanOrEqual(0);
    expect(health.controlPlane).toMatchObject({ state: "reachable", bucketProvisioned: true });
    expect(health.controlPlane.roundTripMilliseconds).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(health.observedAt))).toBe(false);
  });

  it("reads BOTH real migration ledgers, not a restatement of intent", async () => {
    // A live Durable Object self-migrates the per-firm lineage on first access, so its ledger head
    // is this build's head; the pool applies the control-plane lineage to a real D1 in beforeAll.
    // Reading each through its own statement is what proves both statements parse — and both are
    // swallowed into an "unknown" row on failure, which is right for an outage and terrible for a
    // typo, because a broken statement would answer forever with what looks like a verdict.
    await seedCredentialedUser("health-schema@example.com", {
      userName: "Schema Reader",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("health-schema@example.com");
    const health = (await (await readHealth(cookie)).json()) as {
      firmSchema: { state: string; appliedCount: number; appliedHead: string | null };
      controlPlaneSchema: { state: string; appliedCount: number; appliedHead: string | null };
    };
    expect(health.firmSchema.state).toBe("current");
    expect(health.firmSchema.appliedHead).toBe(perFirmHeadSchemaVersion());
    expect(health.firmSchema.appliedCount).toBeGreaterThan(0);
    // The control plane's own lineage, against its OWN head — a different journal and a different
    // tag, which is why the two expected heads are read from two functions.
    expect(health.controlPlaneSchema.appliedHead).toBe(controlPlaneHeadSchemaVersion());
    expect(health.controlPlaneSchema.state).toBe("current");
    expect(health.controlPlaneSchema.appliedCount).toBeGreaterThan(0);
  });

  it("counts this firm's pending and dead-lettered member mirrors, and nobody else's", async () => {
    // The backlog statement scopes by the payload's own firmId, because member.provision carries no
    // aggregate key. A count that leaked another firm's rows would be both wrong and a disclosure.
    const otherFirmId = newIdentifier("firm");
    const now = new Date().toISOString();
    const rows: { status: string; firmId: string }[] = [
      { status: "pending", firmId: poolFirmId },
      { status: "pending", firmId: poolFirmId },
      { status: "failed", firmId: poolFirmId },
      { status: "dispatched", firmId: poolFirmId },
      { status: "pending", firmId: otherFirmId },
    ];
    for (const row of rows) {
      await env.DB_CONTROL.prepare(
        "INSERT INTO outbox (id, topic, payload, aggregate_key, seq, status, attempts, created_at) " +
          "VALUES (?1, 'member.provision', ?2, NULL, NULL, ?3, 0, ?4)",
      )
        .bind(
          newIdentifier("outbox"),
          JSON.stringify({ userId: newIdentifier("user"), firmId: row.firmId }),
          row.status,
          now,
        )
        .run();
    }

    await seedCredentialedUser("health-backlog@example.com", {
      userName: "Backlog Reader",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("health-backlog@example.com");
    const health = (await (await readHealth(cookie)).json()) as {
      provisioning: { state: string; pending: number; deadLettered: number };
    };
    // Two pending and one failed for THIS firm; the dispatched row and the other firm's are not
    // counted, and the statement having executed at all is what "read" proves.
    expect(health.provisioning).toEqual({ state: "read", pending: 2, deadLettered: 1 });
  });

  it("reports a mirrored member's roles and the permissions they resolve to", async () => {
    const { userId } = await seedCredentialedUser("health-mirrored@example.com", {
      userName: "Mirrored Member",
      firmId: poolFirmId,
    });
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
    await insertMemberStatement(firmDatabase, {
      userId,
      displayName: "Mirrored Member",
      now: new Date().toISOString(),
    }).run();
    const cookie = await signInForSessionCookie("health-mirrored@example.com");
    const health = (await (await readHealth(cookie)).json()) as {
      membership: { state: string; roles: string[]; permissionCount: number };
    };
    // Mirrored but roleless, which is a DIFFERENT fault from an absent mirror and has a different
    // remedy — an administrator assigns a role, rather than anybody waiting for a sweep.
    expect(health.membership).toMatchObject({ state: "active", roles: [], permissionCount: 0 });
  });
});
