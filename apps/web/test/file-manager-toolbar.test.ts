// @vitest-environment happy-dom
/*
 * Where the folder path can and cannot take the reader.
 *
 * Two defects the owner saw on the deployed file manager, pinned so a later round cannot bring
 * either back. A deep path used to run sideways under a horizontal scrollbar that arrived with it:
 * the scrollbar took its own height out of the toolbar, so the whole row moved every time a reader
 * opened a folder deep enough to need one, and Home — the crumb at the head of the path, and the
 * one always worth reaching — was the first thing to scroll off the left. Now Home is pinned beside
 * back, forward and up, the middle of a deep path folds behind an ellipsis, and the strip that
 * still scrolls hides its scrollbar rather than paying for it in layout.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createItemDrag } from "@magna-carta/design-system/item-drag";
import { FileManagerState } from "$lib/file-manager/file-manager-state.svelte.ts";
import FileManagerToolbar from "$lib/file-manager/file-manager-toolbar.svelte";

/*
 * The crumbs take part in the surface's one drag — a folder dropped on an ancestor is how something
 * comes back OUT of a folder — so the toolbar needs one to render at all. These tests are about the
 * path, so it is a drag that accepts nothing and is never started.
 */
const standingDrag = () =>
  createItemDrag({
    keysFor: () => [],
    describe: () => "",
    accepts: () => false,
    onDrop: () => undefined,
  });

const dropKeyOf = (folderId: string | null) => folderId ?? "matter-root";

const trailOfDepth = (depth: number) =>
  Array.from({ length: depth }, (_, step) => ({
    id: `folder-${step}`,
    label: `Folder ${step}`,
  }));

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

function drawToolbar(trail: readonly { id: string; label: string }[]): HTMLElement {
  instance = mount(FileManagerToolbar, {
    target,
    props: { manager: new FileManagerState(), trail, drag: standingDrag(), dropKeyOf },
  });
  flushSync();
  return target;
}

/** The one element that scrolls: the folder path, minus the controls pinned on either side of it. */
const pathStrip = (rendered: HTMLElement): HTMLElement => {
  const strip = rendered.querySelector<HTMLElement>(".mc-scrollbar-hidden");
  if (strip === null) throw new Error("the folder path strip is not in the toolbar");
  return strip;
};

const buttonNames = (within: HTMLElement): string[] =>
  [...within.querySelectorAll("button")].map(
    (button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "",
  );

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  flushSync();
  target.remove();
});

describe("the file manager's folder path", () => {
  it("keeps Home out of the scrolling strip, beside the buttons that navigate", () => {
    const rendered = drawToolbar(trailOfDepth(6));
    const home = rendered.querySelector('button[aria-label="Home"]');

    expect(home).not.toBeNull();
    expect(pathStrip(rendered).contains(home)).toBe(false);
    // Back, forward and up (the toolbar's own) and then Home: all four out of the strip's reach.
    expect(buttonNames(rendered).slice(0, 4)).toEqual(["Back", "Forward", "Up", "Home"]);
  });

  it("draws a path that fits in full, with nothing folded away", () => {
    const rendered = drawToolbar(trailOfDepth(3));

    expect(buttonNames(pathStrip(rendered))).toEqual(["Folder 0", "Folder 1", "Folder 2"]);
  });

  it("folds the middle of a deeper path behind the ellipsis, keeping where the reader stands", () => {
    const rendered = drawToolbar(trailOfDepth(6));

    expect(buttonNames(pathStrip(rendered))).toEqual([
      "Folder 0",
      "Show the folders in between",
      "Folder 4",
      "Folder 5",
    ]);
    expect(pathStrip(rendered).querySelector('[aria-current="page"]')?.textContent?.trim()).toBe(
      "Folder 5",
    );
  });

  it("titles the path with a view that is not a folder, and folds nothing", () => {
    instance = mount(FileManagerToolbar, {
      target,
      props: {
        manager: new FileManagerState(),
        trail: [],
        viewTitle: "Deleted Files",
        drag: standingDrag(),
        dropKeyOf,
      },
    });
    flushSync();

    expect(target.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe(
      "Deleted Files",
    );
    expect(target.querySelector(".mc-scrollbar-hidden")).toBeNull();
  });
});
