import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_DRAW_ATTEMPTS } from "@magna-carta/sequence-numbering/bounded-retry";
import { createMatter } from "../src/matter-service.ts";
import type { NumberSegment } from "@magna-carta/sequence-numbering/segments";
import type { MatterNumberingPurpose } from "../src/matter-statements.ts";

// THE INVARIANT, asked over many draws rather than two.
//
// A matter number is frozen at assignment and unique per firm, and the partial UNIQUE index on
// `matter_number` is the concurrency backstop: two simultaneous draws must come out distinct. The
// existing verifiers ask that of a pair. A counter is exactly the shape where a pair is not enough —
// a scheme that loses one value in a hundred draws passes every two-caller test ever written — so
// this drives N at once and checks the whole set at the end.
//
// The oracle is total, not sampled: N draws that all commit must yield N numbers, all distinct, and
// (because the counter is a sequence rather than a hash) exactly the run 1..N with nothing skipped.
// A skipped value is as much a defect as a duplicated one — it means a draw consumed a number and
// then lost, and the firm's numbering has a hole it cannot explain to a client.

const clock = { now: () => "2026-06-13T12:00:00.000Z", today: () => "2026-06-13" };
const RESPONSIBLE = "user_attorney" as UserId;
const options = { clock, actorUserId: RESPONSIBLE };
const COUNTER_SCHEME: NumberSegment[] = [
  { kind: "year", digits: 4 },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 4 },
];

async function setup(): Promise<BatchDatabase> {
  const database: BatchDatabase = createMigratedNodeDatabase("per-firm").database;
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Attorney', 'active', ?2)",
    )
    .bind(RESPONSIBLE, clock.now())
    .run();
  await seedScheme(database, "matter");
  return database;
}

async function seedScheme(database: BatchDatabase, purpose: MatterNumberingPurpose): Promise<void> {
  await database
    .prepare("UPDATE numbering_scheme SET active = 0 WHERE purpose = ?1")
    .bind(purpose)
    .run();
  await database
    .prepare(
      "INSERT INTO numbering_scheme (id, segments, purpose, active, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
    )
    .bind(
      `numberingScheme_${purpose}_linearizability`,
      JSON.stringify(COUNTER_SCHEME),
      purpose,
      clock.now(),
    )
    .run();
}

/** Every draw that committed, in whatever order they finished. A loser is allowed; a duplicate is not. */
async function drawConcurrently(database: BatchDatabase, count: number): Promise<string[]> {
  const settled = await Promise.allSettled(
    Array.from({ length: count }, (_, index) =>
      createMatter(
        database,
        { title: `Matter ${String(index)}`, responsibleMemberId: RESPONSIBLE, status: "open" },
        options,
      ),
    ),
  );
  const drawn: string[] = [];
  for (const one of settled) {
    // A matter opened straight from creation always draws a number; the null arm belongs to a
    // consultation, which this never creates.
    if (one.status === "fulfilled" && one.value.matterNumber !== null) {
      drawn.push(one.value.matterNumber);
    }
  }
  return drawn;
}

describe("the matter number draw under many concurrent draws", () => {
  // CORRECTNESS AND CONVERGENCE ARE DIFFERENT PROPERTIES, and the draw holds them differently.
  //
  // Correctness is absolute: whatever set of draws commits is distinct and gapless, at every N. A
  // duplicate would put two matters under one number, and a hole would be a number the firm consumed
  // and cannot account for. Neither happens at any concurrency this exercises.
  //
  // Convergence is BOUNDED, and that bound is a real ceiling rather than a formality. A draw retries
  // at most DEFAULT_MAX_DRAW_ATTEMPTS times, so it is refused after losing that many races in a row —
  // and with N simultaneous draws the unluckiest loses N-1 times, which means N above the bound sheds
  // the excess by construction. That is a deliberate refusal, not corruption, and the refusal is what
  // a caller retries. It is pinned here because the number is invisible from any two-caller test: a
  // pair never loses five times, so nothing else in the suite can notice the ceiling move.
  for (const count of [2, 3, 5]) {
    it(`converges every one of ${String(count)} concurrent draws, within the retry bound`, async () => {
      const database = await setup();
      const drawn = await drawConcurrently(database, count);

      expect(drawn).toHaveLength(count);
      expect(drawn.toSorted()).toEqual(
        Array.from({ length: count }, (_, index) => `2026-${String(index + 1).padStart(4, "0")}`),
      );
    });
  }

  for (const count of [8, 13, 21]) {
    it(`keeps ${String(count)} concurrent draws distinct and gapless, refusing the excess rather than duplicating`, async () => {
      const database = await setup();
      const drawn = await drawConcurrently(database, count);

      // The shed draws were REFUSED — they are simply absent, and a caller retries them.
      expect(drawn.length).toBeLessThanOrEqual(count);
      expect(drawn.length).toBeGreaterThan(0);
      // Whatever committed is still exactly the run 1..k: no duplicate, no hole.
      expect(new Set(drawn).size).toBe(drawn.length);
      expect(drawn.toSorted()).toEqual(
        Array.from(
          { length: drawn.length },
          (_, index) => `2026-${String(index + 1).padStart(4, "0")}`,
        ),
      );
    });
  }

  it("converges exactly as many draws as the retry bound allows, so a change to that bound is visible here", async () => {
    // The measured ceiling. Raising DEFAULT_MAX_DRAW_ATTEMPTS raises this number and lowering it
    // lowers it; either way the change should be a decision somebody made rather than one this test
    // absorbs quietly. A firm importing matters in bulk meets this bound before it meets anything else.
    const database = await setup();
    const drawn = await drawConcurrently(database, 40);
    expect(drawn).toHaveLength(DEFAULT_MAX_DRAW_ATTEMPTS);
  });

  it("leaves one allocation row per number, so the ledger agrees with what was handed out", async () => {
    const database = await setup();
    const drawn = await drawConcurrently(database, 4);

    const { results } = await database
      .prepare(
        "SELECT drawn_value, COUNT(*) AS n FROM matter_number_allocation GROUP BY drawn_value ORDER BY drawn_value",
      )
      .bind()
      .all<{ drawn_value: number; n: number }>();
    expect(results.map((row) => row.n)).toEqual(Array.from({ length: drawn.length }, () => 1));
    expect(results.map((row) => row.drawn_value)).toEqual(
      Array.from({ length: drawn.length }, (_, index) => index + 1),
    );
  });
});
