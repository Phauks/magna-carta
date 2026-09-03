import { describe, expect, it } from "vitest";
import {
  EXPAND_LABEL,
  EXPANDED_FRAME_CLASSES,
  FrameExpansion,
  SHRINK_LABEL,
  actionDialogExpansion,
  recordWindowExpansion,
} from "../src/lib/internal/frame-expansion.svelte.ts";

/*
 * The frame's expansion, pinned where a rendered panel cannot show it as clearly: which of the two
 * sources answers, that a toggle reaches both, and that the two shells do not share a memory.
 */

function expansionOver(memory: { expanded: boolean }, bound?: { value: boolean | undefined }) {
  const holder = bound ?? { value: undefined };
  return {
    holder,
    expansion: new FrameExpansion(memory, {
      read: () => holder.value,
      write: (next) => {
        holder.value = next;
      },
    }),
  };
}

describe("the frame's expansion", () => {
  it("answers from the memory when the caller has not bound it", () => {
    const memory = { expanded: true };
    const { expansion } = expansionOver(memory);
    expect(expansion.expanded).toBe(true);
  });

  it("lets a caller's binding win over the memory — a panel can open expanded by design", () => {
    const memory = { expanded: false };
    const { expansion } = expansionOver(memory, { value: true });
    expect(expansion.expanded).toBe(true);
  });

  it("records a toggle in the memory and in the binding, so the next panel opens the same way", () => {
    const memory = { expanded: false };
    const { expansion, holder } = expansionOver(memory);
    expansion.toggle();
    expect(memory.expanded).toBe(true);
    expect(holder.value).toBe(true);
    expansion.toggle();
    expect(memory.expanded).toBe(false);
    expect(holder.value).toBe(false);
  });

  it("names the control for what pressing it will do", () => {
    const { expansion } = expansionOver({ expanded: false });
    expect(expansion.label).toBe(EXPAND_LABEL);
    expansion.toggle();
    expect(expansion.label).toBe(SHRINK_LABEL);
  });

  it("drops the width cap entirely when expanded, and hands back the windowed set otherwise", () => {
    const { expansion } = expansionOver({ expanded: false });
    expect(expansion.panelClasses("max-w-lg")).toBe("max-w-lg");
    expansion.toggle();
    expect(expansion.panelClasses("max-w-lg")).toBe(EXPANDED_FRAME_CLASSES);
    expect(EXPANDED_FRAME_CLASSES).toMatch(/\bmax-w-none\b/);
  });

  it("keeps the two shells' memories apart: a form filled to the screen says nothing about records", () => {
    expect(recordWindowExpansion).not.toBe(actionDialogExpansion);
    actionDialogExpansion.expanded = true;
    expect(recordWindowExpansion.expanded).toBe(false);
    actionDialogExpansion.expanded = false;
  });
});
