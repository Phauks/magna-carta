/*
 * The register's column model and the listing's query, pinned.
 *
 * These are the places on this surface where a quiet mistake would be invisible on screen and wrong
 * in a way a person would act on: a location cell that prints a handle, a checked-out packet that
 * reads as though it were on a shelf, a status filter offering enum values nobody says out loud,
 * and a listing asked with a filter the caller did not choose.
 */
import { describe, expect, it } from "vitest";
import {
  custodyPacketColumns,
  custodyRegisterVocabulary,
  packetLocationText,
  CUSTODY_REGISTER_INITIAL_SORT,
  EMPTY_CUSTODY_VOCABULARY,
  NOT_ON_A_SHELF,
} from "../src/lib/custodian/packet-columns.ts";
import { listCustodyPackets, type CustodyPacketSummary } from "../src/lib/custodian/custody-api.ts";
import { entityDisplayName } from "../src/lib/custodian/directory-names.svelte.ts";

function packet(overrides: Partial<CustodyPacketSummary> = {}): CustodyPacketSummary {
  return {
    id: "custodyPacket_one",
    custodyNumber: "CUS-00042",
    name: "Smith family deeds",
    status: "held",
    currentLocationId: "custodyLocation_safe",
    matterId: null,
    createdAt: "2026-03-14T09:00:00.000Z",
    ...overrides,
  };
}

const VOCABULARY = custodyRegisterVocabulary([{ id: "custodyLocation_safe", name: "Reno safe" }]);

function columnText(id: string, row: CustodyPacketSummary): string {
  const column = custodyPacketColumns(VOCABULARY).find((candidate) => candidate.id === id);
  if (column === undefined) throw new Error(`The register has no ${id} column.`);
  const value = column.text?.(row) ?? column.value(row);
  return value === null || value === undefined ? "" : String(value);
}

describe("the register's columns", () => {
  it("anchors the row on the custody number", () => {
    // It is written on a physical label, read aloud over the phone, and searched by. It leads, and
    // the columns menu cannot take it away.
    const [first] = custodyPacketColumns(VOCABULARY);
    expect(first?.id).toBe("custodyNumber");
    expect(first?.anchored).toBe(true);
  });

  it("opens most recently logged first", () => {
    expect(CUSTODY_REGISTER_INITIAL_SORT).toEqual({
      columnId: "createdAt",
      direction: "descending",
    });
  });

  it("filters status on the word a person says, not the stored value", () => {
    expect(columnText("status", packet())).toBe("Held");
    expect(columnText("status", packet({ status: "out" }))).toBe("Out");
  });

  it("names a location from the firm's own tree", () => {
    expect(columnText("location", packet())).toBe("Reno safe");
  });

  it("renders a location the tree cannot name as empty, never as the handle", () => {
    const text = packetLocationText(packet(), EMPTY_CUSTODY_VOCABULARY);
    expect(text).toBe("");
    expect(text).not.toContain("custodyLocation_");
  });
});

describe("a packet that is not on a shelf", () => {
  it("says so for every status that puts it nowhere", () => {
    for (const status of ["out", "released", "destroyed", "lost"] as const) {
      expect(packetLocationText(packet({ status, currentLocationId: null }), VOCABULARY)).toBe(
        NOT_ON_A_SHELF,
      );
    }
  });

  it("leaves a held packet with no location as an honest gap", () => {
    // A held packet with no shelf is a row somebody wrote without one, which is a gap and should
    // read as one — not as the register asserting that it is out.
    expect(packetLocationText(packet({ currentLocationId: null }), VOCABULARY)).toBe("");
  });
});

/** A fetch that records the paths it was asked for and answers an empty page. */
function capture() {
  const asked: string[] = [];
  const fetchImpl = ((path: string) => {
    asked.push(path);
    return Promise.resolve(
      new Response(JSON.stringify({ data: [], nextCursor: null }), {
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return { asked, fetchImpl };
}

describe("the listing's query", () => {
  it("asks with no filter at all when none was chosen", async () => {
    const { asked, fetchImpl } = capture();
    await listCustodyPackets(fetchImpl);
    expect(asked[0]).toBe("/api/v1/custody/packets");
  });

  it("carries every filter the caller chose, and nothing it did not", async () => {
    const { asked, fetchImpl } = capture();
    await listCustodyPackets(fetchImpl, {
      status: "out",
      matterId: "matter_one",
      locationSubtreeId: "custodyLocation_safe",
      search: "Smith",
    });
    const [path] = asked;
    expect(path).toContain("status=out");
    expect(path).toContain("matterId=matter_one");
    expect(path).toContain("locationSubtreeId=custodyLocation_safe");
    expect(path).toContain("search=Smith");
    expect(path).not.toContain("ownerEntityId");
  });
});

describe("naming a directory entity", () => {
  it("prefers the directory's own display name", () => {
    expect(entityDisplayName({ displayName: "Jane Smith", given: "Jane", family: "Smyth" })).toBe(
      "Jane Smith",
    );
  });

  it("assembles a person from the parts the record carries", () => {
    expect(entityDisplayName({ given: "Jane", middle: "R", family: "Smith", suffix: "III" })).toBe(
      "Jane R Smith III",
    );
  });

  it("falls back to an organization's legal name", () => {
    expect(entityDisplayName({ displayName: null, legalName: "Acme Holdings Ltd" })).toBe(
      "Acme Holdings Ltd",
    );
  });

  it("answers nothing rather than an empty string when the record names nobody", () => {
    expect(entityDisplayName({ displayName: "  ", legalName: null })).toBeNull();
  });
});
