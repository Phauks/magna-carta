import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOpenAPIDocument } from "../src/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Slice 1·3 directory route surface, driven through the chokepoint over real Miniflare bindings: the
// person/organization create+read, the name/identifier/edge/category writes, fuzzy search, duplicate
// candidates, merge, and the matter-party link — plus the protected sensitive-identifier read whose
// decrypt is gated by directory:viewSensitiveIdentifiers (a member without it is refused 403 by the
// chokepoint, before any decrypt). Mutations require an Idempotency-Key (the chokepoint gate).

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;

// Mirror a member carrying a named seeded role (the Read-only role grants no directory permission).
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
  poolFirmId = (
    await seedFirm({ name: "Directory Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await seedFirmKey(poolFirmId);

  const owner = await seedCredentialedUser("directory-owner@example.com", {
    userName: "Directory Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Directory Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("directory-owner@example.com");

  const readOnly = await seedCredentialedUser("directory-readonly@example.com", {
    userName: "Read Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithRole(readOnly.userId, "Read Only", "Read-only");
  readOnlyCookie = await signInForSessionCookie("directory-readonly@example.com");
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
async function put(path: string, body: unknown, cookie = ownerCookie, withKey = true) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PUT",
    headers: authHeaders(cookie, withKey),
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

// A POST that pins a caller-chosen Idempotency-Key (vs. the fresh-per-call key `post` mints), so a
// retry under the SAME key exercises the dedup path.
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

describe("directory person routes", () => {
  it("creates a person, reads it back, and finds it by fuzzy search", async () => {
    const created = await post("/api/v1/directory/persons", {
      given: "Catherine",
      family: "Smith",
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(id).toMatch(/^directoryPerson_/);

    const read = await get(`/api/v1/directory/persons/${id}`);
    expect(read.status).toBe(200);
    const person = (await read.json()) as { id: string; displayName: string };
    expect(person.id).toBe(id);
    expect(person.displayName).toBe("Catherine Smith");

    // Fuzzy trigram search tolerates a typo.
    const search = await get("/api/v1/directory/search?q=Cathrine");
    expect(search.status).toBe(200);
    const hits = (await search.json()) as { data: { entityId: string }[] };
    expect(hits.data.some((hit) => hit.entityId === id)).toBe(true);
  });

  it("requires an Idempotency-Key on the create mutation (400 without)", async () => {
    const response = await post(
      "/api/v1/directory/persons",
      { given: "No", family: "Key" },
      ownerCookie,
      false,
    );
    expect(response.status).toBe(400);
  });

  it("dedups a retried create under the same Idempotency-Key — one person, replayed response", async () => {
    const key = crypto.randomUUID();
    const body = { given: "Retry", family: "Dedup" };

    const first = await postWithFixedKey("/api/v1/directory/persons", body, key);
    expect(first.status).toBe(201);
    const { id: firstId } = (await first.json()) as { id: string };
    expect(first.headers.get("Idempotency-Replayed")).toBeNull();

    // The retry under the SAME key replays the stored response — byte-identical id, replay header set.
    const replay = await postWithFixedKey("/api/v1/directory/persons", body, key);
    expect(replay.status).toBe(201);
    const { id: replayId } = (await replay.json()) as { id: string };
    expect(replayId).toBe(firstId);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");

    // Exactly ONE person row was created across the two requests — true dedup, not a second insert.
    const countResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT COUNT(*) AS c FROM directory_person WHERE id = ?1")
      .bind(firstId)
      .all<{ c: number }>();
    const count = countResult.results[0];
    expect(count?.c).toBe(1);
  });
});

// Pronouns over HTTP. The route's job is to record a whole set or refuse, and to make the empty case
// an ordinary answer rather than an error — a person who has stated nothing is the common case.
describe("creating a whole person in one request", () => {
  it("records every section the draft carried, in one batch, and reads each back", async () => {
    const organization = await post("/api/v1/directory/organizations", {
      legalName: "Okafor Actuarial LLC",
    });
    const { id: organizationId } = (await organization.json()) as { id: string };

    const created = await post("/api/v1/directory/persons", {
      prefix: "Dr.",
      given: "Margaret",
      family: "Okafor",
      otherNames: [{ given: "Margaret", family: "Adeyemi", nameRole: "maiden" }],
      pronouns: {
        subject: "she",
        object: "her",
        possessiveDeterminer: "her",
        possessivePronoun: "hers",
        reflexive: "herself",
        verbNumber: "singular",
      },
      dateOfBirth: "1978-03-14",
      emails: [{ address: "m.okafor@example.com", contactUse: "work" }],
      phones: [
        { number: "+13125550148", contactUse: "mobile", countryRegionCode: "US" },
        {
          number: "+13125550190",
          contactSystem: "fax",
          contactUse: "work",
          countryRegionCode: "US",
        },
      ],
      identifiers: [
        { type: "ssn", number: "123456789" },
        {
          type: "account",
          label: "Cook County e-filing",
          number: "CC-2291-0087",
          username: "mokafor",
          secret: "hunter2",
        },
      ],
      organizations: [
        { organizationId, edgeType: "employment", personIs: "from", role: "Principal" },
      ],
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const person = (await (await get(`/api/v1/directory/persons/${id}`)).json()) as {
      displayName: string;
      pronouns: { subject: string } | null;
      dateOfBirth: string | null;
    };
    expect(person.displayName).toBe("Dr. Margaret Okafor");
    expect(person.pronouns?.subject).toBe("she");
    expect(person.dateOfBirth).toBe("1978-03-14");

    const points = (await (
      await get(`/api/v1/directory/entities/${id}/contact-points`)
    ).json()) as {
      emails: { address: string }[];
      phones: { contactSystem: string; countryCallingCode: string | null }[];
    };
    expect(points.emails.map((email) => email.address)).toEqual(["m.okafor@example.com"]);
    expect(points.phones.map((phone) => phone.contactSystem).toSorted()).toEqual(["fax", "voice"]);
    expect(points.phones[0]?.countryCallingCode).toBe("1");

    const identifiers = (await (
      await get(`/api/v1/directory/entities/${id}/identifiers`)
    ).json()) as {
      data: { type: string; label: string | null }[];
    };
    expect(
      identifiers.data.map((record) => `${record.type}:${record.label ?? ""}`).toSorted(),
    ).toEqual(["account:Cook County e-filing", "ssn:"]);
    const account = (await (
      await get(`/api/v1/directory/entities/${id}/identifiers/account`)
    ).json()) as {
      value: string | null;
      username?: string | null;
      secret?: string | null;
    };
    expect(account).toEqual({ value: "CC-2291-0087", username: "mokafor", secret: "hunter2" });

    const edges = (await (await get(`/api/v1/directory/entities/${id}/edges`)).json()) as {
      data: { edgeType: string; role: string | null }[];
    };
    expect(edges.data.map((edge) => [edge.edgeType, edge.role])).toEqual([
      ["employment", "Principal"],
    ]);
  });

  it("refuses a draft with a short social security number by the sentence the screen shows, and records nothing", async () => {
    const refused = await post("/api/v1/directory/persons", {
      given: "Short",
      family: "Number",
      emails: [{ address: "short@example.com" }],
      identifiers: [{ type: "ssn", number: "123-45-67" }],
    });
    expect(refused.status).toBe(422);
    const problem = (await refused.json()) as { detail: string };
    expect(problem.detail).toBe("Nine digits, as 123-45-6789.");
    const search = (await (await get("/api/v1/directory/search?q=Short%20Number")).json()) as {
      data: { displayName: string }[];
    };
    expect(search.data.some((hit) => hit.displayName === "Short Number")).toBe(false);
  });

  it("refuses an email address without a domain", async () => {
    const refused = await post("/api/v1/directory/persons", {
      given: "No",
      family: "Domain",
      emails: [{ address: "nodomain@example" }],
    });
    expect(refused.status).toBe(422);
  });
});

describe("directory person pronoun routes", () => {
  const SHE = {
    subject: "she",
    object: "her",
    possessiveDeterminer: "her",
    possessivePronoun: "hers",
    reflexive: "herself",
    verbNumber: "singular",
  };

  async function newPerson(given: string, family: string): Promise<string> {
    const created = await post("/api/v1/directory/persons", { given, family });
    expect(created.status).toBe(201);
    return (await readJson<{ id: string }>(created)).id;
  }

  async function pronounsOf(id: string) {
    const read = await get(`/api/v1/directory/persons/${id}`);
    expect(read.status).toBe(200);
    return (await readJson<{ pronouns: string }>(read)).pronouns;
  }

  it("reports null for a person who has stated none, rather than an error or a guess", async () => {
    expect(await pronounsOf(await newPerson("Elizabeth", "Marchetti"))).toBeNull();
  });

  it("records a whole set and reads it back", async () => {
    const id = await newPerson("Dana", "Okafor");
    const recorded = await put(`/api/v1/directory/persons/${id}/pronouns`, { pronouns: SHE });
    expect(recorded.status).toBe(200);
    expect(await pronounsOf(id)).toEqual(SHE);
  });

  it("records a set no closed list of options would contain", async () => {
    const id = await newPerson("Rowan", "Ashcroft");
    const xe = {
      subject: "xe",
      object: "xem",
      possessiveDeterminer: "xyr",
      possessivePronoun: "xyrs",
      reflexive: "xemself",
      verbNumber: "singular",
    };
    expect((await put(`/api/v1/directory/persons/${id}/pronouns`, { pronouns: xe })).status).toBe(
      200,
    );
    expect(await pronounsOf(id)).toEqual(xe);
  });

  it("clears the set on file when null is sent", async () => {
    const id = await newPerson("Priya", "Raman");
    await put(`/api/v1/directory/persons/${id}/pronouns`, { pronouns: SHE });
    expect((await put(`/api/v1/directory/persons/${id}/pronouns`, { pronouns: null })).status).toBe(
      200,
    );
    expect(await pronounsOf(id)).toBeNull();
  });

  // Half a set is what renders "she signed their declaration", so the contract refuses it at the
  // edge rather than storing something the document layer has to defend against.
  it("refuses a set missing a form", async () => {
    const id = await newPerson("Elias", "Renn");
    const { reflexive: _reflexive, ...withoutReflexive } = SHE;
    const response = await put(`/api/v1/directory/persons/${id}/pronouns`, {
      pronouns: withoutReflexive,
    });
    // 422 is the contract's answer to a body the schema refuses; 400 is reserved for a missing
    // Idempotency-Key, which is a different mistake with a different fix.
    expect(response.status).toBe(422);
    expect(await pronounsOf(id)).toBeNull();
  });

  it("refuses a verb agreement that is neither singular nor plural", async () => {
    const id = await newPerson("Mara", "Ferreira");
    const response = await put(`/api/v1/directory/persons/${id}/pronouns`, {
      pronouns: { ...SHE, verbNumber: "dual" },
    });
    expect(response.status).toBe(422);
  });

  it("refuses a blank form rather than storing an empty pronoun", async () => {
    const id = await newPerson("Tomas", "Halvorsen");
    const response = await put(`/api/v1/directory/persons/${id}/pronouns`, {
      pronouns: { ...SHE, object: "   " },
    });
    expect(response.status).toBe(422);
    expect(await pronounsOf(id)).toBeNull();
  });

  it("is 404 for a person this firm does not have", async () => {
    const response = await put(
      "/api/v1/directory/persons/directoryPerson_MISSINGMISSINGMISS/pronouns",
      { pronouns: SHE },
    );
    expect(response.status).toBe(404);
  });

  it("refuses a caller without directory:edit", async () => {
    const id = await newPerson("Ines", "Duarte");
    const response = await put(
      `/api/v1/directory/persons/${id}/pronouns`,
      { pronouns: SHE },
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
  });

  it("requires an Idempotency-Key", async () => {
    const id = await newPerson("Noor", "Haddad");
    const response = await put(
      `/api/v1/directory/persons/${id}/pronouns`,
      { pronouns: SHE },
      ownerCookie,
      false,
    );
    expect(response.status).toBe(400);
  });
});

describe("the directory index", () => {
  // The read that answers "show me everyone". It exists because a firm that has entered records
  // expects to open the directory and see them; the ranked search answers a name and is capped, and
  // one can never stand in for the other.
  it("lists both kinds in one sequence, and says how many the firm holds", async () => {
    const person = await post("/api/v1/directory/persons", {
      given: "Index",
      family: "Person",
    });
    const { id: personId } = (await person.json()) as { id: string };
    const organization = await post("/api/v1/directory/organizations", {
      legalName: "Index Organization Limited",
    });
    const { id: organizationId } = (await organization.json()) as { id: string };

    const response = await get("/api/v1/directory/entities");
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      data: { entityId: string; entityKind: string; displayName: string | null }[];
      nextCursor: string | null;
      total: number;
    };

    const listed = page.data.map((row) => row.entityId);
    expect(listed).toContain(personId);
    expect(listed).toContain(organizationId);
    // The count is of the firm's record, so it is at least the two just written.
    expect(page.total).toBeGreaterThanOrEqual(2);
    expect(page.total).toBeGreaterThanOrEqual(page.data.length);
  });

  it("narrows to one side of the book without needing a second endpoint", async () => {
    const response = await get("/api/v1/directory/entities?kind=organization");
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      data: { entityKind: string }[];
      total: number;
    };

    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data.every((row) => row.entityKind === "organization")).toBe(true);
  });

  it("is refused without a session, like every other firm-scoped read", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/directory/entities", {
      headers: { origin: "https://example.com" },
    });
    expect(response.status).toBe(401);
  });

  // The same read, asked a name. The screen showing the answer is the screen showing the index, so
  // the answer has to arrive as the same rows — a second row shape there is a second table.
  it("answers a search with the same listing rows, in relevance order and capped", async () => {
    const created = await post("/api/v1/directory/persons", {
      given: "Searchable",
      family: "Pemberton",
      emails: [{ address: "searchable@example.test", isPrimary: true }],
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const response = await get("/api/v1/directory/entities?search=Pemberton");
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      data: { entityId: string; familyName: string | null; emailAddress: string | null }[];
      nextCursor: string | null;
      total: number;
      capped: boolean;
    };

    const match = page.data.find((row) => row.entityId === id);
    expect(match).toBeDefined();
    // The whole row, contact summary included — not a name and a kind.
    expect(match?.familyName).toBe("Pemberton");
    expect(match?.emailAddress).toBe("searchable@example.test");
    // A ranked answer is one page, and its count is the answer's rather than the book's.
    expect(page.nextCursor).toBeNull();
    expect(page.total).toBe(page.data.length);
    expect(page.capped).toBe(false);
  });

  it("leaves out the records the name does not reach, and never falls back to the whole book", async () => {
    // A query sharing no three-letter window with anything the firm holds. Matching is by trigram,
    // so "no match" has to be built out of windows rather than out of an unlikely-looking word.
    const response = await get("/api/v1/directory/entities?search=qqqqzzzzjjjj");
    expect(response.status).toBe(200);
    const page = (await response.json()) as { data: unknown[]; total: number; capped: boolean };

    expect(page.data).toEqual([]);
    // Not the firm's whole record. A search that fell back to the index would present an accident
    // as the answer to what was asked.
    expect(page.total).toBe(0);
    expect(page.capped).toBe(false);
  });

  it("says the index was never cut short", async () => {
    const response = await get("/api/v1/directory/entities");
    const page = (await response.json()) as { capped: boolean };

    expect(page.capped).toBe(false);
  });
});

describe("directory organization + duplicate-candidate routes", () => {
  it("creates an organization and surfaces a duplicate candidate", async () => {
    const created = await post("/api/v1/directory/organizations", {
      legalName: "Acme Legal Pty Ltd",
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const candidates = await post("/api/v1/directory/duplicate-candidates", {
      kind: "organization",
      legalName: "Acme Legal Pty Ltd",
    });
    expect(candidates.status).toBe(200);
    const body = (await candidates.json()) as { data: { entityId: string }[] };
    expect(body.data.some((candidate) => candidate.entityId === id)).toBe(true);
  });
});

describe("directory sensitive-identifier read gate", () => {
  it("adds an identifier, then refuses the decrypt read without directory:viewSensitiveIdentifiers (403)", async () => {
    const created = await post("/api/v1/directory/persons", {
      given: "Sensitive",
      family: "Subject",
    });
    const { id } = (await created.json()) as { id: string };

    const added = await post(`/api/v1/directory/entities/${id}/identifiers`, {
      type: "ssn",
      number: "123-45-6789",
    });
    expect(added.status).toBe(201);

    // The owner holds directory:viewSensitiveIdentifiers (seeded onto Admin) — the decrypt
    // returns the plaintext.
    const ownerRead = await get(`/api/v1/directory/entities/${id}/identifiers/ssn`);
    expect(ownerRead.status).toBe(200);
    expect((await readJson<{ value: string }>(ownerRead)).value).toBe("123-45-6789");

    // The Read-only member lacks the permission — the chokepoint refuses before any decrypt.
    const denied = await get(`/api/v1/directory/entities/${id}/identifiers/ssn`, readOnlyCookie);
    expect(denied.status).toBe(403);
  });
});

describe("directory merged-entity write refusal", () => {
  it("keeps reading a merged-away entity but refuses a write to it with a 409 naming the master", async () => {
    const masterResponse = await post("/api/v1/directory/persons", {
      given: "Merged",
      family: "Master",
    });
    const { id: masterId } = (await masterResponse.json()) as { id: string };
    const subordinateResponse = await post("/api/v1/directory/persons", {
      given: "Merged",
      family: "Subordinate",
    });
    const { id: subordinateId } = (await subordinateResponse.json()) as { id: string };

    const merged = await post("/api/v1/directory/merges", { masterId, subordinateId });
    expect(merged.status).toBe(201);

    // The READ is unchanged: the subordinate is still fetchable and carries the pointer to follow.
    const read = await get(`/api/v1/directory/persons/${subordinateId}`);
    expect(read.status).toBe(200);
    const person = (await read.json()) as { status: string; mergedIntoId: string | null };
    expect(person.status).toBe("merged_into");
    expect(person.mergedIntoId).toBe(masterId);

    // The WRITE is refused as a conflict — not a 404 — and the problem detail names the master the
    // caller should address instead.
    const write = await post(`/api/v1/directory/entities/${subordinateId}/names`, {
      given: "Merged",
      family: "Alias",
      nameRole: "alias",
    });
    expect(write.status).toBe(409);
    expect(write.headers.get("content-type")).toContain("application/problem+json");
    const problem = (await write.json()) as { detail: string };
    expect(problem.detail).toContain(masterId);

    // The same write against the surviving master still succeeds.
    const onMaster = await post(`/api/v1/directory/entities/${masterId}/names`, {
      given: "Merged",
      family: "Alias",
      nameRole: "alias",
    });
    expect(onMaster.status).toBe(201);
  });
});

// The name CHANGE — the one act that was unreachable over HTTP, and the reason a marriage could not
// be recorded. The prior name is retained rather than overwritten, which is what keeps a twenty-year
// old file tied to a living person.
describe("directory name change and name history", () => {
  it("records a marriage: the new name becomes current, the maiden name is kept and still findable", async () => {
    const created = await post("/api/v1/directory/persons", {
      given: "Mary",
      family: "Kowalczyk",
    });
    const { id } = await readJson<{ id: string }>(created);

    const changed = await put(`/api/v1/directory/entities/${id}/name`, {
      given: "Mary",
      family: "Whitfield",
    });
    expect(changed.status).toBe(200);

    // The entity now answers to the new name.
    const person = await readJson<{ displayName: string }>(
      await get(`/api/v1/directory/persons/${id}`),
    );
    expect(person.displayName).toBe("Mary Whitfield");

    // Both names are readable, newest first, and exactly one is current.
    const names = await readJson<{
      data: { displayName: string | null; nameRole: string; isCurrent: boolean }[];
      nextCursor: string | null;
    }>(await get(`/api/v1/directory/entities/${id}/names`));
    expect(names.data.map((name) => [name.displayName, name.nameRole, name.isCurrent])).toEqual([
      ["Mary Whitfield", "current", true],
      ["Mary Kowalczyk", "former", false],
    ]);

    // And the superseded name still matches, saying it is the one that matched.
    const hits = await readJson<{
      data: { entityId: string; matchedName: string; matchedNameRole: string }[];
    }>(await get("/api/v1/directory/search?q=Kowalczyk"));
    const hit = hits.data.find((entry) => entry.entityId === id);
    expect(hit?.matchedName).toBe("Mary Kowalczyk");
    expect(hit?.matchedNameRole).toBe("former");
  });

  it("renames an organization the same way", async () => {
    const created = await post("/api/v1/directory/organizations", {
      legalName: "Pemberton Holdings Limited",
    });
    const { id } = await readJson<{ id: string }>(created);

    expect(
      (await put(`/api/v1/directory/entities/${id}/name`, { legalName: "Pemberton Group Limited" }))
        .status,
    ).toBe(200);

    const organization = await readJson<{ legalName: string }>(
      await get(`/api/v1/directory/organizations/${id}`),
    );
    expect(organization.legalName).toBe("Pemberton Group Limited");
  });

  it("refuses a body shaped for the other side of the directory with a 422, not a 500", async () => {
    const created = await post("/api/v1/directory/persons", { given: "Wrong", family: "Shape" });
    const { id } = await readJson<{ id: string }>(created);
    const response = await put(`/api/v1/directory/entities/${id}/name`, {
      legalName: "Not A Person Limited",
    });
    expect(response.status).toBe(422);
  });

  it("refuses a caller without directory:edit", async () => {
    const created = await post("/api/v1/directory/persons", { given: "Gated", family: "Rename" });
    const { id } = await readJson<{ id: string }>(created);
    const response = await put(
      `/api/v1/directory/entities/${id}/name`,
      { given: "Gated", family: "Renamed" },
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});

// The naming read three surfaces were crippled without. It answers display identity for a page of
// rows in ONE request, and it answers nothing else.
describe("directory bulk entity-name read", () => {
  it("names people and organizations together, in the order asked", async () => {
    const person = await readJson<{ id: string }>(
      await post("/api/v1/directory/persons", { given: "Bulk", family: "Person" }),
    );
    const organization = await readJson<{ id: string }>(
      await post("/api/v1/directory/organizations", { legalName: "Bulk Organization Limited" }),
    );

    const response = await get(
      `/api/v1/directory/entity-names?ids=${organization.id},${person.id}`,
    );
    expect(response.status).toBe(200);
    const named = await readJson<{
      data: { entityId: string; entityKind: string; displayName: string | null }[];
    }>(response);
    expect(named.data).toEqual([
      {
        entityId: organization.id,
        entityKind: "organization",
        displayName: "Bulk Organization Limited",
        mergedIntoId: null,
      },
      {
        entityId: person.id,
        entityKind: "person",
        displayName: "Bulk Person",
        mergedIntoId: null,
      },
    ]);
  });

  it("omits a handle the firm holds nothing for rather than naming it null", async () => {
    const named = await readJson<{ data: { entityId: string }[] }>(
      await get("/api/v1/directory/entity-names?ids=directoryPerson_zzzzzzzzzzzzzzzzzzzzz"),
    );
    expect(named.data).toEqual([]);
  });

  it("refuses more ids than the bound rather than truncating the answer", async () => {
    const ids = Array.from(
      { length: 101 },
      (_, index) => `directoryPerson_${String(index).padStart(21, "0")}`,
    ).join(",");
    const response = await get(`/api/v1/directory/entity-names?ids=${ids}`);
    expect(response.status).toBe(422);
  });

  it("is readable by a member with no directory permission — it is a naming read", async () => {
    const person = await readJson<{ id: string }>(
      await post("/api/v1/directory/persons", { given: "Named", family: "ForEveryone" }),
    );
    const response = await get(`/api/v1/directory/entity-names?ids=${person.id}`, readOnlyCookie);
    expect(response.status).toBe(200);
  });
});

// What the firm holds for an entity, described and never disclosed.
describe("directory identifier enumeration", () => {
  it("says which identifiers are held without decrypting any of them", async () => {
    const person = await readJson<{ id: string }>(
      await post("/api/v1/directory/persons", { given: "Sealed", family: "Holder" }),
    );
    expect(
      (
        await post(`/api/v1/directory/entities/${person.id}/identifiers`, {
          type: "ssn",
          number: "123-45-6789",
        })
      ).status,
    ).toBe(201);

    // The Read-only member cannot decrypt, and does not have to in order to see what is held.
    const response = await get(
      `/api/v1/directory/entities/${person.id}/identifiers`,
      readOnlyCookie,
    );
    expect(response.status).toBe(200);
    const held = await readJson<{ data: Record<string, unknown>[] }>(response);
    expect(held.data).toHaveLength(1);
    expect(held.data[0]).toMatchObject({ type: "ssn" });
    // No value field, under any spelling. The decrypt is the other route.
    expect(JSON.stringify(held.data)).not.toContain("123-45-6789");
    expect(Object.keys(held.data[0] ?? {}).sort()).toEqual([
      "id",
      "label",
      "recordedAt",
      "type",
      "validFrom",
      "validTo",
    ]);
  });
});

// The three panes that had no read at all: relationships, the matters an entity is on, and the
// firm's category labels.
describe("directory entity relationship, matter and category reads", () => {
  it("reads an entity's edges from both ends, naming the far end", async () => {
    const person = await readJson<{ id: string }>(
      await post("/api/v1/directory/persons", { given: "Edge", family: "Subject" }),
    );
    const organization = await readJson<{ id: string }>(
      await post("/api/v1/directory/organizations", { legalName: "Edge Counterparty Limited" }),
    );
    expect(
      (
        await post("/api/v1/directory/edges", {
          from: person.id,
          to: organization.id,
          edgeType: "affiliation",
          role: "Director",
        })
      ).status,
    ).toBe(201);

    const outbound = await readJson<{
      data: { direction: string; farEntityId: string; farDisplayName: string | null }[];
    }>(await get(`/api/v1/directory/entities/${person.id}/edges`));
    expect(outbound.data).toHaveLength(1);
    expect(outbound.data[0]).toMatchObject({
      direction: "outbound",
      farEntityId: organization.id,
      farDisplayName: "Edge Counterparty Limited",
    });

    // The same row read from the other end reads in the opposite sense.
    const inbound = await readJson<{ data: { direction: string; farEntityId: string }[] }>(
      await get(`/api/v1/directory/entities/${organization.id}/edges`),
    );
    expect(inbound.data[0]).toMatchObject({ direction: "inbound", farEntityId: person.id });
  });

  it("reads the firm's categories and what one entity carries", async () => {
    const category = await readJson<{ id: string }>(
      await post("/api/v1/directory/categories", { name: "Expert Witness", appliesTo: "person" }),
    );
    const person = await readJson<{ id: string }>(
      await post("/api/v1/directory/persons", { given: "Labelled", family: "Person" }),
    );
    expect(
      (
        await post("/api/v1/directory/category-assignments", {
          entityId: person.id,
          categoryId: category.id,
        })
      ).status,
    ).toBe(201);

    const firmCategories = await readJson<{ data: { id: string; archived: boolean }[] }>(
      await get("/api/v1/directory/categories"),
    );
    expect(firmCategories.data.some((entry) => entry.id === category.id)).toBe(true);
    expect(firmCategories.data.every((entry) => typeof entry.archived === "boolean")).toBe(true);

    const carried = await readJson<{ data: { id: string; name: string }[] }>(
      await get(`/api/v1/directory/entities/${person.id}/categories`),
    );
    expect(carried.data).toEqual([
      {
        id: category.id,
        name: "Expert Witness",
        appliesTo: "person",
        position: 0,
        archived: false,
      },
    ]);
  });
});

describe("directory duplicate candidates carry a name", () => {
  it("names each candidate in the answer rather than making the caller resolve it", async () => {
    const existing = await readJson<{ id: string }>(
      await post("/api/v1/directory/organizations", { legalName: "Fenwick Bramley Partners" }),
    );

    const candidates = await readJson<{
      data: { entityId: string; entityKind: string; displayName: string | null }[];
    }>(
      await post(
        "/api/v1/directory/duplicate-candidates",
        { kind: "organization", legalName: "Fenwick Bramley Partners" },
        ownerCookie,
        false,
      ),
    );
    const hit = candidates.data.find((candidate) => candidate.entityId === existing.id);
    expect(hit).toMatchObject({
      entityKind: "organization",
      displayName: "Fenwick Bramley Partners",
    });
  });
});

describe("directory contract", () => {
  it("registers the directory operations in the OpenAPI document", () => {
    const document = buildOpenAPIDocument();
    const operationIds = new Set<string>();
    for (const item of Object.values(document.paths ?? {})) {
      for (const method of ["get", "post"] as const) {
        const operation = (item as Record<string, { operationId?: string } | undefined>)[method];
        if (operation?.operationId) operationIds.add(operation.operationId);
      }
    }
    expect(operationIds.has("directory.createPerson")).toBe(true);
    expect(operationIds.has("directory.getPerson")).toBe(true);
    expect(operationIds.has("directory.search")).toBe(true);
    expect(operationIds.has("directory.readIdentifier")).toBe(true);
    expect(operationIds.has("directory.listNames")).toBe(true);
    expect(operationIds.has("directory.entityNames")).toBe(true);
    expect(operationIds.has("directory.listEdges")).toBe(true);
    expect(operationIds.has("directory.listIdentifiers")).toBe(true);
  });
});
