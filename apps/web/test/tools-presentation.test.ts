/*
 * Fitness checks for the Tools listing's presentation layer: every catalog tool has exactly
 * one descriptor + stage, every catalog icon name resolves to a component, every subject group
 * has a label, and the mock-gated grouping surfaces the whole catalog in canonical order. These
 * are the guards that keep a newly-added catalog tool from rendering blank or vanishing.
 */
import { describe, expect, it } from "vitest";
import { CATALOG } from "@magna-carta/tools/catalog";
import { SUBJECT_GROUP_ORDER } from "@magna-carta/tools/types";
import {
  SUBJECT_GROUP_LABELS,
  TOOL_ICONS,
  TOOL_PRESENTATION,
  visibleToolGroups,
} from "../src/lib/tools/tool-presentation.ts";

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

  it("labels every subject group", () => {
    for (const group of SUBJECT_GROUP_ORDER) {
      expect(SUBJECT_GROUP_LABELS[group], `missing label for ${group}`).toBeTruthy();
    }
  });
});

describe("visibleToolGroups (mock all-permissions)", () => {
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
