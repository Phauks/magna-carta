/*
 * GET /api/v1/meta/database-health — whether THIS session can actually reach and use its firm's
 * data, told as the four separate facts that a single "the database is down" would collapse into
 * one. It is the companion to the version read: that one answers "what is running", this one
 * answers "does what is running work for me, here, now".
 *
 * The question it exists to answer out loud is the one a newly provisioned firm asks. A firm is
 * created, its owner signs in, and every permission-gated screen answers 403 — "Your role does not
 * grant this action in this firm" — because the owner's member row has not yet been mirrored from
 * the control plane into the firm's own database (member-provision-consumer.ts, driven by the
 * outbox relay's sweep). Nothing on screen distinguished that from a broken deployment, a missing
 * firm, or a role somebody forgot to grant, and the four have four different remedies. So each is
 * a check of its own here, and each says which one it is.
 *
 * Honesty rules the read follows, the same ones the version aggregate keeps:
 * - Every check reports a STATE, never prose: the words a reader sees are the web app's
 *   (versions/database-health-model.ts), so the wire carries facts and the surface carries copy.
 * - A check that could not run is "unknown", never "healthy". A read that throws is that check's
 *   own failure and never the whole reply's — one dead probe must not hide the three that answered.
 * - Nothing here is an existence oracle and nothing here is privileged content: it reports on the
 *   session's OWN firm (from the session, never the URL) and the session's OWN membership, in
 *   counts and role names, which is what the member already sees on the firm's people screen.
 * - The read is never cached. Its whole subject is a state that is expected to CHANGE within
 *   seconds of somebody looking at it — a mirror landing, a sweep running — and a cached answer
 *   would be a panel that keeps saying the fault is still there after it has cleared.
 */
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { OUTBOX_TABLE } from "@magna-carta/data-access/outbox-statements";
import { scrubText } from "@magna-carta/telemetry/scrub";
import type { UserId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../bindings.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables, FirmContext } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { perFirmHeadSchemaVersion } from "../per-firm-migrations.ts";
import { loadEffectivePermissions } from "../session-context.ts";
import { UPLOAD_READINESS_AUDIT_EVENT, uploadPathForEnv } from "../files/upload-readiness.ts";
import { resourceProviderForEnv } from "../firm-provisioner-wiring.ts";

/**
 * An unreachable database's own words, made safe to show.
 *
 * Put through the same scrub pass the error pipeline uses, so this cannot become the one surface
 * that prints a value the logs are careful never to. A non-Error throw yields null rather than
 * "[object Object]": a reader is better served by a missing line than by one that says nothing
 * while looking like it says something.
 *
 * Bounded LONGER than a logged message head, deliberately. MESSAGE_HEAD_LENGTH is sized for a log
 * line, where the same fault repeats across many entries and the tail is recoverable from any of
 * them. This is the opposite case: one line, on screen, for a fault a reader cannot get at any
 * other way — a failing migration names itself, the statement inside it, and then SQLite's own
 * sentence, and 120 characters cut that off before the part that identifies anything.
 */
const FAULT_LENGTH = 400;

export function faultOf(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const head = error.message.slice(0, FAULT_LENGTH).trim();
  return head.length === 0 ? null : scrubText(head).text;
}

/** The topic whose backlog explains a member who is in the firm but not yet in its database. */
export const MEMBER_PROVISION_TOPIC = "member.provision";

const ControlPlaneCheck = z
  .object({
    // "reachable" once the control plane answered for this firm's row. "unreachable" is the read
    // itself failing; the firm row's own absence cannot appear here at all, because the chokepoint
    // turns it into the reserved 404 before this handler runs.
    state: z.enum(["reachable", "unreachable"]),
    // Whether provisioning has finished allocating the firm's object storage. False is a firm still
    // being built, not a fault — it is the one fact on the row that flips exactly once.
    bucketProvisioned: z.boolean(),
  })
  .openapi("DatabaseHealthControlPlane");

