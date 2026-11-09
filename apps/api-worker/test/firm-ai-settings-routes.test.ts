import { env, SELF } from "cloudflare:test";
import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import {
  aiProcessingEligibilityDefinition,
  primaryReasoningModelDefinition,
} from "@magna-carta/inference/settings";
import {
  magnusDailyTurnCeilingDefinition,
  magnusEnabledDefinition,
} from "@magna-carta/magnus/settings";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { resolveMagnusFirmGates } from "../src/magnus/consent.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The firm's AI settings through the chokepoint over real Miniflare bindings. The point the whole
// suite turns on is the LAST test: what this screen writes is exactly what the assistant's consent
// resolver reads, so a firm that opens both gates here has actually opened them for the queue
// consumer — that seam is the only reason this route exists.

let firmId: FirmId;
let ownerCookie: string;
let converserCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString() };
const SETTINGS_URL = "https://example.com/api/v1/firm/ai/settings";

interface AiSettings {
  aiProcessing: { eligible: boolean };
  model: {
    modelId: string;
    snapshotId: string;
    zeroDataRetention: boolean;
    noTraining: boolean;
    selection: "platform" | "chosen";
  } | null;
  models: Array<{
    modelId: string;
    zeroDataRetention: boolean;
    verifiedOn: string;
    platformDefault: boolean;
  }>;
  catalog: { version: number; effectiveDate: string };
  provider: {
    status: "live" | "not-configured" | "unreachable";
    checkedAt: string | null;
    awaitingVerification: Array<{ modelId: string; displayName: string }>;
  };
  magnus: { enabled: boolean; dailyTurnCeiling: number };
}

async function readSettings(cookie: string): Promise<Response> {
  return SELF.fetch(SETTINGS_URL, { headers: { cookie } });
}

async function patchSettings(cookie: string, body: unknown, key = crypto.randomUUID()) {
  return SELF.fetch(SETTINGS_URL, {
    method: "PATCH",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: "https://example.com",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
}

async function countSettingsAudits(): Promise<number> {
  return (
    (
      await firmDatabase
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'firm.ai_settings_updated'")
        .first<{ n: number }>()
    )?.n ?? 0
  );
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "AI Settings Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("ai-settings-owner@example.com", {
    userName: "Settings Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Settings Owner", firmId);
  ownerCookie = await signInForSessionCookie("ai-settings-owner@example.com");

  // A member who may HOLD a conversation with the assistant and nothing else. Asking the assistant
  // a question is ordinary work and seeds broadly; deciding for the whole firm that privileged
  // content may leave for a third-party model is not, so magnus:converse must not reach this route.
  const converser = await seedCredentialedUser("ai-settings-converser@example.com", {
    userName: "Settings Converser",
    firmId,
  });
  await insertMemberStatement(firmDatabase, {
    userId: converser.userId,
    displayName: "Settings Converser",
    now: clock.now(),
  }).run();
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, 'magnus:converse', ?2, NULL, ?3)",
    )
    .bind(newIdentifier("grant"), converser.userId, clock.now())
    .run();
  converserCookie = await signInForSessionCookie("ai-settings-converser@example.com");
});

