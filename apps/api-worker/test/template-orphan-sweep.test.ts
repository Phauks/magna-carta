import { env } from "cloudflare:test";
import { TEMPLATE_STAGING_PREFIX } from "@magna-carta/document-assembly/template-service";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { runTemplateOrphanSweep } from "../src/background/assemblies/template-orphan-sweep.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseHandle } from "./support/firm-database-handle.ts";

// The collector for template objects no row names. Registering a template writes its bytes to R2
// before the rows naming them commit, so a registration that throws in between leaves a full copy
// behind that nothing else in the platform can recognize as garbage.
//
// This pass DELETES NOTHING today — it reports what a collecting pass would take. The rules are
// still worth pinning exactly: they are what a future collector would arm, and a candidate rule that
// over-reports quietly becomes a collector that over-deletes.
//
// What is worth proving is entirely about what it does NOT name as garbage: a live template's object, a
// staged upload that is legitimately named by no version row, an object young enough to still be
// mid-registration, and — the one that would be data loss rather than waste — another firm's live
// template, whose key is absent from THIS firm's version set for exactly the same reason an orphan's
// is. Only after those does the collection itself matter.
//
// Age is controlled by moving the sweep's clock rather than the objects: R2 stamps an upload time
// this suite cannot backdate, so the pass takes its `now` the way the search compaction sweep takes
// its own.

const CREATED_AT = "2026-07-01T00:00:00.000Z";
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

let firmId: FirmId;
let otherFirmId: FirmId;
let firmDb: ReturnType<typeof firmDatabaseHandle>;
let otherFirmDb: ReturnType<typeof firmDatabaseHandle>;

async function seedFirm(name: string, bucket: string): Promise<FirmId> {
  const id = newIdentifier("firm");
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, bucket_name, status, created_at) VALUES (?1, ?2, ?3, 'active', ?4)",
  )
    .bind(id, name, bucket, CREATED_AT)
    .run();
  return id;
}

// A registered template version and the object behind it — the retention set the sweep complements.
async function seedTemplateVersion(
  database: ReturnType<typeof firmDatabaseHandle>,
  bytes: Uint8Array,
): Promise<string> {
  const templateId = newIdentifier("documentTemplate");
  const versionId = newIdentifier("documentTemplateVersion");
  const r2Key = `templates/${templateId}/${versionId}`;
  await database
    .prepare(
      "INSERT INTO document_template (id, name, status, created_at, updated_at) VALUES (?1, 'Retainer', 'active', ?2, ?2)",
    )
    .bind(templateId, CREATED_AT)
    .run();
  await database
    .prepare(
      "INSERT INTO document_template_version (id, template_id, version_number, kind, r2_key, size_bytes, status, created_at) VALUES (?1, ?2, 1, 'wordProcessing', ?3, ?4, 'clean', ?5)",
    )
    .bind(versionId, templateId, r2Key, bytes.byteLength, CREATED_AT)
    .run();
  await env.R2.put(r2Key, bytes);
  return r2Key;
}

// The bytes of a registration that threw after the object write: a key nothing will ever name.
async function putUnnamedObject(bytes: Uint8Array): Promise<string> {
  const key = `templates/${newIdentifier("documentTemplate")}/${newIdentifier("documentTemplateVersion")}`;
  await env.R2.put(key, bytes);
  return key;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = await seedFirm("Orphan Sweep Firm", "magna-carta-test-template-orphan-bucket");
  otherFirmId = await seedFirm("Neighbour Firm", "magna-carta-test-template-neighbour-bucket");
  firmDb = firmDatabaseHandle(firmId);
  otherFirmDb = firmDatabaseHandle(otherFirmId);
});

