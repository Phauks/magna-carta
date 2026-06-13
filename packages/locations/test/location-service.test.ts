import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { LocationId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  assignMemberLocations,
  closeLocation,
  createLocation,
  setLocationAddresses,
  updateLocation,
} from "../src/location-service.ts";
import { LocationValidationError } from "../src/validation.ts";

const clock = { now: () => "2026-06-13T12:00:00.000Z" };
const now = () => clock.now();
const actorUserId = "user_actor" as UserId;
const options = { clock, actorUserId };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedLocation(
  database: BatchDatabase,
  input: { name: string; numberCode?: string },
): Promise<LocationId> {
  const { locationId, effect } = await createLocation(database, input, options);
  await commitEffectBatch(database, effect, { now });
  return locationId;
}

// A member row must exist before member_location can reference it (FK).
async function seedMember(database: BatchDatabase, userId: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, 'active', ?3)",
    )
    .bind(userId, "Member", clock.now())
    .run();
}

describe("createLocation", () => {
  it("writes an active location row with the given fields", async () => {
    const database = freshDatabase();
    const { locationId, effect } = await createLocation(
      database,
      { name: "Reno", jurisdiction: "US-NV", numberCode: "RENO", remitTo: "PO Box 1" },
      options,
    );
    await commitEffectBatch(database, effect, { now });
    const { results } = await database
      .prepare(
        "SELECT name, status, jurisdiction, number_code, remit_to FROM location WHERE id = ?1",
      )
      .bind(locationId)
      .all();
    expect(results[0]).toEqual({
      name: "Reno",
      status: "active",
      jurisdiction: "US-NV",
      number_code: "RENO",
      remit_to: "PO Box 1",
    });
  });

  it("emits a location.created outbox message and an audit row in the same batch", async () => {
    const database = freshDatabase();
    const { locationId, effect } = await createLocation(database, { name: "Reno" }, options);
    expect(effect.outboxMessages).toEqual([
      { topic: "location.created", payload: { locationId, name: "Reno" } },
    ]);
    await commitEffectBatch(database, effect, { now });
    const audit = await database
      .prepare("SELECT event, actor_user_id, subject_id FROM audit_log WHERE subject_id = ?1")
      .bind(locationId)
      .all();
    expect(audit.results[0]).toEqual({
      event: "location.created",
      actor_user_id: actorUserId,
      subject_id: locationId,
    });
  });

  it("refuses an empty name with a named code", async () => {
    const database = freshDatabase();
    await expect(createLocation(database, { name: "  " }, options)).rejects.toMatchObject({
      code: "empty-location-name",
    });
  });
});

describe("updateLocation", () => {
  it("merges a partial patch, leaving unspecified fields untouched", async () => {
    const database = freshDatabase();
    const locationId = await seedLocation(database, { name: "Reno", numberCode: "RENO" });
    const { effect } = await updateLocation(
      database,
      locationId,
      { remitTo: "New Remit" },
      options,
    );
    await commitEffectBatch(database, effect, { now });
    const { results } = await database
      .prepare("SELECT name, number_code, remit_to FROM location WHERE id = ?1")
      .bind(locationId)
      .all();
    expect(results[0]).toEqual({ name: "Reno", number_code: "RENO", remit_to: "New Remit" });
  });

  it("refuses an unknown location", async () => {
    const database = freshDatabase();
    await expect(
      updateLocation(database, "location_missing" as LocationId, { name: "X" }, options),
    ).rejects.toMatchObject({ code: "unknown-location" });
  });

  it("refuses an empty name", async () => {
    const database = freshDatabase();
    const locationId = await seedLocation(database, { name: "Reno" });
    await expect(updateLocation(database, locationId, { name: "" }, options)).rejects.toMatchObject(
      { code: "empty-location-name" },
    );
  });
});

describe("closeLocation", () => {
  it("soft-closes the location (status only, row preserved)", async () => {
    const database = freshDatabase();
    const locationId = await seedLocation(database, { name: "Reno" });
    const { effect } = await closeLocation(database, locationId, {
      ...options,
      firmDefaultLocationId: null,
    });
    await commitEffectBatch(database, effect, { now });
    const { results } = await database
      .prepare("SELECT status FROM location WHERE id = ?1")
      .bind(locationId)
      .all();
    expect(results[0]).toEqual({ status: "closed" });
  });

  it("refuses to close the firm-default location", async () => {
    const database = freshDatabase();
    const locationId = await seedLocation(database, { name: "Reno" });
    await expect(
      closeLocation(database, locationId, { ...options, firmDefaultLocationId: locationId }),
    ).rejects.toMatchObject({ code: "location-is-firm-default" });
  });

  it("refuses an unknown location", async () => {
    const database = freshDatabase();
    await expect(
      closeLocation(database, "location_missing" as LocationId, {
        ...options,
        firmDefaultLocationId: null,
      }),
    ).rejects.toMatchObject({ code: "unknown-location" });
  });
});