const FirmDatabaseCheck = z
  .object({
    state: z.enum(["reachable", "unreachable"]),
    // The round trip to the firm's Durable Object, in whole milliseconds — the number that says
    // "connected, and this is what it cost". Null when the round trip never completed.
    roundTripMilliseconds: z.number().int().nullable(),
    // WHY it is not answering, in the database's own words, or null while it is.
    //
    // "Not answering" names the symptom and stops, which is the one thing a reader already knows by
    // the time they open this panel. The cause was in hand the whole time — the durable object
    // throws a specific error and this read was discarding it in a bare `catch` — and recovering it
    // turned a database outage into a message that names the failing constraint outright.
    //
    // Scrubbed and bounded like any other message head, because an error string is the one place a
    // stray value can ride out of the database: a constraint failure names the constraint, but a
    // UNIQUE violation can carry the offending value with it. Same treatment as the error pipeline
    // gives the `messageHead` it logs (docs/conventions/error-logging.md), for the same reason.
    fault: z.string().nullable(),
  })
  .openapi("DatabaseHealthFirmDatabase");

const SchemaCheck = z
  .object({
    // "current" once the firm's applied lineage head matches the build's own journal head.
    // "behind" is a database that self-migrated to an older head (a firm not yet woken by this
    // build). "refused" is the runner declining the lineage outright — the ledger holds a tag this
    // build cannot place, so NOTHING was applied and the head comparison is not the question.
    // "unknown" is the lineage read failing — never guessed as any of the other three.
    //
    // "refused" exists because the head comparison alone answered "current" for a database that was
    // refusing every request: its ledger was at head, and the runner had rejected it anyway. Two
    // rows describing one subsystem then contradicted each other, and the reassuring one was wrong.
    state: z.enum(["current", "behind", "refused", "unknown"]),
    // How many migrations the firm's database has actually run. Deliberately NOT paired with a
    // target: a superseding migration collapses several applied tags into one, so a firm at head
    // can legitimately carry fewer than the lineage lists, and "213 of 214" would be a false alarm
    // printed on every healthy firm. The two head tags below are what say whether it is current.
    appliedCount: z.number().int(),
    // The greatest applied tag and the tag this build expects, so a "behind" row says how far.
    appliedHead: z.string().nullable(),
    expectedHead: z.string(),
    // Migrations that reached this database BEHIND its own ledger head, because two branches merged
    // and seated one behind a migration that had already shipped. Everything is applied either way,
    // so this is not a fault — but this database ran the pair in a different order than a freshly
    // provisioned one will, and the ledger is a set of tags that cannot say so afterwards. Empty on
    // every ordinary firm. The runner reports it once, on the wake that applied them; it is carried
    // here because a report nothing reads is a report that was not made.
    outOfOrderArrivals: z.array(z.string()),
    // The restore point the object took before its last batch of migrations, when it took one: the
    // instant it names, and the migrations it sits in front of. A migration that FAILS needs no
    // restore — the whole context rolls back — so this is for the other case, a migration that
    // succeeded and was wrong, which the lineage cannot undo by running forwards.
    //
    // The Cloudflare bookmark itself is deliberately NOT on the wire. Restoring is an operator's
    // act with dashboard access, and the opaque handle does nothing for the member reading this
    // panel; what they need to know is that a point exists and what it precedes.
    restorePoint: z.object({ takenAt: z.string(), precedes: z.array(z.string()) }).nullable(),
  })
  .openapi("DatabaseHealthSchema");

const MembershipCheck = z
  .object({
    // "active" — a mirrored, active member row, the ordinary state.
    // "missing" — no member row at all: the mirror has not landed, which is precisely the state
    //   that reads on every other screen as an unexplained 403.
    // "inactive" — a member row that is not active. The chokepoint 404s such a session before this
    //   handler, so it is unreachable in practice and stated anyway rather than assumed away.
    // "unknown" — the read failed.
    state: z.enum(["active", "missing", "inactive", "unknown"]),
    // The roles this account holds in the firm, by name. A mirrored member with an empty list is a
    // real and distinct fault from an unmirrored one: the row landed, the role assignment did not.
    roles: z.array(z.string()),
    // How many permissions those roles and any direct grants actually resolve to. Zero is what
    // every 403 on every screen is downstream of.
    permissionCount: z.number().int(),
  })
  .openapi("DatabaseHealthMembership");

const ProvisioningCheck = z
  .object({
    // "unknown" when the backlog read failed; otherwise the counts below are authoritative.
    state: z.enum(["read", "unknown"]),
    // Member mirrors for THIS firm still waiting for a sweep. Non-zero beside a missing membership
    // is the whole diagnosis: nothing is broken, the mirror is in flight.
    pending: z.number().int(),
    // Member mirrors for this firm the relay gave up on. Non-zero is a fault that will not clear on
    // its own — the operator seam is requeueDeadLetteredMessageStatement.
    deadLettered: z.number().int(),
  })
  .openapi("DatabaseHealthProvisioning");

