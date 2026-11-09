/*
 * The register's three entry forms, pinned at the two points where a quiet mistake reaches the
 * record and nobody sees it happen.
 *
 * WHAT IS SENT. An optional field nobody answered must be ABSENT, not empty: an empty string
 * reaches the server as an answer somebody gave, and the register would then hold that the firm was
 * told the depositor is nobody rather than that nobody was asked. That distinction is invisible on
 * screen and permanent in an append-only ledger, which is exactly the shape of defect worth a test.
 *
 * WHAT STOPS A SUBMIT. The three answers the register cannot do its job without, and the contract's
 * own length bounds. A control that enabled on a draft the server would refuse is a person losing
 * what they typed to a 422 the screen could have seen coming.
 */
import { describe, expect, it } from "vitest";
import {
  itemDraftReady,
  itemDraftRequest,
  itemDraftShortfalls,
  packetDraftReady,
  packetDraftRequest,
  packetDraftShortfalls,
  scanDraftReady,
  scanDraftRequest,
  scanDraftShortfalls,
  EMPTY_ITEM_DRAFT,
  EMPTY_PACKET_DRAFT,
  EMPTY_SCAN_DRAFT,
  type PacketDraft,
} from "../src/lib/custodian/packet-draft.ts";
import {
  custodyLocationOptions,
  custodyLocationPath,
} from "../src/lib/custodian/location-options.ts";
import type { CustodyLocationNode } from "../src/lib/custodian/custody-api.ts";

function loggable(overrides: Partial<PacketDraft> = {}): PacketDraft {
  return {
    ...EMPTY_PACKET_DRAFT,
    name: "Smith family deeds",
    owners: [{ entityId: "directoryPerson_smith", displayName: "Ada Smith", ownershipRole: "" }],
    locationId: "custodyLocation_safe",
    ...overrides,
  };
}

function node(overrides: Partial<CustodyLocationNode> = {}): CustodyLocationNode {
  return {
    id: "custodyLocation_one",
    name: "A node",
    kind: "box",
    parentLocationId: null,
    firmLocationId: null,
    address: null,
    status: "active",
    notes: null,
    ...overrides,
  };
}

describe("the packet form", () => {
  it("names the three answers the register cannot work without", () => {
    const shortfalls = packetDraftShortfalls(EMPTY_PACKET_DRAFT);
    expect(packetDraftReady(EMPTY_PACKET_DRAFT)).toBe(false);
    expect(shortfalls).toEqual([
      "Name what the firm is holding.",
      "Name at least one person or organization this is held for.",
      "Choose a container, or add one.",
    ]);
  });

  it("is ready on those three alone, because everything else really is optional", () => {
    expect(packetDraftShortfalls(loggable())).toEqual([]);
    expect(packetDraftReady(loggable())).toBe(true);
  });

  it("sends nothing for a field nobody answered, rather than sending it empty", () => {
    const request = packetDraftRequest(loggable());
    expect(request).toEqual({
      name: "Smith family deeds",
      owners: [{ entityId: "directoryPerson_smith" }],
      currentLocationId: "custodyLocation_safe",
    });
    // Said explicitly: a key that is merely undefined would still serialize away, but a key set to
    // "" would not, and this is the difference the register would record as an answer.
    expect(Object.keys(request)).not.toContain("depositorEntityId");
    expect(Object.keys(request)).not.toContain("notes");
    expect(Object.keys(request)).not.toContain("manualCustodyNumber");
  });

  it("sends what was answered, trimmed", () => {
    const request = packetDraftRequest(
      loggable({
        name: "  Smith family deeds  ",
        owners: [
          {
            entityId: "directoryPerson_smith",
            displayName: "Ada Smith",
            ownershipRole: " Life tenant ",
          },
        ],
        depositorEntityId: "directoryOrganization_bank",
        depositedAt: "2019-04-02",
        notes: "  Sealed on receipt.  ",
        manualCustodyNumber: " OLD-114 ",
        matterId: "matter_conveyance",
      }),
    );
    expect(request).toEqual({
      name: "Smith family deeds",
      owners: [{ entityId: "directoryPerson_smith", ownershipRole: "Life tenant" }],
      currentLocationId: "custodyLocation_safe",
      matterId: "matter_conveyance",
      depositorEntityId: "directoryOrganization_bank",
      depositedAt: "2019-04-02",
      notes: "Sealed on receipt.",
      manualCustodyNumber: "OLD-114",
    });
  });

  it("refuses a draft the contract's own bounds would refuse", () => {
    expect(packetDraftShortfalls(loggable({ name: "x".repeat(301) }))).toEqual([
      "The name is longer than 300 characters.",
    ]);
    expect(packetDraftShortfalls(loggable({ notes: "x".repeat(4001) }))).toEqual([
      "The notes are longer than 4000 characters.",
    ]);
    expect(
      packetDraftShortfalls(
        loggable({
          owners: Array.from({ length: 21 }, (_, index) => ({
            entityId: `directoryPerson_${index}`,
            displayName: `Owner ${index}`,
            ownershipRole: "",
          })),
        }),
      ),
    ).toEqual(["A packet records at most 20 owners."]);
  });

  it("will not assemble a request it has already said is not ready", () => {
    expect(() => packetDraftRequest(EMPTY_PACKET_DRAFT)).toThrow(/location/);
  });
});

