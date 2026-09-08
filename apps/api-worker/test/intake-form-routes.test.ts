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

/*
 * The public intake form, driven through the chokepoint over real Miniflare bindings.
 *
 * THE ASSERTIONS THAT MATTER MOST ARE THE ONES ABOUT WHAT THE ANONYMOUS ROUTES DO NOT REVEAL, and
 * they cannot be made anywhere but here. A unit test can prove the resolver returns `undefined` for
 * a draft form; only a request through the real route can prove that a draft form, a closed form, a
 * rotated token, a token that never existed and a firm that does not exist are indistinguishable to
 * somebody on the internet — which is the property the whole feature rests on, and the one a
 * well-meaning change to a handler would break without failing anything else.
 */

let poolFirmId: FirmId;
let ownerCookie: string;
let paralegalCookie: string;

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
  poolFirmId = (await seedFirm({ name: "Intake Form Test Firm" })).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("form-owner@example.com", {
    userName: "Form Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Form Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("form-owner@example.com");

  const paralegal = await seedCredentialedUser("form-paralegal@example.com", {
    userName: "Form Paralegal",
    firmId: poolFirmId,
  });
  await mirrorMemberWithRole(paralegal.userId, "Form Paralegal", "Paralegal");
  paralegalCookie = await signInForSessionCookie("form-paralegal@example.com");
});

