// @vitest-environment happy-dom
/*
 * The settings column FOLDS, and these are the two halves of that worth pinning.
 *
 * The first is pure: what survives a read of the stored preference. Folds are stored as DEPARTURES
 * from everything-open, so a band or a group shipped later arrives open rather than inheriting a
 * preference nobody expressed — and anything this build does not ship drops on read, or a retired
 * group's name would fold whichever group takes it next.
 *
 * The second is mounted, because the rule that matters is not "a chevron turns": it is that the
 * column never folds away the page the reader is standing on, and that pressing the heading of a
 * band held open only for that reason still folds it. Both are behaviours of the layout rather than
 * of the store, which is why they are tested through the rendered column.
 *
 * The store is a module singleton (one member, one browser), so these tests restore what they fold.
 */
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "./stubs/app-state.ts";
import SettingsLayout from "../src/routes/(app)/settings/+layout.svelte";
import { normalizeSettingsNavigationFolds } from "../src/lib/settings/settings-navigation-folds.svelte.ts";

describe("normalizeSettingsNavigationFolds", () => {
  it("folds nothing when nothing is stored", () => {
    expect(normalizeSettingsNavigationFolds(undefined)).toEqual({
      collapsedBands: [],
      collapsedGroups: [],
    });
  });

  it("folds nothing for a payload that is not an object", () => {
    for (const parsed of [null, 42, "firm", true]) {
      expect(normalizeSettingsNavigationFolds(parsed)).toEqual({
        collapsedBands: [],
        collapsedGroups: [],
      });
    }
  });

  it("keeps a band and a group this build ships", () => {
    expect(
      normalizeSettingsNavigationFolds({ collapsedBands: ["firm"], collapsedGroups: ["practice"] }),
    ).toEqual({ collapsedBands: ["firm"], collapsedGroups: ["practice"] });
  });

  it("drops an id no registry carries, and never mixes the two key spaces", () => {
    // "firm" names both a band and a group, which is exactly why each list is validated against its
    // own registry rather than against one pooled set of names.
    expect(
      normalizeSettingsNavigationFolds({
        collapsedBands: ["practice", "firm", 7],
        collapsedGroups: ["user", "billing"],
      }),
    ).toEqual({ collapsedBands: ["firm"], collapsedGroups: ["billing"] });
  });

  it("keeps the other list's default when only one is stored", () => {
    expect(normalizeSettingsNavigationFolds({ collapsedGroups: ["appearance"] })).toEqual({
      collapsedBands: [],
      collapsedGroups: ["appearance"],
    });
  });
});

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

const content = createRawSnippet(() => ({ render: () => "<p>the settings page</p>" }));

function drawSettings(pathname: string): HTMLElement {
  page.url = new URL(`https://magna-carta.test${pathname}`);
  instance = mount(SettingsLayout, { target, props: { children: content } });
  flushSync();
  return target;
}

function takeDown(): void {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.replaceChildren();
}

/** The heading that folds a band or a group, by the name it carries. */
function heading(rendered: HTMLElement, label: string): HTMLButtonElement {
  const found = [...rendered.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
  if (found === undefined) throw new Error(`no folding heading reads "${label}"`);
  return found;
}

function press(button: HTMLButtonElement): void {
  button.click();
  flushSync();
}

/** The addresses the column is offering — a row's text carries its standing chip, its href does not. */
function rowAddresses(rendered: HTMLElement): string[] {
  return [...rendered.querySelectorAll("a")].map((link) => link.getAttribute("href") ?? "");
}

function expansionOf(button: HTMLButtonElement): string | null {
  return button.getAttribute("aria-expanded");
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no session in a mounted test")));
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  takeDown();
  target.remove();
  page.url = new URL("https://magna-carta.test/");
  vi.unstubAllGlobals();
});

describe("the settings column's folds", () => {
  it("opens every band and every group until somebody folds one", () => {
    const rendered = drawSettings("/settings/theme");
    for (const label of ["My Settings", "Firm Settings", "Appearance"]) {
      expect(expansionOf(heading(rendered, label))).toBe("true");
    }
  });

  it("folds a group's rows away and brings them back, and says so to a screen reader", () => {
    const rendered = drawSettings("/settings/users");
    const appearance = heading(rendered, "Appearance");

    press(appearance);
    expect(expansionOf(appearance)).toBe("false");
    expect(rowAddresses(rendered)).not.toContain("/settings/theme");
    // Its neighbours are untouched: a fold is one heading's business.
    expect(rowAddresses(rendered)).toContain("/settings/users");

    press(appearance);
    expect(expansionOf(appearance)).toBe("true");
    expect(rowAddresses(rendered)).toContain("/settings/theme");
  });

  it("takes a band's groups with it, headings and rows alike", () => {
    const rendered = drawSettings("/settings/users");
    const band = heading(rendered, "My Settings");

    press(band);
    expect(rendered.textContent).not.toContain("Appearance");
    expect(rowAddresses(rendered)).not.toContain("/settings/theme");
    expect(rowAddresses(rendered)).toContain("/settings/users");

    press(band);
    expect(rendered.textContent).toContain("Appearance");
  });

  it("never folds away the page the reader is standing on, and does not remember opening it", () => {
    // Fold the group from a page outside it, which is the only way a reader can fold it.
    const away = drawSettings("/settings/users");
    press(heading(away, "Appearance"));
    expect(rowAddresses(away)).not.toContain("/settings/theme");
    takeDown();

    // Arriving inside the folded group opens it — a column that has hidden the page it sits beside
    // has stopped being a finding aid.
    const inside = drawSettings("/settings/theme");
    const appearance = heading(inside, "Appearance");
    expect(expansionOf(appearance)).toBe("true");
    expect(rowAddresses(inside)).toContain("/settings/theme");

    // And the member can still fold it from here: the press acts on what they can see, so one press
    // closes it rather than writing a fold that changes nothing.
    press(appearance);
    expect(expansionOf(appearance)).toBe("false");
    expect(rowAddresses(inside)).not.toContain("/settings/theme");

    // Restore: the next press clears the stored departure, leaving the column as it ships.
    press(appearance);
    expect(expansionOf(appearance)).toBe("true");
  });

  it("draws every heading as the design system's foldable group, with no treatment of its own", () => {
    const rendered = drawSettings("/settings/theme");
    const headings = [...rendered.querySelectorAll("nav button")];
    expect(headings.length).toBeGreaterThan(0);
    for (const element of headings) {
      expect(element.classList.contains("mc-navigation-layout-group-heading")).toBe(true);
      expect(element.getAttribute("style")).toBeNull();
    }
  });
});
