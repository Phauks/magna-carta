/*
 * The database-health read's resolution rules. Two contracts are worth pinning here and nothing
 * else is: every check lands in exactly one honest state, and NO single failing check can fail the
 * reply or contaminate a sibling — the whole point of the route is to be readable during the outage
 * it is describing.
 */
import { describe, expect, it } from "vitest";
import type { UserId } from "@magna-carta/identifiers/types";
import {
  collectDatabaseHealth,
  type ControlPlaneReader,
} from "../src/routes/meta-database-health.ts";
import type { FirmContext } from "../src/chokepoint/ports.ts";

const USER_ID = "usr_0000000000000000000000" as UserId;
const FIRM_ID = "frm_0000000000000000000000";
const EXPECTED_HEAD = "20260903T020000_conflicts-hit-entity-index";

// What each statement the collector sends should answer with. Keyed by a fragment of the SQL, which
// is how a fake stays legible: the test says "the migrations read answers these tags", not "the
// third prepare call".
interface FirmDatabasePlan {
  readonly migrations?: { tag: string }[] | "throw";
  readonly member?: { status: string }[] | "throw";
  readonly roles?: { name: string }[] | "throw";
  readonly rolePermissions?: { permission: string }[] | "throw";
  readonly roundTrip?: "throw";
  /** The newest readiness-check audit row, or none; "throw" for an audit log that will not answer. */
  readonly readinessChecks?: { created_at: string; metadata: string | null }[] | "throw";
}

function fakeFirmDatabase(plan: FirmDatabasePlan): FirmContext["firmDatabase"] {
  const answerFor = (
    sql: string,
  ):
    | { tag: string }[]
    | { status: string }[]
    | { name: string }[]
    | { permission: string }[]
    | { created_at: string; metadata: string | null }[]
    | "throw"
    | [] => {
    if (sql.includes("FROM audit_log")) return plan.readinessChecks ?? [];
    if (sql.includes("_migrations")) return plan.migrations ?? [];
    if (sql.includes("FROM member WHERE")) return plan.member ?? [];
    if (sql.includes("FROM role JOIN member_role")) return plan.roles ?? [];
    if (sql.includes("role_permission")) return plan.rolePermissions ?? [];
    if (sql.includes("direct_grant")) return [];
    if (sql.includes("SELECT 1")) return plan.roundTrip ?? [];
    throw new Error(`unexpected statement: ${sql}`);
  };
  const statementFor = (sql: string) => ({
    sql,
    bindings: [] as readonly unknown[],
    bind: () => statementFor(sql),
    run: () => Promise.resolve({ meta: { changes: 0 } }),
    first: () => Promise.resolve(null),
    all: <T>(): Promise<{ results: T[] }> => {
      const answer = answerFor(sql);
      if (answer === "throw") return Promise.reject(new Error(`read failed: ${sql}`));
      return Promise.resolve({ results: answer as T[] });
    },
  });
  return {
    prepare: (sql: string) => statementFor(sql) as never,
    batch: () => Promise.resolve([]),
  } as unknown as FirmContext["firmDatabase"];
}

function fakeControlPlane(
  backlog: { pending: number; dead_lettered: number } | "throw",
): ControlPlaneReader {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: <T>(): Promise<T | null> => {
          if (backlog === "throw") return Promise.reject(new Error("control plane down"));
          if (sql.includes("SELECT 1")) return Promise.resolve({ ok: 1 } as T);
          return Promise.resolve(backlog as T);
        },
      }),
    }),
  };
}

function collect(options: {
  firm?: FirmDatabasePlan;
  backlog?: { pending: number; dead_lettered: number } | "throw";
  bucketName?: string | null;
  // What the firm database reports ALONGSIDE its ledger. The schema state is not a head comparison
  // alone: a runner that refused the ledger applied nothing, so a refused database can sit at head.
  migrationFault?: string;
  outOfOrderArrivals?: string[];
  restorePoint?: { bookmark: string; takenAt: string; appliedTags: string[] };
}) {
  const firmContext = {
    firmDatabase: fakeFirmDatabase(options.firm ?? {}),
    // The schema row asks the migration read now rather than SELECTing _migrations, so the plan's
    // own `migrations` drives it — "throw" still means the question could not be answered.
    migrationState: () => {
      const planned = options.firm?.migrations;
      if (planned === "throw") return Promise.reject(new Error("firm database unreachable"));
      const tags = planned ?? [];
      return Promise.resolve({
        fault: options.migrationFault ?? null,
        appliedCount: tags.length,
        appliedHead: tags.at(-1)?.tag ?? null,
        outOfOrderArrivals: options.outOfOrderArrivals ?? [],
        restorePoint: options.restorePoint ?? null,
      });
    },
    readFirmName: () => Promise.resolve("Test Firm"),
    bucketName: options.bucketName === undefined ? "firm-bucket" : options.bucketName,
  } satisfies FirmContext;
  return collectDatabaseHealth({
    controlPlane: fakeControlPlane(options.backlog ?? { pending: 0, dead_lettered: 0 }),
    firmContext,
    firmId: FIRM_ID,
    userId: USER_ID,
    expectedHead: EXPECTED_HEAD,
    fileStorage: { uploadPath: "direct-to-storage", provisioner: "cloudflare-rest" },
  });
}

