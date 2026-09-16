// @vitest-environment happy-dom
/*
 * How a member reaches a tool, since the owner's direction of 2026-09-16: from the GLOBAL RAIL, not
 * from a navigation column inside a Tools sub-page. Pinned here because the whole ruling is the
 * shape:
 *
 *   - every permitted tool is a row in the rail's own Tools group, exactly once, in the catalog's
 *     canonical subject order — derived from the catalog, never hand-listed, so a tool added there
 *     appears in the rail with no edit to the destination registry;
 *   - a tool with a surface routes to its own address; one without is an announced Soon row, never
 *     omitted and never a link to a page that is not there;
 *   - the Tools layout is a passthrough, so a tool opens onto the whole canvas — the navigation
 *     column that used to sit beside it is gone, and with it the width it was taking;
 *   - the index at /tools survives as the index, and lights as current only on its own address,
 *     because everything beneath it is now a row of its own.
 *
 * The File Workbench is deliberately absent. It declares a `route` outside this area, which is what
 * takes it out of every projection of the catalog; its manifest stays for contextual surfacing, so
 * CATALOG.length is not the count of anything here.
 */
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "./stubs/app-state.ts";
import { CATALOG, toolRoute } from "@magna-carta/tools/catalog";
import { hasSurface } from "@magna-carta/design-system/maturity";
import ToolsLayout from "../src/routes/(app)/tools/+layout.svelte";
import {
  DESTINATION_GROUPS,
  DESTINATIONS,
  isCurrentDestination,
  type Destination,
} from "../src/lib/navigation/destinations.ts";
import { toolSidebarDestinations } from "../src/lib/navigation/tool-sidebar.ts";
import {
  currentCatalogueEntry,
  isCurrentCatalogueEntry,
} from "../src/lib/catalogue/catalogue-navigation.ts";
import { toolCatalogueSections } from "../src/lib/tools/tool-catalogue.ts";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

/** A minimal page, the way SvelteKit would hand one to the layout. */
const content = createRawSnippet(() => ({ render: () => "<p>the tool</p>" }));

function drawTools(pathname: string): HTMLElement {
  page.url = new URL(`https://magna-carta.test${pathname}`);
  page.data = {};
  instance = mount(ToolsLayout, { target, props: { children: content } });
  flushSync();
  return target;
}

const indexRow = DESTINATIONS.find((destination) => destination.id === "tools") as Destination;

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  page.url = new URL("https://magna-carta.test/");
  page.data = {};
});

describe("the tools in the rail", () => {
  const rows = toolSidebarDestinations();

  it("is every permitted tool exactly once, in the catalog's own order", () => {
    const expected = toolCatalogueSections().flatMap((section) =>
      section.entries.map((entry) => entry.name),
    );
    expect(rows.map((row) => row.label)).toEqual(expected);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(rows.length).toBe(CATALOG.filter((tool) => tool.route === undefined).length);
  });

  it("addresses each tool where the catalog says, and never invents an id", () => {
    for (const tool of CATALOG.filter((candidate) => candidate.route === undefined)) {
      const row = rows.find((candidate) => candidate.id === `tool-${tool.id}`);
      expect(row, `${tool.name} should have a rail row`).toBeDefined();
      expect(row?.href).toBe(toolRoute(tool));
    }
  });

  it("ships a tool with a surface and announces one without", () => {
    for (const row of rows) {
      expect(row.shipped).toBe(hasSurface(row.stage ?? "soon"));
      if (!row.shipped) expect(row.announced).toBe(true);
    }
  });

  it("leaves out a tool promoted to its own destination", () => {
    expect(rows.some((row) => row.href === "/file-workbench")).toBe(false);
    expect(rows.some((row) => row.label === "File Workbench")).toBe(false);
  });

  it("belongs to a Tools group the registry heads with its index", () => {
    expect(DESTINATION_GROUPS.some((group) => group.id === "tools")).toBe(true);
    for (const row of rows) expect(row.group).toBe("tools");
    expect(indexRow.group).toBe("tools");
    expect(indexRow.href).toBe("/tools");
  });

  it("is governed by permissions rather than by stars, so every row is pinned", () => {
    // A star beside a tool would be a second answer to a question access control has settled, and
    // an inert one — Customize mode leaves the group out for the same reason.
    for (const row of rows) expect(row.pinned).toBe(true);
  });
});

describe("which row lights", () => {
  const rows = toolSidebarDestinations();
  const whoisRow = rows.find((row) => row.href === "/tools/whois-lookup") as Destination;

  it("is the tool's own row while its address is open, and never the index with it", () => {
    expect(isCurrentDestination(whoisRow, "/tools/whois-lookup")).toBe(true);
    expect(isCurrentDestination(whoisRow, "/tools/whois-lookup/some-record")).toBe(true);
    // The index is exact: everything under /tools is a row of its own now, so a prefix match here
    // would light two rows at once.
    expect(isCurrentDestination(indexRow, "/tools/whois-lookup")).toBe(false);
    expect(isCurrentDestination(indexRow, "/tools")).toBe(true);
  });
});

describe("the tools layout", () => {
  it("renders the page and nothing else — no navigation column beside it", () => {
    const rendered = drawTools("/tools/whois-lookup");
    expect(rendered.textContent).toContain("the tool");
    expect(rendered.querySelector('nav[aria-label="Tools"]')).toBeNull();
    expect(rendered.querySelector("[data-navigation-layout]")).toBeNull();
  });
});

describe("the index's own catalogue", () => {
  const sections = toolCatalogueSections();
  const whois = sections
    .flatMap((section) => section.entries)
    .find((entry) => entry.id === "whois-lookup");
  if (whois === undefined) throw new Error("the WHOIS lookup is not in the catalogue");

  it("still resolves the entry an address is on, for the index that lists them", () => {
    expect(isCurrentCatalogueEntry(whois, "/tools/whois-lookup")).toBe(true);
    expect(isCurrentCatalogueEntry(whois, "/tools/whois-lookup/some-record")).toBe(true);
    expect(isCurrentCatalogueEntry(whois, "/tools/whois-lookup-else")).toBe(false);
    expect(isCurrentCatalogueEntry(whois, "/tools")).toBe(false);
    expect(isCurrentCatalogueEntry({ ...whois, href: null }, "/tools/whois-lookup")).toBe(false);
    expect(currentCatalogueEntry(sections, "/tools")).toBeNull();
    expect(currentCatalogueEntry(sections, "/tools/whois-lookup")?.id).toBe("whois-lookup");
  });
});
