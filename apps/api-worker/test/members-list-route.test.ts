import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// GET /api/v1/members — the roster read, through the chokepoint over real Miniflare bindings.
//
// The three things this endpoint exists to get right, and each is a case below:
//
//   - It names people. A screen that cannot put a display name to a user handle prints the handle or
//     prints nothing, and the matters list shipped printing nothing.
//   - It is readable by a member who may NOT invite anybody. Binding the roster to
//     firm:manageMembers would have made "who is on the firm" an administrative privilege, which is
//     not what it is; the seed puts firm:readMembers on every default role including Read-only, and
//     the Read-only case below is the one that would fail if that were ever narrowed.
//   - A departed colleague is still listed, with their status saying so. Filtering them out would
//     erase the responsible attorney from every matter they carried.

interface MemberSummary {
  userId: string;
  displayName: string;
  status: "active" | "deactivated";
  roleNames: string[];
  hasProfessionalProfile: boolean;
}

let firmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;
let ownerUserId: UserId;
let readOnlyUserId: UserId;
let departedUserId: UserId;
let rolelessUserId: UserId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString() };

async function readRoster(cookie: string): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/members", { headers: { cookie } });
}

async function rosterBody(cookie: string): Promise<MemberSummary[]> {
  const response = await readRoster(cookie);
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: MemberSummary[] }).data;
}

function memberIn(roster: readonly MemberSummary[], userId: string): MemberSummary {
  const found = roster.find((row) => row.userId === userId);
  if (found === undefined) throw new Error(`no member ${userId} in the roster`);
  return found;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Roster Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("roster-owner@example.com", {
    userName: "Zara Okonkwo",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Zara Okonkwo", firmId);
  ownerCookie = await signInForSessionCookie("roster-owner@example.com");

  // The seat the permission split is really about: Read-only holds no management key at all, and
  // must still be able to read who its colleagues are.
  const readOnly = await seedCredentialedUser("roster-readonly@example.com", {
    userName: "Amara Bell",
    firmId,
  });
  readOnlyUserId = readOnly.userId;
  await mirrorMemberWithRole(readOnly.userId, "Amara Bell", firmId, "Read-only");
  readOnlyCookie = await signInForSessionCookie("roster-readonly@example.com");

  // A member who has left. No session is minted for them — they are here to be READ, which is the
  // point: the matters they carried still name them.
  departedUserId = newIdentifier("user");
  await insertMemberStatement(firmDatabase, {
    userId: departedUserId,
    displayName: "Cormac Vale",
    now: clock.now(),
  }).run();
  await firmDatabase
    .prepare("UPDATE member SET status = 'deactivated' WHERE user_id = ?1")
    .bind(departedUserId)
    .run();

  // A member mirrored before any role was named — the real state the outbox leaves behind between
  // the member row and the role assignment when a provision names no role.
  rolelessUserId = newIdentifier("user");
  await insertMemberStatement(firmDatabase, {
    userId: rolelessUserId,
    displayName: "Bea Nightingale",
    now: clock.now(),
  }).run();
});

describe("GET /api/v1/members", () => {
  it("names every member of the firm, ordered by display name", async () => {
    const roster = await rosterBody(ownerCookie);
    expect(roster.map((row) => row.displayName)).toEqual([
      "Amara Bell",
      "Bea Nightingale",
      "Cormac Vale",
      "Zara Okonkwo",
    ]);
  });

  it("carries the roles a member holds, and an empty list where they hold none", async () => {
    const roster = await rosterBody(ownerCookie);
    expect(memberIn(roster, ownerUserId).roleNames).toEqual(["Admin"]);
    expect(memberIn(roster, readOnlyUserId).roleNames).toEqual(["Read-only"]);
    // Not `[""]`: a member holding no role reads as holding no role, never as holding one with no
    // name — which is what an unguarded split of an empty packed column would produce.
    expect(memberIn(roster, rolelessUserId).roleNames).toEqual([]);
  });

  it("lists a departed colleague and says they are departed, rather than dropping the row", async () => {
    const roster = await rosterBody(ownerCookie);
    expect(memberIn(roster, departedUserId).status).toBe("deactivated");
    expect(memberIn(roster, ownerUserId).status).toBe("active");
  });

  it("reports whether a professional profile has been written, and flips when one is", async () => {
    expect(memberIn(await rosterBody(ownerCookie), ownerUserId).hasProfessionalProfile).toBe(false);

    const written = await SELF.fetch(
      `https://example.com/api/v1/members/${ownerUserId}/professional-profile`,
      {
        method: "PUT",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          title: "Managing Partner",
          admissions: null,
          directDial: null,
          professionalEmail: null,
          signatureBlock: null,
        }),
      },
    );
    expect(written.status).toBe(200);

    expect(memberIn(await rosterBody(ownerCookie), ownerUserId).hasProfessionalProfile).toBe(true);
  });

  it("carries no contact detail: the roster answers WHO, not how to reach them", async () => {
    const roster = await rosterBody(ownerCookie);
    const keys = new Set(Object.keys(roster[0] ?? {}));
    for (const forbidden of ["email", "professionalEmail", "directDial", "permissions"]) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
  });
});

describe("GET /api/v1/members — who may read it", () => {
  it("answers a Read-only member: knowing one's colleagues is not an administrative privilege", async () => {
    const roster = await rosterBody(readOnlyCookie);
    expect(roster.length).toBe(4);
  });

  it("refuses a member who holds no firm:readMembers grant at all", async () => {
    // A mirrored member with no role and therefore no permissions — the roster is a capability, not
    // a free read for any authenticated session.
    const stranger = await seedCredentialedUser("roster-stranger@example.com", {
      userName: "Ines Roux",
      firmId,
    });
    await insertMemberStatement(firmDatabase, {
      userId: stranger.userId,
      displayName: "Ines Roux",
      now: clock.now(),
    }).run();
    const strangerCookie = await signInForSessionCookie("roster-stranger@example.com");

    const response = await readRoster(strangerCookie);
    expect(response.status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/members");
    expect(response.status).toBe(401);
  });
});
