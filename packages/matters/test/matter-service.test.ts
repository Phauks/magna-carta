import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { ClosePreconditionError } from "../src/close-preconditions.ts";
import {
  closeMatter,
  createMatter,
  openMatter,
  reopenMatter,
  renumberMatter,
  updateMatter,
} from "../src/matter-service.ts";
import type { NumberSegment } from "../src/numbering/segments.ts";
import { MatterValidationError } from "../src/validation.ts";

const clock = {
  now: () => "2026-06-13T12:00:00.000Z",
  today: () => "2026-06-13",
};
const RESPONSIBLE = "user_attorney" as UserId;
const options = { clock, actorUserId: RESPONSIBLE };

const YEAR_COUNTER_SCHEME: NumberSegment[] = [
  { kind: "year", digits: 4 },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 4 },
];

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedMember(database: BatchDatabase, userId: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Attorney', 'active', ?2)",
    )
    .bind(userId, clock.now())
    .run();
}

async function seedScheme(database: BatchDatabase, segments: NumberSegment[]): Promise<void> {
  // One active scheme: deactivate any existing, then insert the new active one.
  await database.prepare("UPDATE numbering_scheme SET active = 0").run();
  await database
    .prepare(
      "INSERT INTO numbering_scheme (id, segments, active, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?3)",
    )
    .bind(
      `numberingScheme_${Math.floor(performance.now())}_${segments.length}`,
      JSON.stringify(segments),
      clock.now(),
    )
    .run();
}

async function readMatter(database: BatchDatabase, matterId: MatterId) {
  const { results } = await database
    .prepare("SELECT status, matter_number, opened_at, closed_at FROM matter WHERE id = ?1")
    .bind(matterId)
    .all<{
      status: string;
      matter_number: string | null;
      opened_at: string | null;
      closed_at: string | null;
    }>();
  return results[0];
}

async function setup(segments: NumberSegment[] = YEAR_COUNTER_SCHEME): Promise<BatchDatabase> {
  const database = freshDatabase();
  await seedMember(database, RESPONSIBLE);
  await seedScheme(database, segments);
  return database;
}

const baseInput = { title: "Smith v. Jones", responsibleMemberId: RESPONSIBLE } as const;

describe("createMatter", () => {
  it("creates a prospective consultation with no number", async () => {
    const database = await setup();
    const { matterId, matterNumber } = await createMatter(
      database,
      { ...baseInput, status: "prospective" },
      options,
    );
    expect(matterNumber).toBeNull();
    const row = await readMatter(database, matterId);
    expect(row).toMatchObject({ status: "prospective", matter_number: null, opened_at: null });
  });

  it("draws a number when created directly as open", async () => {
    const database = await setup();
    const { matterId, matterNumber } = await createMatter(
      database,
      { ...baseInput, status: "open" },
      options,
    );
    expect(matterNumber).toBe("2026-0001");
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "open",
      matter_number: "2026-0001",
    });
  });

  it("refuses an empty title", async () => {
    const database = await setup();
    await expect(
      createMatter(database, { ...baseInput, title: "  ", status: "open" }, options),
    ).rejects.toMatchObject({ code: "empty-matter-title" });
  });
});

describe("openMatter", () => {
  it("draws the number at open, not at creation, for a prospective", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "prospective" },
      options,
    );
    expect((await readMatter(database, matterId))?.matter_number).toBeNull();
    const { matterNumber } = await openMatter(database, matterId, {}, options);
    expect(matterNumber).toBe("2026-0001");
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "open",
      matter_number: "2026-0001",
    });
  });

  it("refuses to open a matter that is not prospective", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await expect(openMatter(database, matterId, {}, options)).rejects.toMatchObject({
      code: "matter-not-prospective",
    });
  });

  it("refuses an unknown matter", async () => {
    const database = await setup();
    await expect(
      openMatter(database, "matter_missing" as MatterId, {}, options),
    ).rejects.toMatchObject({ code: "matter-not-found" });
  });

  it("refuses to draw a number with no active scheme", async () => {
    const database = freshDatabase();
    await seedMember(database, RESPONSIBLE);
    await expect(
      createMatter(database, { ...baseInput, status: "open" }, options),
    ).rejects.toMatchObject({ code: "scheme-missing" });
  });
});

