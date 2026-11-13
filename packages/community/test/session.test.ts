import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { UserId } from "@magna-carta/identifiers/types";
import { beforeEach, describe, expect, it } from "vitest";
import {
  mintHandoffToken,
  mintSessionToken,
  readBoardState,
  redeemHandoff,
  resolveBoardViewer,
  verifyHandoffToken,
  verifySessionToken,
} from "../src/session.ts";
import type { SqlDatabase } from "../src/sql-database.ts";

const SECRET = "a-test-secret-that-is-long-enough-to-mean-something";
const NOW = "2026-11-13T12:00:00.000Z";
const NOW_SECONDS = Date.parse(NOW) / 1000;

let database: SqlDatabase;
let raw: ReturnType<typeof createMigratedNodeDatabase>["raw"];

beforeEach(() => {
  const created = createMigratedNodeDatabase("control-plane");
  database = created.database as unknown as SqlDatabase;
  raw = created.raw;
  raw.prepare("INSERT INTO firm (id, name, created_at) VALUES ('frm_a', 'Firm A', ?)").run(NOW);
  raw
    .prepare(
      "INSERT INTO user (id, name, email, firm_id, name_given, name_family) VALUES ('usr_dana', 'Dana Reyes', 'dana@example.com', 'frm_a', 'Dana', 'Reyes')",
    )
    .run();
  raw
    .prepare(
      "INSERT INTO user (id, name, email, firm_id) VALUES ('usr_loose', 'No Firm', 'loose@example.com', NULL)",
    )
    .run();
});

describe("handoff and session tokens", () => {
  it("round-trips a handoff within its minute and refuses it after", async () => {
    const token = await mintHandoffToken(SECRET, "usr_dana" as UserId, NOW_SECONDS);
    const claim = await verifyHandoffToken(SECRET, token, NOW_SECONDS + 30);
    expect(claim?.userId).toBe("usr_dana");
    expect(await verifyHandoffToken(SECRET, token, NOW_SECONDS + 61)).toBeNull();
  });

  it("refuses a token signed with another secret, tampered with, or of the other type", async () => {
    const handoff = await mintHandoffToken(SECRET, "usr_dana" as UserId, NOW_SECONDS);
    const session = await mintSessionToken(SECRET, "usr_dana" as UserId, NOW_SECONDS);
    expect(await verifyHandoffToken("another-secret", handoff, NOW_SECONDS)).toBeNull();
    expect(await verifyHandoffToken(SECRET, `x${handoff}`, NOW_SECONDS)).toBeNull();
    expect(await verifyHandoffToken(SECRET, session, NOW_SECONDS)).toBeNull();
    expect(await verifySessionToken(SECRET, handoff, NOW_SECONDS)).toBeNull();
    expect(await verifySessionToken(SECRET, session, NOW_SECONDS)).toBe("usr_dana");
  });

  it("redeems a handoff once", async () => {
    const token = await mintHandoffToken(SECRET, "usr_dana" as UserId, NOW_SECONDS);
    const claim = await verifyHandoffToken(SECRET, token, NOW_SECONDS);
    expect(claim).not.toBeNull();
    if (claim === null) return;
    expect(await redeemHandoff(database, claim, NOW)).toBe(true);
    expect(await redeemHandoff(database, claim, NOW)).toBe(false);
  });
});

describe("resolveBoardViewer", () => {
  it("reads a member's firm and suggests a display name from their name parts", async () => {
    const viewer = await resolveBoardViewer(database, "usr_dana" as UserId, NOW);
    expect(viewer?.member).toEqual({ userId: "usr_dana", firmId: "frm_a", isTeam: false });
    expect(viewer?.suggestedDisplayName).toBe("Dana R.");
  });

  it("marks an unexpired platform operator as the team and ignores an expired one", async () => {
    raw
      .prepare(
        "INSERT INTO platform_operator (user_id, granted_at, granted_by, expires_at) VALUES ('usr_dana', ?, 'usr_dana', ?)",
      )
      .run(NOW, "2026-11-14T00:00:00.000Z");
    expect((await resolveBoardViewer(database, "usr_dana" as UserId, NOW))?.member.isTeam).toBe(
      true,
    );
    const later = "2026-11-15T00:00:00.000Z";
    expect((await resolveBoardViewer(database, "usr_dana" as UserId, later))?.member.isTeam).toBe(
      false,
    );
  });

  it("answers null for a person with no firm or no account", async () => {
    expect(await resolveBoardViewer(database, "usr_loose" as UserId, NOW)).toBeNull();
    expect(await resolveBoardViewer(database, "usr_missing" as UserId, NOW)).toBeNull();
  });
});

describe("readBoardState", () => {
  it("reads open with no row, the stored state, and read-only for an unknown word", async () => {
    expect(await readBoardState(database)).toBe("open");
    raw
      .prepare(
        "INSERT INTO community_board_switch (id, state, changed_at) VALUES ('board', 'off', ?)",
      )
      .run(NOW);
    expect(await readBoardState(database)).toBe("off");
    raw.prepare("UPDATE community_board_switch SET state = 'closed'").run();
    expect(await readBoardState(database)).toBe("read-only");
  });
});
