import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The intake procedure's route surface, driven through the chokepoint over real Miniflare bindings:
// a procedure is authored and bound to a matter type, a consultation of that type reads its
// checklist, the opening is refused while a required step is outstanding and passes once each is
// answered, and a Paralegal — who may record but not waive — is refused the waiver.

let poolFirmId: FirmId;
let ownerCookie: string;
let paralegalCookie: string;
let ownerUserId: UserId;

async function mirrorMemberWithRole(userId: UserId, displayName: string, roleName: string) {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  const roleResult = await firmDatabase
    .prepare("SELECT id FROM role WHERE name = ?1")
    .bind(roleName)
    .all<{ id: string }>();
  const role = roleResult.results[0];
  if (role === undefined) throw new Error(`seeded role ${roleName} missing`);
  await insertMemberStatement(firmDatabase, {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(firmDatabase, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(role.id, "role"),
  }).run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Intake Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("intake-owner@example.com", {
    userName: "Intake Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Intake Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("intake-owner@example.com");

  const paralegal = await seedCredentialedUser("intake-paralegal@example.com", {
    userName: "Intake Paralegal",
    firmId: poolFirmId,
  });
  await mirrorMemberWithRole(paralegal.userId, "Intake Paralegal", "Paralegal");
  paralegalCookie = await signInForSessionCookie("intake-paralegal@example.com");
});

function headers(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

function send(
  method: string,
  path: string,
  body: unknown,
  cookie = ownerCookie,
): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: headers(cookie, true),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// A typed read of a response body, for the assertions the linter's cast-stripper reaches into.
async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

interface Checklist {
  matterStatus: string;
  outstandingRequired: number;
  steps: {
    stepId: string;
    kind: string;
    required: boolean;
    recordable: boolean;
    standing: { satisfied: boolean; answeredBy: string; statement: string };
  }[];
  history: { outcome: string; supersededAt: string | null }[];
}

describe("intake procedure routes", () => {
  it("authors a procedure, gates a consultation of its kind, and opens it once every required step is answered", async () => {
    // A numbering scheme, so the open has a counter to draw from; and a matter type to bind the
    // procedure to.
    const scheme = await send("PUT", "/api/v1/numbering-scheme", {
      segments: [
        { kind: "year", digits: 4 },
        { kind: "literal", text: "-" },
        { kind: "counter", padWidth: 4 },
      ],
    });
    expect(scheme.status).toBe(200);
    const type = await send("POST", "/api/v1/matter-types", { name: "Personal injury" });
    expect(type.status).toBe(201);
    const { id: matterTypeId } = (await type.json()) as { id: string };

    const procedure = await send("POST", "/api/v1/intake-procedures", {
      name: "Injury intake",
      description: "What every injury consultation clears before it opens",
      matterTypeId,
    });
    expect(procedure.status).toBe(201);
    const { id: procedureId } = (await procedure.json()) as { id: string };

    const steps = [
      { kind: "conflicts-check", title: "Run the conflicts check" },
      { kind: "identity-verification", title: "Verify the client's identity" },
      { kind: "acknowledgement", title: "Give the client the privacy notice", required: false },
    ];
    const stepIds: string[] = [];
    for (const step of steps) {
      const added = await send("POST", `/api/v1/intake-procedures/${procedureId}/steps`, step);
      expect(added.status).toBe(201);
      stepIds.push((await readJson<{ id: string }>(added)).id);
    }
    // A reference on a kind that is about nothing is refused by name.
    const refused = await send("POST", `/api/v1/intake-procedures/${procedureId}/steps`, {
      kind: "conflicts-check",
      title: "Again",
      referenceId: "documentTemplate_x",
    });
    expect(refused.status).toBe(422);

    const read = await get(`/api/v1/intake-procedures/${procedureId}`);
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as { steps: { kind: string; required: boolean }[] };
    expect(readBody.steps.map((step) => [step.kind, step.required])).toEqual([
      ["conflicts-check", true],
      ["identity-verification", true],
      ["acknowledgement", false],
    ]);

    // An intake of that kind is bound; one of another kind is not. An intake draws no number of any
    // kind until it graduates.
    const consultation = await send("POST", "/api/v1/matters", {
      title: "Herrera consultation",
      status: "intake",
      responsibleMemberId: ownerUserId,
      matterTypeId,
    });
    expect(consultation.status).toBe(201);
    const created = await readJson<{ matterId: string; consultationNumber: string | null }>(
      consultation,
    );
    const { matterId } = created;
    expect(created.consultationNumber).toBeNull();
    const other = await send("POST", "/api/v1/matters", {
      title: "Untyped consultation",
      status: "intake",
      responsibleMemberId: ownerUserId,
    });
    const { matterId: otherId } = (await other.json()) as { matterId: string };

    const checklist = await get(`/api/v1/matters/${matterId}/intake`);
    expect(checklist.status).toBe(200);
    const listed = (await checklist.json()) as Checklist;
    expect(listed.matterStatus).toBe("intake");
    expect(listed.outstandingRequired).toBe(2);
    expect(
      listed.steps.map((step) => [step.kind, step.standing.answeredBy, step.recordable]),
    ).toEqual([
      ["conflicts-check", "subsystem", false],
      ["identity-verification", "nobody", true],
      ["acknowledgement", "nobody", true],
    ]);
    expect(listed.steps[0]?.standing.statement).toBe(
      "A conflicts check has not yet run on this matter.",
    );

    const unbound = (await (await get(`/api/v1/matters/${otherId}/intake`)).json()) as Checklist;
    expect(unbound.steps).toEqual([]);

    // The readiness read and the graduation agree: refused, naming both outstanding steps. An
    // intake cannot skip to open either — it has to become a consultation first.
    const readiness = await get(`/api/v1/matters/${matterId}/graduate-readiness`);
    expect(readiness.status).toBe(200);
    const readinessBody = (await readiness.json()) as {
      graduable: boolean;
      blockers: { code: string; message: string }[];
    };
    expect(readinessBody.graduable).toBe(false);
    expect(readinessBody.blockers.map((blocker) => blocker.code)).toEqual([
      "intake-step-outstanding",
      "intake-step-outstanding",
    ]);
    const refusedGraduation = await send("POST", `/api/v1/matters/${matterId}/graduate`, {});
    expect(refusedGraduation.status).toBe(409);
    const refusal = (await refusedGraduation.json()) as {
      type: string;
      errors: { code: string; detail: string }[];
    };
    expect(refusal.type).toContain("matter-graduate-refused");
    expect(refusal.errors.length).toBe(2);
    expect(refusal.errors[1]?.detail).toContain("Verify the client's identity");
    const openedTooEarly = await send("POST", `/api/v1/matters/${matterId}/open`, {});
    expect(openedTooEarly.status).toBe(409);
    const openReadiness = await readJson<{ openable: boolean; blockers: { code: string }[] }>(
      await get(`/api/v1/matters/${matterId}/open-readiness`),
    );
    expect(openReadiness.openable).toBe(false);
    expect(openReadiness.blockers[0]?.code).toBe("matter-not-consultation");

    // The paralegal records identity; the conflicts step cannot be recorded by hand, and the
    // paralegal may not waive it.
    const recordedByParalegal = await send(
      "POST",
      `/api/v1/matters/${matterId}/intake/steps/${stepIds[1]}/completion`,
      { note: "Driving licence sighted" },
      paralegalCookie,
    );
    expect(recordedByParalegal.status).toBe(201);
    const handRecordedConflicts = await send(
      "POST",
      `/api/v1/matters/${matterId}/intake/steps/${stepIds[0]}/completion`,
      {},
    );
    expect(handRecordedConflicts.status).toBe(409);
    const paralegalWaiver = await send(
      "POST",
      `/api/v1/matters/${matterId}/intake/steps/${stepIds[0]}/waiver`,
      { rationale: "Existing client" },
      paralegalCookie,
    );
    expect(paralegalWaiver.status).toBe(403);

    // The owner waives the conflicts step with a rationale; an empty one is refused.
    const emptyWaiver = await send(
      "POST",
      `/api/v1/matters/${matterId}/intake/steps/${stepIds[0]}/waiver`,
      { rationale: "" },
    );
    expect(emptyWaiver.status).toBe(422);
    const waived = await send(
      "POST",
      `/api/v1/matters/${matterId}/intake/steps/${stepIds[0]}/waiver`,
      {
        rationale: "Existing client; the comprehensive check ran on the related matter last week.",
      },
    );
    expect(waived.status).toBe(201);

    const answered = (await (await get(`/api/v1/matters/${matterId}/intake`)).json()) as Checklist;
    expect(answered.outstandingRequired).toBe(0);
    expect(answered.steps[0]?.standing.statement).toContain("Waived:");
    expect(answered.steps[1]?.standing.statement).toBe(
      "Recorded as completed: Driving licence sighted",
    );

    // Reopening the identity step supersedes its record and the graduation is refused again;
    // recording it again answers it, and the history keeps both records.
    const reopened = await send(
      "DELETE",
      `/api/v1/matters/${matterId}/intake/steps/${stepIds[1]}/record`,
      undefined,
    );
    expect(reopened.status).toBe(200);
    const afterReopen = await readJson<{ graduable: boolean }>(
      await get(`/api/v1/matters/${matterId}/graduate-readiness`),
    );
    expect(afterReopen.graduable).toBe(false);
    const again = await send(
      "POST",
      `/api/v1/matters/${matterId}/intake/steps/${stepIds[1]}/completion`,
      {},
    );
    expect(again.status).toBe(201);
    const history = (await (await get(`/api/v1/matters/${matterId}/intake`)).json()) as Checklist;
    expect(history.history.map((record) => [record.outcome, record.supersededAt !== null])).toEqual(
      [
        ["completed", true],
        ["waived", false],
        ["completed", false],
      ],
    );

    // The intake is complete: it graduates, drawing its consultation number, and a second
    // graduation is refused because it is no longer an intake.
    const graduated = await send("POST", `/api/v1/matters/${matterId}/graduate`, {});
    expect(graduated.status).toBe(200);
    expect((await readJson<{ consultationNumber: string }>(graduated)).consultationNumber).toMatch(
      /^C\d{4}-\d{4}$/,
    );
    const graduatedAgain = await send("POST", `/api/v1/matters/${matterId}/graduate`, {});
    expect(graduatedAgain.status).toBe(409);

    // The intake ended: a record on a consultation is refused, the checklist still reads, and the
    // consultation opens on the firm's decision with no further intake gate.
    const late = await send(
      "POST",
      `/api/v1/matters/${matterId}/intake/steps/${stepIds[2]}/completion`,
      {},
    );
    expect(late.status).toBe(409);
    const asConsultation = await readJson<Checklist>(
      await get(`/api/v1/matters/${matterId}/intake`),
    );
    expect(asConsultation.matterStatus).toBe("consultation");
    const opened = await send("POST", `/api/v1/matters/${matterId}/open`, {});
    expect(opened.status).toBe(200);
    expect((await readJson<{ matterNumber: string }>(opened)).matterNumber).toMatch(
      /^\d{4}-\d{4}$/,
    );
    const afterOpen = (await (await get(`/api/v1/matters/${matterId}/intake`)).json()) as Checklist;
    expect(afterOpen.matterStatus).toBe("open");
  });

  it("refuses authoring to a member without the manage permission, and a second procedure of the same name", async () => {
    const byParalegal = await send(
      "POST",
      "/api/v1/intake-procedures",
      { name: "Paralegal procedure", matterTypeId: null },
      paralegalCookie,
    );
    expect(byParalegal.status).toBe(403);
    const first = await send("POST", "/api/v1/intake-procedures", {
      name: "Every consultation",
      matterTypeId: null,
    });
    expect(first.status).toBe(201);
    const duplicate = await send("POST", "/api/v1/intake-procedures", {
      name: "Every consultation",
      matterTypeId: null,
    });
    expect(duplicate.status).toBe(409);
    const { id } = (await first.json()) as { id: string };
    const off = await send("PUT", `/api/v1/intake-procedures/${id}/active`, { active: false });
    expect(off.status).toBe(200);
    const list = (await (await get("/api/v1/intake-procedures")).json()) as {
      data: { id: string }[];
    };
    expect(list.data.some((row) => row.id === id)).toBe(false);
    const all = (await (await get("/api/v1/intake-procedures?includeInactive=true")).json()) as {
      data: { id: string }[];
    };
    expect(all.data.some((row) => row.id === id)).toBe(true);
  });

  it("lists every consultation in flight on the desk, with who it is for, where it stands, and whether it is scheduled", async () => {
    const type = await send("POST", "/api/v1/matter-types", { name: "Estate planning" });
    expect(type.status).toBe(201);
    const { id: matterTypeId } = await readJson<{ id: string }>(type);
    const procedure = await send("POST", "/api/v1/intake-procedures", {
      name: "Estate intake",
      matterTypeId,
    });
    expect(procedure.status).toBe(201);
    const { id: procedureId } = await readJson<{ id: string }>(procedure);
    for (const step of [
      { kind: "conflicts-check", title: "Run the conflicts check" },
      { kind: "client-forms", title: "Send the estate questionnaire", required: false },
    ]) {
      const added = await send("POST", `/api/v1/intake-procedures/${procedureId}/steps`, step);
      expect(added.status).toBe(201);
    }

    const person = await send("POST", "/api/v1/directory/persons", {
      given: "Rosalind",
      family: "Chase",
    });
    expect(person.status).toBe(201);
    const { id: clientEntityId } = await readJson<{ id: string }>(person);
    const consultation = await send("POST", "/api/v1/matters", {
      title: "Chase estate consultation",
      status: "intake",
      responsibleMemberId: ownerUserId,
      matterTypeId,
      clientEntityId,
      clientDisplayName: "Rosalind Chase",
    });
    expect(consultation.status).toBe(201);
    const { matterId } = await readJson<{ matterId: string }>(consultation);

    // Nothing scheduled yet: the desk says so.
    interface DeskRow {
      matterId: string;
      status: string;
      title: string;
      matterTypeName: string | null;
      responsibleMemberName: string | null;
      clientEntityId: string | null;
      clientDisplayName: string | null;
      isStale: boolean;
      checklist: { bound: boolean; steps: number; answered: number; outstandingRequired: number };
      nextConsultation: { eventId: string; title: string; startsOn: string } | null;
    }
    interface Desk {
      data: DeskRow[];
      nextCursor: string | null;
    }
    const before = await readJson<Desk>(await get("/api/v1/intake/consultations"));
    const unscheduled = before.data.find((row) => row.matterId === matterId);
    expect(unscheduled).toMatchObject({
      status: "intake",
      title: "Chase estate consultation",
      matterTypeName: "Estate planning",
      responsibleMemberName: "Intake Owner",
      clientEntityId,
      clientDisplayName: "Rosalind Chase",
      isStale: false,
      checklist: { bound: true, steps: 2, answered: 0, outstandingRequired: 1 },
      nextConsultation: null,
    });
    // An intake whose kind no procedure binds is on the desk and says it is unbound; the matter
    // the first test opened has left it.
    const unbound = before.data.find((row) => row.title === "Untyped consultation");
    expect(unbound?.checklist).toEqual({
      bound: false,
      steps: 0,
      answered: 0,
      outstandingRequired: 0,
    });
    expect(before.data.some((row) => row.title === "Herrera consultation")).toBe(false);

    // The consultation is scheduled: the desk carries the next setting.
    const tomorrow = civilDateOf(new Date(Date.now() + 86_400_000));
    const scheduled = await send("POST", `/api/v1/matters/${matterId}/events`, {
      title: "Consultation with Rosalind Chase",
      startsOn: tomorrow,
      startsAtTime: "10:00",
      timeZone: "America/Los_Angeles",
    });
    expect(scheduled.status).toBe(201);
    const after = await readJson<Desk>(await get("/api/v1/intake/consultations?search=Chase"));
    expect(after.data.map((row) => row.matterId)).toEqual([matterId]);
    expect(after.data[0]?.nextConsultation).toMatchObject({
      title: "Consultation with Rosalind Chase",
      startsOn: tomorrow,
    });
    const none = await readJson<Desk>(await get("/api/v1/intake/consultations?search=Zzzz"));
    expect(none.data).toEqual([]);

    // The desk is behind intake:read, which every working seat holds.
    const byParalegal = await get("/api/v1/intake/consultations", paralegalCookie);
    expect(byParalegal.status).toBe(200);
  });
});
