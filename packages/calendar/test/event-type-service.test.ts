import { describe, expect, it } from "vitest";
import {
  createMatterEventType,
  deactivateMatterEventType,
  updateMatterEventType,
} from "../src/event-type-service.ts";
import { readMatterEventTypes } from "../src/event-type-statements.ts";
import type { MatterEventTypeId } from "@magna-carta/identifiers/types";
import { commit, migratedDatabase, options, seedMatters } from "./support.ts";

const PLATFORM_HEARING = "matterEventType_hearing00000000000000" as MatterEventTypeId;

describe("the event-type catalog is platform-seeded and firm-extensible", () => {
  it("ships the starting vocabulary as platform rows", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const types = await readMatterEventTypes(database);
    const hearing = types.find((type) => type.code === "HEARING");
    expect(hearing?.origin).toBe("platform");
    expect(hearing?.category).toBe("litigation");
    expect(types.some((type) => type.category === "firm")).toBe(true);
  });

  it("lets a firm add its own type", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { eventTypeId, effect } = await createMatterEventType(
      database,
      { name: "Probate citation return", code: "CITATION" },
      options,
    );
    await commit(database, effect);
    const types = await readMatterEventTypes(database);
    const created = types.find((type) => type.id === eventTypeId);
    // A firm cannot mint a platform row: the shared vocabulary arrives only by migration.
    expect(created?.origin).toBe("firm");
  });

  it("refuses a firm row whose name collides with an existing type", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    await expect(createMatterEventType(database, { name: "Hearing" }, options)).rejects.toThrow(
      /already exists/,
    );
  });

  it("refuses to rename or recode a platform row, and permits deactivating it", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    await expect(
      updateMatterEventType(database, PLATFORM_HEARING, { name: "Court appearance" }, options),
    ).rejects.toThrow(/shared vocabulary/);
    await expect(
      updateMatterEventType(database, PLATFORM_HEARING, { code: "APPEARANCE" }, options),
    ).rejects.toThrow(/shared vocabulary/);

    // A firm whose practice never sees one should not have to look at it, and nothing already
    // classified under it loses its meaning.
    const { effect } = await deactivateMatterEventType(database, PLATFORM_HEARING, options);
    await commit(database, effect);
    const active = await readMatterEventTypes(database);
    expect(active.some((type) => type.id === PLATFORM_HEARING)).toBe(false);
    const all = await readMatterEventTypes(database, true);
    expect(all.some((type) => type.id === PLATFORM_HEARING)).toBe(true);
  });

  it("permits recategorizing a platform row, which changes no shared meaning", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { effect } = await updateMatterEventType(
      database,
      PLATFORM_HEARING,
      { category: "other" },
      options,
    );
    await commit(database, effect);
    const all = await readMatterEventTypes(database, true);
    expect(all.find((type) => type.id === PLATFORM_HEARING)?.category).toBe("other");
  });
});
