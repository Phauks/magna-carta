import { env, runInDurableObject, SELF } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import type { BundleBuildCoordinator } from "../src/downloads/bundle-coordinator.ts";
import type { BundleBuildMessage } from "../src/downloads/bundle-types.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The bundle-status poll endpoint through the chokepoint over real Miniflare bindings. The coordinator
// DO is primed directly (its BUNDLE_BUILD binding swapped for a no-op so priming never enqueues a real
// build), then the route is polled over HTTP. The per-firm isolation check primes a job under a
// different firm's DO name and confirms the caller — keyed by its session firm — cannot see it.

let firmId: FirmId;
let ownerCookie: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  firmId = (await seedFirm({ name: "Bundle Status Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();
  const owner = await seedCredentialedUser("bundle-owner@example.com", {
    userName: "Bundle Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Bundle Owner");
  ownerCookie = await signInForSessionCookie("bundle-owner@example.com");
});

function message(hash: string): BundleBuildMessage {
  return {
    firmId,
    bucketName: "R2",
    manifestHash: hash,
    entries: [{ r2Key: "files/x/v1", path: "x.txt" }],
  };
}

// Primes a coordinator DO to `building` without enqueuing a real build (its BUNDLE_BUILD send is a
// no-op for the priming call only).
async function primeBuilding(name: string, hash: string) {
  const stub = env.BUNDLE_COORDINATOR.get(env.BUNDLE_COORDINATOR.idFromName(name));
  await runInDurableObject(stub, async (instance: BundleBuildCoordinator) => {
    const mutable = instance as unknown as { env: Record<string, unknown> };
    mutable.env = { ...mutable.env, BUNDLE_BUILD: { send: async () => {} } };
    await instance.requestBundle(message(hash));
  });
  return stub;
}

async function poll(hash: string): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/downloads/bundles/${hash}`, {
    headers: { cookie: ownerCookie, origin: "https://example.com" },
  });
}

describe("GET /api/v1/downloads/bundles/{manifestHash}", () => {
  it("reports a building job and carries no URL", async () => {
    const hash = "a".repeat(64);
    await primeBuilding(`${firmId}:${hash}`, hash);
    const response = await poll(hash);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; url?: string };
    expect(body.status).toBe("building");
    expect(body.url).toBeUndefined();
  });

  it("mints a fresh signed URL for a ready job whose artifact exists", async () => {
    const hash = "b".repeat(64);
    await env.R2.put(`bundles/${hash}.zip`, "PK-fake-zip");
    const stub = await primeBuilding(`${firmId}:${hash}`, hash);
    await stub.markReady(`bundles/${hash}.zip`);
    const response = await poll(hash);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; url?: string };
    expect(body.status).toBe("ready");
    expect(body.url ?? "").toContain("dev-presigned=get");
  });

  it("reports expired (no URL) when the ready artifact has been reaped", async () => {
    const hash = "d".repeat(64);
    // Ready in the DO, but no object in R2 — the lifecycle rule reaped it. A poll must not hand out a
    // URL that 404s; it reports `expired` so the client re-requests a build.
    const stub = await primeBuilding(`${firmId}:${hash}`, hash);
    await stub.markReady(`bundles/${hash}.zip`);
    const response = await poll(hash);
    const body = (await response.json()) as { status: string; url?: string };
    expect(body.status).toBe("expired");
    expect(body.url).toBeUndefined();
  });

  it("never reads another firm's job (the DO name carries the session firm id)", async () => {
    const hash = "c".repeat(64);
    const otherFirmId = newIdentifier("firm");
    // A ready job exists under a DIFFERENT firm's DO name; the caller's own DO (firmId:hash) is
    // separate and was never built, so the caller can never see the other firm's ready state or URL.
    const otherStub = await primeBuilding(`${otherFirmId}:${hash}`, hash);
    await otherStub.markReady(`bundles/${hash}.zip`);
    const response = await poll(hash);
    const body = (await response.json()) as { status: string; url?: string };
    expect(body.status).not.toBe("ready");
    expect(body.url).toBeUndefined();
  });
});
