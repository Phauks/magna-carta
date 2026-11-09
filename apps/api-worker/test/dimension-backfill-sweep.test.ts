import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterId } from "@magna-carta/identifiers/types";
import {
  matterScopedObjectDimensions,
  objectIsStamped,
} from "@magna-carta/object-dimensions/dimensions";
import { beforeAll, describe, expect, it } from "vitest";
import { runDimensionBackfillSweep } from "../src/background/files/dimension-backfill-sweep.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseHandle } from "./support/firm-database-handle.ts";

// The repair pass for objects written before their scope travelled with them: it finds the unstamped
// ones by listing the bucket, resolves each one's matter from the firm's own records, and rewrites the
// object's metadata without touching its bytes. What is worth proving here is the convergence: a pass
// leaves strictly fewer unstamped objects than it found, an already-stamped object is never rewritten,
// and an object whose file is gone is counted rather than guessed at — so it can never eat the budget.

const BUCKET = "magna-carta-test-dimension-bucket";
const MEMBER = "user_backfill";
const CREATED_AT = "2026-07-01T00:00:00.000Z";

let firmDb: ReturnType<typeof firmDatabaseHandle>;
let matterId: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  const firmId = newIdentifier("firm");
  firmDb = firmDatabaseHandle(firmId);
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, database_identifier, bucket_name, status, created_at) VALUES (?1, 'Backfill Firm', 'DB_FIRM_POOL_1', ?2, 'active', ?3)",
  )
    .bind(firmId, BUCKET, CREATED_AT)
    .run();
  await firmDb
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Backfiller', 'active', ?2)",
    )
    .bind(MEMBER, CREATED_AT)
    .run();
  matterId = newIdentifier("matter");
  await firmDb
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, MEMBER, CREATED_AT)
    .run();
});

async function seedFile(): Promise<string> {
  const fileId = newIdentifier("file");
  await firmDb
    .prepare(
      "INSERT INTO file (id, matter_id, name, current_version_id, created_at, updated_at) VALUES (?1, ?2, 'Brief.docx', NULL, ?3, ?3)",
    )
    .bind(fileId, matterId, CREATED_AT)
    .run();
  return fileId;
}

async function dimensionsOf(key: string): Promise<Record<string, string> | undefined> {
  const object = await env.R2.head(key);
  return object?.customMetadata;
}

describe("runDimensionBackfillSweep", () => {
  it("stamps an unstamped version, keeps its bytes, and leaves a stamped object alone", async () => {
    const unstampedFileId = await seedFile();
    const stampedFileId = await seedFile();
    const unstampedKey = `files/${unstampedFileId}/${newIdentifier("fileVersion")}`;
    const stampedKey = `files/${stampedFileId}/${newIdentifier("fileVersion")}`;
    const bytes = new TextEncoder().encode("the document bytes");
    await env.R2.put(unstampedKey, bytes);
    const alreadyStamped = matterScopedObjectDimensions({
      objectClass: "working-document",
      matterId: matterId as MatterId,
    });
    await env.R2.put(stampedKey, bytes, { customMetadata: alreadyStamped });

    const report = await runDimensionBackfillSweep(env);

    expect(report.stamped).toBeGreaterThanOrEqual(1);
    expect(await dimensionsOf(unstampedKey)).toEqual({
      matter: matterId,
      object_class: "working-document",
    });
    // The bytes are the same bytes: this pass rewrites metadata, never content.
    const rewritten = await env.R2.get(unstampedKey);
    expect(await rewritten?.text()).toBe("the document bytes");
    expect(await dimensionsOf(stampedKey)).toEqual(alreadyStamped);
  });

  it("stamps a live working copy as a working copy, never as a committed version", async () => {
    const fileId = await seedFile();
    const currentKey = `files/${fileId}/current`;
    await env.R2.put(currentKey, new TextEncoder().encode("half-typed"));

    await runDimensionBackfillSweep(env);

    expect(await dimensionsOf(currentKey)).toEqual({
      matter: matterId,
      object_class: "working-copy",
    });
  });

  it("covers the bulk lane on the same pass", async () => {
    const fileId = await seedFile();
    const bulkKey = `bulk/${fileId}/${newIdentifier("fileVersion")}`;
    await env.R2.put(bulkKey, new TextEncoder().encode("bulk bytes"));

    await runDimensionBackfillSweep(env);

    expect(await dimensionsOf(bulkKey)).toEqual({
      matter: matterId,
      object_class: "working-document",
    });
  });

  it("leaves an object whose file is gone alone, and never lets it spend the rewrite budget", async () => {
    const orphanKeys = [
      `files/${newIdentifier("file")}/${newIdentifier("fileVersion")}`,
      `files/${newIdentifier("file")}/${newIdentifier("fileVersion")}`,
    ];
    for (const key of orphanKeys) await env.R2.put(key, new TextEncoder().encode("orphan"));
    const resolvableFileId = await seedFile();
    const resolvableKey = `files/${resolvableFileId}/${newIdentifier("fileVersion")}`;
    await env.R2.put(resolvableKey, new TextEncoder().encode("resolvable"));

    // A budget of one against two orphans: whichever order the listing returns them in, the one
    // object that CAN be repaired is repaired — an orphan that can never resolve must not be able to
    // consume the budget night after night and starve the objects that can.
    const report = await runDimensionBackfillSweep(env, { perFirmRewriteBudget: 1 });

    expect(report.stamped).toBe(1);
    expect(objectIsStamped(await dimensionsOf(resolvableKey))).toBe(true);
    for (const key of orphanKeys) {
      expect(objectIsStamped(await dimensionsOf(key))).toBe(false);
    }
  });

  it("converges: a second pass over the same bucket has nothing left to do", async () => {
    const fileId = await seedFile();
    const key = `files/${fileId}/${newIdentifier("fileVersion")}`;
    await env.R2.put(key, new TextEncoder().encode("converge"));

    const first = await runDimensionBackfillSweep(env);
    expect(first.stamped).toBeGreaterThanOrEqual(1);
    const second = await runDimensionBackfillSweep(env);
    expect(second.stamped).toBe(0);
  });
});