function send(method: string, path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

/** The anonymous surface: no cookie, ever. A credential here would invalidate every assertion. */
function anonymous(method: string, path: string, body?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: { "content-type": "application/json", origin: "https://example.com" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface FormDetail {
  id: string;
  status: string;
  publicToken: string;
  fields: { id: string; label: string; kind: string; required: boolean }[];
}

async function authorPublishedForm(name: string): Promise<FormDetail> {
  const created = await send("POST", "/api/v1/intake-forms", {
    name,
    title: "Tell us what happened",
  });
  expect(created.status).toBe(201);
  const { id } = await readJson<{ id: string }>(created);

  const addedName = await send("POST", `/api/v1/intake-forms/${id}/fields`, {
    kind: "person-name",
    label: "Your name",
    required: true,
  });
  expect(addedName.status).toBe(201);

  const addedStory = await send("POST", `/api/v1/intake-forms/${id}/fields`, {
    kind: "matter-description",
    label: "What happened",
  });
  expect(addedStory.status).toBe(201);

  const published = await send("POST", `/api/v1/intake-forms/${id}/publication`, undefined);
  expect(published.status).toBe(200);

  return readJson<FormDetail>(await get(`/api/v1/intake-forms/${id}`));
}

describe("what the anonymous routes refuse to distinguish", () => {
  it("answers a real form, a draft, a closed form and an invented token identically", async () => {
    const live = await authorPublishedForm("Live form");

    const draftCreated = await send("POST", "/api/v1/intake-forms", {
      name: "Never published",
      title: "Draft",
    });
    const draft = await readJson<FormDetail>(
      await get(`/api/v1/intake-forms/${(await readJson<{ id: string }>(draftCreated)).id}`),
    );

    const closedForm = await authorPublishedForm("Closed form");
    const closed = await send("PUT", `/api/v1/intake-forms/${closedForm.id}/closed`, {
      closed: true,
    });
    expect(closed.status).toBe(200);

    const live200 = await anonymous(
      "GET",
      `/api/v1/public/intake-forms/${poolFirmId}/${live.publicToken}`,
    );
    expect(live200.status).toBe(200);

    // The four that must be one answer. A 404 for an unknown token beside a 403 for a closed one
    // turns the endpoint into an index of which forms a firm has and what state each is in.
    const refusals = await Promise.all([
      anonymous("GET", `/api/v1/public/intake-forms/${poolFirmId}/${draft.publicToken}`),
      anonymous("GET", `/api/v1/public/intake-forms/${poolFirmId}/${closedForm.publicToken}`),
      anonymous("GET", `/api/v1/public/intake-forms/${poolFirmId}/not-a-real-token`),
      anonymous("GET", `/api/v1/public/intake-forms/frm_000000000000000000000/anything`),
    ]);

    const bodies = await Promise.all(
      refusals.map(async (response) => {
        const problem = await readJson<{ type: string; title: string; detail?: string }>(response);
        return `${String(response.status)} ${problem.type} ${problem.title} ${problem.detail ?? ""}`;
      }),
    );

    expect(refusals.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    // Byte-for-byte the same sentence, not merely the same code.
    expect(new Set(bodies).size).toBe(1);
  });

  it("gives a submission the same answer whatever it contains", async () => {
    const form = await authorPublishedForm("Sameness form");
    const nameField = form.fields.find((one) => one.kind === "person-name");
    expect(nameField).toBeDefined();

    const first = await anonymous(
      "POST",
      `/api/v1/public/intake-forms/${poolFirmId}/${form.publicToken}/submissions`,
      { answers: { [nameField!.id]: "Somebody Nobody Has Heard Of" } },
    );
    const second = await anonymous(
      "POST",
      `/api/v1/public/intake-forms/${poolFirmId}/${form.publicToken}/submissions`,
      { answers: { [nameField!.id]: "Somebody Nobody Has Heard Of" } },
    );

    expect(first.status).toBe(202);
    // A repeat submission is a duplicate row triage dismisses, never a refusal that would reveal
    // the firm has heard from this person before.
    expect(second.status).toBe(202);
    expect(await first.text()).toBe(await second.text());
  });

  it("refuses a closed form's submission as though the form never existed", async () => {
    const form = await authorPublishedForm("Closing form");
    await send("PUT", `/api/v1/intake-forms/${form.id}/closed`, { closed: true });

    const refused = await anonymous(
      "POST",
      `/api/v1/public/intake-forms/${poolFirmId}/${form.publicToken}/submissions`,
      { answers: {} },
    );
    const invented = await anonymous(
      "POST",
      `/api/v1/public/intake-forms/${poolFirmId}/never-existed/submissions`,
      { answers: {} },
    );
    expect(refused.status).toBe(404);
    expect(await refused.text()).toBe(await invented.text());
  });

  it("rotating the link stops the old one resolving and keeps what arrived", async () => {
    const form = await authorPublishedForm("Rotating form");
    const nameField = form.fields.find((one) => one.kind === "person-name")!;

    await anonymous(
      "POST",
      `/api/v1/public/intake-forms/${poolFirmId}/${form.publicToken}/submissions`,
      { answers: { [nameField.id]: "Before the rotation" } },
    );

    const rotated = await send(
      "POST",
      `/api/v1/intake-forms/${form.id}/token-rotations`,
      undefined,
    );
    expect(rotated.status).toBe(200);
    const { publicToken } = await readJson<{ publicToken: string }>(rotated);
    expect(publicToken).not.toBe(form.publicToken);

    const old = await anonymous(
      "GET",
      `/api/v1/public/intake-forms/${poolFirmId}/${form.publicToken}`,
    );
    const fresh = await anonymous("GET", `/api/v1/public/intake-forms/${poolFirmId}/${publicToken}`);
    expect(old.status).toBe(404);
    expect(fresh.status).toBe(200);

    // The submission the old link took is still the firm's, which is the whole point of rotating
    // rather than deleting.
    const queue = await readJson<{ data: { id: string }[] }>(
      await get(`/api/v1/intake-forms/${form.id}/submissions`),
    );
    expect(queue.data).toHaveLength(1);
  });
});

describe("what a stranger may be told about their own input", () => {
  it("names a required question they left out", async () => {
    const form = await authorPublishedForm("Required form");
    const refused = await anonymous(
      "POST",
      `/api/v1/public/intake-forms/${poolFirmId}/${form.publicToken}/submissions`,
      { answers: {} },
    );
    expect(refused.status).toBe(422);
    const problem = await readJson<{ detail: string }>(refused);
    expect(problem.detail).toContain("Your name");
  });
});

describe("the firm's side", () => {
  it("shows a submission's answers under the questions as they were asked", async () => {
    const form = await authorPublishedForm("Freezing form");
    const nameField = form.fields.find((one) => one.kind === "person-name")!;

    await anonymous(
      "POST",
      `/api/v1/public/intake-forms/${poolFirmId}/${form.publicToken}/submissions`,
      { answers: { [nameField.id]: "Rowan Ashcroft" } },
    );

    // The firm rewords the question and republishes. What the visitor was asked must not move.
    const reworded = await send("PATCH", `/api/v1/intake-forms/${form.id}/fields/${nameField.id}`, {
      kind: "person-name",
      label: "Full legal name",
      required: true,
    });
    expect(reworded.status).toBe(200);
    expect((await send("POST", `/api/v1/intake-forms/${form.id}/publication`, undefined)).status)
      .toBe(200);

    const queue = await readJson<{ data: { id: string }[] }>(
      await get(`/api/v1/intake-forms/${form.id}/submissions`),
    );
    const detail = await readJson<{ answers: { label: string; value: string | null }[] }>(
      await get(`/api/v1/intake-forms/${form.id}/submissions/${queue.data[0]!.id}`),
    );
    expect(detail.answers.map((answer) => answer.label)).toContain("Your name");
    expect(detail.answers.map((answer) => answer.label)).not.toContain("Full legal name");
  });

  it("lets a paralegal work the queue but not republish the form", async () => {
    const form = await authorPublishedForm("Permission form");

    const queueRead = await get(`/api/v1/intake-forms/${form.id}/submissions`, paralegalCookie);
    expect(queueRead.status).toBe(200);

    const republish = await send(
      "POST",
      `/api/v1/intake-forms/${form.id}/publication`,
      undefined,
      paralegalCookie,
    );
    expect(republish.status).toBe(403);

    const rotate = await send(
      "POST",
      `/api/v1/intake-forms/${form.id}/token-rotations`,
      undefined,
      paralegalCookie,
    );
    expect(rotate.status).toBe(403);
  });

  it("records a triage decision and lets it be changed", async () => {
    const form = await authorPublishedForm("Triage form");
    const nameField = form.fields.find((one) => one.kind === "person-name")!;
    await anonymous(
      "POST",
      `/api/v1/public/intake-forms/${poolFirmId}/${form.publicToken}/submissions`,
      { answers: { [nameField.id]: "Someone Real" } },
    );

    const queue = await readJson<{ data: { id: string; triageState: string }[] }>(
      await get(`/api/v1/intake-forms/${form.id}/submissions`),
    );
    const submissionId = queue.data[0]!.id;
    expect(queue.data[0]!.triageState).toBe("new");

    const spam = await send(
      "PUT",
      `/api/v1/intake-forms/${form.id}/submissions/${submissionId}/triage`,
      { state: "spam" },
      paralegalCookie,
    );
    expect(spam.status).toBe(200);

    // The mistake a queue produces: something marked spam that turns out to be a real enquiry.
    const corrected = await send(
      "PUT",
      `/api/v1/intake-forms/${form.id}/submissions/${submissionId}/triage`,
      { state: "accepted", note: "Real enquiry, mis-marked" },
      paralegalCookie,
    );
    expect(corrected.status).toBe(200);

    const after = await readJson<{ triageState: string; triageNote: string | null }>(
      await get(`/api/v1/intake-forms/${form.id}/submissions/${submissionId}`),
    );
    expect(after.triageState).toBe("accepted");
    expect(after.triageNote).toBe("Real enquiry, mis-marked");
  });

  it("refuses to return a submission to the state it arrived in", async () => {
    const form = await authorPublishedForm("Un-look form");
    const nameField = form.fields.find((one) => one.kind === "person-name")!;
    await anonymous(
      "POST",
      `/api/v1/public/intake-forms/${poolFirmId}/${form.publicToken}/submissions`,
      { answers: { [nameField.id]: "Another Person" } },
    );
    const queue = await readJson<{ data: { id: string }[] }>(
      await get(`/api/v1/intake-forms/${form.id}/submissions`),
    );

    const refused = await send(
      "PUT",
      `/api/v1/intake-forms/${form.id}/submissions/${queue.data[0]!.id}/triage`,
      { state: "new" },
    );
    // A member who has looked cannot un-look, and a queue whose count can be reset means nothing.
    expect(refused.status).toBe(422);
  });

  it("refuses to publish a form with no questions", async () => {
    const created = await send("POST", "/api/v1/intake-forms", {
      name: "Empty form",
      title: "Nothing to answer",
    });
    const { id } = await readJson<{ id: string }>(created);
    const refused = await send("POST", `/api/v1/intake-forms/${id}/publication`, undefined);
    expect(refused.status).toBe(409);
  });
});
