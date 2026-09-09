import { env, SELF } from "cloudflare:test";
import type { FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A member's own name, through the chokepoint over real Miniflare bindings.
//
// The two things worth pinning are the ones a screen cannot enforce for itself. The rendered line
// is composed on the server from the parts in the same write, so what the platform prints and what
// the person stated can never disagree. And the firm's roster is brought along, because a name that
// changed on the account and not on the roster is a colleague with two names.

let firmId: FirmId;
let cookie: string;
let userId: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const NAME_URL = "https://example.com/api/v1/me/name";

interface NameBody {
  parts: {
    prefix: string | null;
    given: string | null;
    middle: string | null;
    family: string | null;
    suffix: string | null;
  };
  displayName: string;
  partsStated: boolean;
}

async function readName(): Promise<Response> {
  return SELF.fetch(NAME_URL, { headers: { cookie } });
}

async function writeName(parts: Partial<NameBody["parts"]>, as = cookie): Promise<Response> {
  return SELF.fetch(NAME_URL, {
    method: "PUT",
    headers: { cookie: as, "content-type": "application/json", origin: "https://example.com" },
    body: JSON.stringify({
      prefix: null,
      given: null,
      middle: null,
      family: null,
      suffix: null,
      ...parts,
    }),
  });
}

async function rosterName(): Promise<string | undefined> {
  return (
    await firmDatabase
      .prepare("SELECT display_name AS displayName FROM member WHERE user_id = ?1")
      .bind(userId)
      .first<{ displayName: string }>()
  )?.displayName;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Own Name Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  // A Read-only seat deliberately: writing one's own name is not a privilege, and the seeded key
  // reaches every default role. A denial asserted against an administrator would prove nothing.
  const member = await seedCredentialedUser("own-name-member@example.com", {
    userName: "Jane Doe",
    firmId,
  });
  userId = member.userId;
  await mirrorMemberWithRole(member.userId, "Jane Doe", firmId, "Read-only");
  cookie = await signInForSessionCookie("own-name-member@example.com");
});

describe("a member's own name", () => {
  it("reads the single line the account was created with, and no guess at its parts", async () => {
    const response = await readName();
    expect(response.status).toBe(200);
    const body = (await response.json()) as NameBody;
    expect(body.displayName).toBe("Jane Doe");
    expect(body.partsStated).toBe(false);
    // The server never splits: a reading of the line is a screen's suggestion, not a stored fact.
    expect(body.parts).toEqual({
      prefix: null,
      given: null,
      middle: null,
      family: null,
      suffix: null,
    });
  });

  it("is writable from a Read-only seat, because it is one's own", async () => {
    const response = await writeName({ given: "Jane", family: "Doe" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as NameBody;
    expect(body.partsStated).toBe(true);
    expect(body.displayName).toBe("Jane Doe");
  });

  it("composes the line from the parts, several honorifics included", async () => {
    const response = await writeName({
      prefix: "Hon.",
      given: "Jane",
      middle: "Marie",
      family: "Doe",
      suffix: "III, Esq.",
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as NameBody).displayName).toBe("Hon. Jane Marie Doe III, Esq.");
    // And the stored line agrees with it, because both are written in one statement.
    const stored = await env.DB_CONTROL.prepare('SELECT name FROM "user" WHERE id = ?1')
      .bind(userId)
      .first<{ name: string }>();
    expect(stored?.name).toBe("Hon. Jane Marie Doe III, Esq.");
  });

  it("brings the firm's roster along, so a colleague never has two names", async () => {
    expect(await rosterName()).toBe("Hon. Jane Marie Doe III, Esq.");
    await writeName({ given: "Jane", family: "Okafor" });
    expect(await rosterName()).toBe("Jane Okafor");
  });

  it("treats a part that is only whitespace as unstated", async () => {
    const response = await writeName({ given: "Jane", middle: "   ", family: "Okafor" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as NameBody;
    expect(body.parts.middle).toBeNull();
    expect(body.displayName).toBe("Jane Okafor");
  });

  it("refuses a name with no parts at all rather than leaving the record unnamed", async () => {
    const response = await writeName({});
    expect(response.status).toBe(422);
    // And the name that was there is untouched.
    expect(((await (await readName()).json()) as NameBody).displayName).toBe("Jane Okafor");
  });

  it("refuses a caller with no session", async () => {
    const response = await SELF.fetch(NAME_URL, { headers: {} });
    expect(response.status).toBe(401);
  });
});
