import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { LocationId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  addMemberToLocation,
  assignMemberLocations,
  clearLetterheadLogo,
  closeLocation,
  createLocation,
  removeMemberFromLocation,
  setFirmDefaultLocation,
  setLetterheadLogo,
  setLocationAddresses,
  updateLocation,
} from "../src/location-service.ts";
import { readMemberLocations, readMemberPrimaryOfficeRegion } from "../src/statements.ts";
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

describe("the letterhead logo", () => {
  const logo = {
    objectKey: "letterhead/location_x/abc123.png",
    contentType: "image/png",
    sizeBytes: 4096,
    sha256: "abc123",
    widthPixels: 400,
    heightPixels: 100,
    widthEmu: 1_828_800,
  };

  it("stores the object key, what the bytes are, and the width the mark prints at", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    const written = await setLetterheadLogo(database, reno, logo, options);
    await commitEffectBatch(database, written.effect, { now });
    // Nothing was pointing at an object before, so there is nothing for the caller to sweep.
    expect(written.replacedObjectKey).toBeNull();

    const { results } = await database
      .prepare(
        "SELECT letterhead_logo_object_key, letterhead_logo_content_type, letterhead_logo_width_pixels, letterhead_logo_height_pixels, letterhead_logo_width_emu FROM location WHERE id = ?1",
      )
      .bind(reno)
      .all();
    expect(results[0]).toEqual({
      letterhead_logo_object_key: logo.objectKey,
      letterhead_logo_content_type: "image/png",
      letterhead_logo_width_pixels: 400,
      letterhead_logo_height_pixels: 100,
      letterhead_logo_width_emu: 1_828_800,
    });
    // NO STORED HEIGHT. The height follows from the image's own proportions at render time, which is
    // what makes a stretched logo unexpressible rather than merely discouraged.
    const columns = await database.prepare("SELECT * FROM location WHERE id = ?1").bind(reno).all();
    expect(Object.keys(columns.results[0] ?? {})).not.toContain("letterhead_logo_height_emu");
  });

  it("hands the caller the object it has stopped pointing at, so nothing is orphaned silently", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    const first = await setLetterheadLogo(database, reno, logo, options);
    await commitEffectBatch(database, first.effect, { now });

    const second = await setLetterheadLogo(
      database,
      reno,
      { ...logo, objectKey: "letterhead/location_x/def456.png", sha256: "def456" },
      options,
    );
    await commitEffectBatch(database, second.effect, { now });
    expect(second.replacedObjectKey).toBe(logo.objectKey);

    const cleared = await clearLetterheadLogo(database, reno, options);
    await commitEffectBatch(database, cleared.effect, { now });
    expect(cleared.replacedObjectKey).toBe("letterhead/location_x/def456.png");
  });

  it("clears every column, not only the key — stale metadata reads as current", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    await commitEffectBatch(
      database,
      (await setLetterheadLogo(database, reno, logo, options)).effect,
      {
        now,
      },
    );
    await commitEffectBatch(database, (await clearLetterheadLogo(database, reno, options)).effect, {
      now,
    });
    const { results } = await database
      .prepare(
        "SELECT letterhead_logo_object_key, letterhead_logo_content_type, letterhead_logo_size_bytes, letterhead_logo_sha256, letterhead_logo_width_pixels, letterhead_logo_height_pixels, letterhead_logo_width_emu, letterhead_logo_updated_at FROM location WHERE id = ?1",
      )
      .bind(reno)
      .all();
    expect(Object.values(results[0] ?? {}).every((value) => value === null)).toBe(true);
  });

  it("refuses a format the assembly engine will not draw, and a width it cannot draw at", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    await expect(
      setLetterheadLogo(database, reno, { ...logo, contentType: "image/svg+xml" }, options),
    ).rejects.toMatchObject({ code: "unsupported-logo-format" });
    await expect(
      setLetterheadLogo(database, reno, { ...logo, widthEmu: 0 }, options),
    ).rejects.toMatchObject({ code: "invalid-logo-width" });
  });

  it("refuses to set a logo on an office that does not exist", async () => {
    const database = freshDatabase();
    await expect(
      setLetterheadLogo(database, "location_missing" as LocationId, logo, options),
    ).rejects.toMatchObject({ code: "unknown-location" });
  });
});