describe("setLocationAddresses", () => {
  it("replaces the address set (delete-then-insert)", async () => {
    const database = freshDatabase();
    const locationId = await seedLocation(database, { name: "Reno" });
    const first = await setLocationAddresses(
      database,
      locationId,
      [{ kind: "physical", street: "1 First St" }],
      options,
    );
    await commitEffectBatch(database, first.effect, { now });
    const second = await setLocationAddresses(
      database,
      locationId,
      [
        { kind: "physical", street: "2 Second St" },
        { kind: "mailing", street: "PO Box 9" },
      ],
      options,
    );
    await commitEffectBatch(database, second.effect, { now });
    const { results } = await database
      .prepare("SELECT kind, street FROM location_address WHERE location_id = ?1 ORDER BY kind")
      .bind(locationId)
      .all();
    expect(results).toEqual([
      { kind: "mailing", street: "PO Box 9" },
      { kind: "physical", street: "2 Second St" },
    ]);
  });

  it("refuses two addresses of the same kind", async () => {
    const database = freshDatabase();
    const locationId = await seedLocation(database, { name: "Reno" });
    await expect(
      setLocationAddresses(
        database,
        locationId,
        [
          { kind: "physical", street: "A" },
          { kind: "physical", street: "B" },
        ],
        options,
      ),
    ).rejects.toMatchObject({ code: "duplicate-address-kind" });
  });

  it("refuses an unknown location", async () => {
    const database = freshDatabase();
    await expect(
      setLocationAddresses(database, "location_missing" as LocationId, [], options),
    ).rejects.toMatchObject({ code: "unknown-location" });
  });
});

describe("assignMemberLocations", () => {
  it("replaces a member's assignments with exactly one primary", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    const vegas = await seedLocation(database, { name: "Vegas" });
    await seedMember(database, "user_paralegal");
    const { effect } = await assignMemberLocations(
      database,
      "user_paralegal" as UserId,
      [
        { locationId: reno, isPrimary: true },
        { locationId: vegas, isPrimary: false },
      ],
      options,
    );
    await commitEffectBatch(database, effect, { now });
    const { results } = await database
      .prepare(
        "SELECT location_id, is_primary FROM member_location WHERE member_user_id = ?1 ORDER BY is_primary DESC",
      )
      .bind("user_paralegal")
      .all();
    expect(results).toEqual([
      { location_id: reno, is_primary: 1 },
      { location_id: vegas, is_primary: 0 },
    ]);
  });

  it("refuses an assignment set with no primary", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    await seedMember(database, "user_x");
    await expect(
      assignMemberLocations(
        database,
        "user_x" as UserId,
        [{ locationId: reno, isPrimary: false }],
        options,
      ),
    ).rejects.toMatchObject({ code: "member-needs-one-primary" });
  });

  it("refuses an assignment set with more than one primary", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    const vegas = await seedLocation(database, { name: "Vegas" });
    await seedMember(database, "user_y");
    await expect(
      assignMemberLocations(
        database,
        "user_y" as UserId,
        [
          { locationId: reno, isPrimary: true },
          { locationId: vegas, isPrimary: true },
        ],
        options,
      ),
    ).rejects.toMatchObject({ code: "member-needs-one-primary" });
  });

  it("allows clearing all assignments (no primary required when empty)", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    await seedMember(database, "user_z");
    const assigned = await assignMemberLocations(
      database,
      "user_z" as UserId,
      [{ locationId: reno, isPrimary: true }],
      options,
    );
    await commitEffectBatch(database, assigned.effect, { now });
    const cleared = await assignMemberLocations(database, "user_z" as UserId, [], options);
    await commitEffectBatch(database, cleared.effect, { now });
    const { results } = await database
      .prepare("SELECT COUNT(*) AS n FROM member_location WHERE member_user_id = ?1")
      .bind("user_z")
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(0);
  });
});

it("LocationValidationError carries a stable code", () => {
  const error = new LocationValidationError("empty-location-name", "x");
  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe("empty-location-name");
});
