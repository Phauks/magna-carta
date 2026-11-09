/*
 * The call record's caller lookup through the real chokepoint. Two states are pinned, the address
 * lookup's precedent (address-lookup-routes.test.ts): the SHIPPED state, with no Telnyx key, where
 * the free answers still arrive and the paid one is `unavailable` without anybody being asked; and the
 * provisioned state, reached by handing the app an environment carrying a key while the outbound call
 * to Telnyx is answered by a stub.
 *
 * The thing worth most here is the bill: a number is paid for once. The second press for a number
 * the firm already looked up must be answered from the kept row, with no request to Telnyx at all.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { addPhone } from "@magna-carta/directory/contact-phone";
import { createPerson } from "@magna-carta/directory/person";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

const app = createApp();
const base = "https://example.com/api/v1/communications/caller-lookup";
const PROVISIONED = { ...env, TELNYX_API_KEY: "test-telnyx-key" };
const SHIPPED = { ...env, TELNYX_API_KEY: undefined };

let firmId: FirmId;
let ownerCookie: string;
let unprivilegedCookie: string;
let personId: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Caller Lookup Firm" })).firmId;
  const { userId } = await seedCredentialedUser("caller-lookup-owner@example.com", {
    userName: "Lookup Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(userId, "Lookup Owner", firmId);
  ownerCookie = await signInForSessionCookie("caller-lookup-owner@example.com");
  // Present in the firm but holding no role, so no communications:log.
  await seedCredentialedUser("caller-lookup-no-role@example.com", {
    userName: "No Role",
    firmId,
  });
  unprivilegedCookie = await signInForSessionCookie("caller-lookup-no-role@example.com");

  const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const options = {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId as UserId,
  };
  personId = await createPerson(database, { given: "Rosa", family: "Pell" }, options);
  await addPhone(
    database,
    { entityId: personId, number: "702-555-0142", contactSystem: "voice", contactUse: "mobile" },
    options,
  );
});

function post(path: string, body: unknown, cookie?: string): [string, RequestInit] {
  return [
    path === "" ? base : `${base}/${path}`,
    {
      method: "POST",
      headers: {
        ...(cookie === undefined ? {} : { cookie }),
        origin: "https://example.com",
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    },
  ];
}

/** Answer Telnyx from a script and let every other request through untouched. */
const originalFetch = globalThis.fetch;
const telnyxCalls: URL[] = [];
function answerTelnyxWith(answer: () => Response): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.telnyx.com") {
      telnyxCalls.push(url);
      return Promise.resolve(answer());
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  telnyxCalls.length = 0;
});

function telnyxFound(name: string): Response {
  return new Response(
    JSON.stringify({ data: { caller_name: { caller_name: name }, carrier: { type: "mobile" } } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("who may ask", () => {
  it("refuses a caller with no session, and a member who may not log calls", async () => {
    const anonymous = await app.request(...post("", { number: "+17025550142" }), SHIPPED);
    expect(anonymous.status).toBe(401);
    const noRole = await app.request(
      ...post("", { number: "+17025550142" }, unprivilegedCookie),
      SHIPPED,
    );
    expect(noRole.status).toBe(403);
  });

  it("refuses anything that is not E.164", async () => {
    const response = await app.request(
      ...post("", { number: "702-555-0142" }, ownerCookie),
      SHIPPED,
    );
    expect(response.status).toBe(422);
  });
});

describe("the free answers", () => {
  it("names the contact who has the number and the area code's region, with no key at all", async () => {
    answerTelnyxWith(() => new Response("must not be called", { status: 500 }));
    const response = await app.request(
      ...post("", { number: "+17025550142" }, ownerCookie),
      SHIPPED,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      directoryMatches: [{ entityId: personId, entityKind: "person", displayName: "Rosa Pell" }],
      areaCode: { areaCode: "702", region: "Nevada" },
      callerIdentity: null,
      paidLookup: "unavailable",
    });
    expect(telnyxCalls).toHaveLength(0);
  });

  it("says a number outside North America has no caller ID to buy", async () => {
    const response = await app.request(
      ...post("", { number: "+442079460018" }, ownerCookie),
      PROVISIONED,
    );
    expect(((await response.json()) as { paidLookup: string }).paidLookup).toBe("not-covered");
  });
});

describe("the paid answer", () => {
  it("is unavailable, and asks nobody, while no key is provisioned", async () => {
    answerTelnyxWith(() => new Response("must not be called", { status: 500 }));
    const response = await app.request(
      ...post("caller-identity", { number: "+17025550199" }, ownerCookie),
      SHIPPED,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "unavailable" });
    expect(telnyxCalls).toHaveLength(0);
  });

  it("is asked once, kept, and then read back for free", async () => {
    answerTelnyxWith(() => telnyxFound("PELL ROSA"));
    const first = await app.request(
      ...post("caller-identity", { number: "+17025550142" }, ownerCookie),
      PROVISIONED,
    );
    expect(first.status).toBe(200);
    const found = (await first.json()) as {
      outcome: string;
      callerIdentity: { callerName: string; lineType: string };
    };
    expect(found.outcome).toBe("found");
    expect(found.callerIdentity.callerName).toBe("PELL ROSA");
    expect(found.callerIdentity.lineType).toBe("mobile");
    expect(telnyxCalls).toHaveLength(1);

    const second = await app.request(
      ...post("caller-identity", { number: "+17025550142" }, ownerCookie),
      PROVISIONED,
    );
    expect(((await second.json()) as { outcome: string }).outcome).toBe("found");
    expect(telnyxCalls).toHaveLength(1);

    const free = await app.request(
      ...post("", { number: "+17025550142" }, ownerCookie),
      PROVISIONED,
    );
    const known = (await free.json()) as { callerIdentity: { callerName: string } | null };
    expect(known.callerIdentity?.callerName).toBe("PELL ROSA");
  });

  it("keeps nothing when Telnyx refuses, so the next press asks again", async () => {
    answerTelnyxWith(() => new Response(JSON.stringify({ errors: [] }), { status: 401 }));
    const refused = await app.request(
      ...post("caller-identity", { number: "+17025550177" }, ownerCookie),
      PROVISIONED,
    );
    expect(refused.status).toBe(502);

    answerTelnyxWith(() => telnyxFound("SECOND TRY"));
    const retried = await app.request(
      ...post("caller-identity", { number: "+17025550177" }, ownerCookie),
      PROVISIONED,
    );
    expect(retried.status).toBe(200);
    // Two requests in all: the refused one kept nothing, so the second press asked again.
    expect(telnyxCalls).toHaveLength(2);
  });
});