// The firm's file storage as this deployment serves it, and the last time anyone checked that an
// upload can reach it. READ, never acted on: the readiness check itself re-applies bucket settings
// and writes an audit row (routes/upload-readiness.ts), so this looks back for that row rather
// than running the check on every open of the overlay. Absent means nobody has run it.
const FileStorageCheck = z
  .object({
    uploadPath: z.enum(["direct-to-storage", "through-the-application"]),
    provisioner: z.enum(["cloudflare-rest", "development"]),
    lastReadinessCheck: z
      .object({
        at: z.string(),
        ready: z.boolean(),
        failed: z.array(z.string()),
      })
      .nullable(),
    // "unknown" when the audit log could not be read; the two facts above never depend on it.
    state: z.enum(["read", "unknown"]),
  })
  .openapi("DatabaseHealthFileStorage");

const DatabaseHealthResponse = z
  .object({
    controlPlane: ControlPlaneCheck,
    firmDatabase: FirmDatabaseCheck,
    schema: SchemaCheck,
    membership: MembershipCheck,
    provisioning: ProvisioningCheck,
    fileStorage: FileStorageCheck,
    observedAt: z.string(),
  })
  .openapi("DatabaseHealthResponse");

export type DatabaseHealthValue = z.infer<typeof DatabaseHealthResponse>;

// The minimal control-plane shape the backlog and firm-row reads need. Declared structurally so the
// tests drive the collector with a fake instead of a D1 binding.
export interface ControlPlaneReader {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
    };
  };
}

/*
 * The firm's applied migration lineage, read straight out of the runner's own ledger. `_migrations`
 * is the table the DO migration target maintains (packages/database/src/do-sqlite-migration-target.ts),
 * so this is the database stating what it actually ran — not this Worker restating what it intended
 * to run, which would answer "current" for a firm whose migration threw.
 */
async function readSchemaState(
  migrationState: FirmContext["migrationState"],
  expectedHead: string,
): Promise<z.infer<typeof SchemaCheck>> {
  // Asked through the migration read rather than a statement. This used to SELECT from _migrations
  // like any other query, which meant the one check that could name a stuck lineage was the check a
  // stuck lineage silenced: the durable object refused every statement, this fell to its catch, and
  // the panel said "Not read" — the least informative thing available, about the very subject the
  // row exists for.
  try {
    const state = await migrationState();
    return {
      // The fault is read FIRST, and that ordering is the point. A refused lineage can sit at head
      // — the runner rejects the ledger before it applies anything, so the tags already in it are
      // untouched — and comparing heads alone then calls that database current while it answers
      // nothing. The fault is the fact; the heads only say how far along a database that is
      // actually running has got.
      state:
        state.fault !== null
          ? "refused"
          : state.appliedHead === expectedHead
            ? "current"
            : "behind",
      appliedCount: state.appliedCount,
      appliedHead: state.appliedHead,
      expectedHead,
      // Copied, not aliased: the migration read hands these back readonly, and the response shape
      // owns its own arrays rather than sharing the object's.
      outOfOrderArrivals: [...state.outOfOrderArrivals],
      restorePoint:
        state.restorePoint === null
          ? null
          : { takenAt: state.restorePoint.takenAt, precedes: [...state.restorePoint.appliedTags] },
    };
  } catch {
    return {
      state: "unknown",
      appliedCount: 0,
      appliedHead: null,
      expectedHead,
      outOfOrderArrivals: [],
      restorePoint: null,
    };
  }
}

/*
 * This account's standing in its own firm: the member row, the roles on it, and what those roles
 * resolve to. All three, not just the last — a zero permission count alone cannot tell a member
 * whose mirror has not landed from a member whose role was never assigned, and those are somebody
 * else's two different jobs to fix.
 */
async function readMembershipState(
  firmDatabase: FirmContext["firmDatabase"],
  userId: UserId,
): Promise<z.infer<typeof MembershipCheck>> {
  try {
    const [memberResult, roleResult, permissions] = await Promise.all([
      firmDatabase
        .prepare("SELECT status FROM member WHERE user_id = ?1")
        .bind(userId)
        .all<{ status: string }>(),
      firmDatabase
        .prepare(
          "SELECT role.name AS name FROM role JOIN member_role ON member_role.role_id = role.id " +
            "WHERE member_role.member_user_id = ?1 ORDER BY role.name",
        )
        .bind(userId)
        .all<{ name: string }>(),
      loadEffectivePermissions(firmDatabase, userId),
    ]);
    const status = memberResult.results[0]?.status;
    return {
      state: status === undefined ? "missing" : status === "active" ? "active" : "inactive",
      roles: roleResult.results.map((row) => row.name),
      permissionCount: permissions.size,
    };
  } catch {
    return { state: "unknown", roles: [], permissionCount: 0 };
  }
}

