// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import {
  FIRM_RESOURCES,
  firmResourcesInDestroyOrder,
  inventoryFirmResources,
  orphanableFirmResources,
} from "../src/firm-resources.ts";
import type { FirmId } from "@magna-carta/identifiers/types";

/*
 * The manifest exists because a firm's resources cannot be discovered, only declared — no API lists
 * Durable Object instances, none maps a bucket back to its firm, and ai_search_instance is
 * deliberately the sole index of the search instances. So the properties that make walking it SAFE
 * are the ones worth pinning: the control plane goes last, everything that can be orphaned goes
 * before it, and a conditional resource is read rather than assumed.
 */

const FIRM = "firm_pemberton" as FirmId;

describe("the firm resource manifest", () => {
  it("destroys the control plane last, because it is the only index of everything else", () => {
    const order = firmResourcesInDestroyOrder();
    expect(order.at(-1)?.id).toBe("control-plane-rows");
  });

  it("puts every orphanable resource strictly before the control plane", () => {
    const controlPlane = FIRM_RESOURCES.find((one) => one.id === "control-plane-rows");
    // Anything that survives its row is something a wrong order leaves running with nothing able to
    // name it. That is the failure the ordering exists to prevent, so it is asserted rather than
    // trusted to the numbers being written correctly.
    for (const resource of orphanableFirmResources()) {
      expect(resource.destroyOrder).toBeLessThan(controlPlane?.destroyOrder ?? 0);
    }
  });

  it("says of every resource whether it survives its control-plane row", () => {
    // The control plane is the one thing that does not outlive itself; everything else does, which is
    // exactly why the order matters.
    const survivors = FIRM_RESOURCES.filter((one) => one.outlivesTheControlPlane).map(
      (one) => one.id,
    );
    expect(survivors.toSorted()).toEqual(
      ["firm-bucket", "firm-database", "natural-language-search-instance"].toSorted(),
    );
  });

  it("gives every resource a unique destroy position, so a walk is deterministic", () => {
    const positions = FIRM_RESOURCES.map((one) => one.destroyOrder);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("says how each resource is destroyed, because none of them share a mechanism", () => {
    for (const resource of FIRM_RESOURCES) {
      expect(resource.destroyedBy.length).toBeGreaterThan(0);
    }
  });
});

describe("one firm's inventory", () => {
  it("reports the two always-present resources for a firm that has nothing else", () => {
    const inventory = inventoryFirmResources({
      firmId: FIRM,
      bucketName: null,
      searchInstanceName: null,
      searchInstanceState: null,
    });
    const present = inventory.present.filter((one) => one.present).map((one) => one.id);
    // A firm whose bucket step never completed still has a database and a row set.
    expect(present.toSorted()).toEqual(["control-plane-rows", "firm-database"]);
  });

  it("reports a bucket and a live search instance by the names they answer to", () => {
    const inventory = inventoryFirmResources({
      firmId: FIRM,
      bucketName: "magna-carta-production-firm-pemberton",
      searchInstanceName: "opaque-instance-name",
      searchInstanceState: "ready",
    });
    const byId = new Map(inventory.present.map((one) => [one.id, one]));
    expect(byId.get("firm-bucket")).toMatchObject({
      present: true,
      address: "magna-carta-production-firm-pemberton",
    });
    expect(byId.get("natural-language-search-instance")?.present).toBe(true);
    // The database has only ever had one handle: the firm's id.
    expect(byId.get("firm-database")?.address).toBe(FIRM);
  });

  it("treats a torn-down search instance as absent rather than as something still to destroy", () => {
    // `absent` is a RECORDED state — a firm that opted out is a different fact from one that never
    // opted in — so the row exists and the resource does not.
    const inventory = inventoryFirmResources({
      firmId: FIRM,
      bucketName: null,
      searchInstanceName: "opaque-instance-name",
      searchInstanceState: "absent",
    });
    const search = inventory.present.find((one) => one.id === "natural-language-search-instance");
    expect(search?.present).toBe(false);
  });

  it("lists the inventory in destroy order, so a caller that walks it in order is correct", () => {
    const inventory = inventoryFirmResources({
      firmId: FIRM,
      bucketName: "bucket",
      searchInstanceName: "instance",
      searchInstanceState: "ready",
    });
    expect(inventory.present.at(-1)?.id).toBe("control-plane-rows");
  });
});
