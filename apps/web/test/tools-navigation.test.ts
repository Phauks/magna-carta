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
 *   - the row for the tool the reader is on is marked current, including from a screen beneath it
 *     (the workbench's password recovery);
 *   - the content column scrolls unless the page claims the scrolling, which the two full-height
 *     tools do through their route data.
 */
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "./stubs/app-state.ts";
import { CATALOG } from "@magna-carta/tools/catalog";
import { hasSurface } from "@magna-carta/design-system/maturity";
import ToolsLayout from "../src/routes/(app)/tools/+layout.svelte";
import { load as fileWorkbenchLoad } from "../src/routes/(app)/tools/file-workbench/+page.ts";
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
    expect(new Set(expected).size).toBe(CATALOG.length);

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
    const onWorkbench = navigation(drawTools("/tools/file-workbench"));
    expect(onWorkbench.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(
      "/tools/file-workbench",
    );
    expect(onWorkbench.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    if (instance !== undefined) void unmount(instance);
    instance = undefined;
    target.replaceChildren();

    const onRecovery = navigation(drawTools("/tools/file-workbench/recovery/job-1"));
    expect(onRecovery.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(
      "/tools/file-workbench",
    );
    if (instance !== undefined) void unmount(instance);
    instance = undefined;
    target.replaceChildren();

    const onLanding = navigation(drawTools("/tools"));
    expect(onLanding.querySelector('[aria-current="page"]')).toBeNull();
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

    const owned = contentColumn(drawTools("/tools/file-workbench", { ...PAGE_OWNS_SCROLLER }));
    expect(owned.classList.contains("mc-navigation-layout-content-scrolling")).toBe(false);
  });

  it("is claimed by the two full-height tools through their route data, and by nothing else", () => {
    expect(contentColumnScrolls({})).toBe(true);
    expect(contentColumnScrolls({ contentScrolls: true })).toBe(true);
    expect(contentColumnScrolls({ ...PAGE_OWNS_SCROLLER })).toBe(false);
    expect(contentColumnScrolls(routeData(fileWorkbenchLoad))).toBe(false);
    expect(contentColumnScrolls(routeData(safeWebsiteViewerLoad))).toBe(false);
  });
});

describe("which row is current", () => {
  const sections = toolCatalogueSections();
  const workbench = sections
    .flatMap((section) => section.entries)
    .find((entry) => entry.id === "file-workbench");
  if (workbench === undefined) throw new Error("the workbench is not in the catalogue");

  it("is the entry whose route the address is on or beneath, on the path boundary", () => {
    expect(isCurrentCatalogueEntry(workbench, "/tools/file-workbench")).toBe(true);
    expect(isCurrentCatalogueEntry(workbench, "/tools/file-workbench/recovery/job-1")).toBe(true);
    expect(isCurrentCatalogueEntry(workbench, "/tools/file-workbench-else")).toBe(false);
    expect(isCurrentCatalogueEntry(workbench, "/tools")).toBe(false);
    expect(isCurrentCatalogueEntry({ ...workbench, href: null }, "/tools/file-workbench")).toBe(
      false,
    );
  });

  it("is nothing on the landing screen", () => {
    expect(currentCatalogueEntry(sections, "/tools")).toBeNull();
    expect(currentCatalogueEntry(sections, "/tools/whois-lookup")?.id).toBe("whois-lookup");
  });
});
