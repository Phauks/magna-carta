// @vitest-environment happy-dom
/*
 * Tools is a two-sided screen: the tools column on the left, the tool on the right, on the design
 * system's NavigationLayout. Pinned here, mounted, because the shape is the whole ruling:
 *
 *   - the column is a navigation landmark named Tools, and it lists every permitted tool exactly
 *     once under its subject heading — the same projection the landing index renders, so the two
 *     cannot disagree;
 *   - a tool with a surface is a link to its own route; one without stands in its group unlinked
 *     and wearing the Soon mark, never omitted and never dressed as a broken control;
 *   - the row for the tool the reader is on is marked current, including from a screen beneath it;
 *   - the content column scrolls unless the page claims the scrolling, which the full-height tool
 *     does through its route data.
 *
 * The File Workbench is deliberately NOT here any more. It became a sidebar destination of its own
 * (navigation/destinations.ts) and declares a `route` outside this area, which is what takes it out
 * of the column: every row here loads BESIDE the column, and a row that replaced the whole screen
 * would be the one control that does not. Its manifest stays for contextual surfacing, so
 * CATALOG.length is no longer the column's count.
 */
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "./stubs/app-state.ts";
import { CATALOG } from "@magna-carta/tools/catalog";
import { hasSurface } from "@magna-carta/design-system/maturity";
import ToolsLayout from "../src/routes/(app)/tools/+layout.svelte";
import { load as safeWebsiteViewerLoad } from "../src/routes/(app)/tools/safe-website-viewer/+page.ts";
import {
  currentCatalogueEntry,
  isCurrentCatalogueEntry,
} from "../src/lib/tools/catalogue-navigation.ts";
import { PAGE_OWNS_SCROLLER, contentColumnScrolls } from "../src/lib/tools/content-column.ts";
import { toolCatalogueSections } from "../src/lib/tools/tool-catalogue.ts";
import { SUBJECT_GROUP_LABELS } from "../src/lib/tools/tool-presentation.ts";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

/** What a route's load hands the layout, read without SvelteKit's load event. */
const routeData = (load: unknown): Record<string, unknown> =>
  (load as () => Record<string, unknown>)();

/** A minimal page, the way SvelteKit would hand one to the layout. */
const content = createRawSnippet(() => ({ render: () => "<p>the tool</p>" }));

function drawTools(pathname: string, data: Record<string, unknown> = {}): HTMLElement {
  page.url = new URL(`https://magna-carta.test${pathname}`);
  page.data = data;
  instance = mount(ToolsLayout, { target, props: { children: content } });
  flushSync();
  return target;
}

function navigation(rendered: HTMLElement): HTMLElement {
  const found = rendered.querySelector<HTMLElement>('nav[aria-label="Tools"]');
  if (found === null) throw new Error("the tools column did not render as a named landmark");
  return found;
}

function contentColumn(rendered: HTMLElement): HTMLElement {
  const found = rendered.querySelector<HTMLElement>('[data-navigation-layout="content"]');
  if (found === null) throw new Error("the content column did not render");
  return found;
}

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