const HEALTHY_FIRM: FirmDatabasePlan = {
  migrations: [{ tag: "20260704T041516_baseline" }, { tag: EXPECTED_HEAD }],
  member: [{ status: "active" }],
  roles: [{ name: "Admin" }],
  rolePermissions: [{ permission: "firm:manageMembers" }, { permission: "matters:create" }],
};

describe("collectDatabaseHealth", () => {
  it("reports a healthy firm on every check", async () => {
    const health = await collect({ firm: HEALTHY_FIRM });
    expect(health.firmDatabase.state).toBe("reachable");
    expect(health.firmDatabase.roundTripMilliseconds).not.toBeNull();
    expect(health.schema).toMatchObject({ state: "current", appliedHead: EXPECTED_HEAD });
    expect(health.membership).toMatchObject({
      state: "active",
      roles: ["Admin"],
      permissionCount: 2,
    });
    expect(health.controlPlane).toMatchObject({ state: "reachable", bucketProvisioned: true });
    expect(health.provisioning).toMatchObject({ state: "read", pending: 0, deadLettered: 0 });
  });

  it("names a member whose mirror has not landed, with the backlog that explains it", async () => {
    // The state this whole route exists for: the account is in the firm, its member row is not in
    // the firm's database yet, and a message is still waiting to write it.
    const health = await collect({
      firm: { ...HEALTHY_FIRM, member: [], roles: [], rolePermissions: [] },
      backlog: { pending: 1, dead_lettered: 0 },
    });
    expect(health.membership).toMatchObject({ state: "missing", roles: [], permissionCount: 0 });
    expect(health.provisioning).toMatchObject({ pending: 1, deadLettered: 0 });
    // And nothing else is blamed for it.
    expect(health.firmDatabase.state).toBe("reachable");
    expect(health.schema.state).toBe("current");
  });

  it("separates a mirrored member with no role from one with no member row", async () => {
    const health = await collect({
      firm: { ...HEALTHY_FIRM, roles: [], rolePermissions: [] },
    });
    expect(health.membership).toMatchObject({ state: "active", roles: [], permissionCount: 0 });
  });

  it("reports a database behind this build's lineage without calling it a fault", async () => {
    const health = await collect({
      firm: { ...HEALTHY_FIRM, migrations: [{ tag: "20260704T041516_baseline" }] },
    });
    expect(health.schema).toMatchObject({
      state: "behind",
      appliedHead: "20260704T041516_baseline",
      expectedHead: EXPECTED_HEAD,
      appliedCount: 1,
    });
  });

  it("reports an unreachable firm database without a made-up round trip, and says why", async () => {
    const health = await collect({ firm: { ...HEALTHY_FIRM, roundTrip: "throw" } });
    expect(health.firmDatabase.state).toBe("unreachable");
    expect(health.firmDatabase.roundTripMilliseconds).toBeNull();
    // The reason the read failed, carried rather than dropped: "unreachable" alone is the symptom a
    // reader already has by the time they are looking at this panel.
    expect(health.firmDatabase.fault).not.toBeNull();
  });

  it("still reads the schema when the database refuses every statement", async () => {
    // THE POINT OF THE DEGRADATION. A firm database whose lineage is stuck refuses statements — it
    // has to, because the schema it holds is older than the code querying it — and the schema row
    // used to be a statement like any other, so the one check that could name a stuck lineage was
    // the check the stuck lineage silenced. It reported "Not read" about its own subject.
    //
    // The durable object answers this question outside that gate now, so an unreachable database
    // still says which migration it got to.
    const health = await collect({
      firm: { ...HEALTHY_FIRM, roundTrip: "throw", member: "throw" },
    });
    expect(health.firmDatabase.state).toBe("unreachable");
    // Membership genuinely cannot be read — it is a statement, and statements are refused.
    expect(health.membership.state).toBe("unknown");
    // The schema can, and does.
    expect(health.schema).toMatchObject({ state: "current", appliedHead: EXPECTED_HEAD });
  });

  it("keeps one failing check from failing or contaminating the others", async () => {
    const health = await collect({
      firm: { ...HEALTHY_FIRM, migrations: "throw" },
      backlog: "throw",
    });
    expect(health.schema.state).toBe("unknown");
    expect(health.provisioning.state).toBe("unknown");
    // The checks that could answer still did, and the control plane's own probe failing is its own
    // row rather than the whole read's.
    expect(health.membership.state).toBe("active");
    expect(health.firmDatabase.state).toBe("reachable");
    expect(health.controlPlane.state).toBe("unreachable");
  });

  it("reports a member read that failed as unknown, never as a missing member", async () => {
    // The distinction that matters: "we could not read your membership" must never render as "you
    // have no membership", which is a sentence that sends somebody to an administrator for nothing.
    const health = await collect({ firm: { ...HEALTHY_FIRM, member: "throw" } });
    expect(health.membership).toMatchObject({ state: "unknown", roles: [], permissionCount: 0 });
  });

  it("reports a firm whose storage has not been allocated yet", async () => {
    const health = await collect({ firm: HEALTHY_FIRM, bucketName: null });
    expect(health.controlPlane).toMatchObject({ state: "reachable", bucketProvisioned: false });
  });

  it("reports the file storage facts with no readiness check on record", async () => {
    const health = await collect({ firm: HEALTHY_FIRM });
    expect(health.fileStorage).toEqual({
      uploadPath: "direct-to-storage",
      provisioner: "cloudflare-rest",
      lastReadinessCheck: null,
      state: "read",
    });
  });

  it("reports the last readiness check from its audit row — verdict, failed ids, and when", async () => {
    const health = await collect({
      firm: {
        ...HEALTHY_FIRM,
        readinessChecks: [
          {
            created_at: "2026-09-10T15:00:00.000Z",
            metadata: JSON.stringify({ ready: false, failed: ["key-can-sign"] }),
          },
        ],
      },
    });
    expect(health.fileStorage.lastReadinessCheck).toEqual({
      at: "2026-09-10T15:00:00.000Z",
      ready: false,
      failed: ["key-can-sign"],
    });
  });

  it("reports an audit log that would not answer as unknown, keeping the deployment facts", async () => {
    const health = await collect({ firm: { ...HEALTHY_FIRM, readinessChecks: "throw" } });
    expect(health.fileStorage).toMatchObject({
      state: "unknown",
      lastReadinessCheck: null,
      uploadPath: "direct-to-storage",
    });
  });

  it("reports a dead-lettered provisioning message", async () => {
    const health = await collect({
      firm: { ...HEALTHY_FIRM, member: [], roles: [], rolePermissions: [] },
      backlog: { pending: 0, dead_lettered: 2 },
    });
    expect(health.provisioning).toMatchObject({ state: "read", pending: 0, deadLettered: 2 });
  });
});

