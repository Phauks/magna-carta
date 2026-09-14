import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  MAX_ADDITIONAL_BRAND_IMAGES,
  readFirmPrimaryBrandImage,
  removeFirmBrandImage,
  setFirmBrandImage,
  updateFirmBrandImage,
} from "../src/brand-image-service.ts";
import { readFirmBrandImages } from "../src/brand-image-statements.ts";

const clock = { now: () => "2026-09-11T12:00:00.000Z" };
const now = () => clock.now();
const options = { clock, actorUserId: "user_actor" as UserId };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

function image(sha256: string, role: "primary" | "additional", label: string | null = null) {
  return {
    sha256,
    role,
    label,
    objectKey: `brand/${sha256}.png`,
    contentType: "image/png",
    sizeBytes: 1200,
    widthPixels: 400,
    heightPixels: 100,
  };
}

async function hold(
  database: BatchDatabase,
  sha256: string,
  role: "primary" | "additional",
  label: string | null = null,
): Promise<void> {
  const { effect } = await setFirmBrandImage(database, image(sha256, role, label), options);
  await commitEffectBatch(database, effect, { now });
}

describe("setFirmBrandImage", () => {
  it("records the mark under its own hash, with the facts a document needs to draw it", async () => {
    const database = freshDatabase();
    await hold(database, "a".repeat(64), "primary", "  Seal ");
    const held = await readFirmBrandImages(database);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      id: "a".repeat(64),
      role: "primary",
      // Trimmed: a caption is what a reader typed, not the whitespace around it.
      label: "Seal",
      objectKey: `brand/${"a".repeat(64)}.png`,
      contentType: "image/png",
      widthPixels: 400,
      heightPixels: 100,
    });
  });

  it("a second primary DEMOTES the first rather than removing it", async () => {
    const database = freshDatabase();
    await hold(database, "a".repeat(64), "primary");
    await hold(database, "b".repeat(64), "primary");
    const held = await readFirmBrandImages(database);
    expect(held.map((row) => [row.id.slice(0, 1), row.role])).toEqual([
      ["b", "primary"],
      ["a", "additional"],
    ]);
    expect((await readFirmPrimaryBrandImage(database))?.id).toBe("b".repeat(64));
  });

  it("the same bytes again is the same row, re-filed under the new role and caption", async () => {
    const database = freshDatabase();
    await hold(database, "a".repeat(64), "additional", "Wordmark");
    await hold(database, "a".repeat(64), "primary", "The mark");
    const held = await readFirmBrandImages(database);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ role: "primary", label: "The mark" });
  });

  it("refuses a format the assembly engine will not draw", async () => {
    const database = freshDatabase();
    await expect(
      setFirmBrandImage(
        database,
        { ...image("c".repeat(64), "primary"), contentType: "image/svg+xml" },
        options,
      ),
    ).rejects.toMatchObject({ code: "unsupported-logo-format" });
  });

  it("bounds the additional set, so a letterhead can resolve it in one read", async () => {
    const database = freshDatabase();
    for (let index = 0; index < MAX_ADDITIONAL_BRAND_IMAGES; index += 1) {
      await hold(database, String(index).padStart(64, "0"), "additional");
    }
    await expect(
      setFirmBrandImage(database, image("f".repeat(64), "additional"), options),
    ).rejects.toMatchObject({ code: "too-many-brand-images" });
    // A primary is never refused by the bound: it is the one mark the letterhead prints.
    await hold(database, "e".repeat(64), "primary");
  });

  it("writes an audit row in the same batch", async () => {
    const database = freshDatabase();
    await hold(database, "a".repeat(64), "primary");
    const audit = await database
      .prepare("SELECT event, subject_id FROM audit_log WHERE subject_id = ?1")
      .bind("a".repeat(64))
      .all();
    expect(audit.results).toEqual([{ event: "firm.brand_image_set", subject_id: "a".repeat(64) }]);
  });
});

describe("updateFirmBrandImage", () => {
  it("promotes an additional image to primary and demotes the one that was", async () => {
    const database = freshDatabase();
    await hold(database, "a".repeat(64), "primary");
    await hold(database, "b".repeat(64), "additional", "Seal");
    const { effect } = await updateFirmBrandImage(
      database,
      "b".repeat(64),
      { role: "primary" },
      options,
    );
    await commitEffectBatch(database, effect, { now });
    const held = await readFirmBrandImages(database);
    expect(held.map((row) => [row.id.slice(0, 1), row.role, row.label])).toEqual([
      ["b", "primary", "Seal"],
      ["a", "additional", null],
    ]);
  });

  it("refuses an image the firm does not hold", async () => {
    const database = freshDatabase();
    await expect(
      updateFirmBrandImage(database, "d".repeat(64), { label: "x" }, options),
    ).rejects.toMatchObject({ code: "unknown-brand-image" });
  });
});

describe("removeFirmBrandImage", () => {
  it("drops the row and hands the caller the object key to sweep", async () => {
    const database = freshDatabase();
    await hold(database, "a".repeat(64), "primary");
    const removed = await removeFirmBrandImage(database, "a".repeat(64), options);
    await commitEffectBatch(database, removed.effect, { now });
    expect(removed.removedObjectKey).toBe(`brand/${"a".repeat(64)}.png`);
    expect(await readFirmBrandImages(database)).toEqual([]);
    expect(await readFirmPrimaryBrandImage(database)).toBeUndefined();
  });
});