describe("the tools column", () => {
  it("lists every permitted tool exactly once, under its subject heading, as the landing index does", () => {
    const column = navigation(drawTools("/tools"));
    const rows = [...column.querySelectorAll("li")].map((row) => row.textContent?.trim() ?? "");
    const expected = toolCatalogueSections().flatMap((section) =>
      section.entries.map((entry) => entry.name),
    );
    expect(rows.map((row) => row.replace(/Soon$/u, "").trim())).toEqual(expected);
    // Every catalog tool the area still addresses, which is all of them but the promoted ones.
    expect(new Set(expected).size).toBe(CATALOG.filter((tool) => tool.route === undefined).length);

    const headings = [...column.querySelectorAll("p.mc-field-label")].map(
      (heading) => heading.textContent?.trim() ?? "",
    );
    expect(headings).toEqual(toolCatalogueSections().map((section) => section.label));
    for (const heading of headings) expect(Object.values(SUBJECT_GROUP_LABELS)).toContain(heading);
  });

  it("links a tool with a surface to its route, and leaves one without unlinked and marked Soon", () => {
    const column = navigation(drawTools("/tools"));
    for (const section of toolCatalogueSections()) {
      for (const entry of section.entries) {
        const link = column.querySelector(`a[href="/tools/${entry.id}"]`);
        if (hasSurface(entry.stage)) {
          expect(link, `${entry.name} should be a link`).not.toBeNull();
          expect(link?.textContent).not.toContain("Soon");
        } else {
          expect(link, `${entry.name} has no surface and must not link`).toBeNull();
          const row = [...column.querySelectorAll("li")].find((candidate) =>
            candidate.textContent?.includes(entry.name),
          );
          expect(row?.textContent).toContain("Soon");
          expect(row?.querySelector('[aria-disabled="true"]')).not.toBeNull();
        }
      }
    }
  });

  it("lights the row of the tool the reader is on, including from a screen beneath it", () => {
    const onWhois = navigation(drawTools("/tools/whois-lookup"));
    expect(onWhois.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(
      "/tools/whois-lookup",
    );
    expect(onWhois.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    if (instance !== undefined) void unmount(instance);
    instance = undefined;
    target.replaceChildren();

    const onBeneath = navigation(drawTools("/tools/whois-lookup/some-record"));
    expect(onBeneath.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(
      "/tools/whois-lookup",
    );
    if (instance !== undefined) void unmount(instance);
    instance = undefined;
    target.replaceChildren();

    const onLanding = navigation(drawTools("/tools"));
    expect(onLanding.querySelector('[aria-current="page"]')).toBeNull();
  });

  it("leaves out a tool promoted to its own destination, and the group it emptied", () => {
    const column = navigation(drawTools("/tools"));
    expect(column.textContent).not.toContain("File Workbench");
    expect(column.querySelector('a[href="/file-workbench"]')).toBeNull();
    expect(
      toolCatalogueSections().some((section) => section.id === "files"),
      "the files group has no tool left to show",
    ).toBe(false);
  });

  it("renders the page beside the column", () => {
    const rendered = drawTools("/tools/whois-lookup");
    expect(contentColumn(rendered).textContent).toContain("the tool");
  });
});

describe("who scrolls the content column", () => {
  it("is the column itself unless the page claims it", () => {
    const scrolling = contentColumn(drawTools("/tools/whois-lookup"));
    expect(scrolling.classList.contains("mc-navigation-layout-content-scrolling")).toBe(true);
    if (instance !== undefined) void unmount(instance);
    instance = undefined;
    target.replaceChildren();

    const owned = contentColumn(drawTools("/tools/safe-website-viewer", { ...PAGE_OWNS_SCROLLER }));
    expect(owned.classList.contains("mc-navigation-layout-content-scrolling")).toBe(false);
  });

  it("is claimed by the full-height tool through its route data, and by nothing else", () => {
    // One tool claims it now. The workbench was the other, and it stages its own height against
    // the App Shell rather than against this column since it stopped being a tool.
    expect(contentColumnScrolls({})).toBe(true);
    expect(contentColumnScrolls({ contentScrolls: true })).toBe(true);
    expect(contentColumnScrolls({ ...PAGE_OWNS_SCROLLER })).toBe(false);
    expect(contentColumnScrolls(routeData(safeWebsiteViewerLoad))).toBe(false);
  });
});

describe("which row is current", () => {
  const sections = toolCatalogueSections();
  const whois = sections
    .flatMap((section) => section.entries)
    .find((entry) => entry.id === "whois-lookup");
  if (whois === undefined) throw new Error("the WHOIS lookup is not in the catalogue");

  it("is the entry whose route the address is on or beneath, on the path boundary", () => {
    expect(isCurrentCatalogueEntry(whois, "/tools/whois-lookup")).toBe(true);
    expect(isCurrentCatalogueEntry(whois, "/tools/whois-lookup/some-record")).toBe(true);
    expect(isCurrentCatalogueEntry(whois, "/tools/whois-lookup-else")).toBe(false);
    expect(isCurrentCatalogueEntry(whois, "/tools")).toBe(false);
    expect(isCurrentCatalogueEntry({ ...whois, href: null }, "/tools/whois-lookup")).toBe(false);
  });

  it("is nothing on the landing screen", () => {
    expect(currentCatalogueEntry(sections, "/tools")).toBeNull();
    expect(currentCatalogueEntry(sections, "/tools/whois-lookup")?.id).toBe("whois-lookup");
  });
});
