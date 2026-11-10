import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The search across matters, driven through the real chokepoint against a real firm database.
//
// Three things only this suite can prove. The statement form the read is built on (the newest
// matches of the record index, capped, then joined to their own tables) runs in a firm's real
// storage, which refuses shapes plain SQLite in a package test accepts. The second permission gate
// is the chokepoint's own resolved capability set. And the reach ends at the session's firm: a
// second firm holding the same words is not in the answer.

let firmId: FirmId;
let ownerCookie: string;
let billingCookie: string;
let ownerUserId: UserId;
let firstMatterId: string;
let secondMatterId: string;

interface Hit {
  readonly id: string;
  readonly title: string;
  readonly snippet: string | null;
  readonly link: string;
  readonly matter: { readonly id: string; readonly title: string; readonly number: string | null };
}

interface Group {
  readonly source: string;
  readonly section: string;
  readonly matchedFields: readonly string[];
  readonly hits: readonly Hit[];
  readonly hasMore: boolean;
  readonly skipped: string | null;
}

interface Answer {
  readonly query: string;
  readonly broad: boolean;
  readonly groups: readonly Group[];
}

async function post(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

async function put(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function jsonOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function search(query: string, extra = "", cookie = ownerCookie): Promise<Answer> {
  const response = await get(`/api/v1/search?q=${encodeURIComponent(query)}${extra}`, cookie);
  expect(response.status, await response.clone().text()).toBe(200);
  return jsonOf<Answer>(response);
}

function group(answer: Answer, key: string): Group {
  const found = answer.groups.find((candidate) => candidate.source === key);
  if (found === undefined) throw new Error(`no group for source ${key}`);
  return found;
}

async function mirrorMemberWithRole(
  userId: UserId,
  displayName: string,
  roleName: string,
): Promise<void> {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
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

async function openMatter(
  title: string,
  clientDisplayName: string,
  responsibleMemberId: string,
  cookie = ownerCookie,
): Promise<string> {
  const matter = await post(
    "/api/v1/matters",
    { title, status: "open", responsibleMemberId, clientDisplayName },
    cookie,
  );
  expect(matter.status, await matter.clone().text()).toBe(201);
  return (await jsonOf<{ matterId: string }>(matter)).matterId;
}

// A note is ordered by the day it is about, so the tests that read an order say the day.
async function writeNote(
  matterId: string,
  body: string,
  occurredOn: string,
  cookie = ownerCookie,
): Promise<void> {
  const note = await post(`/api/v1/matters/${matterId}/notes`, { body, occurredOn }, cookie);
  expect(note.status, await note.clone().text()).toBe(201);
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Across Matters Firm" })).firmId;
  await seedFirmKey(firmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(firmId, "across-matters-firm-bucket")
    .run();
  const owner = await seedCredentialedUser("across-matters-owner@example.com", {
    userName: "Across Matters Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Across Matters Owner", firmId);
  ownerCookie = await signInForSessionCookie("across-matters-owner@example.com");

  // A Billing seat holds search:matter (every default role does) and does not hold notes:read. It
  // is the seat that proves the second gate does real work on this route as on a matter's own.
  const billing = await seedCredentialedUser("across-matters-billing@example.com", {
    userName: "Across Matters Billing",
    firmId,
  });
  await mirrorMemberWithRole(billing.userId, "Across Matters Billing", "Billing");
  billingCookie = await signInForSessionCookie("across-matters-billing@example.com");

  const scheme = await put("/api/v1/numbering-scheme", {
    segments: [
      { kind: "literal", text: "AM-" },
      { kind: "counter", padWidth: 4 },
    ],
  });
  expect(scheme.status, await scheme.clone().text()).toBe(200);

  firstMatterId = await openMatter("Ashgrove easement dispute", "Devon Marchetti", ownerUserId);
  secondMatterId = await openMatter("Harrow Lane purchase", "Imani Okafor", ownerUserId);
  await writeNote(
    firstMatterId,
    "The easement runs along the eastern boundary and was never registered.",
    "2026-06-04",
  );
  await writeNote(firstMatterId, "Client prefers afternoon calls.", "2026-06-05");
  await writeNote(
    secondMatterId,
    "Seller disclosed a drainage easement across the rear of the lot.",
    "2026-07-11",
  );

  // A second firm holding a matter with the same word in a note. Nothing this firm's session asks
  // may return it.
  const otherFirmId = (await seedFirm({ name: "Other Firm" })).firmId;
  await seedFirmKey(otherFirmId);
  const otherOwner = await seedCredentialedUser("across-matters-other@example.com", {
    userName: "Other Firm Owner",
    firmId: otherFirmId,
  });
  await mirrorMemberWithOwnerRole(otherOwner.userId, "Other Firm Owner", otherFirmId);
  const otherCookie = await signInForSessionCookie("across-matters-other@example.com");
  const otherScheme = await put(
    "/api/v1/numbering-scheme",
    {
      segments: [
        { kind: "literal", text: "OF-" },
        { kind: "counter", padWidth: 4 },
      ],
    },
    otherCookie,
  );
  expect(otherScheme.status, await otherScheme.clone().text()).toBe(200);
  const otherMatterId = await openMatter(
    "Someone else's easement",
    "Not Our Client",
    otherOwner.userId,
    otherCookie,
  );
  await writeNote(
    otherMatterId,
    "An easement belonging to another firm entirely.",
    "2026-08-01",
    otherCookie,
  );
});

describe("one question, answered from every matter the member may see", () => {
  it("finds the same word on two matters and names each hit's matter", async () => {
    const answer = await search("easement");
    const notes = group(answer, "notes");
    expect(notes.skipped).toBeNull();
    expect(notes.hits).toHaveLength(2);
    const byMatter = new Map(notes.hits.map((hit) => [hit.matter.id, hit]));
    const first = byMatter.get(firstMatterId);
    const second = byMatter.get(secondMatterId);
    expect(first?.matter.title).toBe("Ashgrove easement dispute");
    expect(first?.snippet).toContain("eastern boundary");
    expect(second?.matter.title).toBe("Harrow Lane purchase");
    expect(second?.snippet).toContain("drainage");
    // The number is the one the matter wears today, read from the matter and not from the hit.
    expect(first?.matter.number).toMatch(/^AM-\d{4}$/);
    expect(second?.matter.number).toMatch(/^AM-\d{4}$/);
    expect(first?.matter.number).not.toBe(second?.matter.number);
  });

  it("links each hit into its own section on its own matter", async () => {
    const answer = await search("easement");
    for (const hit of group(answer, "notes").hits) {
      expect(hit.link).toBe(`/matters/${hit.matter.id}/notes?entry=${hit.id}`);
    }
  });

  it("answers the newest record first", async () => {
    const answer = await search("easement");
    expect(group(answer, "notes").hits.map((hit) => hit.matter.id)).toEqual([
      secondMatterId,
      firstMatterId,
    ]);
  });

  it("finds a matter's files and folders by name, which reads no index", async () => {
    // Nothing was uploaded, so this proves the statement runs in the firm's storage and answers
    // an empty group, and not that a file was found.
    const answer = await search("easement", "&in=files");
    expect(group(answer, "files").skipped).toBeNull();
    expect(group(answer, "files").matchedFields).toEqual(["file names", "folder names"]);
  });

  it("is not marked broad for a word two records hold", async () => {
    expect((await search("easement")).broad).toBe(false);
  });

  it("answers nothing for a word no matter holds", async () => {
    const answer = await search("zoning");
    expect(answer.groups.flatMap((entry) => entry.hits)).toEqual([]);
    expect(answer.broad).toBe(false);
  });
});

describe("the answer says what it did not look at", () => {
  it("names the places that are searched inside a matter and not across them", async () => {
    const answer = await search("easement");
    // Listed and not derived, because this is the wire contract seen from outside the worker: a
    // place that starts answering across matters should show up here as a test edit.
    expect(
      answer.groups
        .filter((entry) => entry.skipped === "one-matter-only")
        .map((entry) => entry.source),
    ).toEqual(["file-contents", "billing", "parties", "calendar", "custody"]);
    for (const entry of answer.groups) {
      if (entry.skipped === "one-matter-only") expect(entry.hits).toEqual([]);
    }
  });

  it("answers a group for every place, in the order a matter's sections read in", async () => {
    const answer = await search("easement");
    expect(answer.groups.map((entry) => entry.source)).toEqual([
      "files",
      "file-contents",
      "time",
      "costs",
      "billing",
      "parties",
      "calendar",
      "notes",
      "custody",
      "communications",
    ]);
  });

  it("narrows to the named places", async () => {
    const answer = await search("easement", "&in=notes&in=files");
    expect(answer.groups.map((entry) => entry.source)).toEqual(["files", "notes"]);
  });
});

describe("the second permission gate is the chokepoint's own capability set", () => {
  it("withholds notes from a Billing seat and says so, while its other places still answer", async () => {
    const answer = await search("easement", "", billingCookie);
    expect(group(answer, "notes").skipped).toBe("permission");
    expect(group(answer, "notes").hits).toEqual([]);
    expect(group(answer, "files").skipped).toBeNull();
  });

  it("returns no note body to a seat without notes:read, on any scope", async () => {
    const answer = await search("easement", "&in=notes", billingCookie);
    expect(answer.groups[0]?.skipped).toBe("permission");
    const wire = JSON.stringify(answer);
    expect(wire).not.toContain("eastern boundary");
    expect(wire).not.toContain("drainage");
  });
});

describe("the reach ends at the session's firm", () => {
  it("returns nothing of another firm's matter holding the same word", async () => {
    const answer = await search("easement");
    const wire = JSON.stringify(answer);
    expect(wire).not.toContain("another firm entirely");
    expect(wire).not.toContain("Someone else's easement");
    for (const hit of answer.groups.flatMap((entry) => entry.hits)) {
      expect([firstMatterId, secondMatterId]).toContain(hit.matter.id);
    }
  });

  it("requires a session", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/search?q=easement", {
      headers: { origin: "https://example.com" },
    });
    expect(response.status).toBe(401);
  });

  it("refuses a question longer than the contract admits instead of truncating it", async () => {
    const response = await get(`/api/v1/search?q=${"a".repeat(201)}`);
    expect(response.status).toBe(422);
  });

  it("treats a reader's punctuation as text and never as match syntax", async () => {
    const answer = await search('easement" OR matter:*');
    expect(answer.groups.flatMap((entry) => entry.hits).length).toBeLessThanOrEqual(2);
  });
});
