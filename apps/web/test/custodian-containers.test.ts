/*
 * Adding a container from the packet form, pinned where a quiet mistake would put property in the
 * wrong place or make the server refuse a container the screen offered.
 *
 * The server lets only a root name one of the firm's offices, so a container put "inside an office"
 * the tree has never met is two writes: the office's own root, then the container under it. A
 * request that named the office on the child would be refused; one that skipped the root would
 * file the container at the top of the tree with no office at all.
 */
import { describe, expect, it } from "vitest";
import {
  containerDraftRequests,
  containerDraftShortfall,
  containerParentOptions,
  defaultContainerParent,
  kindFromName,
  STANDS_ALONE,
} from "../src/lib/custodian/container-draft.ts";
import type { CustodyLocationNode } from "../src/lib/custodian/custody-api.ts";

function node(
  overrides: Partial<CustodyLocationNode> & { id: string; name: string },
): CustodyLocationNode {
  return {
    kind: "box",
    parentLocationId: null,
    firmLocationId: null,
    address: null,
    status: "active",
    notes: null,
    ...overrides,
  };
}

const MAIN = { id: "location_main", name: "Main Street", firmDefault: true };
const RIVER = { id: "location_river", name: "Riverside", firmDefault: false };

describe("where a new container can go", () => {
  it("offers open containers by path, then offices not yet in the tree, then standing alone", () => {
    const nodes = [
      node({ id: "a", name: "Main Street", kind: "office", firmLocationId: MAIN.id }),
      node({ id: "b", name: "Deeds Safe", kind: "safe", parentLocationId: "a" }),
    ];
    expect(containerParentOptions(nodes, [MAIN, RIVER])).toEqual([
      { value: "container:a", label: "Main Street" },
      { value: "container:b", label: "Main Street › Deeds Safe" },
      { value: "office:location_river", label: "Riverside" },
      { value: STANDS_ALONE, label: "Standalone (such as a bank or offsite storage)" },
    ]);
  });

  it("defaults to the firm's default office, as a container once the tree has it", () => {
    expect(defaultContainerParent([], [RIVER, MAIN])).toBe("office:location_main");
    const rooted = [
      node({ id: "a", name: "Main Street", kind: "office", firmLocationId: MAIN.id }),
    ];
    expect(defaultContainerParent(rooted, [RIVER, MAIN])).toBe("container:a");
    expect(defaultContainerParent([], [])).toBe(STANDS_ALONE);
  });
});

describe("what is sent", () => {
  it("creates an office's root first when the container goes into a new office", () => {
    expect(
      containerDraftRequests(
        { name: " Deeds Safe ", kind: "safe", parent: "office:location_main" },
        [MAIN],
      ),
    ).toEqual({
      officeRoot: { name: "Main Street", kind: "office", firmLocationId: MAIN.id },
      container: { name: "Deeds Safe", kind: "safe" },
    });
  });

  it("makes an office-kind container the office's root itself", () => {
    expect(
      containerDraftRequests(
        { name: "Head Office", kind: "office", parent: "office:location_main" },
        [MAIN],
      ),
    ).toEqual({
      officeRoot: null,
      container: { name: "Head Office", kind: "office", firmLocationId: MAIN.id },
    });
  });

  it("hangs a container from a chosen container, and never names an office on a child", () => {
    expect(
      containerDraftRequests({ name: "Box 1", kind: "box", parent: "container:b" }, [MAIN]),
    ).toEqual({
      officeRoot: null,
      container: { name: "Box 1", kind: "box", parentLocationId: "b" },
    });
  });

  it("puts a standalone container at the top of the tree", () => {
    expect(
      containerDraftRequests({ name: "City Bank", kind: "bank", parent: STANDS_ALONE }, []),
    ).toEqual({
      officeRoot: null,
      container: { name: "City Bank", kind: "bank" },
    });
  });
});

describe("what stops the add", () => {
  it("needs a name and a kind", () => {
    expect(containerDraftShortfall({ name: " ", kind: "box", parent: STANDS_ALONE })).toBe(
      "Name the container.",
    );
    expect(containerDraftShortfall({ name: "Box 1", kind: "", parent: STANDS_ALONE })).toBe(
      "Say what kind of container it is.",
    );
    expect(
      containerDraftShortfall({ name: "Box 1", kind: "box", parent: STANDS_ALONE }),
    ).toBeNull();
  });

  it("reads the kind a name already says", () => {
    expect(kindFromName("Box 4")).toBe("box");
    expect(kindFromName("Deeds Safe")).toBe("safe");
    expect(kindFromName("Riverside Bank Vault")).toBe("bank");
    expect(kindFromName("Archive")).toBe("");
  });
});