describe("closeMatter / reopenMatter", () => {
  it("closes an open matter and reopens it back to open (number frozen)", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await closeMatter(database, matterId, options);
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "closed",
      matter_number: "2026-0001",
    });
    await reopenMatter(database, matterId, options);
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "open",
      matter_number: "2026-0001",
      closed_at: null,
    });
  });

  it("closes a prospective (declined consultation) and reopens it to prospective", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "prospective" },
      options,
    );
    await closeMatter(database, matterId, options);
    expect((await readMatter(database, matterId))?.status).toBe("closed");
    await reopenMatter(database, matterId, options);
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "prospective",
      matter_number: null,
    });
  });

  it("close runs the (empty) precondition registry and succeeds", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await expect(closeMatter(database, matterId, options)).resolves.toBeUndefined();
  });
});

describe("updateMatter", () => {
  it("merges a field patch", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await updateMatter(database, matterId, { title: "Smith v. Jones (amended)" }, options);
    const { results } = await database
      .prepare("SELECT title FROM matter WHERE id = ?1")
      .bind(matterId)
      .all<{ title: string }>();
    expect(results[0]?.title).toBe("Smith v. Jones (amended)");
  });

  it("refuses an empty title", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await expect(updateMatter(database, matterId, { title: "" }, options)).rejects.toMatchObject({
      code: "empty-matter-title",
    });
  });
});

describe("renumberMatter", () => {
  it("assigns a manual number to a prospective without drawing a counter", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "prospective" },
      options,
    );
    await renumberMatter(database, matterId, "LEGACY-7", options);
    expect((await readMatter(database, matterId))?.matter_number).toBe("LEGACY-7");
    // The counter was never touched — the next drawn matter still starts at 0001.
    const next = await createMatter(database, { ...baseInput, status: "open" }, options);
    expect(next.matterNumber).toBe("2026-0001");
  });

  it("refuses a non-URL-safe number", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await expect(renumberMatter(database, matterId, "a/b c", options)).rejects.toMatchObject({
      code: "matter-number-not-url-safe",
    });
  });

  it("refuses a number already in use", async () => {
    const database = await setup();
    const first = await createMatter(database, { ...baseInput, status: "open" }, options);
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "prospective" },
      options,
    );
    await expect(
      renumberMatter(database, matterId, first.matterNumber as string, options),
    ).rejects.toMatchObject({ code: "matter-number-taken" });
  });
});

describe("number allocation under contention", () => {
  it("two concurrent open draws yield distinct, sequential numbers", async () => {
    const database = await setup();
    const [a, b] = await Promise.all([
      createMatter(database, { ...baseInput, status: "open" }, options),
      createMatter(database, { ...baseInput, status: "open" }, options),
    ]);
    expect(new Set([a.matterNumber, b.matterNumber])).toEqual(new Set(["2026-0001", "2026-0002"]));
  });

  it("a counter draw retries past a manual number that collides with it", async () => {
    const database = await setup();
    // Park a manual number equal to the counter's SECOND draw.
    const parked = await createMatter(database, { ...baseInput, status: "prospective" }, options);
    await renumberMatter(database, parked.matterId, "2026-0002", options);
    // First draw takes 0001; the second draw renders 0002, collides, and retries to 0003.
    const first = await createMatter(database, { ...baseInput, status: "open" }, options);
    const second = await createMatter(database, { ...baseInput, status: "open" }, options);
    expect(first.matterNumber).toBe("2026-0001");
    expect(second.matterNumber).toBe("2026-0003");
  });

  it("a scheme edit only affects later matters (existing numbers are frozen)", async () => {
    const database = await setup();
    const first = await createMatter(database, { ...baseInput, status: "open" }, options);
    expect(first.matterNumber).toBe("2026-0001");
    // Switch to a literal-prefixed scheme (still firm-wide, so the counter continues at 2).
    await seedScheme(database, [
      { kind: "literal", text: "M" },
      { kind: "counter", padWidth: 4 },
    ]);
    const second = await createMatter(database, { ...baseInput, status: "open" }, options);
    expect(second.matterNumber).toBe("M0002");
    // The first matter's number is untouched by the scheme change.
    expect((await readMatter(database, first.matterId))?.matter_number).toBe("2026-0001");
  });
});

it("ClosePreconditionError carries its failures", () => {
  const error = new ClosePreconditionError([{ code: "x", message: "y" }]);
  expect(error.failures).toEqual([{ code: "x", message: "y" }]);
});

it("MatterValidationError carries a stable code", () => {
  expect(new MatterValidationError("scheme-missing", "x").code).toBe("scheme-missing");
});