describe("an office's email", () => {
  it("is stored trimmed, and an empty one is none rather than a refusal", async () => {
    const database = freshDatabase();
    const { locationId, effect } = await createLocation(
      database,
      { name: "Reno", email: "  reno@example.com " },
      options,
    );
    await commitEffectBatch(database, effect, { now });
    const read = (email: string | null) =>
      database
        .prepare("SELECT email FROM location WHERE id = ?1")
        .bind(locationId)
        .all()
        .then((result) => expect(result.results[0]).toEqual({ email }));
    await read("reno@example.com");
    const cleared = await updateLocation(database, locationId, { email: "   " }, options);
    await commitEffectBatch(database, cleared.effect, { now });
    await read(null);
  });

  it("refuses something that is not one address", async () => {
    const database = freshDatabase();
    await expect(
      createLocation(database, { name: "Reno", email: "not an address" }, options),
    ).rejects.toMatchObject({ code: "invalid-email" });
    await expect(
      createLocation(database, { name: "Reno", email: "a@b c" }, options),
    ).rejects.toMatchObject({ code: "invalid-email" });
  });
});

describe("an address carries the international field set", () => {
  it("stores every line the country's form can ask for", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    const { effect } = await setLocationAddresses(
      database,
      reno,
      [
        {
          kind: "physical",
          street: "1 Main St",
          streetTwo: "Suite 200",
          dependentLocality: "Midtown",
          city: "Reno",
          region: "NV",
          postal: "89501",
          sortingCode: "CEDEX 1",
          country: "US",
          phone: "+17755550148",
        },
      ],
      options,
    );
    await commitEffectBatch(database, effect, { now });
    const { results } = await database
      .prepare(
        "SELECT street, street_two, dependent_locality, city, region, postal, sorting_code, country, phone FROM location_address WHERE location_id = ?1",
      )
      .bind(reno)
      .all();
    expect(results[0]).toEqual({
      street: "1 Main St",
      street_two: "Suite 200",
      dependent_locality: "Midtown",
      city: "Reno",
      region: "NV",
      postal: "89501",
      sorting_code: "CEDEX 1",
      country: "US",
      phone: "+17755550148",
    });
  });
});

describe("assignment from the office's side", () => {
  it("a member's first office is their primary whatever the caller said", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    await seedMember(database, "user_a");
    const added = await addMemberToLocation(database, "user_a" as UserId, reno, false, options);
    await commitEffectBatch(database, added.effect, { now });
    expect(await readMemberLocations(database, "user_a" as UserId)).toEqual([
      { locationId: reno, isPrimary: true },
    ]);
  });

  it("a later office is primary only when asked, and asking demotes the one that was", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    const vegas = await seedLocation(database, { name: "Vegas" });
    await seedMember(database, "user_a");
    await commitEffectBatch(
      database,
      (await addMemberToLocation(database, "user_a" as UserId, reno, true, options)).effect,
      { now },
    );
    await commitEffectBatch(
      database,
      (await addMemberToLocation(database, "user_a" as UserId, vegas, false, options)).effect,
      { now },
    );
    expect(await readMemberLocations(database, "user_a" as UserId)).toEqual([
      { locationId: reno, isPrimary: true },
      { locationId: vegas, isPrimary: false },
    ]);
    await commitEffectBatch(
      database,
      (await addMemberToLocation(database, "user_a" as UserId, vegas, true, options)).effect,
      { now },
    );
    expect(await readMemberLocations(database, "user_a" as UserId)).toEqual([
      { locationId: vegas, isPrimary: true },
      { locationId: reno, isPrimary: false },
    ]);
  });

  it("removing the primary hands the role to the first remaining office", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    const vegas = await seedLocation(database, { name: "Vegas" });
    await seedMember(database, "user_a");
    await commitEffectBatch(
      database,
      (await addMemberToLocation(database, "user_a" as UserId, reno, true, options)).effect,
      { now },
    );
    await commitEffectBatch(
      database,
      (await addMemberToLocation(database, "user_a" as UserId, vegas, false, options)).effect,
      { now },
    );
    await commitEffectBatch(
      database,
      (await removeMemberFromLocation(database, "user_a" as UserId, reno, options)).effect,
      { now },
    );
    expect(await readMemberLocations(database, "user_a" as UserId)).toEqual([
      { locationId: vegas, isPrimary: true },
    ]);
    await commitEffectBatch(
      database,
      (await removeMemberFromLocation(database, "user_a" as UserId, vegas, options)).effect,
      { now },
    );
    expect(await readMemberLocations(database, "user_a" as UserId)).toEqual([]);
  });

  it("refuses to put a member at an office that does not exist", async () => {
    const database = freshDatabase();
    await seedMember(database, "user_a");
    await expect(
      addMemberToLocation(
        database,
        "user_a" as UserId,
        "location_missing" as LocationId,
        true,
        options,
      ),
    ).rejects.toMatchObject({ code: "unknown-location" });
  });
});

