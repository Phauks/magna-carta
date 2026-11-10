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

// The consolidated matter search, driven through the real chokepoint against real per-firm rows.
//
// Two things only this suite can prove, because both are properties of the WHOLE path rather than of
// the search package: that the second permission gate is the chokepoint's own resolved capability
// set and not a set the handler assembled for itself, and that a second firm's matter answers a
// reserved 404 rather than a search.

let firmId: FirmId;
let otherFirmId: FirmId;
let ownerCookie: string;
let billingCookie: string;
let ownerUserId: UserId;
let matterId: string;
let otherFirmMatterId: string;

interface SearchHit {
  readonly id: string;
  readonly title: string;
  readonly snippet: string | null;
  readonly secondary: string | null;
  readonly link: string;
}

interface SearchGroup {
  readonly source: string;
  readonly section: string;
  readonly matchedFields: readonly string[];
  readonly hits: readonly SearchHit[];
  readonly hasMore: boolean;
  readonly skipped: string | null;
}

interface SearchAnswer {
  readonly matterId: string;
  readonly query: string;
  readonly groups: readonly SearchGroup[];
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

async function search(query: string, extra = "", cookie = ownerCookie): Promise<SearchAnswer> {
  const response = await get(
    `/api/v1/matters/${matterId}/search?q=${encodeURIComponent(query)}${extra}`,
    cookie,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return jsonOf<SearchAnswer>(response);
}

function group(answer: SearchAnswer, key: string): SearchGroup {
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

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Matter Search Firm" })).firmId;
  await seedFirmKey(firmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(firmId, "matter-search-firm-bucket")
    .run();

  const owner = await seedCredentialedUser("matter-search-owner@example.com", {
    userName: "Matter Search Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Matter Search Owner", firmId);
  ownerCookie = await signInForSessionCookie("matter-search-owner@example.com");

  // A Billing seat holds search:matter (every default role does) and holds neither notes:read nor
  // custody:read. It is the seat that proves the second gate does real work.
  const billing = await seedCredentialedUser("matter-search-billing@example.com", {
    userName: "Matter Search Billing",
    firmId,
  });
  await mirrorMemberWithRole(billing.userId, "Matter Search Billing", "Billing");
  billingCookie = await signInForSessionCookie("matter-search-billing@example.com");

  const scheme = await put("/api/v1/numbering-scheme", {
    segments: [
      { kind: "literal", text: "MS-" },
      { kind: "counter", padWidth: 4 },
    ],
  });
  expect(scheme.status, await scheme.clone().text()).toBe(200);

  const matter = await post("/api/v1/matters", {
    title: "Ashgrove easement dispute",
    status: "open",
    responsibleMemberId: ownerUserId,
    clientDisplayName: "Devon Marchetti",
  });
  expect(matter.status, await matter.clone().text()).toBe(201);
  matterId = (await jsonOf<{ matterId: string }>(matter)).matterId;

  const note = await post(`/api/v1/matters/${matterId}/notes`, {
    body: "The easement runs along the eastern boundary and was never registered.",
  });
  expect(note.status, await note.clone().text()).toBe(201);

  const unrelated = await post(`/api/v1/matters/${matterId}/notes`, {
    body: "Client prefers afternoon calls.",
  });
  expect(unrelated.status, await unrelated.clone().text()).toBe(201);

  // A second firm holding a matter with the same words in it. Nothing this firm's session does may
  // reach it, and the refusal must be the reserved 404 rather than a 403 that confirms it exists.
  otherFirmId = (await seedFirm({ name: "Other Firm" })).firmId;
  await seedFirmKey(otherFirmId);
  const otherOwner = await seedCredentialedUser("matter-search-other@example.com", {
    userName: "Other Firm Owner",
    firmId: otherFirmId,
  });
  await mirrorMemberWithOwnerRole(otherOwner.userId, "Other Firm Owner", otherFirmId);
  const otherCookie = await signInForSessionCookie("matter-search-other@example.com");
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
  const otherMatter = await post(
    "/api/v1/matters",
    {
      title: "Someone else's easement",
      status: "open",
      responsibleMemberId: otherOwner.userId,
      clientDisplayName: "Not Our Client",
    },
    otherCookie,
  );
  expect(otherMatter.status, await otherMatter.clone().text()).toBe(201);
  otherFirmMatterId = (await jsonOf<{ matterId: string }>(otherMatter)).matterId;
});

describe("one query, answered from every section the member may read", () => {
  it("returns a group per source with the matter's own section slugs", async () => {
    const answer = await search("easement");
    // The whole registry answers, in its own order. Listed rather than derived here on purpose:
    // this is the WIRE contract seen from outside the worker, and a client reading these keys is
    // entitled to have a change in them show up as a test edit rather than pass silently.
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
    expect(group(answer, "notes").section).toBe("notes");
    expect(group(answer, "custody").section).toBe("custodian");
    // The source key and the section slug differ here, which is the case this assertion exists to
    // catch: the source is named for what it holds and the section for what a reader calls the tab.
    expect(group(answer, "communications").section).toBe("messaging");
    // Two sources answer in the Files section: the names, and the words inside the files.
    expect(group(answer, "file-contents").section).toBe("files");
  });

  it("says the words inside files are not connected while no search service is bound", async () => {
    // The test pool binds no search service. That has to read as "not switched on yet", never as
    // "no file contains this word", and it must not take the rest of the answer down with it.
    const answer = await search("easement");
    expect(group(answer, "file-contents").skipped).toBe("engine-not-connected");
    expect(group(answer, "file-contents").hits).toEqual([]);
    expect(group(answer, "notes").hits).toHaveLength(1);
  });

  it("finds the note and carries its words and a link into the Notes tab", async () => {
    const answer = await search("easement");
    const notes = group(answer, "notes");
    expect(notes.hits).toHaveLength(1);
    expect(notes.hits[0]?.snippet).toContain("eastern boundary");
    expect(notes.hits[0]?.link).toBe(`/matters/${matterId}/notes?entry=${notes.hits[0]?.id}`);
  });

  it("says what each source matched on, so a hit never has to be guessed at", async () => {
    const answer = await search("easement");
    expect(group(answer, "notes").matchedFields).toEqual(["the note's text"]);
    // Two fields, because the Files group answers for the matter's folders as well as its files —
    // and a reader has to be told that, or a folder in the results reads as a file.
    expect(group(answer, "files").matchedFields).toEqual(["file names", "folder names"]);
  });

  it("answers nothing for a word the matter does not hold, without skipping anything", async () => {
    const answer = await search("zoning");
    for (const entry of answer.groups) {
      expect(entry.hits).toEqual([]);
      // The one source that reads an index outside the database says it could not; see above.
      if (entry.source !== "file-contents") expect(entry.skipped).toBeNull();
    }
  });
});

describe("the scope narrows the registry", () => {
  it("answers only the named source", async () => {
    const answer = await search("easement", "&in=notes");
    expect(answer.groups).toHaveLength(1);
    expect(answer.groups[0]?.source).toBe("notes");
  });

  it("takes the parameter repeated", async () => {
    const answer = await search("easement", "&in=notes&in=files");
    expect(answer.groups.map((entry) => entry.source)).toEqual(["files", "notes"]);
  });
});

describe("the second permission gate is the chokepoint's own capability set", () => {
  it("withholds the sources a Billing seat may not read, and says which", async () => {
    const answer = await search("easement", "", billingCookie);
    // A Billing seat is withheld notes:read and nothing else here — a note is the firm's candid
    // assessment of a case, which is the deliberate contrast with custody:read reaching every seat.
    // So this asserts BOTH halves: the withheld source says why, and the seat's other sources still
    // answer. If they did not, this test would pass on a route that simply returned nothing.
    expect(group(answer, "notes").skipped).toBe("permission");
    expect(group(answer, "notes").hits).toEqual([]);
    expect(group(answer, "custody").skipped).toBeNull();
    expect(group(answer, "files").skipped).toBeNull();
    expect(group(answer, "parties").skipped).toBeNull();
  });

  it("returns no note body to a seat without notes:read, on any scope", async () => {
    // Naming the source explicitly is the request that would bypass a gate applied to the default
    // scope alone. It is refused the same way.
    const answer = await search("easement", "&in=notes", billingCookie);
    expect(answer.groups[0]?.skipped).toBe("permission");
    expect(JSON.stringify(answer)).not.toContain("eastern boundary");
  });
});

describe("a search cannot leave the firm or the matter", () => {
  it("reaches nothing of another firm's matter", async () => {
    // 200 with nothing in it, not 404, and that is the SIBLING behaviour rather than a decision
    // this route makes: the matter's own list reads (notes among them) answer an empty page for a
    // matter id their firm does not hold, because the database the handler resolves is the SESSION'S
    // firm and the path value only ever selects within it. The security property is what is asserted
    // here — no row of the other firm's matter is reachable — and 404-vs-200 discloses nothing
    // either way, since an id that never existed anywhere answers identically.
    const response = await get(`/api/v1/matters/${otherFirmMatterId}/search?q=easement`);
    expect(response.status).toBe(200);
    const answer = await jsonOf<SearchAnswer>(response);
    expect(answer.groups.flatMap((entry) => entry.hits)).toEqual([]);
  });

  it("requires a session", async () => {
    const response = await SELF.fetch(
      `https://example.com/api/v1/matters/${matterId}/search?q=easement`,
      { headers: { origin: "https://example.com" } },
    );
    expect(response.status).toBe(401);
  });

  it("refuses a query longer than the contract admits rather than truncating it", async () => {
    // A caller that asked for something and quietly got something narrower cannot tell that from a
    // matter with nothing in it, which is the same reasoning the calendar's window cap carries.
    const response = await get(`/api/v1/matters/${matterId}/search?q=${"x".repeat(201)}`);
    expect(response.status).toBe(422);
  });
});

describe("a query too short to answer says so", () => {
  it("marks every source skipped rather than returning an empty answer", async () => {
    const answer = await search("e");
    for (const entry of answer.groups) {
      expect(entry.skipped).toBe("query-too-short");
    }
  });
});