/*
 * How many member mirrors for this firm the relay still owes, and how many it has given up on.
 * Scoped to the firm by the payload's own firmId — member.provision carries no aggregate key, so
 * the JSON is where the tenancy lives, and the firmId binds from the SESSION, never from the URL.
 */
async function readProvisioningBacklog(
  controlPlane: ControlPlaneReader,
  firmId: string,
): Promise<z.infer<typeof ProvisioningCheck>> {
  try {
    const row = await controlPlane
      .prepare(
        // SUM(CASE …) rather than COUNT(…) FILTER: this read swallows its own failures into an
        // "unknown" row, so a syntax error would be permanently invisible, and the plainest SQL
        // that expresses the count is the one least able to become one.
        `SELECT ` +
          `SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending, ` +
          `SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS dead_lettered ` +
          `FROM ${OUTBOX_TABLE} WHERE topic = ?1 AND json_extract(payload, '$.firmId') = ?2`,
      )
      .bind(MEMBER_PROVISION_TOPIC, firmId)
      .first<{ pending: number; dead_lettered: number }>();
    return {
      state: "read",
      pending: row?.pending ?? 0,
      deadLettered: row?.dead_lettered ?? 0,
    };
  } catch {
    return { state: "unknown", pending: 0, deadLettered: 0 };
  }
}

/**
 * The whole read, assembled. Exported free of Hono so the tests drive it with fakes: every check
 * is independently faultable, and the contract that one failing check never fails the reply is the
 * thing worth pinning.
 */
/** The deployment facts the file-storage row states, supplied by the route from its env. */
export interface FileStorageFacts {
  readonly uploadPath: z.infer<typeof FileStorageCheck>["uploadPath"];
  readonly provisioner: z.infer<typeof FileStorageCheck>["provisioner"];
}

/*
 * The newest readiness-check audit row, read off the event index. Its metadata is the check's own
 * verdict and failed ids — deployment facts, written redacted by construction. A row whose metadata
 * will not parse is treated as no row rather than as a verdict.
 */
