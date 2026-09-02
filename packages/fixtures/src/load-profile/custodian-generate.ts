import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { placeCustodyHold } from "@magna-carta/custodian/hold-service";
import { addCustodyItem } from "@magna-carta/custodian/item-service";
import { createCustodyLocation } from "@magna-carta/custodian/location-service";
import { readCustodyLocationSubtreeIds } from "@magna-carta/custodian/location-statements";
import { recordCustodyMovement } from "@magna-carta/custodian/movement-service";
import { createCustodyPacket, updateCustodyPacket } from "@magna-carta/custodian/packet-service";
import type { CustodyLocationKind, CustodyMovementKind } from "@magna-carta/custodian/types";
import type {
  CustodyItemTypeId,
  CustodyLocationId,
  CustodyPacketId,
  LocationId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { CustodianVolume } from "./profile.ts";

// The custody volume laid over the practice + directory books. Every row rides a REAL write path —
// createCustodyLocation, createCustodyPacket (number draw, owner links, and the opening ledger entry
// in one commit), addCustodyItem, recordCustodyMovement, placeCustodyHold, updateCustodyPacket — so
// the corpus is valid by construction: statuses are derived rather than set, the append-only ledger
// is appended to rather than inserted into, and a packet without an owner cannot come into existence
// here any more than it can in production. All randomness comes from the one FixtureContext.
//
// The shape this generator is trying to produce is the one the register's reads are hard on: a modest
// packet population with a LONG history behind it. A packet's ledger depth is its age times the
// movement rate, so the age distribution is what fills the movement table — and one probe packet is
// given the tail depth outright, because an average-depth packet would measure the average.

// The item-type catalogue rows the custody seed migration ships. They are literals here because they
// ARE literals in the migration — a firm's catalogue starts as exactly these rows, and reading them
// back to pick one would only re-derive what the schema already fixed.
const ITEM_TYPE_IDS = [
  "custodyItemType_originalWill000000000",
  "custodyItemType_codicil00000000000000",
  "custodyItemType_deed00000000000000000",
  "custodyItemType_powerOfAttorney000000",
  "custodyItemType_trustInstrument000000",
  "custodyItemType_titleDocument00000000",
  "custodyItemType_promissoryNote0000000",
] as unknown as readonly CustodyItemTypeId[];

const HOLD_KINDS = ["legal", "discovery", "client_instruction", "dispute", "unclaimed"] as const;

const MILLISECONDS_PER_DAY = 86_400_000;

// Probe identifiers the custody measurement layer binds real queries to — deterministic for a given
// profile + seed, recorded in the snapshot manifest.
export interface CustodianProbes {
  // The Directory entity holding the most packets — the register's primary filter, "everything this
  // firm holds for one person".
  readonly busiestOwnerEntityId: string;
  // The root of the largest branch of the container tree — the subtree walk's hot case. The design
  // names this as the one read with a genuinely non-obvious plan.
  readonly subtreeRootLocationId: CustodyLocationId;
  // A mid-tree node (a safe, not a root), so the subtree read is also exercised where the recursion
  // starts partway down rather than only at the top.
  readonly midTreeLocationId: CustodyLocationId;
  // That root's subtree, already expanded. The register's location filter takes a VALUE LIST rather
  // than a subquery — the expansion happens once per request, above the list — so the plan probe for
  // the list has to bind the same list the read binds, and re-deriving it in the measurement layer
  // would be a second definition of the subtree that could drift from the first.
  readonly subtreeLocationIds: readonly CustodyLocationId[];
  // The packet at the tail of the history distribution — the keyset-paginated ledger read's target.
  readonly deepHistoryPacketId: CustodyPacketId;
  // The (occurred_at, id) cursor that opens the SECOND page of that packet's history, so the
  // paginated read is measured past the head rather than only at it.
  readonly deepHistoryCursorOccurredAt: string;
  readonly deepHistoryCursorId: string;
  // A packet currently checked out and already past its due-back date — the overdue sweep's target.
  readonly overduePacketId: CustodyPacketId;
  // A packet carrying a hold in force, and one with a firm-set review date.
  readonly heldPacketId: CustodyPacketId;
  readonly reviewScheduledPacketId: CustodyPacketId;
  // The as-of civil date the overdue and reviews-due reads are taken at: the generator's own "today",
  // recorded rather than re-derived so a plan probe binds exactly the date the measurement used.
  readonly asOfDate: string;
  // The custody location a measured packet creation files its packet into, and the member the
  // measured writes act as.
  readonly intakeLocationId: CustodyLocationId;
  // The matter a measured packet creation files its packet under. A packet names one or it is not a
  // packet, so the probe carries a real matter rather than the measurement inventing one.
  readonly intakeMatterId: MatterId;
  readonly actorUserId: UserId;
}

export interface CustodianGenerationResult {
  readonly locationCount: number;
  readonly packetCount: number;
  readonly itemCount: number;
  readonly movementCount: number;
  readonly holdCount: number;
  readonly probes: CustodianProbes;
}

export interface CustodianAttachPoints {
  // The firm offices a custody root binds. Only a ROOT may name one, and an offsite vault names none.
  readonly firmLocationIds: readonly LocationId[];
  // Directory entities that own packets. Owner links carry no cross-domain foreign key, following the
  // matter_party precedent, but the ids are real Directory rows so the holdings report joins something.
  readonly ownerEntityIds: readonly string[];
  // Matters the packets are filed under. EVERY packet names one: the firm holds property for
  // clients, and a client is somebody it has a matter with (packages/custodian/src/packet-service.ts
  // refuses a packet without one), so a corpus of matterless packets would be a corpus of rows the
  // product cannot produce.
  readonly matterIds: readonly MatterId[];
  readonly actorUserId: UserId;
}

// The generator's civil "today": the fixed clock's date. Every age and due-back date is derived from
// it by whole-day arithmetic on a fixed base — no wall-clock read anywhere.
function civilDateDaysBefore(baseDate: string, days: number): string {
  return new Date(Date.parse(`${baseDate}T00:00:00.000Z`) - days * MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

function instantDaysBefore(baseInstant: string, days: number): string {
  return new Date(Date.parse(baseInstant) - days * MILLISECONDS_PER_DAY).toISOString();
}

interface TreeNode {
  readonly id: CustodyLocationId;
  readonly depth: number;
}

export async function generateCustodianVolume(
  database: BatchDatabase,
  context: FixtureContext,
  volume: CustodianVolume,
  attach: CustodianAttachPoints,
  options: SeedingOptions,
): Promise<CustodianGenerationResult> {
  assertSeedingAllowed(options);
  const { faker, clock, randomSource } = context;
  const serviceOptions = { clock, actorUserId: attach.actorUserId, randomSource };
  const commit = (effect: Parameters<typeof commitEffectBatch>[1]) =>
    commitEffectBatch(database, effect, { now: () => clock.now() });

  if (attach.ownerEntityIds.length === 0) {
    throw new Error("load-profile: custody volume needs at least one Directory entity as an owner");
  }
  if (attach.matterIds.length === 0) {
    throw new Error("load-profile: custody volume needs at least one matter to file packets under");
  }

  // ---- the container tree ----
  //
  // Roots bind an office where there is one to bind; the offsite roots bind none, which is the whole
  // reason the two are separate parameters. Below each root the conventional safe / box / position
  // shape, which is what makes the subtree walk a walk rather than a single hop.
  const roots: CustodyLocationId[] = [];
  const positions: CustodyLocationId[] = [];
  const midTreeNodes: CustodyLocationId[] = [];
  const nodes: TreeNode[] = [];
  const createNode = async (
    name: string,
    kind: CustodyLocationKind,
    parentLocationId: CustodyLocationId | null,
    firmLocationId: LocationId | null,
    depth: number,
  ): Promise<CustodyLocationId> => {
    const created = await createCustodyLocation(
      database,
      { name, kind, parentLocationId, firmLocationId },
      serviceOptions,
    );
    await commit(created.effect);
    nodes.push({ id: created.locationId, depth });
    return created.locationId;
  };

  const totalRoots = volume.officeRootCount + volume.offsiteRootCount;
  for (let rootIndex = 0; rootIndex < totalRoots; rootIndex += 1) {
    const bindsOffice = rootIndex < volume.officeRootCount;
    const firmLocationId = bindsOffice ? (attach.firmLocationIds[rootIndex] ?? null) : null;
    // A root that binds a firm office is an `office`; one that binds none is an `offsite` vault. The
    // schema refuses a mid-tree node claiming an office, which is what makes the two kinds of root
    // genuinely different rather than a label.
    const rootId = await createNode(
      bindsOffice ? `Office strongroom ${rootIndex + 1}` : `Offsite vault ${rootIndex + 1}`,
      bindsOffice ? "office" : "offsite",
      null,
      firmLocationId,
      0,
    );
    roots.push(rootId);
    for (let safeIndex = 0; safeIndex < volume.safesPerRoot; safeIndex += 1) {
      const safeId = await createNode(
        `Safe ${rootIndex + 1}-${safeIndex + 1}`,
        "safe",
        rootId,
        null,
        1,
      );
      midTreeNodes.push(safeId);
      for (let boxIndex = 0; boxIndex < volume.boxesPerSafe; boxIndex += 1) {
        const boxId = await createNode(
          `Box ${rootIndex + 1}-${safeIndex + 1}-${boxIndex + 1}`,
          "box",
          safeId,
          null,
          2,
        );
        for (let positionIndex = 0; positionIndex < volume.positionsPerBox; positionIndex += 1) {
          positions.push(
            await createNode(
              `Position ${rootIndex + 1}-${safeIndex + 1}-${boxIndex + 1}-${positionIndex + 1}`,
              "position",
              boxId,
              null,
              3,
            ),
          );
        }
      }
    }
  }
  if (positions.length === 0) {
    throw new Error("load-profile: custody volume generated a container tree with no positions");
  }

  // ---- the packets, their items, and their histories ----
  const today = clock.today();
  const now = clock.now();
  const packetsPerOwner = new Map<string, number>();
  const packetIds: CustodyPacketId[] = [];
  let itemCount = 0;
  let holdCount = 0;
  let overduePacketId: CustodyPacketId | null = null;
  let heldPacketId: CustodyPacketId | null = null;
  let reviewScheduledPacketId: CustodyPacketId | null = null;

  // How many movements a packet of this age carries, beyond its opening entry.
  const historyDepthFor = (ageYears: number): number =>
    ageYears *
    faker.number.int({
      min: volume.movementsPerPacketPerYear.min,
      max: volume.movementsPerPacketPerYear.max,
    });

  // A valid movement sequence that leaves the packet back on its shelf: a review (which changes
  // nothing), a move to another position, and a check-out closed by a return. Every kind requiring a
  // destination gets one — a `moved` or `returned` with nowhere to go would leave the register unable
  // to say where the property is, which the write path refuses. The closing `returned` is not
  // decoration: the write path also refuses a second check-out on a packet already out, so a history
  // that ended mid-loan would make everything after it unrecordable.
  const appendHistory = async (
    packetId: CustodyPacketId,
    depth: number,
    firstOccurredAt: string,
    spacingDays: number,
  ): Promise<void> => {
    let cursor = firstOccurredAt;
    let out = false;
    const advance = (): string => {
      cursor = new Date(Date.parse(cursor) + spacingDays * MILLISECONDS_PER_DAY).toISOString();
      return cursor;
    };
    const record = async (kind: CustodyMovementKind, occurredAt: string): Promise<void> => {
      const needsDestination = kind === "moved" || kind === "returned";
      // recordCustodyMovement commits its own batch — the movement row and the status update it
      // derives are one atomic write by construction, which is the whole reason there is one write
      // path for every state change.
      await recordCustodyMovement(
        database,
        packetId,
        {
          kind,
          occurredAt,
          toLocationId: needsDestination
            ? positions[faker.number.int({ min: 0, max: positions.length - 1 })]
            : null,
          borrower:
            kind === "checked_out" ? { kind: "member", userId: attach.actorUserId } : undefined,
          dueBackOn:
            kind === "checked_out"
              ? new Date(Date.parse(occurredAt) + 14 * MILLISECONDS_PER_DAY)
                  .toISOString()
                  .slice(0, 10)
              : undefined,
        },
        serviceOptions,
      );
    };
    for (let step = 0; step < depth; step += 1) {
      const phase = step % 4;
      const kind: CustodyMovementKind =
        phase === 0 ? "reviewed" : phase === 1 ? "moved" : phase === 2 ? "checked_out" : "returned";
      await record(kind, advance());
      out = kind === "checked_out";
    }
    if (out) await record("returned", advance());
  };

  for (let index = 0; index < volume.packetCount; index += 1) {
    const ownerEntityId =
      attach.ownerEntityIds[faker.number.int({ min: 0, max: attach.ownerEntityIds.length - 1 })]!;
    const matterId =
      attach.matterIds[faker.number.int({ min: 0, max: attach.matterIds.length - 1 })]!;
    const ageYears = faker.number.int({ min: 0, max: volume.historySpanYears });
    const depositedAt = instantDaysBefore(now, ageYears * 365);

    const created = await createCustodyPacket(
      database,
      {
        name: `${faker.person.lastName()} ${faker.helpers.arrayElement(["deeds", "will", "papers", "securities"])}`,
        owners: [{ entityId: ownerEntityId }],
        currentLocationId: positions[index % positions.length]!,
        matterId,
        depositorEntityId: ownerEntityId,
        depositedAt,
      },
      { ...serviceOptions, responsibleMemberId: attach.actorUserId },
    );
    packetIds.push(created.packetId);
    packetsPerOwner.set(ownerEntityId, (packetsPerOwner.get(ownerEntityId) ?? 0) + 1);

    const itemTarget = faker.number.int({
      min: volume.itemsPerPacket.min,
      max: volume.itemsPerPacket.max,
    });
    for (let itemIndex = 0; itemIndex < itemTarget; itemIndex += 1) {
      const added = await addCustodyItem(
        database,
        created.packetId,
        {
          description: `${faker.helpers.arrayElement(["Original", "Counterpart", "Sealed"])} ${faker.word.noun()}`,
          itemTypeId: faker.helpers.arrayElement(ITEM_TYPE_IDS),
          occurredAt: depositedAt,
        },
        serviceOptions,
      );
      await commit(added.effect);
      itemCount += 1;
    }

    // The history, spread from the deposit to now. Spacing is derived from the packet's age and its
    // own depth so an old packet's entries really do span its decades rather than bunching at one end.
    const depth = historyDepthFor(ageYears);
    if (depth > 0) {
      const spacingDays = Math.max(1, Math.floor((ageYears * 365) / (depth + 1)));
      await appendHistory(created.packetId, depth, depositedAt, spacingDays);
    }

    // A slice of the register is currently out, and a slice of THAT is already late. The check-out is
    // appended last so it is the packet's live state, and its due-back date is what the sweep reads.
    if (faker.number.float({ min: 0, max: 1 }) < volume.checkedOutPacketFraction) {
      const overdue = faker.number.float({ min: 0, max: 1 }) < volume.overdueCheckoutFraction;
      await recordCustodyMovement(
        database,
        created.packetId,
        {
          kind: "checked_out",
          occurredAt: instantDaysBefore(now, overdue ? 60 : 3),
          borrower: { kind: "member", userId: attach.actorUserId },
          dueBackOn: overdue ? civilDateDaysBefore(today, 30) : civilDateDaysBefore(today, -14),
        },
        serviceOptions,
      );
      if (overdue) overduePacketId ??= created.packetId;
    } else if (faker.number.float({ min: 0, max: 1 }) < volume.heldPacketFraction) {
      // A hold rides only on a packet the firm still physically holds, which is the ordinary case.
      const placed = await placeCustodyHold(
        database,
        created.packetId,
        {
          kind: faker.helpers.arrayElement(HOLD_KINDS),
          reason: faker.lorem.sentence(),
          occurredAt: instantDaysBefore(now, faker.number.int({ min: 1, max: 400 })),
        },
        serviceOptions,
      );
      await commit(placed.effect);
      holdCount += 1;
      heldPacketId ??= created.packetId;
    }

    if (faker.number.float({ min: 0, max: 1 }) < volume.reviewScheduledFraction) {
      const updated = await updateCustodyPacket(
        database,
        created.packetId,
        {
          // Half already due, half still ahead — the reviews-due read has to be selective at volume,
          // and nothing here derives a date or expires when one passes.
          reviewOn: civilDateDaysBefore(today, faker.number.int({ min: -365, max: 365 })),
          reviewIntervalMonths: faker.helpers.arrayElement([12, 36, 60]),
        },
        serviceOptions,
      );
      await commit(updated.effect);
      reviewScheduledPacketId ??= created.packetId;
    }
  }

  // ---- the tail of the history distribution ----
  //
  // Its OWN packet, created last and given the tail depth outright. Everything above produces an
  // average-depth register, and a paginated ledger read measured only there would never see the depth
  // the pagination exists for. A dedicated packet rather than one of the two thousand because those
  // rest in states the extra history could not legally be appended to — a packet left checked out
  // takes no second check-out, and a probe that depended on which state a draw happened to leave
  // would be a probe that broke on a seed change.
  const deepHistoryOwnerEntityId = attach.ownerEntityIds[0]!;
  const deepHistoryPacket = await createCustodyPacket(
    database,
    {
      name: "Long-held deposit",
      owners: [{ entityId: deepHistoryOwnerEntityId }],
      currentLocationId: positions[0]!,
      matterId: attach.matterIds[0]!,
      depositorEntityId: deepHistoryOwnerEntityId,
      depositedAt: instantDaysBefore(now, volume.historySpanYears * 365),
    },
    { ...serviceOptions, responsibleMemberId: attach.actorUserId },
  );
  const deepHistoryPacketId = deepHistoryPacket.packetId;
  packetIds.push(deepHistoryPacketId);
  packetsPerOwner.set(
    deepHistoryOwnerEntityId,
    (packetsPerOwner.get(deepHistoryOwnerEntityId) ?? 0) + 1,
  );
  await appendHistory(
    deepHistoryPacketId,
    volume.deepHistoryMovementCount,
    instantDaysBefore(now, volume.historySpanYears * 365),
    Math.max(
      1,
      Math.floor((volume.historySpanYears * 365) / (volume.deepHistoryMovementCount + 1)),
    ),
  );

  // The cursor onto the SECOND page of that packet's history, taken from the register's own ordering
  // (newest first by occurred_at then id) so the measured page is a real one rather than a guess.
  const historyPageSize = 50;
  const { results: historyHead } = await database
    .prepare(
      "SELECT occurred_at, id FROM custody_movement WHERE packet_id = ?1 ORDER BY occurred_at DESC, id DESC LIMIT ?2",
    )
    .bind(deepHistoryPacketId, historyPageSize)
    .all<{ occurred_at: string; id: string }>();
  const cursorRow = historyHead.at(-1);
  if (cursorRow === undefined) {
    throw new Error("load-profile: custody volume produced a probe packet with no history");
  }

  // The busiest owner — the register's primary filter at its hot case.
  let busiestOwnerEntityId = attach.ownerEntityIds[0]!;
  let mostPackets = -1;
  for (const [entityId, count] of packetsPerOwner) {
    if (count > mostPackets) {
      mostPackets = count;
      busiestOwnerEntityId = entityId;
    }
  }

  // The root whose branch holds the most packets. Every root has the same shape here, so the first is
  // as good as any — but it is resolved from the tree rather than assumed, so a change to the tree
  // shape moves the probe with it instead of silently pointing at an empty branch.
  const subtreeRootLocationId = roots[0];
  const midTreeLocationId = midTreeNodes[0];
  if (subtreeRootLocationId === undefined || midTreeLocationId === undefined) {
    throw new Error("load-profile: custody volume generated no container tree");
  }
  const subtreeLocationIds = await readCustodyLocationSubtreeIds(database, subtreeRootLocationId);

  // Counted off the table rather than tallied in the loop: several write paths append a ledger row of
  // their own (the opening `logged`, an `itemized` per item, a `hold_placed`), so a hand-kept tally
  // would be a second definition of what the ledger holds and the two would eventually disagree.
  const { results: movementTotal } = await database
    .prepare("SELECT COUNT(*) AS movements FROM custody_movement")
    .all<{ movements: number }>();

  return {
    locationCount: nodes.length,
    packetCount: packetIds.length,
    itemCount,
    movementCount: movementTotal[0]?.movements ?? 0,
    holdCount,
    probes: {
      busiestOwnerEntityId,
      subtreeRootLocationId,
      midTreeLocationId,
      subtreeLocationIds,
      deepHistoryPacketId,
      deepHistoryCursorOccurredAt: cursorRow.occurred_at,
      deepHistoryCursorId: cursorRow.id,
      // Falling back to the first packet keeps every probe bound at the smoke multiplier, where a
      // fraction of a dozen packets can round to none. The measurement still runs; it just runs
      // against a packet that is not in that state, which is the honest small-scale answer.
      overduePacketId: overduePacketId ?? deepHistoryPacketId,
      heldPacketId: heldPacketId ?? deepHistoryPacketId,
      reviewScheduledPacketId: reviewScheduledPacketId ?? deepHistoryPacketId,
      asOfDate: today,
      intakeLocationId: positions[0]!,
      intakeMatterId: attach.matterIds[0]!,
      actorUserId: attach.actorUserId,
    },
  };
}
