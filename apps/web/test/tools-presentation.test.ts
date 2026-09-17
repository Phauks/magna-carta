/*
 * Fitness checks for the tools' presentation layer: every catalog tool has exactly one descriptor
 * and stage, every catalog icon name resolves to a component, every subject cluster has a rail
 * cluster to fold into, and the mock-gated grouping surfaces the whole catalog in canonical order.
 * These are the guards that keep a newly-added catalog tool from rendering blank or vanishing.
 */
import { describe, expect, it } from "vitest";
import { CATALOG } from "@magna-carta/tools/catalog";
import { SUBJECT_GROUP_ORDER } from "@magna-carta/tools/types";
import {
  TOOL_ICONS,
  TOOL_PRESENTATION,
  visibleToolGroups,
} from "../src/lib/tools/tool-presentation.ts";
import { clusterById } from "../src/lib/navigation/clusters.ts";

const catalogIds = CATALOG.map((tool) => tool.id).sort();

describe("tool presentation completeness", () => {
  it("has a presentation entry for every catalog tool and no extras", () => {
    expect(Object.keys(TOOL_PRESENTATION).sort()).toEqual(catalogIds);
  });

  it("resolves an icon component for every catalog icon name", () => {
    for (const tool of CATALOG) {
      expect(TOOL_ICONS[tool.icon], `missing icon for ${tool.icon}`).toBeDefined();
    }
  });

  it("gives every subject group a rail cluster to fold into", () => {
    // The cluster registry is where a subject's NAME and glyph live now, because a cluster is a
    // thing the rail draws. A subject with no cluster would put its tools in the Tools group with
    // no heading over them and no way to fold them away.
    for (const group of SUBJECT_GROUP_ORDER) {
      const cluster = clusterById(group);
      expect(cluster, `missing cluster for ${group}`).not.toBeNull();
      expect(cluster?.group).toBe("tools");
      expect(cluster?.label).not.toBe("");
    }
  });
});

describe("visibleToolGroups (mock all-permissions)", () => {
  it("sorts a cluster's tools alphabetically by name", () => {
    // Owner's direction, 2026-09-16: a member comes to the rail with a tool's NAME in mind, so the
    // order their eye can scan is the one that answers fastest. Catalog order is the order rows
    // were written.
    for (const { tools } of visibleToolGroups()) {
      const names = tools.map((tool) => tool.name);
      expect(names).toEqual(names.toSorted((left, right) => left.localeCompare(right)));
    }
  });

  it("returns every non-empty group in canonical order", () => {
    const expectedOrder = SUBJECT_GROUP_ORDER.filter((group) =>
      CATALOG.some((tool) => tool.subjectGroup === group),
    );
    expect(visibleToolGroups().map((entry) => entry.group)).toEqual(expectedOrder);
  });

  it("surfaces the whole catalog exactly once", () => {
    const listed = visibleToolGroups()
      .flatMap((entry) => entry.tools.map((tool) => tool.id))
      .sort();
    expect(listed).toEqual(catalogIds);
  });
});