async function readFileStorageState(
  firmDatabase: FirmContext["firmDatabase"],
  facts: FileStorageFacts,
): Promise<z.infer<typeof FileStorageCheck>> {
  try {
    const { results } = await firmDatabase
      .prepare(
        "SELECT created_at, metadata FROM audit_log WHERE event = ?1 " +
          "ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .bind(UPLOAD_READINESS_AUDIT_EVENT)
      .all<{ created_at: string; metadata: string | null }>();
    const row = results[0];
    let lastReadinessCheck: z.infer<typeof FileStorageCheck>["lastReadinessCheck"] = null;
    if (row !== undefined && row.metadata !== null) {
      const metadata = JSON.parse(row.metadata) as { ready?: unknown; failed?: unknown };
      if (typeof metadata.ready === "boolean") {
        lastReadinessCheck = {
          at: row.created_at,
          ready: metadata.ready,
          failed: Array.isArray(metadata.failed)
            ? metadata.failed.filter((id): id is string => typeof id === "string")
            : [],
        };
      }
    }
    return { ...facts, lastReadinessCheck, state: "read" };
  } catch {
    return { ...facts, lastReadinessCheck: null, state: "unknown" };
  }
}

export async function collectDatabaseHealth(input: {
  controlPlane: ControlPlaneReader;
  firmContext: FirmContext;
  firmId: string;
  userId: UserId;
  expectedHead: string;
  fileStorage: FileStorageFacts;
  now?: () => number;
}): Promise<DatabaseHealthValue> {
  const now = input.now ?? (() => Date.now());
  const { firmDatabase } = input.firmContext;

  // The round trip that IS the connection check: the cheapest statement there is, sent to the
  // firm's own Durable Object and timed. Everything below it is a question about the data; this is
  // the question about the wire, and it is asked first so a total failure reads as one line rather
  // than as four unrelated ones.
  const startedAt = now();
  let firmDatabaseCheck: z.infer<typeof FirmDatabaseCheck>;
  try {
    await firmDatabase.prepare("SELECT 1 AS ok").bind().all();
    firmDatabaseCheck = {
      state: "reachable",
      roundTripMilliseconds: Math.max(0, Math.round(now() - startedAt)),
      fault: null,
    };
  } catch (error) {
    firmDatabaseCheck = {
      state: "unreachable",
      roundTripMilliseconds: null,
      fault: faultOf(error),
    };
  }

  // The control-plane leg. The firm's row is already proven to exist — the chokepoint read it to
  // build this request's firm context — so what is asked here is whether the control plane is
  // answering NOW, and whether provisioning finished allocating the firm's bucket.
  let controlPlaneCheck: z.infer<typeof ControlPlaneCheck>;
  try {
    await input.controlPlane.prepare("SELECT 1 AS ok").bind().first<{ ok: number }>();
    controlPlaneCheck = {
      state: "reachable",
      bucketProvisioned: input.firmContext.bucketName !== null,
    };
  } catch {
    controlPlaneCheck = {
      state: "unreachable",
      bucketProvisioned: input.firmContext.bucketName !== null,
    };
  }

  // The three data reads run together: they are independent questions of two different databases,
  // and asking them serially would make a panel that exists to explain a delay into a source of one.
  const [schema, membership, provisioning, fileStorage] = await Promise.all([
    readSchemaState(input.firmContext.migrationState, input.expectedHead),
    readMembershipState(firmDatabase, input.userId),
    readProvisioningBacklog(input.controlPlane, input.firmId),
    readFileStorageState(firmDatabase, input.fileStorage),
  ]);

  return {
    controlPlane: controlPlaneCheck,
    firmDatabase: firmDatabaseCheck,
    schema,
    membership,
    provisioning,
    fileStorage,
    observedAt: new Date(now()).toISOString(),
  };
}

// permission: null — any authenticated member may ask whether their own firm's database is
// answering them, and the member who most needs the answer is precisely the one whose permissions
// have not landed yet. A gated version of this route would refuse exactly the session it exists to
// explain. The chokepoint still resolves session and firm, so the read is firm-scoped by
// construction and reports on nothing but the caller's own membership.
export const metaDatabaseHealthMeta: RouteMeta = {
  operationId: "meta.databaseHealth",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
  // The read must survive the fault it reports, which is the whole point of it. Every firm read
  // below is already caught and reported as its own "unreachable"/"unknown" — but none of them ran,
  // because the chokepoint's member-active check is itself a read against the database in question,
  // and it threw first. So the route answered 500 rather than the honest diagnosis it was built to
  // give. Toleration only ever engages while that database is down, and it discloses nothing
  // thereby: the reads that would carry firm data are the reads that cannot complete. While the
  // database is up the member-active check runs exactly as before and a deactivated member is
  // still absent.
  firmDatabaseOutage: "tolerate",
};

export const metaDatabaseHealthRoute = defineOpenAPIRoute(metaDatabaseHealthMeta, {
  method: "get",
  path: "/api/v1/meta/database-health",
  description:
    "Whether this session can reach and use its firm's data: a timed round trip to the firm's " +
    "database, the control plane's own answer, the applied migration lineage against the one this " +
    "build expects, this account's member row and roles with the permission count they resolve " +
    "to, and any member-provisioning message for the firm still pending or dead-lettered. Each " +
    "check reports its own state, so one failing read never hides the others, and a check that " +
    "could not run says so rather than reporting health.",
  responses: {
    200: {
      description: "The firm database's health, as seen by this session",
      content: { "application/json": { schema: DatabaseHealthResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "The session's firm is not reachable from this deployment, or the session user is a " +
        "deactivated member of it (absent, never an existence oracle)",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerMetaDatabaseHealthRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...metaDatabaseHealthRoute,
      middleware: chokepointMiddleware(chokepoint, metaDatabaseHealthRoute),
    },
    async (c) => {
      const value = await collectDatabaseHealth({
        controlPlane: c.env.DB_CONTROL,
        firmContext: requireChokepointFirmContext(c),
        firmId: requireChokepointFirmId(c),
        userId: requireChokepointUserId(c),
        expectedHead: perFirmHeadSchemaVersion(),
        fileStorage: {
          uploadPath: uploadPathForEnv(c.env),
          provisioner: resourceProviderForEnv(c.env).kind,
        },
      });
      return c.json(value, 200);
    },
  );
}
