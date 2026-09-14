/*
 * The floating surfaces' shared behaviour, pinned at the source so it cannot drift one component
 * at a time. Two owner rulings live here, both already issued once as corrections:
 *
 *   - There is ONE dropdown and its behaviour is the component's, not each call site's: every
 *     surface that opens from a control aligns to the control's end edge, never grows past the room
 *     Bits measured, and keeps the same distance from the screen's edges — by default, written
 *     nowhere at the call site, with a caller's explicit `align` still winning.
 *   - Every floating Content part stacks on the `anchored` layer, above modal. The two context-menu
 *     parts were the last on `dropdown`, and a right-click menu raised inside a dialog painted
 *     under it — there and unreachable.
 *
 * The rendered proof (the panel's edges, the menu above the dialog) is in the stories; this is
 * what keeps a tidy-up from deleting the default the story then rediscovers in a browser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FLOATING_ALIGN,
  FLOATING_COLLISION_PADDING,
  FLOATING_PANEL_STYLE,
  floatingContentStyle,
  LISTBOX_PANEL_STYLE,
} from "../src/lib/internal/floating.ts";

const COMPONENTS = join(import.meta.dirname, "../src/lib/components");

function read(path: string): string {
  return readFileSync(join(COMPONENTS, path), "utf-8");
}

/** Every floating Content part in the package that opens from something, by its source file. */
const FLOATING_PARTS = [
  "select/select-content.svelte",
  "combobox/combobox-content.svelte",
  "dropdown-menu/dropdown-menu-content.svelte",
  "dropdown-menu/dropdown-menu-sub-content.svelte",
  "popover/popover-content.svelte",
  "context-menu/context-menu-content.svelte",
  "context-menu/context-menu-sub-content.svelte",
];

/** The parts that open from a CONTROL and so share the end alignment and the width rule. */
const CONTROL_ANCHORED_PARTS = [
  "select/select-content.svelte",
  "combobox/combobox-content.svelte",
  "dropdown-menu/dropdown-menu-content.svelte",
  "popover/popover-content.svelte",
];

/** The listbox parts: at least as wide as the control they open from. */
const LISTBOX_PARTS = ["select/select-content.svelte", "combobox/combobox-content.svelte"];

describe("every floating content part stacks on the anchored layer", () => {
  it.each(FLOATING_PARTS)("%s composes the anchored layer and never the dropdown one", (part) => {
    const source = read(part);
    expect(source).toContain('floatingContentClasses("anchored"');
    expect(source).not.toContain('floatingContentClasses("dropdown"');
  });
});

describe("a surface that opens from a control aligns to the control's end edge by default", () => {
  it("the shared default is the end edge", () => {
    expect(FLOATING_ALIGN).toBe("end");
  });

  it.each(CONTROL_ANCHORED_PARTS)(
    "%s takes the shared default and lets a caller's align win",
    (part) => {
      const source = read(part);
      // A prop with the shared constant as its default: a caller who writes nothing gets it, a caller
      // who writes `align="start"` replaces it, and the value reaches Bits as `{align}`.
      expect(source).toMatch(/\balign = FLOATING_ALIGN,/);
      expect(source).toMatch(/\{align\}/);
    },
  );

  it("the shared distance from the screen's edges is the one every surface held before", () => {
    // Each surface used to write `collisionPadding = 8` on its own; the number is unchanged, and
    // now there is one of it.
    expect(FLOATING_COLLISION_PADDING).toBe(8);
  });

  it.each(CONTROL_ANCHORED_PARTS)(
    "%s keeps the shared distance from the screen's edges",
    (part) => {
      const source = read(part);
      expect(source).toMatch(/\bcollisionPadding = FLOATING_COLLISION_PADDING,/);
      expect(source).toMatch(/\{collisionPadding\}/);
    },
  );

  it("a context menu keeps Bits' own alignment — it anchors to the pointer, not a control", () => {
    for (const part of [
      "context-menu/context-menu-content.svelte",
      "context-menu/context-menu-sub-content.svelte",
    ]) {
      expect(read(part)).not.toContain("FLOATING_ALIGN");
    }
  });
});

describe("a surface never grows past the room Bits measured, and a listbox never narrower than its control", () => {
  it("the width rules name Bits' generic floating variables", () => {
    expect(FLOATING_PANEL_STYLE).toBe("max-width: var(--bits-floating-available-width)");
    expect(LISTBOX_PANEL_STYLE).toBe(
      "min-width: var(--bits-floating-anchor-width); max-width: var(--bits-floating-available-width)",
    );
  });

  it.each(LISTBOX_PARTS)(
    "%s carries the listbox width rule, composed with the caller's style",
    (part) => {
      expect(read(part)).toContain("floatingContentStyle(LISTBOX_PANEL_STYLE, style)");
    },
  );

  it.each(["dropdown-menu/dropdown-menu-content.svelte", "popover/popover-content.svelte"])(
    "%s carries the panel width rule, composed with the caller's style",
    (part) => {
      expect(read(part)).toContain("floatingContentStyle(FLOATING_PANEL_STYLE, style)");
    },
  );

  it("the combobox anchors to the field box a person sees, not the input inside it", () => {
    // Bits anchors a combobox to its <input>; end-aligned to that, the panel would stop short of the
    // chevron. Root shares the bordered field box and Content anchors to it unless a caller says.
    expect(read("combobox/combobox-root.svelte")).toContain("COMBOBOX_FIELD_ANCHOR");
    expect(read("combobox/combobox-input.svelte")).toContain("bind:this={fieldBox}");
    expect(read("combobox/combobox-content.svelte")).toMatch(
      /customAnchor \?\? fieldAnchor\?\.element/,
    );
  });
});

describe("floatingContentStyle", () => {
  it("is the surface's own rule when the caller passed nothing", () => {
    expect(floatingContentStyle(FLOATING_PANEL_STYLE, undefined)).toBe(FLOATING_PANEL_STYLE);
    expect(floatingContentStyle(FLOATING_PANEL_STYLE, null)).toBe(FLOATING_PANEL_STYLE);
    expect(floatingContentStyle(FLOATING_PANEL_STYLE, "  ")).toBe(FLOATING_PANEL_STYLE);
  });

  it("puts the caller's declarations after the surface's, so the caller wins the cascade", () => {
    const composed = floatingContentStyle(
      LISTBOX_PANEL_STYLE,
      "min-inline-size: var(--mc-size-popover)",
    );
    expect(composed.indexOf("min-inline-size")).toBeGreaterThan(composed.indexOf("max-width"));
    expect(composed).toBe(`${LISTBOX_PANEL_STYLE}; min-inline-size: var(--mc-size-popover)`);
  });
});