describe("runTemplateOrphanSweep", () => {
  it("leaves an object written moments ago alone, however unnamed it is", async () => {
    const fresh = await putUnnamedObject(new TextEncoder().encode("mid-registration"));

    // The real clock: the object is inside the grace period, which is the window in which its row
    // may still be committing.
    const report = await runTemplateOrphanSweep(env);

    expect(report.disarmed).toBe(false);
    expect(report.orphansFound).toBe(0);
    expect(await env.R2.head(fresh)).not.toBeNull();
    // The pool's bucket is shared across the tests in this file, and the next one moves the clock
    // two days on — where this object would be collected as an aged orphan and count against a
    // deletion total that is asserted exactly. Removing it keeps each test's arithmetic its own.
    await env.R2.delete(fresh);
  });

  it("collects an aged unnamed object and keeps the live template, the staged upload, and the neighbour firm's template", async () => {
    const bytes = new TextEncoder().encode("the stored template bytes");
    const live = await seedTemplateVersion(firmDb, bytes);
    const neighbourLive = await seedTemplateVersion(otherFirmDb, bytes);
    const staged = `${TEMPLATE_STAGING_PREFIX}${firmId}/${newIdentifier("documentTemplateVersion")}`;
    await env.R2.put(staged, bytes);
    const orphan = await putUnnamedObject(bytes);

    // Two days on: every object above is past the grace period, so survival can only come from the
    // retention set or the staging rule.
    const report = await runTemplateOrphanSweep(env, {
      nowMilliseconds: Date.now() + 2 * DAY_MILLISECONDS,
    });

    expect(report.disarmed).toBe(false);
    expect(report.orphansFound).toBe(1);
    expect(report.bytesRecoverable).toBe(bytes.byteLength);
    // Reported, never removed. This pass measures the leak; nothing here collects it.
    expect(await env.R2.head(orphan)).not.toBeNull();
    expect(await env.R2.head(live)).not.toBeNull();
    expect(await env.R2.head(staged)).not.toBeNull();
    // The one that would be data loss: this key is in no version row of the firm whose pass listed
    // it, and it is a live template all the same.
    expect(await env.R2.head(neighbourLive)).not.toBeNull();

    // The pass leaves everything where it found it, so a test that plants an orphan now has to
    // remove its own. The store is not rolled back between tests in this file, and a survivor would
    // be counted again by the next pass.
    await env.R2.delete(orphan);
    await env.R2.delete(staged);
  });

  it("keeps every live template when the retention set spans more than one page", async () => {
    // The retention read is paged, and the paging is load-bearing: an unpaged read that overflowed
    // one response would throw, which disarms the pass for the WHOLE fleet, every night, silently.
    // A walk that dropped or repeated rows would be worse — a dropped key is a live template that
    // reads as garbage. Driven with a page size of 2 over 5 versions so the boundary is crossed
    // three times, including a final short page.
    const bytes = new TextEncoder().encode("paged");
    const live: string[] = [];
    for (let index = 0; index < 5; index++) live.push(await seedTemplateVersion(firmDb, bytes));
    const orphan = await putUnnamedObject(bytes);

    const report = await runTemplateOrphanSweep(env, {
      nowMilliseconds: Date.now() + 2 * DAY_MILLISECONDS,
      retentionPageSize: 2,
    });

    expect(report.disarmed).toBe(false);
    // Exactly the one key no row names — every paged-in live key was retained.
    expect(report.orphansFound).toBe(1);
    for (const key of live) await env.R2.delete(key);
    await env.R2.delete(orphan);
  });

  it("deletes nothing at all when a firm's retention read fails", async () => {
    // The guard that matters most, and the one that is easiest to ship untested. Every template key
    // lives in one bucket today, so the retention set is the union over the fleet — and a set that
    // is missing one firm's rows does not describe a smaller problem, it describes every one of that
    // firm's live templates as an orphan. Disarming is the only safe reading of an incomplete set.
    const aged = await putUnnamedObject(new Uint8Array([9, 9, 9]));
    const live = await seedTemplateVersion(firmDb, new Uint8Array([8, 8, 8]));

    const report = await runTemplateOrphanSweep(
      { ...env, FIRM_DATABASE: undefined } as unknown as typeof env,
      { nowMilliseconds: Date.parse(CREATED_AT) + 30 * DAY_MILLISECONDS },
    );

    expect(report.disarmed).toBe(true);
    expect(report.orphansFound).toBe(0);
    // The aged orphan is genuinely collectable and still survives — disarmed means disarmed, not
    // "collect the ones we are sure about".
    expect(await env.R2.head(aged)).not.toBeNull();
    expect(await env.R2.head(live)).not.toBeNull();
    await env.R2.delete(aged);
  });

  it("stops at the per-firm cap and reports the truncation rather than swallowing it", async () => {
    const bytes = new TextEncoder().encode("orphaned");
    const orphans: string[] = [];
    for (let index = 0; index < 5; index++) orphans.push(await putUnnamedObject(bytes));

    const report = await runTemplateOrphanSweep(env, {
      nowMilliseconds: Date.now() + 2 * DAY_MILLISECONDS,
      perFirmExamineCap: 2,
    });

    // Two firms are active and both resolve to the same bound bucket, so each pass walks the SAME
    // prefix and the cap binds per pass rather than per firm's own objects. The report counts
    // DISTINCT keys, so the two passes seeing the same two candidates report two — not four
    // sightings. Reporting sightings would make the leak look twice its size and would scale the
    // number with tenancy rather than with the problem.
    expect(report.orphansFound).toBe(2);
    // The number the `storage.template_orphan.cap_reached` counter is emitted from. The counter
    // itself has no readable sink under the local pool (no Analytics Engine to read back), and the
    // metric's declaration is enforced by the repo-wide catalog scan in @magna-carta/telemetry.
    expect(report.firmsCapped).toBe(2);
    // Every one of them is still there: a capped pass and an uncapped pass both collect nothing.
    const survivors = await Promise.all(orphans.map((key) => env.R2.head(key)));
    expect(survivors.filter((object) => object !== null)).toHaveLength(5);
    for (const key of orphans) await env.R2.delete(key);
  });
});
