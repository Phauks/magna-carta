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

// The conflicts route surface, driven through the chokepoint over real Miniflare bindings: running a
// check against the directory corpus, reading it back with its hits, and recording a reviewer's
// disposition of a hit. conflicts:run and conflicts:read are seeded broadly (every default role,
// including Owner/Admin); a caller with neither gets refused before any check runs. Mutations require
// an Idempotency-Key (the chokepoint gate), and a repeated key replays the first check rather than
// running a second.

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

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Conflicts Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);

  const owner = await seedCredentialedUser("conflicts-owner@example.com", {
    userName: "Conflicts Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Conflicts Owner", poolFirmId);
  ownerUserId = owner.userId;
  ownerCookie = await signInForSessionCookie("conflicts-owner@example.com");

  const noPermission = await seedCredentialedUser("conflicts-nopermission@example.com", {
    userName: "No Permission",
    firmId: poolFirmId,
  });
  await mirrorMemberWithUnrelatedGrant(noPermission.userId, "No Permission");
  noPermissionCookie = await signInForSessionCookie("conflicts-nopermission@example.com");

  // A matter cannot be opened without an active numbering scheme, and the posture tests need real
  // matters rather than fabricated handles.
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

describe("conflicts check routes", () => {
  it("runs a check and returns a handle", async () => {
    const personId = await createPerson("Solo", "Subject");

    const response = await post("/api/v1/conflicts/checks", {
      trigger: "comprehensive",
      subjectEntityIds: [personId],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(id).toMatch(/^conflictsCheck_/);
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
    const scope = { sources: ["party"], strictness: "balanced", depth: 1 };

    const first = await post("/api/v1/conflicts/checks", {
      trigger: "comprehensive",
      subjectEntityIds: [subjectId],
      scope,
    });
    expect(first.status, await first.clone().text()).toBe(201);
    const { id: firstCheckId } = (await first.json()) as { id: string };
    const firstRead = await get(`/api/v1/conflicts/checks/${firstCheckId}`);
    const firstBody = (await firstRead.json()) as {
      hits: Array<{ id: string; entityId: string; previouslyAnswered: unknown }>;
    };
    const firstHit = firstBody.hits.find((hit) => hit.entityId === matchId);
    expect(firstHit).toBeDefined();
    // Nothing has been said about this party yet.
    expect(firstHit?.previouslyAnswered).toBeNull();

    const answered = await post(`/api/v1/conflicts/hits/${firstHit?.id}/dispositions`, {
      kind: "cleared",
      rationale: "former client, unrelated matter",
    });
    expect(answered.status, await answered.clone().text()).toBe(201);

    const second = await post("/api/v1/conflicts/checks", {
      trigger: "comprehensive",
      subjectEntityIds: [subjectId],
      scope,
    });
    expect(second.status, await second.clone().text()).toBe(201);
    const { id: secondCheckId } = (await second.json()) as { id: string };
    const secondRead = await get(`/api/v1/conflicts/checks/${secondCheckId}`);
    const secondBody = (await secondRead.json()) as {
      hits: Array<{
        entityId: string;
        disposition: unknown;
        previouslyAnswered: { checkId: string; kind: string } | null;
      }>;
    };
    const secondHit = secondBody.hits.find((hit) => hit.entityId === matchId);
    expect(secondHit?.previouslyAnswered?.kind).toBe("cleared");
    expect(secondHit?.previouslyAnswered?.checkId).toBe(firstCheckId);
    // The point of the ruling: context, not a conclusion. This hit is unanswered.
    expect(secondHit?.disposition).toBeNull();
  });

  it("lists the checks the firm has run, newest first, and narrows to one matter", async () => {
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
    const forMatter = await post("/api/v1/conflicts/checks", {
      trigger: "comprehensive",
      matterId,
      subjectEntityIds: [subjectId],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    });
    expect(forMatter.status, await forMatter.clone().text()).toBe(201);
    const { id: matterCheckId } = (await forMatter.json()) as { id: string };
    const withoutMatter = await post("/api/v1/conflicts/checks", {
      trigger: "preliminary",
      subjectEntityIds: [subjectId],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    });
    expect(withoutMatter.status, await withoutMatter.clone().text()).toBe(201);

    const all = await get("/api/v1/conflicts/checks");
    expect(all.status, await all.clone().text()).toBe(200);
    const page = (await all.json()) as {
      data: Array<{
        id: string;
        matterId: string | null;
        actorUserId: string | null;
        triggerSource: string | null;
        hitCount: number;
      }>;
      nextCursor: string | null;
    };
    // Newest first, and the envelope is the uniform one — never a bare array.
    expect(page.data.length).toBeGreaterThanOrEqual(2);
    expect(page).toHaveProperty("nextCursor");
    const listed = page.data.find((entry) => entry.id === matterCheckId);
    expect(listed?.matterId).toBe(matterId);
    // A person asked for it, so the row names them. An automated run would carry null here, and the
    // two must never read alike.
    expect(listed?.actorUserId).toBe(ownerUserId);
    expect(typeof listed?.hitCount).toBe("number");

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
     * the firm requires. It also names no subjects — runConflictsCheck reads the matter's own live
     * parties, so a party added since the last check is in the search without anybody listing them.
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
    expect(recheck.status, await recheck.clone().text()).toBe(201);
    const { checkId } = (await recheck.json()) as { checkId: string };
    expect(checkId).toMatch(/^conflictsCheck_/);

    // It is somebody's act, and the log says whose — unlike an automated run, which is nobody's.
    const read = await get(`/api/v1/conflicts/checks/${checkId}`);
    expect(read.status, await read.clone().text()).toBe(200);
    const body = (await read.json()) as {
      check: { matterId: string | null; actorUserId: string | null };
    };
    expect(body.check.matterId).toBe(matterId);
    expect(body.check.actorUserId).toBe(ownerUserId);
  });

  it("serves the firm's conflicts floor, with the party class always in it", async () => {
    const response = await get("/api/v1/firm/conflicts-policy");
    expect(response.status, await response.clone().text()).toBe(200);
    const policy = (await response.json()) as {
      floorSources: string[];
      floorStrictness: string;
      balancedNameRoles: string[];
    };
    // Never optional: conflicts impute across the whole firm, so a floor that could drop the party
    // corpus would be a floor that permits a check nobody should be able to ask for.
    expect(policy.floorSources).toContain("party");
    expect(policy.floorStrictness).toBeTruthy();
    // Never empty: an emptied set would compare no name rows at all — a check that runs and finds
    // nothing for a reason nothing on the row explains.
    expect(policy.balancedNameRoles.length).toBeGreaterThan(0);
  });

  it("serves every answer on a hit, oldest first, with the reversed one still standing", async () => {
    /*
     * The compliance artifact. The log is append-only so that a reviewer who cleared a hit and later
     * reversed leaves both acts on the books; this read is what makes that history producible. A
     * response carrying only the surviving answer would destroy on the read what the triggers refuse
     * to destroy on the write.
     */
    const subjectId = await createPerson("Trailed", "Subject");
    const matchId = await createPerson("Trailed", "Subject");
    const created = await post("/api/v1/conflicts/checks", {
      trigger: "comprehensive",
      subjectEntityIds: [subjectId],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const { id: checkId } = (await created.json()) as { id: string };

    const read = await get(`/api/v1/conflicts/checks/${checkId}`);
    const body = (await read.json()) as { hits: Array<{ id: string; entityId: string }> };
    const hit = body.hits.find((candidate) => candidate.entityId === matchId);
    expect(hit).toBeDefined();

    // Nobody has answered it yet: an empty trail, not a 404 and not an error.
    const empty = await get(`/api/v1/conflicts/hits/${hit?.id}/dispositions`);
    expect(empty.status, await empty.clone().text()).toBe(200);
    const emptyBody = (await empty.json()) as { dispositions: unknown[] };
    expect(emptyBody.dispositions).toEqual([]);

    const cleared = await post(`/api/v1/conflicts/hits/${hit?.id}/dispositions`, {
      kind: "cleared",
      rationale: "former client, unrelated matter",
    });
    expect(cleared.status, await cleared.clone().text()).toBe(201);
    const reversed = await post(`/api/v1/conflicts/hits/${hit?.id}/dispositions`, {
      kind: "representation_declined",
      rationale: "on review, the parent is a current client",
    });
    expect(reversed.status, await reversed.clone().text()).toBe(201);

    const trail = await get(`/api/v1/conflicts/hits/${hit?.id}/dispositions`);
    expect(trail.status, await trail.clone().text()).toBe(200);
    const trailBody = (await trail.json()) as {
      hitId: string;
      dispositions: Array<{ kind: string; rationale: string; shortfalls: string[] }>;
    };
    expect(trailBody.hitId).toBe(hit?.id);
    expect(trailBody.dispositions.map((entry) => entry.kind)).toEqual([
      "cleared",
      "representation_declined",
    ]);
    // The clearance keeps its own words, which is the whole point of not editing it.
    expect(trailBody.dispositions[0]?.rationale).toBe("former client, unrelated matter");
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

    const created = await post("/api/v1/conflicts/checks", {
      trigger: "comprehensive",
      subjectEntityIds: [subjectId],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const { id: checkId } = (await created.json()) as { id: string };

    const read = await get(`/api/v1/conflicts/checks/${checkId}`);
    expect(read.status, await read.clone().text()).toBe(200);
    const body = (await read.json()) as {
      hits: Array<{
        entityId: string;
        party: { kind: string; displayName: string | null } | null;
      }>;
    };

    const hit = body.hits.find((candidate) => candidate.entityId === matchId);
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
    const created = await post("/api/v1/conflicts/checks", {
      trigger: "comprehensive",
      subjectEntityIds: [subjectId],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const { id: checkId } = (await created.json()) as { id: string };

    await firmDatabase
      .prepare(
        `INSERT INTO conflicts_hit (id, check_id, entity_id, source_class, evidence_tier,
           matched_fields_json, graph_path_json, co_party, created_at)
         VALUES (?1, ?2, ?3, 'party', 2, '[]', '[]', 0, ?4)`,
      )
      .bind(
        newIdentifier("conflictsHit"),
        checkId,
        "directoryPerson_mergedAwayAfterTheCheck",
        new Date().toISOString(),
      )
      .run();

    const read = await get(`/api/v1/conflicts/checks/${checkId}`);
    expect(read.status, await read.clone().text()).toBe(200);
    const body = (await read.json()) as {
      hits: Array<{ entityId: string; party: unknown }>;
    };
    const orphan = body.hits.find(
      (candidate) => candidate.entityId === "directoryPerson_mergedAwayAfterTheCheck",
    );
    expect(orphan, "the unresolvable hit still comes back").toBeDefined();
    expect(orphan?.party).toBeNull();
  });

  it("reads a check back with its hits, and dispositions a surfaced hit", async () => {
    // Two persons sharing a name so the check surfaces one as a conflicts hit for the other.
    const subjectId = await createPerson("Marguerite", "Castellane");
    const matchId = await createPerson("Marguerite", "Castellane");

    const created = await post("/api/v1/conflicts/checks", {
      trigger: "new_party",
      subjectEntityIds: [subjectId],
      scope: { sources: ["party"], strictness: "over_inclusive", depth: 1 },
    });
    expect(created.status).toBe(201);
    const { id: checkId } = (await created.json()) as { id: string };

    const read = await get(`/api/v1/conflicts/checks/${checkId}`);
    expect(read.status).toBe(200);
    const body = (await read.json()) as {
      check: { id: string; trigger: string; subjectEntityIds: string[] };
      hits: Array<{ id: string; entityId: string; disposition: unknown }>;
    };
    expect(body.check.id).toBe(checkId);
    expect(body.check.trigger).toBe("new_party");
    expect(body.check.subjectEntityIds).toContain(subjectId);
    expect(body.hits.some((hit) => hit.entityId === matchId)).toBe(true);

    const hit = body.hits.find((candidate) => candidate.entityId === matchId);
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
    const readAgain = await get(`/api/v1/conflicts/checks/${checkId}`);
    const bodyAgain = (await readAgain.json()) as {
      hits: Array<{ id: string; disposition: { kind: string } | null }>;
    };
    const hitAgain = bodyAgain.hits.find((candidate) => candidate.id === hit?.id);
    expect(hitAgain?.disposition?.kind).toBe("cleared");
  });

  it("records a waiver with its own record, and reports what it is short of", async () => {
    const subjectId = await createPerson("Aurelien", "Vasseur");
    const matchId = await createPerson("Aurelien", "Vasseur");

    const created = await post("/api/v1/conflicts/checks", {
      trigger: "comprehensive",
      subjectEntityIds: [subjectId],
      scope: { sources: ["party"], strictness: "over_inclusive", depth: 1 },
    });
    const { id: checkId } = (await created.json()) as { id: string };
    const read = await get(`/api/v1/conflicts/checks/${checkId}`);
    const body = (await read.json()) as { hits: Array<{ id: string; entityId: string }> };
    const hit = body.hits.find((candidate) => candidate.entityId === matchId);
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

    const readAgain = await get(`/api/v1/conflicts/checks/${checkId}`);
    const bodyAgain = (await readAgain.json()) as {
      hits: Array<{
        id: string;
        disposition: {
          kind: string;
          waiver: { givenByEntityId: string; confirmedInWriting: boolean; givenOn: string };
          shortfalls: string[];
        } | null;
      }>;
    };
    const answered = bodyAgain.hits.find((candidate) => candidate.id === hit?.id);
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
    const created = await post("/api/v1/conflicts/checks", {
      trigger: "comprehensive",
      subjectEntityIds: [subjectId],
      scope: { sources: ["party"], strictness: "over_inclusive", depth: 1 },
    });
    const { id: checkId } = (await created.json()) as { id: string };
    const read = await get(`/api/v1/conflicts/checks/${checkId}`);
    const body = (await read.json()) as { hits: Array<{ id: string }> };
    const hitId = body.hits[0]?.id;
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
      {
        trigger: "comprehensive",
        subjectEntityIds: [],
        scope: { sources: ["party"], strictness: "balanced", depth: 1 },
      },
      noPermissionCookie,
    );
    expect(response.status).toBe(403);
  });

  it("rejects a request omitting trigger (422)", async () => {
    const response = await post("/api/v1/conflicts/checks", {
      subjectEntityIds: [],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    });
    expect(response.status).toBe(422);
  });

  it("dedups a repeated Idempotency-Key — the retry returns the first check's id", async () => {
    const key = crypto.randomUUID();
    const body = {
      trigger: "periodic_rescan",
      subjectEntityIds: [],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    };

    const first = await postWithFixedKey("/api/v1/conflicts/checks", body, key);
    expect(first.status).toBe(201);
    const { id: firstId } = (await first.json()) as { id: string };

    const replay = await postWithFixedKey("/api/v1/conflicts/checks", body, key);
    expect(replay.status).toBe(201);
    const { id: replayId } = (await replay.json()) as { id: string };
    expect(replayId).toBe(firstId);

    const countResult = await firmDatabase
      .prepare("SELECT COUNT(*) AS c FROM conflicts_check WHERE id = ?1")
      .bind(firstId)
      .all<{ c: number }>();
    expect(countResult.results[0]?.c).toBe(1);
  });
});

describe("conflicts contract", () => {
  it("registers the conflicts operations in the OpenAPI document", () => {
    const document = buildOpenAPIDocument();
    const operationIds = new Set<string>();
    for (const item of Object.values(document.paths ?? {})) {
      for (const method of ["get", "post"] as const) {
        const operation = (item as Record<string, { operationId?: string } | undefined>)[method];
        if (operation?.operationId) operationIds.add(operation.operationId);
      }
    }
    expect(operationIds.has("conflicts.runCheck")).toBe(true);
    expect(operationIds.has("conflicts.getCheck")).toBe(true);
    expect(operationIds.has("conflicts.matterPosture")).toBe(true);
    expect(operationIds.has("conflicts.recordDisposition")).toBe(true);
  });
});

// The reporting posture at the HTTP edge. The domain-level proofs live in packages/conflicts/test;
// what is proved here is that the wire shape a caller actually receives carries no verdict, and that
// the statement a caller renders says what the search did.
describe("the reporting posture over the wire", () => {
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
    const created = await post("/api/v1/conflicts/checks", {
      trigger: "comprehensive",
      matterId,
      subjectEntityIds: [],
      scope: { sources: ["party", "content"], strictness: "balanced", depth: 1 },
    });
    expect(created.status).toBe(201);

    const body = (await (await readPosture(matterId)).json()) as PostureBody;
    expect(body.neverChecked).toBe(false);
    expect(body.latestCheck).not.toBeNull();
    expect(body.latestCheck?.hitCount).toBe(0);
    // The sources that could not run come back named, with why — never flattened into "searched".
    expect(body.unavailableSources.map((entry) => entry.source)).toContain("content");
    for (const entry of body.unavailableSources) expect(entry.reason.length).toBeGreaterThan(0);
  });

  it("carries no verdict-shaped field anywhere in the response", async () => {
    const matterId = await createMatter("Shape check");
    await post("/api/v1/conflicts/checks", {
      trigger: "comprehensive",
      matterId,
      subjectEntityIds: [],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    });
    const raw = await (await readPosture(matterId)).text();
    const verdictShaped = /"(clear|clean|ok|passed|conflictFree|status|severity)"\s*:/i;
    expect(verdictShaped.test(raw)).toBe(false);
  });

  it("refuses a caller lacking conflicts:read (403)", async () => {
    const matterId = await createMatter("Permission check");
    const response = await readPosture(matterId, noPermissionCookie);
    expect(response.status).toBe(403);
  });

  it("returns the statement of what a check searched, ending in what surfaced", async () => {
    const matterId = await createMatter("Statement");
    const created = await post("/api/v1/conflicts/checks", {
      trigger: "comprehensive",
      matterId,
      subjectEntityIds: [],
      scope: { sources: ["party", "graph", "content"], strictness: "balanced", depth: 1 },
    });
    const { id: checkId } = (await created.json()) as { id: string };

    const body = (await (await get(`/api/v1/conflicts/checks/${checkId}`)).json()) as {
      statement: string[];
      hits: unknown[];
    };
    expect(body.hits).toEqual([]);
    expect(body.statement[0]).toMatch(/^Searched on .* trigger comprehensive\.$/);
    expect(body.statement.some((line) => line.startsWith("Not searched:"))).toBe(true);
    expect(body.statement.at(-1)).toBe("Nothing surfaced.");
  });
});
