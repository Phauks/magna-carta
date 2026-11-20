import { env } from "cloudflare:test";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { signerCheckChoiceDefinition } from "../src/signing/signer-check-settings.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The firm's signing settings through the chokepoint over real Miniflare bindings:
//
//   - A FIRM THAT NEVER CHOSE gets the email link and the email code, starting on the email code.
//   - ONLY OWNER/ADMIN DECIDES. An attorney sends documents, so reads what is offered, and may not
//     change it.
//   - TEXT CODES NEED THE DEPLOYMENT'S TEXT SERVICE. A firm can turn them on before it is set up;
//     `offered` leaves them out until both Telnyx values are present.
//   - EVERY WRITE IS ONE AUDIT ROW, and what the route stores is what the send route reads.

const app = createApp();
const base = "https://example.com";
const SETTINGS_PATH = "/api/v1/firm/signing/settings";

const TEXTING_DEPLOYMENT = {
  ...env,
  TELNYX_API_KEY: "test-telnyx-key",
  TELNYX_TEXT_FROM: "+17025550100",
};

interface SigningSettings {
  emailCode: boolean;
  textCode: boolean;
  identityCheck: boolean;
  startWith: string;
  startingCheck: string;
  offered: string[];
  textServiceReady: boolean;
  outsideServices: Array<{ kind: string; connected: boolean; vendor: string | null }>;
}

let firmId: FirmId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let ownerCookie: string;
let attorneyCookie: string;

async function request(
  method: "GET" | "PATCH",
  cookie: string,
  body?: unknown,
  environment: typeof env = env,
): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (method === "PATCH") {
    headers["idempotency-key"] = crypto.randomUUID();
    headers["content-type"] = "application/json";
    headers.origin = base;
  }
  return await app.request(
    `${base}${SETTINGS_PATH}`,
    { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) },
    environment,
  );
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Signing Settings Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("signing-settings-owner@example.com", {
    userName: "Settings Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Settings Owner", firmId);
  ownerCookie = await signInForSessionCookie("signing-settings-owner@example.com");

  const attorney = await seedCredentialedUser("signing-settings-attorney@example.com", {
    userName: "Settings Attorney",
    firmId,
  });
  await mirrorMemberWithRole(attorney.userId, "Settings Attorney", firmId, "Attorney");
  attorneyCookie = await signInForSessionCookie("signing-settings-attorney@example.com");
});

describe("the firm's signing settings", () => {
  it("offers the email link and the email code where the firm has chosen nothing", async () => {
    const response = await request("GET", ownerCookie);
    expect(response.status).toBe(200);
    expect(await response.json<SigningSettings>()).toEqual({
      emailCode: true,
      textCode: false,
      identityCheck: false,
      startWith: "email-code",
      startingCheck: "email-code",
      offered: ["email-link", "email-code"],
      textServiceReady: false,
      outsideServices: [
        { kind: "identity-check", connected: false, vendor: null },
        { kind: "online-notary", connected: false, vendor: null },
      ],
    });
  });

  it("lets an attorney read what is offered, and not change it", async () => {
    expect((await request("GET", attorneyCookie)).status).toBe(200);
    expect((await request("PATCH", attorneyCookie, { textCode: true })).status).toBe(403);
  });

  it("offers text codes only once the text service is set up", async () => {
    const response = await request("PATCH", ownerCookie, {
      textCode: true,
      startWith: "text-code",
    });
    expect(response.status).toBe(200);
    const notReady = await response.json<SigningSettings>();
    expect(notReady.textCode).toBe(true);
    expect(notReady.offered).toEqual(["email-link", "email-code"]);
    expect(notReady.startingCheck).toBe("email-link");

    const ready = await (
      await request("GET", ownerCookie, undefined, TEXTING_DEPLOYMENT)
    ).json<SigningSettings>();
    expect(ready.textServiceReady).toBe(true);
    expect(ready.offered).toEqual(["email-link", "email-code", "text-code"]);
    expect(ready.startingCheck).toBe("text-code");
  });

  it("stores what the send route reads, and records who changed it", async () => {
    await request("PATCH", ownerCookie, { emailCode: false });
    expect(await readFirmSetting(firmDatabase, signerCheckChoiceDefinition)).toEqual({
      emailCode: false,
      textCode: true,
      identityCheck: false,
      startWith: "text-code",
    });
    const { results } = await firmDatabase
      .prepare("SELECT metadata FROM audit_log WHERE event = 'firm.signing_settings_updated'")
      .all<{ metadata: string }>();
    expect(results.length).toBe(2);
  });

  it("refuses a check that does not exist", async () => {
    expect((await request("PATCH", ownerCookie, { startWith: "fingerprint" })).status).toBe(422);
  });
});
