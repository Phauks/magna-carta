import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { CustodyLocationId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { createCustodyLocation } from "../src/location-service.ts";
import { recordCustodyMovement } from "../src/movement-service.ts";
import { readCustodyMovements } from "../src/movement-statements.ts";
import { createCustodyPacket } from "../src/packet-service.ts";
import { readCustodyReleasePolicy } from "../src/settings.ts";
import {
  ACTOR,
  AUTHORIZED_RELEASE,
  DEPARTED_MEMBER,
  MATTER,
  WITNESS,
  commit,
  migratedDatabase,
  options,
  seedMatter,
  seedMember,
} from "./support.ts";

// The release row out of a packet's history. Read by kind rather than by taking the newest, because
// the opening entry and the release share an instant under the fixed test clock and the tie breaks on
// a random identifier — a "newest" that is right most of the time is a flaky test waiting to happen.
async function releaseRow(
  database: BatchDatabase,
  packetId: Parameters<typeof readCustodyMovements>[1],
) {
  const rows = await readCustodyMovements(database, packetId, 50);
  return rows.find((row) => row.kind === "released");
}

// Gated release: an original does not leave the firm's custody until the authority it leaves on and
// the identity check made on the person collecting it are both on the ledger row. The gate rides the
// one movement write path — there is no release endpoint and no release service — so every test here
// goes through recordCustodyMovement, which is where a second write path would have to be caught.

const SMITH = "directoryPerson_smith0000000000000";
const STRANGER = "user_notAMemberHere0000000" as UserId;

async function scaffold() {
  const { database, raw } = migratedDatabase();
  seedMember(raw);
  seedMatter(raw);
  const safe = await node(database, "Main safe", "safe");
  const created = await createCustodyPacket(
    database,
    {
      name: "Smith family deeds",
      owners: [{ entityId: SMITH }],
      currentLocationId: safe,
      matterId: MATTER,
    },
    { ...options, responsibleMemberId: ACTOR },
  );
  return { database, raw, safe, packetId: created.packetId };
}

async function node(
  database: BatchDatabase,
  name: string,
  kind: Parameters<typeof createCustodyLocation>[1]["kind"],
): Promise<CustodyLocationId> {
  const { locationId, effect } = await createCustodyLocation(database, { name, kind }, options);
  await commit(database, effect);
  return locationId;
}

function requireTwoSignatories(raw: ReturnType<typeof migratedDatabase>["raw"]): void {
  raw.exec(
    `INSERT INTO setting (key, value, updated_at) VALUES ('custody.releasePolicy', '{"requireTwoSignatories":true}', '2026-08-05T00:00:00.000Z')`,
  );
}

describe("an original does not leave without identity and authority", () => {
  it("refuses a release that names nobody as having collected the property", async () => {
    const { database, packetId } = await scaffold();
    await expect(
      recordCustodyMovement(
        database,
        packetId,
        { kind: "released", releaseAuthorization: AUTHORIZED_RELEASE.releaseAuthorization },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-release-not-authorized" });
  });

  it("refuses a release that captures nothing", async () => {
    const { database, packetId } = await scaffold();
    await expect(
      recordCustodyMovement(
        database,
        packetId,
        { kind: "released", borrower: AUTHORIZED_RELEASE.borrower },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-release-not-authorized" });
  });

  it("refuses a release whose authority is whitespace", async () => {
    const { database, packetId } = await scaffold();
    await expect(
      recordCustodyMovement(
        database,
        packetId,
        {
          kind: "released",
          borrower: AUTHORIZED_RELEASE.borrower,
          releaseAuthorization: {
            ...AUTHORIZED_RELEASE.releaseAuthorization,
            authorityBasis: "  ",
          },
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-release-not-authorized" });
  });

  it("refuses a release that records no identity check", async () => {
    const { database, packetId } = await scaffold();
    await expect(
      recordCustodyMovement(
        database,
        packetId,
        {
          kind: "released",
          borrower: AUTHORIZED_RELEASE.borrower,
          releaseAuthorization: {
            ...AUTHORIZED_RELEASE.releaseAuthorization,
            identityEvidence: "",
          },
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-release-not-authorized" });
  });

  // A refused release must leave the register exactly as it found it. The gate runs before the
  // identifier is minted and before the batch is composed, so there is no half-written release and no
  // idempotency record standing in the way of the corrected retry a moment later.
  it("writes nothing at all when it refuses", async () => {
    const { database, packetId } = await scaffold();
    const before = await readCustodyMovements(database, packetId, 50);
    await expect(
      recordCustodyMovement(database, packetId, { kind: "released" }, options),
    ).rejects.toMatchObject({ code: "custody-release-not-authorized" });
    const after = await readCustodyMovements(database, packetId, 50);
    expect(after.length).toBe(before.length);
  });

  it("records the capture on the ledger row when the release is authorized", async () => {
    const { database, packetId } = await scaffold();
    await recordCustodyMovement(database, packetId, AUTHORIZED_RELEASE, options);
    expect(await releaseRow(database, packetId)).toMatchObject({
      kind: "released",
      borrower_name: "A. Collector",
      release_authority_basis: "owner collecting their own original in person",
      release_identity_verified_by_user_id: ACTOR,
      release_witnessed_by_user_id: null,
    });
  });

  // The basis is stored as the firm wrote it, trimmed and otherwise untouched. Nothing here parses
  // it, matches it against a vocabulary, or decides whether it is good enough — what suffices to
  // release an original is jurisdiction-specific, and this register encodes none of it.
  it("stores the authority the firm asserted, verbatim", async () => {
    const { database, packetId } = await scaffold();
    await recordCustodyMovement(
      database,
      packetId,
      {
        ...AUTHORIZED_RELEASE,
        releaseAuthorization: {
          ...AUTHORIZED_RELEASE.releaseAuthorization,
          authorityBasis: "  Grant of probate dated 3 March 2026, original sighted  ",
        },
      },
      options,
    );
    const released = await releaseRow(database, packetId);
    expect(released?.release_authority_basis).toBe(
      "Grant of probate dated 3 March 2026, original sighted",
    );
  });

  it("refuses release capture on a movement that is not a release", async () => {
    const { database, packetId } = await scaffold();
    await expect(
      recordCustodyMovement(
        database,
        packetId,
        {
          kind: "checked_out",
          borrower: { kind: "member", userId: ACTOR },
          releaseAuthorization: AUTHORIZED_RELEASE.releaseAuthorization,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-invalid-movement" });
  });
});

describe("two-signatory release is the firm's choice, and means two people", () => {
  it("defaults to one signatory when the firm has configured nothing", async () => {
    const { database } = await scaffold();
    expect(await readCustodyReleasePolicy(database)).toEqual({ requireTwoSignatories: false });
  });

  it("falls back to the default when the stored policy is unreadable", async () => {
    const { database, raw } = await scaffold();
    raw.exec(
      `INSERT INTO setting (key, value, updated_at) VALUES ('custody.releasePolicy', 'not json', '2026-08-05T00:00:00.000Z')`,
    );
    expect(await readCustodyReleasePolicy(database)).toEqual({ requireTwoSignatories: false });
  });

  it("refuses a single-signatory release once the firm requires two", async () => {
    const { database, raw, packetId } = await scaffold();
    requireTwoSignatories(raw);
    await expect(
      recordCustodyMovement(database, packetId, AUTHORIZED_RELEASE, options),
    ).rejects.toMatchObject({ code: "custody-release-not-authorized" });
  });

  it("accepts the same release once a second signatory signs", async () => {
    const { database, raw, packetId } = await scaffold();
    requireTwoSignatories(raw);
    await recordCustodyMovement(
      database,
      packetId,
      {
        ...AUTHORIZED_RELEASE,
        releaseAuthorization: {
          ...AUTHORIZED_RELEASE.releaseAuthorization,
          witnessedByUserId: WITNESS,
        },
      },
      options,
    );
    const released = await releaseRow(database, packetId);
    expect(released?.release_witnessed_by_user_id).toBe(WITNESS);
  });

  it("refuses a witness who is the member that checked identity", async () => {
    const { database, raw, packetId } = await scaffold();
    requireTwoSignatories(raw);
    await expect(
      recordCustodyMovement(
        database,
        packetId,
        {
          ...AUTHORIZED_RELEASE,
          releaseAuthorization: {
            ...AUTHORIZED_RELEASE.releaseAuthorization,
            witnessedByUserId: ACTOR,
          },
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-release-signatories-must-differ" });
  });

  // THE COMPOSITION THIS GATE EXISTS TO REFUSE. A two-signatory release used to take both signatory
  // identifiers out of the request body, bound to nothing: one member could record the release and
  // type any well-formed `user_…` handle into the witness field, and the append-only ledger would
  // permanently assert that two people signed off on a handover only one person witnessed. The
  // verifier is now the session, and the witness has to be somebody the firm actually employs.
  it("refuses a witness the firm does not employ", async () => {
    const { database, raw, packetId } = await scaffold();
    requireTwoSignatories(raw);
    await expect(
      recordCustodyMovement(
        database,
        packetId,
        {
          ...AUTHORIZED_RELEASE,
          releaseAuthorization: {
            ...AUTHORIZED_RELEASE.releaseAuthorization,
            witnessedByUserId: STRANGER,
          },
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-release-not-authorized" });
  });

  it("refuses a witness who has left the firm", async () => {
    const { database, raw, packetId } = await scaffold();
    requireTwoSignatories(raw);
    await expect(
      recordCustodyMovement(
        database,
        packetId,
        {
          ...AUTHORIZED_RELEASE,
          releaseAuthorization: {
            ...AUTHORIZED_RELEASE.releaseAuthorization,
            witnessedByUserId: DEPARTED_MEMBER,
          },
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-release-not-authorized" });
  });

  // And a refused composition writes nothing: the roster check runs inside the gate, before the
  // identifier is minted and before the batch is composed.
  it("writes nothing when the witness is refused", async () => {
    const { database, raw, packetId } = await scaffold();
    requireTwoSignatories(raw);
    const before = await readCustodyMovements(database, packetId, 50);
    await expect(
      recordCustodyMovement(
        database,
        packetId,
        {
          ...AUTHORIZED_RELEASE,
          releaseAuthorization: {
            ...AUTHORIZED_RELEASE.releaseAuthorization,
            witnessedByUserId: STRANGER,
          },
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-release-not-authorized" });
    expect((await readCustodyMovements(database, packetId, 50)).length).toBe(before.length);
  });

  // The verifier is derived, so a caller cannot name one at all — and the row records the member who
  // actually recorded it, which is the whole of the binding.
  it("records the authenticated member as the one who checked identity", async () => {
    const { database, raw, packetId } = await scaffold();
    requireTwoSignatories(raw);
    await recordCustodyMovement(
      database,
      packetId,
      {
        ...AUTHORIZED_RELEASE,
        releaseAuthorization: {
          ...AUTHORIZED_RELEASE.releaseAuthorization,
          witnessedByUserId: WITNESS,
        },
      },
      options,
    );
    expect(await releaseRow(database, packetId)).toMatchObject({
      recorded_by_user_id: ACTOR,
      release_identity_verified_by_user_id: ACTOR,
      release_witnessed_by_user_id: WITNESS,
    });
  });

  // The gate binds the release, not the check-out: friction on the movement a firm records daily is
  // how a register stops being kept, and a check-out is reversible in a way a release is not.
  it("leaves the daily check-out frictionless", async () => {
    const { database, raw, packetId } = await scaffold();
    requireTwoSignatories(raw);
    const recorded = await recordCustodyMovement(
      database,
      packetId,
      {
        kind: "checked_out",
        borrower: { kind: "member", userId: ACTOR },
        dueBackOn: "2026-08-11",
      },
      options,
    );
    expect(recorded.packetStatus).toBe("out");
  });
});
