import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOpenAPIDocument } from "../src/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The conflicts route surface, driven through the chokepoint over real Miniflare bindings: opening a
// check (its first run queued, the search running after the response), reading it back with its runs
// and the selected run's record, running it again, filing it on a matter, and recording a reviewer's
// disposition of a hit. conflicts:run and conflicts:read are seeded broadly (every default role,
// including Admin); a caller with neither gets refused before any check runs. Mutations require
// an Idempotency-Key (the chokepoint gate), and a repeated key replays the first opening rather than
// opening a second.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let noPermissionCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString() };

// Seeds a member with no role and a single, unrelated direct-grant permission — used to prove the
// chokepoint refuses conflicts:run to a caller who genuinely lacks it.
async function mirrorMemberWithUnrelatedGrant(userId: UserId, displayName: string): Promise<void> {
  await insertMemberStatement(firmDatabase, {
    userId,
    displayName,
    now: clock.now(),
  }).run();
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
    )
    .bind(newIdentifier("grant"), userId, "firm:reportIncident", clock.now())
    .run();
}

// Each block below adopts a firm of its own. The chokepoint's rate-limit key is `firm:<firmId>`
// with a hundred requests a minute behind it, and a block that seeds parties, opens checks and reads
// them back spends that window on its own; a second block on the same firm would start collecting
// 429s that say nothing about the code under test. The helpers above read these module-level
// handles, so adopting a firm is one call in a block's beforeAll.
async function adoptFreshFirm(label: string): Promise<void> {
  poolFirmId = (await seedFirm({ name: `Conflicts Test Firm ${label}` })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);

  const owner = await seedCredentialedUser(`conflicts-owner-${label}@example.com`, {
    userName: "Conflicts Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Conflicts Owner", poolFirmId);
  ownerUserId = owner.userId;
  ownerCookie = await signInForSessionCookie(`conflicts-owner-${label}@example.com`);

  const noPermission = await seedCredentialedUser(`conflicts-nopermission-${label}@example.com`, {
    userName: "No Permission",
    firmId: poolFirmId,
  });
  await mirrorMemberWithUnrelatedGrant(noPermission.userId, "No Permission");
  noPermissionCookie = await signInForSessionCookie(`conflicts-nopermission-${label}@example.com`);

  // A matter cannot be opened without an active numbering scheme, and the tests that file a check
  // on a matter need real matters rather than fabricated handles.
  await SELF.fetch("https://example.com/api/v1/numbering-scheme", {
    method: "PUT",
    headers: authHeaders(ownerCookie, true),
    body: JSON.stringify({
      segments: [
        { kind: "literal", text: "CON-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

function authHeaders(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

async function post(path: string, body: unknown, cookie = ownerCookie, withKey = true) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(cookie, withKey),
    body: JSON.stringify(body),
  });
}
async function put(path: string, body: unknown, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PUT",
    headers: authHeaders(cookie, true),
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function postWithFixedKey(path: string, body: unknown, idempotencyKey: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

async function createPerson(given: string, family: string): Promise<string> {
  const response = await post("/api/v1/directory/persons", { given, family });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return id;
}

interface OpenedCheck {
  readonly id: string;
  readonly checkNumber: string;
  readonly runId: string;
  readonly ordinal: number;
}

interface RunSummary {
  readonly id: string;
  readonly ordinal: number;
  readonly status: "queued" | "running" | "completed" | "failed";
  readonly stage: string | null;
  readonly progress: Record<string, number>;
  readonly trigger: string;
  readonly triggerSource: string | null;
  readonly requestedByUserId: string | null;
  readonly failure: string | null;
  readonly hitCount: number | null;
}

interface CheckRead {
  readonly check: {
    readonly id: string;
    readonly checkNumber: string;
    readonly matterId: string | null;
    readonly latestRunId: string | null;
  };
  readonly runs: RunSummary[];
  readonly run: RunSummary;
  readonly record: {
    readonly check: {
      readonly id: string;
      readonly trigger: string;
      readonly matterId: string | null;
      readonly subjectEntityIds: string[];
      readonly actorUserId: string | null;
      readonly traversal: { followedToClosure: boolean; truncated: boolean } | null;
    };
    readonly statement: string[];
    readonly hits: Array<{
      id: string;
      entityId: string;
      party: { kind: string; displayName: string | null } | null;
      disposition: {
        kind: string;
        waiver: unknown;
        shortfalls: string[];
      } | null;
      previouslyAnswered: { checkId: string; kind: string } | null;
    }>;
  } | null;
}

// The search runs after the response, so a test that wants the record waits for the run to settle.
// The wait watches the run row directly rather than polling the route: the chokepoint's rate-limit
// key is `firm:<firmId>`, and a suite that spent a request every few milliseconds on waiting would
// exhaust the firm's window and hand the NEXT case a 429 that says nothing about the code under
// test. One read over the wire follows, the way the screen reads a check. Bounded, so a run that
// never settles fails the test rather than hanging it.
async function readSettled(checkId: string, runId?: string): Promise<CheckRead> {
  const address = `/api/v1/conflicts/checks/${checkId}${runId === undefined ? "" : `?run=${runId}`}`;
  const watched = runId ?? checkId;
  let settled = false;
  for (let attempt = 0; attempt < 400 && !settled; attempt += 1) {
    const row = await firmDatabase
      .prepare("SELECT status FROM conflicts_check_run WHERE id = ?1")
      .bind(watched)
      .first<{ status: string }>();
    settled = row?.status === "completed" || row?.status === "failed";
    if (!settled) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!settled) throw new Error(`the run of ${checkId} did not settle`);
  const response = await get(address);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as CheckRead;
}

// Opens a check and waits for its first run to complete, returning what was opened and the record.
async function openAndSettle(body: unknown): Promise<{ opened: OpenedCheck; read: CheckRead }> {
  const response = await post("/api/v1/conflicts/checks", body);
  expect(response.status, await response.clone().text()).toBe(202);
  const opened = (await response.json()) as OpenedCheck;
  const read = await readSettled(opened.id);
  expect(read.run.status, read.run.failure ?? "").toBe("completed");
  return { opened, read };
}

const PARTY_SCOPE = { sources: ["party"], strictness: "balanced" };

describe("conflicts check routes", () => {
  beforeAll(() => adoptFreshFirm("checks"));

  it("opens a check with a number, answers at once, and settles its first run after the response", async () => {
    const personId = await createPerson("Solo", "Subject");

    const response = await post("/api/v1/conflicts/checks", {
      trigger: "comprehensive",
      subjectEntityIds: [personId],
      scope: PARTY_SCOPE,
    });
    expect(response.status, await response.clone().text()).toBe(202);
    const opened = (await response.json()) as OpenedCheck;
    expect(opened.id).toMatch(/^conflictsCheck_/);
    expect(opened.checkNumber).toMatch(/^CC\d{4}-\d{5,}$/);
    // A check is identified by its first run's handle.
    expect(opened.runId).toBe(opened.id);
    expect(opened.ordinal).toBe(1);

    const read = await readSettled(opened.id);
    expect(read.check.checkNumber).toBe(opened.checkNumber);
    expect(read.runs).toHaveLength(1);
    expect(read.run.status).toBe("completed");
    expect(read.run.requestedByUserId).toBe(ownerUserId);
    expect(read.run.triggerSource).toBe("manual");
    // A settled run carries its record, and a walk to closure says so on it.
    expect(read.record?.check.id).toBe(opened.runId);
    expect(read.record?.check.traversal?.followedToClosure).toBe(true);
  });

  it("previews the number the next check would draw, before anything is saved", async () => {
    const preview = await get("/api/v1/conflicts/checks/next-number");
    expect(preview.status, await preview.clone().text()).toBe(200);
    const { checkNumber } = (await preview.json()) as { checkNumber: string };
    expect(checkNumber).toMatch(/^CC\d{4}-\d{5,}$/);

    const { opened } = await openAndSettle({
      trigger: "preliminary",
      subjectEntityIds: [await createPerson("Next", "Number")],
      scope: PARTY_SCOPE,
    });
    expect(opened.checkNumber).toBe(checkNumber);
  });

  it("runs a check again under the same number, and the check's history gains an entry", async () => {
    const subjectId = await createPerson("Again", "Subject");
    const { opened } = await openAndSettle({
      trigger: "preliminary",
      subjectEntityIds: [subjectId],
      scope: PARTY_SCOPE,
    });

    const rerun = await post(`/api/v1/conflicts/checks/${opened.id}/runs`, {});
    expect(rerun.status, await rerun.clone().text()).toBe(202);
    const second = (await rerun.json()) as OpenedCheck;
    expect(second.id).toBe(opened.id);
    expect(second.checkNumber).toBe(opened.checkNumber);
    expect(second.runId).not.toBe(opened.runId);
    expect(second.ordinal).toBe(2);

    const read = await readSettled(opened.id, second.runId);
    expect(read.runs.map((run) => run.ordinal)).toEqual([1, 2]);
    expect(read.check.latestRunId).toBe(second.runId);
    expect(read.run.id).toBe(second.runId);
    expect(read.record?.check.subjectEntityIds).toContain(subjectId);

    // Either handle lands on the check, and the earlier run is still readable by name.
    const byRun = await readSettled(second.runId, opened.runId);
    expect(byRun.check.id).toBe(opened.id);
    expect(byRun.run.ordinal).toBe(1);
  });

  it("files a check on a matter after it ran, and the matter's history then holds it", async () => {
    const subjectId = await createPerson("Filed", "Later");
    const { opened } = await openAndSettle({
      trigger: "preliminary",
      subjectEntityIds: [subjectId],
      scope: PARTY_SCOPE,
    });
    const matter = await post("/api/v1/matters", {
      title: "Filed after the screen",
      status: "open",
      responsibleMemberId: ownerUserId,
      clientDisplayName: "Filed Client",
    });
    expect(matter.status, await matter.clone().text()).toBe(201);
    const { matterId } = (await matter.json()) as { matterId: string };

    const filed = await put(`/api/v1/conflicts/checks/${opened.id}/matter`, { matterId });
    expect(filed.status, await filed.clone().text()).toBe(200);
    expect(await filed.json()).toEqual({ id: opened.id, matterId });

    const read = await readSettled(opened.id);
    expect(read.check.matterId).toBe(matterId);
    // The search record still says which matter it actually ran against: none.
    expect(read.record?.check.matterId).toBeNull();

    const narrowed = await get(`/api/v1/conflicts/checks?matterId=${matterId}`);
    const page = (await narrowed.json()) as { data: Array<{ id: string }> };
    expect(page.data.map((row) => row.id)).toContain(opened.id);

    const posture = await get(`/api/v1/matters/${matterId}/conflicts-posture`);
    const standing = (await posture.json()) as {
      neverChecked: boolean;
      latestCheck: { id: string; checkNumber: string | null } | null;
    };
    expect(standing.neverChecked).toBe(false);
    expect(standing.latestCheck?.id).toBe(opened.runId);
    expect(standing.latestCheck?.checkNumber).toBe(opened.checkNumber);

    const unknownMatter = await put(`/api/v1/conflicts/checks/${opened.id}/matter`, {
      matterId: newIdentifier("matter"),
    });
    expect(unknownMatter.status).toBe(422);
  });

  it("carries an earlier answer about the same party as context, leaving the hit unanswered", async () => {
    /*
     * The owner's ruling of 2026-09-02, on the wire. The firm answers a hit about a party; a LATER
     * check surfaces the same party, and that hit carries what was said before — and is still
     * unanswered. A response that put the earlier answer in `disposition` would be the platform
     * concluding on a reviewer's behalf about a question nobody has asked yet.
     */
    const subjectId = await createPerson("Twice", "Surfaced");
    const matchId = await createPerson("Twice", "Surfaced");

    const first = await openAndSettle({
      trigger: "comprehensive",
      subjectEntityIds: [subjectId],
      scope: PARTY_SCOPE,
    });
    const firstHit = first.read.record?.hits.find((hit) => hit.entityId === matchId);
    expect(firstHit).toBeDefined();
    // Nothing has been said about this party yet.
    expect(firstHit?.previouslyAnswered).toBeNull();

    const answered = await post(`/api/v1/conflicts/hits/${firstHit?.id}/dispositions`, {
      kind: "cleared",
      rationale: "former client, unrelated matter",
    });
    expect(answered.status, await answered.clone().text()).toBe(201);

    const second = await openAndSettle({
      trigger: "comprehensive",
      subjectEntityIds: [subjectId],
      scope: PARTY_SCOPE,
    });
    const secondHit = second.read.record?.hits.find((hit) => hit.entityId === matchId);
    expect(secondHit?.previouslyAnswered?.kind).toBe("cleared");
    expect(secondHit?.previouslyAnswered?.checkId).toBe(first.opened.runId);
    // The point of the ruling: context, not a conclusion. This hit is unanswered.
    expect(secondHit?.disposition).toBeNull();
  });

  it("lists the checks the firm refers to, newest first, one row per check, and narrows to one matter", async () => {
    const subjectId = await createPerson("History", "Subject");
    const matter = await post("/api/v1/matters", {
      title: "Check history",
      status: "open",
      responsibleMemberId: ownerUserId,
      clientDisplayName: "History Client",
    });
    expect(matter.status, await matter.clone().text()).toBe(201);
    const { matterId } = (await matter.json()) as { matterId: string };

    // One check against the matter, one against a bare party set with no matter at all — which the
    // schema allows and a listing must not imply is impossible.
    const forMatter = await openAndSettle({
      trigger: "comprehensive",
      matterId,
      subjectEntityIds: [subjectId],
      scope: PARTY_SCOPE,
    });
    await openAndSettle({
      trigger: "preliminary",
      subjectEntityIds: [subjectId],
      scope: PARTY_SCOPE,
    });
    // A second run of the matter's check is one row with two runs, not two rows.
    const rerun = await post(`/api/v1/conflicts/checks/${forMatter.opened.id}/runs`, {});
    expect(rerun.status, await rerun.clone().text()).toBe(202);
    const second = (await rerun.json()) as OpenedCheck;
    await readSettled(forMatter.opened.id, second.runId);

    const all = await get("/api/v1/conflicts/checks");
    expect(all.status, await all.clone().text()).toBe(200);
    const page = (await all.json()) as {
      data: Array<{
        id: string;
        checkNumber: string;
        matterId: string | null;
        runCount: number;
        runStatus: string | null;
        actorUserId: string | null;
        triggerSource: string | null;
        hitCount: number | null;
      }>;
      nextCursor: string | null;
    };
    // Newest first, and the envelope is the uniform one — never a bare array.
    expect(page.data.length).toBeGreaterThanOrEqual(2);
    expect(page).toHaveProperty("nextCursor");
    const listed = page.data.find((entry) => entry.id === forMatter.opened.id);
    expect(listed?.checkNumber).toBe(forMatter.opened.checkNumber);
    expect(listed?.matterId).toBe(matterId);
    expect(listed?.runCount).toBe(2);
    expect(listed?.runStatus).toBe("completed");
    // A person asked for it, so the row names them. An automated run would carry null here, and the
    // two must never read alike.
    expect(listed?.actorUserId).toBe(ownerUserId);
    expect(listed?.triggerSource).toBe("manual");
    expect(typeof listed?.hitCount).toBe("number");
    expect(page.data.filter((entry) => entry.id === forMatter.opened.id)).toHaveLength(1);

    const narrowed = await get(`/api/v1/conflicts/checks?matterId=${matterId}`);
    expect(narrowed.status, await narrowed.clone().text()).toBe(200);
    const narrowedPage = (await narrowed.json()) as { data: Array<{ matterId: string | null }> };
    expect(narrowedPage.data.length).toBeGreaterThan(0);
    // The matterless check must not appear under a matter's own history.
    for (const entry of narrowedPage.data) expect(entry.matterId).toBe(matterId);
  });

  it("re-checks a matter on demand, against its live parties and the firm's own floor", async () => {
    /*
     * The affordance a reviewer presses. It takes no scope on purpose: "re-check this matter" has
     * none for a caller to state, and asking would invite a screen to compose a narrower search than
     * the firm requires. It also names no subjects — the engine reads the matter's own live parties,
     * so a party added since the last check is in the search without anybody listing them.
     */
    const clientId = await createPerson("Recheck", "Client");
    const matter = await post("/api/v1/matters", {
      title: "Re-check on demand",
      status: "open",
      responsibleMemberId: ownerUserId,
      clientDisplayName: "Recheck Client",
    });
    expect(matter.status, await matter.clone().text()).toBe(201);
    const { matterId } = (await matter.json()) as { matterId: string };
    const party = await post("/api/v1/directory/matter-parties", {
      matterId,
      entityId: clientId,
      role: "client",
    });
    expect(party.status, await party.clone().text()).toBe(201);

    const recheck = await post(`/api/v1/matters/${matterId}/conflicts-rechecks`, {});
    expect(recheck.status, await recheck.clone().text()).toBe(202);
    const { id: checkId, runId, checkNumber } = (await recheck.json()) as OpenedCheck;
    expect(checkId).toMatch(/^conflictsCheck_/);
    expect(checkNumber).toMatch(/^CC\d{4}-/);

    // It is somebody's act, and the log says whose — unlike an automated run, which is nobody's.
    const read = await readSettled(checkId, runId);
    expect(read.run.status).toBe("completed");
    expect(read.record?.check.matterId).toBe(matterId);
    expect(read.record?.check.actorUserId).toBe(ownerUserId);
    expect(read.record?.check.subjectEntityIds).toContain(clientId);

    // Pressed again, it lands under the matter's own check as a further run.
    const again = await post(`/api/v1/matters/${matterId}/conflicts-rechecks`, {});
    expect(again.status, await again.clone().text()).toBe(202);
    const second = (await again.json()) as OpenedCheck;
    expect(second.id).toBe(checkId);
    expect(second.runId).not.toBe(runId);
    expect((await readSettled(checkId, second.runId)).runs).toHaveLength(2);
  });

  it("serves the firm's conflicts floor, with the party class always in it and no bounds on it", async () => {
    const response = await get("/api/v1/firm/conflicts-policy");
    expect(response.status, await response.clone().text()).toBe(200);
    const policy = (await response.json()) as Record<string, unknown>;
    // Never optional: conflicts impute across the whole firm, so a floor that could drop the party
    // corpus would be a floor that permits a check nobody should be able to ask for.
    expect(policy.floorSources).toContain("party");
    expect(policy.floorStrictness).toBeTruthy();
    // Never empty: an emptied set would compare no name rows at all — a check that runs and finds
    // nothing for a reason nothing on the row explains.
    expect((policy.balancedNameRoles as string[]).length).toBeGreaterThan(0);
    // A firm no longer decides how far a check walks or where it stops.
    for (const bound of ["defaultDepth", "edgeClassBudgets", "closureCap", "candidateCap"]) {
      expect(policy).not.toHaveProperty(bound);
    }
  });
});

describe("conflicts hit routes", () => {
  beforeAll(() => adoptFreshFirm("hits"));

  it("serves every answer on a hit, oldest first, with the reversed one still standing", async () => {
    /*
     * The compliance artifact. The log is append-only so that a reviewer who cleared a hit and later
     * reversed leaves both acts on the books; this read is what makes that history producible. A
     * response carrying only the surviving answer would destroy on the read what the triggers refuse
     * to destroy on the write.
     */
    const subjectId = await createPerson("Trailed", "Subject");
    const matchId = await createPerson("Trailed", "Subject");
    const { read } = await openAndSettle({
      trigger: "comprehensive",
      subjectEntityIds: [subjectId],
      scope: PARTY_SCOPE,
    });
    const hit = read.record?.hits.find((candidate) => candidate.entityId === matchId);
    expect(hit).toBeDefined();

    const cleared = await post(`/api/v1/conflicts/hits/${hit?.id}/dispositions`, {
      kind: "cleared",
      rationale: "unrelated on first look",
    });
    expect(cleared.status, await cleared.clone().text()).toBe(201);
    const reversed = await post(`/api/v1/conflicts/hits/${hit?.id}/dispositions`, {
      kind: "representation_declined",
      rationale: "on reflection the interests are directly adverse",
    });
    expect(reversed.status, await reversed.clone().text()).toBe(201);

    const trail = await get(`/api/v1/conflicts/hits/${hit?.id}/dispositions`);
    expect(trail.status, await trail.clone().text()).toBe(200);
    const body = (await trail.json()) as {
      hitId: string;
      dispositions: Array<{ kind: string; rationale: string; reviewerUserId: string }>;
    };
    expect(body.hitId).toBe(hit?.id);
    expect(body.dispositions.map((entry) => entry.kind)).toEqual([
      "cleared",
      "representation_declined",
    ]);
    for (const entry of body.dispositions) expect(entry.reviewerUserId).toBe(ownerUserId);
  });

  it("answers 404 for a hit that does not exist, rather than an empty trail", async () => {
    // "No such hit" and "nobody has answered this hit" are different facts, and conflating them
    // would let a mistyped handle read as an unanswered candidate.
    const response = await get(
      `/api/v1/conflicts/hits/${newIdentifier("conflictsHit")}/dispositions`,
    );
    expect(response.status).toBe(404);
  });

  it("names the party each hit is about, resolved from the Directory on the read", async () => {
    // The gap this closed: a hit carried entity_id and nothing else, so a reviewer looking at the
    // candidate list could not tell who had surfaced without opening every row one at a time.
    const subjectId = await createPerson("Ines", "Herrera");
    const matchId = await createPerson("Ines", "Herrera");

    const { read } = await openAndSettle({
      trigger: "comprehensive",
      subjectEntityIds: [subjectId],
      scope: PARTY_SCOPE,
    });
    const hit = read.record?.hits.find((candidate) => candidate.entityId === matchId);
    expect(hit, "the name-twin should surface as a hit").toBeDefined();
    expect(hit?.party).toEqual({ kind: "person", displayName: "Ines Herrera" });
  });

  it("says an entity could not be resolved rather than leaving the party blank", async () => {
    /*
     * The conflicts log is append-only, so a hit keeps naming the entity it matched even after the
     * Directory has reshaped that entity — a merge is the ordinary way this happens. The wire must
     * carry that as an UNRESOLVED party, because a null read as "no party" would invert the meaning
     * of the one thing a conflicts hit is: a party the firm may have a problem with.
     *
     * The hit is written directly, because the only supported way to reach this state through the
     * API is to merge an entity away, which is a different subsystem's act.
     */
    const subjectId = await createPerson("Absent", "Reference");
    const { opened } = await openAndSettle({
      trigger: "comprehensive",
      subjectEntityIds: [subjectId],
      scope: PARTY_SCOPE,
    });

    await firmDatabase
      .prepare(
        `INSERT INTO conflicts_hit (id, check_id, entity_id, source_class, evidence_tier,
           matched_fields_json, graph_path_json, co_party, created_at)
         VALUES (?1, ?2, ?3, 'party', 2, '[]', '[]', 0, ?4)`,
      )
      .bind(
        newIdentifier("conflictsHit"),
        opened.runId,
        "directoryPerson_mergedAwayAfterTheCheck",
        new Date().toISOString(),
      )
      .run();

    const read = await readSettled(opened.id);
    const orphan = read.record?.hits.find(
      (candidate) => candidate.entityId === "directoryPerson_mergedAwayAfterTheCheck",
    );
    expect(orphan, "the unresolvable hit still comes back").toBeDefined();
    expect(orphan?.party).toBeNull();
  });

  it("reads a check back with its hits, and dispositions a surfaced hit", async () => {
    // Two persons sharing a name so the check surfaces one as a conflicts hit for the other.
    const subjectId = await createPerson("Marguerite", "Castellane");
    const matchId = await createPerson("Marguerite", "Castellane");

    const { opened, read } = await openAndSettle({
      trigger: "new_party",
      subjectEntityIds: [subjectId],
      scope: { sources: ["party"], strictness: "over_inclusive" },
    });
    expect(read.record?.check.id).toBe(opened.runId);
    expect(read.record?.check.trigger).toBe("new_party");
    expect(read.record?.check.subjectEntityIds).toContain(subjectId);
    expect(read.record?.hits.some((hit) => hit.entityId === matchId)).toBe(true);
    expect(read.run.hitCount).toBe(read.record?.hits.length);

    const hit = read.record?.hits.find((candidate) => candidate.entityId === matchId);
    expect(hit).toBeDefined();
    expect(hit?.disposition).toBeNull();

    const disposed = await post(`/api/v1/conflicts/hits/${hit?.id}/dispositions`, {
      kind: "cleared",
      rationale: "same name, unrelated matter — no conflict on review",
    });
    expect(disposed.status).toBe(201);
    const { id: dispositionId } = (await disposed.json()) as { id: string };
    expect(dispositionId).toMatch(/^conflictsDisposition_/);

    // Reading the check again now shows the recorded disposition on the hit.
    const readAgain = await readSettled(opened.id);
    const hitAgain = readAgain.record?.hits.find((candidate) => candidate.id === hit?.id);
    expect(hitAgain?.disposition?.kind).toBe("cleared");
  });

  it("records a waiver with its own record, and reports what it is short of", async () => {
    const subjectId = await createPerson("Aurelien", "Vasseur");
    const matchId = await createPerson("Aurelien", "Vasseur");

    const { opened, read } = await openAndSettle({
      trigger: "comprehensive",
      subjectEntityIds: [subjectId],
      scope: { sources: ["party"], strictness: "over_inclusive" },
    });
    const hit = read.record?.hits.find((candidate) => candidate.entityId === matchId);
    expect(hit).toBeDefined();

    // Given orally and not yet confirmed in writing — the shape that must be RECORDED rather than
    // refused, because refusing it would leave the firm's log with no waiver on it at all.
    const disposed = await post(`/api/v1/conflicts/hits/${hit?.id}/dispositions`, {
      kind: "waiver_obtained",
      rationale: "consent given by telephone; the confirming letter goes out today",
      waiver: {
        givenByEntityId: matchId,
        confirmedInWriting: false,
        givenOn: "2026-08-24",
      },
    });
    expect(disposed.status).toBe(201);

    const readAgain = await readSettled(opened.id);
    const answered = readAgain.record?.hits.find((candidate) => candidate.id === hit?.id);
    expect(answered?.disposition?.kind).toBe("waiver_obtained");
    expect(answered?.disposition?.waiver).toEqual({
      givenByEntityId: matchId,
      confirmedInWriting: false,
      documentFileId: null,
      givenOn: "2026-08-24",
    });
    expect(answered?.disposition?.shortfalls).toEqual([
      "consent-not-confirmed-in-writing",
      "confirmation-not-filed",
    ]);
  });

  it("refuses a waiver that names nobody, and a waiver record on another kind (422)", async () => {
    const subjectId = await createPerson("Ottilie", "Brandwein");
    await createPerson("Ottilie", "Brandwein");
    const { read } = await openAndSettle({
      trigger: "comprehensive",
      subjectEntityIds: [subjectId],
      scope: { sources: ["party"], strictness: "over_inclusive" },
    });
    const hitId = read.record?.hits[0]?.id;
    expect(hitId).toBeDefined();

    const noParty = await post(`/api/v1/conflicts/hits/${hitId}/dispositions`, {
      kind: "waiver_obtained",
      rationale: "a waiver was obtained",
    });
    expect(noParty.status).toBe(422);

    // The other three kinds' payloads are unchanged, and a waiver record on one of them is refused.
    const wrongKind = await post(`/api/v1/conflicts/hits/${hitId}/dispositions`, {
      kind: "cleared",
      rationale: "unrelated party",
      waiver: {
        givenByEntityId: subjectId,
        confirmedInWriting: true,
        givenOn: "2026-08-24",
      },
    });
    expect(wrongKind.status).toBe(422);
  });

  it("refuses a caller lacking conflicts:run (403)", async () => {
    const response = await post(
      "/api/v1/conflicts/checks",
      { trigger: "comprehensive", subjectEntityIds: [], scope: PARTY_SCOPE },
      noPermissionCookie,
    );
    expect(response.status).toBe(403);
  });

  it("rejects a request omitting trigger (422)", async () => {
    const response = await post("/api/v1/conflicts/checks", {
      subjectEntityIds: [],
      scope: PARTY_SCOPE,
    });
    expect(response.status).toBe(422);
  });

  it("answers 404 for a check that does not exist, and for a run the check does not have", async () => {
    const missing = await get(`/api/v1/conflicts/checks/${newIdentifier("conflictsCheck")}`);
    expect(missing.status).toBe(404);
    const { opened } = await openAndSettle({
      trigger: "preliminary",
      subjectEntityIds: [await createPerson("Runless", "Subject")],
      scope: PARTY_SCOPE,
    });
    const wrongRun = await get(
      `/api/v1/conflicts/checks/${opened.id}?run=${newIdentifier("conflictsCheck")}`,
    );
    expect(wrongRun.status).toBe(404);
    const missingRerun = await post(
      `/api/v1/conflicts/checks/${newIdentifier("conflictsCheck")}/runs`,
      {},
    );
    expect(missingRerun.status).toBe(404);
  });

  it("dedups a repeated Idempotency-Key — the retry returns the first check's handle and number", async () => {
    const key = crypto.randomUUID();
    const body = { trigger: "periodic_rescan", subjectEntityIds: [], scope: PARTY_SCOPE };

    const first = await postWithFixedKey("/api/v1/conflicts/checks", body, key);
    expect(first.status).toBe(202);
    const opened = (await first.json()) as OpenedCheck;

    const replay = await postWithFixedKey("/api/v1/conflicts/checks", body, key);
    expect(replay.status).toBe(202);
    const replayed = (await replay.json()) as OpenedCheck;
    expect(replayed.id).toBe(opened.id);
    expect(replayed.checkNumber).toBe(opened.checkNumber);

    await readSettled(opened.id);
    const countResult = await firmDatabase
      .prepare("SELECT COUNT(*) AS c FROM conflicts_check WHERE id = ?1")
      .bind(opened.runId)
      .all<{ c: number }>();
    expect(countResult.results[0]?.c).toBe(1);
    const runs = await firmDatabase
      .prepare("SELECT COUNT(*) AS c FROM conflicts_check_run WHERE numbered_check_id = ?1")
      .bind(opened.id)
      .all<{ c: number }>();
    expect(runs.results[0]?.c).toBe(1);
  });
});

describe("conflicts contract", () => {
  it("registers the conflicts operations in the OpenAPI document", () => {
    const document = buildOpenAPIDocument();
    const operationIds = new Set<string>();
    for (const item of Object.values(document.paths ?? {})) {
      for (const method of ["get", "post", "put"] as const) {
        const operation = (item as Record<string, { operationId?: string } | undefined>)[method];
        if (operation?.operationId) operationIds.add(operation.operationId);
      }
    }
    expect(operationIds.has("conflicts.runCheck")).toBe(true);
    expect(operationIds.has("conflicts.rerunCheck")).toBe(true);
    expect(operationIds.has("conflicts.fileCheckOnMatter")).toBe(true);
    expect(operationIds.has("conflicts.nextCheckNumber")).toBe(true);
    expect(operationIds.has("conflicts.getCheck")).toBe(true);
    expect(operationIds.has("conflicts.matterPosture")).toBe(true);
    expect(operationIds.has("conflicts.recordDisposition")).toBe(true);
  });
});

// The reporting posture at the HTTP edge. The domain-level proofs live in packages/conflicts/test;
// what is proved here is that the wire shape a caller actually receives carries no verdict, and that
// the statement a caller renders says what the search did.
describe("the reporting posture over the wire", () => {
  beforeAll(() => adoptFreshFirm("posture"));

  interface PostureBody {
    readonly matterId: string;
    readonly neverChecked: boolean;
    readonly latestCheck: { readonly id: string; readonly hitCount: number } | null;
    readonly scopeShortfall: { readonly sources: string[] };
    readonly pendingRecheck: unknown[];
    readonly undisposedByTier: Array<{ tier: number; count: number }>;
    readonly dispositionsByKind: unknown[];
    readonly unavailableSources: Array<{ source: string; reason: string }>;
  }

  async function readPosture(matterId: string, cookie = ownerCookie): Promise<Response> {
    return get(`/api/v1/matters/${matterId}/conflicts-posture`, cookie);
  }

  async function createMatter(title: string): Promise<string> {
    const response = await post("/api/v1/matters", {
      title,
      status: "open",
      responsibleMemberId: ownerUserId,
    });
    expect(response.status).toBe(201);
    const { matterId } = (await response.json()) as { matterId: string };
    return matterId;
  }

  it("reports a matter that was never checked as its own state, not as an absence", async () => {
    const matterId = await createMatter("Never checked");
    const response = await readPosture(matterId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as PostureBody;
    expect(body.neverChecked).toBe(true);
    expect(body.latestCheck).toBeNull();
    expect(body.undisposedByTier).toEqual([
      { tier: 1, count: 0 },
      { tier: 2, count: 0 },
      { tier: 3, count: 0 },
      { tier: 4, count: 0 },
    ]);
  });

  it("distinguishes a checked matter that surfaced nothing from one never checked", async () => {
    const matterId = await createMatter("Checked and quiet");
    await openAndSettle({
      trigger: "comprehensive",
      matterId,
      subjectEntityIds: [],
      scope: { sources: ["party", "content"], strictness: "balanced" },
    });

    const body = (await (await readPosture(matterId)).json()) as PostureBody;
    expect(body.neverChecked).toBe(false);
    expect(body.latestCheck).not.toBeNull();
    expect(body.latestCheck?.hitCount).toBe(0);
    // The sources that could not run come back named, with why — never flattened into "searched".
    // Every place the product lists is among them, Magnus included.
    const unavailable = body.unavailableSources.map((entry) => entry.source);
    expect(unavailable).toContain("content");
    expect(unavailable).toContain("magnus_conversations");
    for (const entry of body.unavailableSources) expect(entry.reason.length).toBeGreaterThan(0);
  });

  it("carries no verdict-shaped field anywhere in the response", async () => {
    const matterId = await createMatter("Shape check");
    await openAndSettle({
      trigger: "comprehensive",
      matterId,
      subjectEntityIds: [],
      scope: PARTY_SCOPE,
    });
    const raw = await (await readPosture(matterId)).text();
    const verdictShaped = /"(clear|clean|ok|passed|conflictFree|severity)"\s*:/i;
    expect(verdictShaped.test(raw)).toBe(false);
  });

  it("refuses a caller lacking conflicts:read (403)", async () => {
    const matterId = await createMatter("Permission check");
    const response = await readPosture(matterId, noPermissionCookie);
    expect(response.status).toBe(403);
  });

  it("returns the statement of what a check searched, ending in what surfaced", async () => {
    const matterId = await createMatter("Statement");
    const { read } = await openAndSettle({
      trigger: "comprehensive",
      matterId,
      subjectEntityIds: [],
      scope: { sources: ["party", "graph", "content"], strictness: "balanced" },
    });
    expect(read.record?.hits).toEqual([]);
    const statement = read.record?.statement ?? [];
    expect(statement[0]).toMatch(/^Searched on .* trigger comprehensive\.$/);
    expect(statement.some((line) => line.includes("followed to closure"))).toBe(true);
    expect(statement.some((line) => line.startsWith("Not searched:"))).toBe(true);
    expect(statement.at(-1)).toBe("Nothing surfaced.");
  });
});
