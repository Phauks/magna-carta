// @vitest-environment happy-dom
/*
 * Settings is a two-sided screen, and its nav is the oldest of the three that are: the bands, the
 * groups and the page rows it stacks are its own, but the ROW is the design system's, the same part
 * the Tools and Reports columns draw. Pinned here, mounted, because the thing worth defending is
 * that the treatment lives in one place: three columns had each written out a control height, a
 * hover tint, a selected fill and a gilt start-edge bar, and a class list reappearing at any of the
 * three call sites is how that comes apart again.
 *
 * The session read the layout starts is answered with a refusal, which is the honest shape for a
 * mounted test and exercises the "View" chip on every firm section that declares an edit right.
 */
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "./stubs/app-state.ts";
import SettingsLayout from "../src/routes/(app)/settings/+layout.svelte";
import { bandedSettingsSections } from "../src/lib/settings/settings-sections.ts";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

const content = createRawSnippet(() => ({ render: () => "<p>the settings page</p>" }));

function drawSettings(pathname: string): HTMLElement {
  page.url = new URL(`https://magna-carta.test${pathname}`);
  instance = mount(SettingsLayout, { target, props: { children: content } });
  flushSync();
  return target;
}

function navigation(rendered: HTMLElement): HTMLElement {
  const found = rendered.querySelector<HTMLElement>('nav[aria-label="Settings sections"]');
  if (found === null) throw new Error("the settings column did not render as a named landmark");
  return found;
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no session in a mounted test")));
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  page.url = new URL("https://magna-carta.test/");
  vi.unstubAllGlobals();
});

describe("the settings column", () => {
  it("lists every section once, in the registry's order, as a link to its own page", () => {
    const column = navigation(drawSettings("/settings/theme"));
    const expected = bandedSettingsSections().flatMap((band) =>
      band.groups.flatMap((group) => group.sections.map((section) => section.href)),
    );
    const links = [...column.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(links).toEqual(expected);
  });

  it("lights exactly the row of the section the reader is on", () => {
    const column = navigation(drawSettings("/settings/theme"));
    const lit = column.querySelectorAll('[aria-current="page"]');
    expect(lit).toHaveLength(1);
    expect(lit[0]?.getAttribute("href")).toBe("/settings/theme");
  });

  it("draws every row as the design system's navigation row, with no treatment of its own", () => {
    const column = navigation(drawSettings("/settings/theme"));
    const rows = [...column.querySelectorAll("li > *")];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.classList.contains("mc-navigation-layout-row")).toBe(true);
      expect(row.getAttribute("style")).toBeNull();
    }
  });

  it("renders the page beside the column, in a column the page scrolls itself", () => {
    const rendered = drawSettings("/settings/theme");
    const column = rendered.querySelector<HTMLElement>('[data-navigation-layout="content"]');
    expect(column?.textContent).toContain("the settings page");
    // Every settings page stages its own masthead, scroll region and exit footer.
    expect(column?.classList.contains("mc-navigation-layout-content-scrolling")).toBe(false);
  });
});