describe("the firm's AI settings", () => {
  it("reads both gates closed where the firm has never set anything", async () => {
    const response = await readSettings(ownerCookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as AiSettings;
    expect(body.aiProcessing.eligible).toBe(false);
    expect(body.magnus).toEqual({ enabled: false, dailyTurnCeiling: 500 });
  });

  it("states the model in force, with its snapshot and both confidentiality facts", async () => {
    const body = (await (await readSettings(ownerCookie)).json()) as AiSettings;
    expect(body.model).not.toBeNull();
    // Every reasoning entry in the catalog is ZDR-eligible by a refinement the catalog enforces at
    // module load; the screen states that guarantee, so the guarantee is asserted here too.
    expect(body.model?.zeroDataRetention).toBe(true);
    expect(body.model?.noTraining).toBe(true);
    expect(body.model?.modelId.length).toBeGreaterThan(0);
    expect(body.model?.snapshotId.length).toBeGreaterThan(0);
  });

  it("refuses a member who may only talk to the assistant, on the read and the write alike", async () => {
    expect((await readSettings(converserCookie)).status).toBe(403);
    const response = await patchSettings(converserCookie, { aiProcessing: { eligible: true } });
    expect(response.status).toBe(403);
    expect(await readFirmSetting(firmDatabase, aiProcessingEligibilityDefinition)).toBe(false);
  });

  it("opens one gate and leaves the other, with one audit row", async () => {
    const before = await countSettingsAudits();
    const response = await patchSettings(ownerCookie, { aiProcessing: { eligible: true } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as AiSettings;
    expect(body.aiProcessing.eligible).toBe(true);
    expect(body.magnus.enabled).toBe(false);
    expect(await readFirmSetting(firmDatabase, aiProcessingEligibilityDefinition)).toBe(true);
    expect(await readFirmSetting(firmDatabase, magnusEnabledDefinition)).toBe(false);
    expect(await countSettingsAudits()).toBe(before + 1);
  });

  it("changes the assistant's gate and its ceiling in one write", async () => {
    const response = await patchSettings(ownerCookie, {
      magnus: { enabled: true, dailyTurnCeiling: 42 },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as AiSettings;
    expect(body.magnus).toEqual({
      enabled: true,
      dailyTurnCeiling: 42,
    });
    expect(await readFirmSetting(firmDatabase, magnusDailyTurnCeilingDefinition)).toBe(42);
  });

  it("replays a retried write rather than recording it twice", async () => {
    const before = await countSettingsAudits();
    const key = crypto.randomUUID();
    const body = { magnus: { dailyTurnCeiling: 250 } };
    const first = await patchSettings(ownerCookie, body, key);
    const second = await patchSettings(ownerCookie, body, key);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await countSettingsAudits()).toBe(before + 1);
  });

  it("writes nothing and audits nothing for an empty patch", async () => {
    const before = await countSettingsAudits();
    const response = await patchSettings(ownerCookie, {});
    expect(response.status).toBe(200);
    expect(await countSettingsAudits()).toBe(before);
  });

  it("refuses a ceiling outside the bounds the setting carries", async () => {
    expect((await patchSettings(ownerCookie, { magnus: { dailyTurnCeiling: -1 } })).status).toBe(
      422,
    );
    expect(
      (await patchSettings(ownerCookie, { magnus: { dailyTurnCeiling: 100001 } })).status,
    ).toBe(422);
    expect((await patchSettings(ownerCookie, { magnus: { dailyTurnCeiling: 1.5 } })).status).toBe(
      422,
    );
  });

  it("offers the roster from the catalog, marks the platform's own choice, and states the catalog's date", async () => {
    const body = (await (await readSettings(ownerCookie)).json()) as AiSettings;
    expect(body.models.length).toBeGreaterThan(1);
    // Every roster entry is ZDR-eligible: the catalog refuses a reasoning entry that is not.
    for (const choice of body.models) {
      expect(choice.zeroDataRetention).toBe(true);
      expect(isCivilDate(choice.verifiedOn)).toBe(true);
    }
    expect(body.models.filter((choice) => choice.platformDefault)).toHaveLength(1);
    expect(isCivilDate(body.catalog.effectiveDate)).toBe(true);
    // A firm that has never chosen follows the platform.
    expect(body.model?.selection).toBe("platform");
  });

  it("without a provider key, says the live check is not configured and still offers the whole roster", async () => {
    // The test environment holds no ANTHROPIC_MODELS_API_KEY, which is the shipped default: the
    // screen must work, and must say what it did not check rather than claim a model is published.
    const body = (await (await readSettings(ownerCookie)).json()) as AiSettings & {
      models: Array<{ published: boolean | null }>;
    };
    expect(body.provider).toEqual({
      status: "not-configured",
      checkedAt: null,
      awaitingVerification: [],
    });
    for (const choice of body.models) expect(choice.published).toBeNull();
  });

  it("refuses a model that is not on the roster, and pins a chosen one until the firm chooses again", async () => {
    const refused = await patchSettings(ownerCookie, {
      model: { modelId: "anthropic/not-a-real-model" },
    });
    expect(refused.status).toBe(422);

    const before = (await (await readSettings(ownerCookie)).json()) as AiSettings;
    const other = before.models.find((choice) => !choice.platformDefault);
    expect(other).toBeDefined();
    if (other === undefined) return;

    const chosen = await patchSettings(ownerCookie, { model: { modelId: other.modelId } });
    expect(chosen.status).toBe(200);
    const pinned = (await chosen.json()) as AiSettings;
    expect(pinned.model?.modelId).toBe(other.modelId);
    expect(pinned.model?.selection).toBe("chosen");
    expect(await readFirmSetting(firmDatabase, primaryReasoningModelDefinition)).toBe(
      other.modelId,
    );

    // Choosing the platform's option is the ABSENCE of a row, so the firm moves forward with the
    // platform again rather than being pinned to today's default.
    const released = await patchSettings(ownerCookie, { model: { modelId: null } });
    expect(released.status).toBe(200);
    const following = (await released.json()) as AiSettings;
    expect(following.model?.selection).toBe("platform");
    expect(following.model?.modelId).toBe(primaryReasoningModelDefinition.defaultValue);
  });

  // THE SEAM. What this screen writes is what the assistant's consent resolver reads: the route
  // exists to open the two gates that apps/api-worker/src/magnus/consent.ts fails closed on, and a
  // screen that wrote settings the resolver did not read would look like it worked and do nothing.
  it("is read by the assistant's own consent resolver", async () => {
    // Assistant on, processing off: the resolver names the OUTER gate, because that is the one the
    // firm has to open first and the one the member's screen must be told about.
    await patchSettings(ownerCookie, {
      aiProcessing: { eligible: false },
      magnus: { enabled: true },
    });
    expect(await resolveMagnusFirmGates(firmDatabase)).toBe("firm-ineligible");

    // Processing on, assistant off: the same firm, the other gate.
    await patchSettings(ownerCookie, {
      aiProcessing: { eligible: true },
      magnus: { enabled: false },
    });
    expect(await resolveMagnusFirmGates(firmDatabase)).toBe("feature-disabled");

    // Both open — the only state in which anything a member types reaches a provider.
    await patchSettings(ownerCookie, { magnus: { enabled: true } });
    expect(await resolveMagnusFirmGates(firmDatabase)).toBe("open");
  });
});