/*
 * The schema check reads more than two head tags. It used to read exactly two, which meant a
 * database refusing every request because of its ledger was reported as "current" — the runner
 * rejects such a ledger before applying anything, so its tags sit untouched at the expected head.
 */
describe("the schema check beyond the head comparison", () => {
  it("reports a refused lineage as refused, even sitting at the expected head", async () => {
    const health = await collect({
      firm: HEALTHY_FIRM,
      migrationFault:
        'database has applied migration "20260911T000000_office-email" which this code does not know',
    });
    expect(health.schema.appliedHead).toBe(health.schema.expectedHead);
    expect(health.schema.state).toBe("refused");
  });

  it("still reports the count and head of a refused lineage", async () => {
    // Refused is not unread: the ledger answered, and what it holds is the row's actual subject.
    const health = await collect({
      firm: HEALTHY_FIRM,
      migrationFault: 'database has applied migration "x" which this code does not know',
    });
    expect(health.schema.appliedHead).toBe(EXPECTED_HEAD);
    expect(health.schema.appliedCount).toBeGreaterThan(0);
  });

  it("carries the out-of-order arrivals the firm database reported", async () => {
    const health = await collect({
      firm: HEALTHY_FIRM,
      outOfOrderArrivals: ["20260911T000000_early"],
    });
    expect(health.schema.outOfOrderArrivals).toEqual(["20260911T000000_early"]);
  });

  it("carries the restore point, and never its bookmark", async () => {
    // The opaque Cloudflare handle does nothing for the member reading this panel, and restoring is
    // an operator's act with dashboard access. What travels is that a point exists and what it
    // sits in front of.
    const health = await collect({
      firm: HEALTHY_FIRM,
      restorePoint: {
        bookmark: "0000007f-secret-bookmark",
        takenAt: "2026-09-15T18:00:00.000Z",
        appliedTags: ["20260914T191528_intake"],
      },
    });
    expect(health.schema.restorePoint).toEqual({
      takenAt: "2026-09-15T18:00:00.000Z",
      precedes: ["20260914T191528_intake"],
    });
    expect(JSON.stringify(health)).not.toContain("secret-bookmark");
  });

  it("answers an ordinary firm with neither signal", async () => {
    const health = await collect({ firm: HEALTHY_FIRM });
    expect(health.schema.state).toBe("current");
    expect(health.schema.outOfOrderArrivals).toEqual([]);
    expect(health.schema.restorePoint).toBeNull();
  });

  it("still reports an unreadable lineage as unknown, never as refused", async () => {
    // "Could not ask" and "asked, and the runner said no" are different facts about the database.
    const health = await collect({ firm: { ...HEALTHY_FIRM, migrations: "throw" } });
    expect(health.schema.state).toBe("unknown");
  });
});