describe("the item form", () => {
  it("asks for a description and nothing else, because an item is the unit of description", () => {
    expect(itemDraftShortfalls(EMPTY_ITEM_DRAFT)).toEqual(["Describe what is inside."]);
    expect(itemDraftReady({ ...EMPTY_ITEM_DRAFT, description: "Original will" })).toBe(true);
  });

  it("sends the irreplaceable answer either way, so a catalog default cannot overrule a person", () => {
    // Unticked in front of the object is an ANSWER, and an absent field would let the firm's
    // item-type default decide something a person deliberately decided.
    expect(itemDraftRequest({ ...EMPTY_ITEM_DRAFT, description: "Copy of a will" })).toEqual({
      description: "Copy of a will",
      intrinsicValue: false,
    });
    expect(
      itemDraftRequest({
        description: "Original will",
        itemTypeId: "custodyItemType_will",
        instrumentDate: "1998-11-02",
        intrinsicValue: true,
      }),
    ).toEqual({
      description: "Original will",
      itemTypeId: "custodyItemType_will",
      instrumentDate: "1998-11-02",
      intrinsicValue: true,
    });
  });
});

describe("the filed-copy form", () => {
  it("cannot link a copy that is not a file the firm holds", () => {
    expect(scanDraftShortfalls(EMPTY_SCAN_DRAFT)).toEqual([
      "Choose the filed document this copy is.",
    ]);
    expect(scanDraftReady(EMPTY_SCAN_DRAFT)).toBe(false);
  });

  it("files against the whole packet unless one item was named", () => {
    expect(scanDraftRequest({ ...EMPTY_SCAN_DRAFT, fileId: "file_one" })).toEqual({
      fileId: "file_one",
      kind: "scan",
    });
    expect(
      scanDraftRequest({
        fileId: "file_one",
        kind: "photograph",
        itemId: "custodyItem_will",
        capturedAt: "2026-08-30",
      }),
    ).toEqual({
      fileId: "file_one",
      kind: "photograph",
      itemId: "custodyItem_will",
      capturedAt: "2026-08-30",
    });
  });
});

describe("the container choices", () => {
  const TREE: readonly CustodyLocationNode[] = [
    node({ id: "custodyLocation_box", name: "Box 4", parentLocationId: "custodyLocation_safe" }),
    node({ id: "custodyLocation_office", name: "Reno office", kind: "office" }),
    node({
      id: "custodyLocation_safe",
      name: "Safe",
      kind: "safe",
      parentLocationId: "custodyLocation_office",
    }),
  ];

  it("walks parents before children and carries the whole path", () => {
    expect(custodyLocationOptions(TREE)).toEqual([
      { id: "custodyLocation_office", path: "Reno office", depth: 0 },
      { id: "custodyLocation_safe", path: "Reno office › Safe", depth: 1 },
      { id: "custodyLocation_box", path: "Reno office › Safe › Box 4", depth: 2 },
    ]);
  });

  it("does not offer a closed container, which the server refuses anyway", () => {
    const closed = TREE.map((entry) =>
      entry.id === "custodyLocation_safe" ? { ...entry, status: "closed" as const } : entry,
    );
    const offered = custodyLocationOptions(closed);
    // The box survives its closed parent rather than vanishing with it, and roots its own branch:
    // a container a reader cannot see is a container they will not put anything in. Roots read in
    // name order, which is why Box 4 now sorts above the office it used to sit under.
    expect(offered).toEqual([
      { id: "custodyLocation_box", path: "Box 4", depth: 0 },
      { id: "custodyLocation_office", path: "Reno office", depth: 0 },
    ]);
  });

  it("answers a path for a node it knows and nothing for one it does not", () => {
    expect(custodyLocationPath(TREE, "custodyLocation_box")).toBe("Reno office › Safe › Box 4");
    expect(custodyLocationPath(TREE, "custodyLocation_gone")).toBeNull();
    expect(custodyLocationPath(TREE, null)).toBeNull();
  });
});