describe("setFirmDefaultLocation", () => {
  it("names the office the firm numbers and prints against, and audits the choice", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    const { effect } = await setFirmDefaultLocation(database, reno, options);
    await commitEffectBatch(database, effect, { now });
    const setting = await database
      .prepare("SELECT value FROM setting WHERE key = 'locations.firmDefaultLocationId'")
      .all<{ value: string }>();
    expect(JSON.parse(setting.results[0]?.value ?? "null")).toBe(reno);
    const audit = await database
      .prepare(
        "SELECT event FROM audit_log WHERE subject_id = ?1 AND event = 'location.firm_default_set'",
      )
      .bind(reno)
      .all();
    expect(audit.results).toHaveLength(1);
  });

  it("refuses a closed office and an unknown one", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    await commitEffectBatch(
      database,
      (await closeLocation(database, reno, { ...options, firmDefaultLocationId: null })).effect,
      { now },
    );
    await expect(setFirmDefaultLocation(database, reno, options)).rejects.toMatchObject({
      code: "location-is-closed",
    });
    await expect(
      setFirmDefaultLocation(database, "location_missing" as LocationId, options),
    ).rejects.toMatchObject({ code: "unknown-location" });
  });
});

it("LocationValidationError carries a stable code", () => {
  const error = new LocationValidationError("empty-location-name", "x");
  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe("empty-location-name");
});

describe("readMemberPrimaryOfficeRegion", () => {
  it("answers the region of the member's primary office from its physical address alone", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    const vegas = await seedLocation(database, { name: "Vegas" });
    for (const [locationId, region, mailingRegion] of [
      [reno, "NV", "CA"],
      [vegas, "AZ", "AZ"],
    ] as const) {
      const { effect } = await setLocationAddresses(
        database,
        locationId,
        [
          { kind: "mailing", street: "PO Box 9", region: mailingRegion, country: "US" },
          { kind: "physical", street: "1 First St", region, country: "US" },
        ],
        options,
      );
      await commitEffectBatch(database, effect, { now });
    }
    await seedMember(database, "user_a");
    const { effect } = await assignMemberLocations(
      database,
      "user_a" as UserId,
      [
        { locationId: vegas, isPrimary: false },
        { locationId: reno, isPrimary: true },
      ],
      options,
    );
    await commitEffectBatch(database, effect, { now });

    expect(await readMemberPrimaryOfficeRegion(database, "user_a" as UserId)).toEqual({
      region: "NV",
      country: "US",
    });
  });

  it("answers null for a member with no primary office, or one whose address does not say", async () => {
    const database = freshDatabase();
    const reno = await seedLocation(database, { name: "Reno" });
    const { effect: addressEffect } = await setLocationAddresses(
      database,
      reno,
      [{ kind: "physical", street: "1 First St" }],
      options,
    );
    await commitEffectBatch(database, addressEffect, { now });
    await seedMember(database, "user_a");
    await seedMember(database, "user_b");
    const { effect } = await assignMemberLocations(
      database,
      "user_a" as UserId,
      [{ locationId: reno, isPrimary: true }],
      options,
    );
    await commitEffectBatch(database, effect, { now });

    expect(await readMemberPrimaryOfficeRegion(database, "user_a" as UserId)).toBeNull();
    expect(await readMemberPrimaryOfficeRegion(database, "user_b" as UserId)).toBeNull();
  });
});
