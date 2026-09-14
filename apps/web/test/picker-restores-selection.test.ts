// @vitest-environment happy-dom
/*
 * A picker's field shows what it holds at rest, even after the selection is re-picked.
 *
 * The owner's report of 2026-09-14: with United States selected, typing "united" and choosing
 * United States again left "united" standing as the field's text. Choosing the item already
 * chosen writes nothing, so the restoration rests on the close settling the text — which it did —
 * after which the primitive returned focus to the input, and a search that began on every focus
 * blanked the field again. Both pickers with that focus shape are pinned here through the exact
 * sequence the primitive drives: type over the selection, settle on close, focus returns.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ChoicePicker from "$lib/components/choice-picker.svelte";
import MatterPicker from "$lib/time/matter-picker.svelte";
import type { SheetMatter } from "$lib/time/time-sheet-model.ts";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
});

function field(): HTMLInputElement {
  const found = target.querySelector<HTMLInputElement>('input[role="combobox"]');
  if (found === null) throw new Error("no combobox input rendered");
  return found;
}

/** Type over whatever the field holds, the way a person does. */
function typeOver(text: string): void {
  field().focus();
  field().value = text;
  field().dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

/**
 * What the primitive does after the item already chosen is picked: the input loses focus to the
 * list, the list closes (settling the text), and focus is handed back from the list.
 */
function settleAndReturnFocus(): void {
  const listbox = document.createElement("div");
  listbox.setAttribute("role", "listbox");
  document.body.append(listbox);
  field().dispatchEvent(new FocusEvent("blur", { relatedTarget: listbox }));
  flushSync();
  // The pick closes the list; Escape asks the primitive for the same close.
  field().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  flushSync();
  field().dispatchEvent(new FocusEvent("focus", { relatedTarget: listbox }));
  flushSync();
  listbox.remove();
}

/** A person leaving the field for something else on the page, then coming back to it. */
function leaveAndReturn(): void {
  field().dispatchEvent(new FocusEvent("blur"));
  flushSync();
  field().dispatchEvent(new FocusEvent("focus"));
  flushSync();
}

const COUNTRIES = [
  { value: "US", label: "United States", keywords: ["United States", "US"] },
  { value: "GB", label: "United Kingdom", keywords: ["United Kingdom", "GB"] },
];

describe("the closed-choice picker", () => {
  it("shows the chosen label at rest", () => {
    instance = mount(ChoicePicker, {
      target,
      props: { options: COUNTRIES, value: "US", label: "Country" },
    });
    flushSync();
    expect(field().value).toBe("United States");
  });

  it("restores the chosen label after typing over it and re-picking the same item", () => {
    instance = mount(ChoicePicker, {
      target,
      props: { options: COUNTRIES, value: "US", label: "Country" },
    });
    flushSync();
    typeOver("united");
    expect(field().value).toBe("united");
    settleAndReturnFocus();
    // The focus the primitive hands back must not start a search and blank the field again.
    expect(field().value).toBe("United States");
    expect(document.activeElement).toBe(field());
  });
});

const MATTERS: readonly SheetMatter[] = [
  { id: "matter_1", matterNumber: "2026-0001", title: "Ashcombe v. Hale" },
  { id: "matter_2", matterNumber: "2026-0002", title: "Bramley Estate" },
];

describe("the matter picker", () => {
  it("restores the chosen matter after typing over it and re-picking the same matter", () => {
    instance = mount(MatterPicker, {
      target,
      props: { matters: MATTERS, value: "matter_1", onpick: () => {} },
    });
    flushSync();
    const chosen = field().value;
    expect(chosen).toContain("2026-0001");
    typeOver("ash");
    expect(field().value).toBe("ash");
    settleAndReturnFocus();
    expect(field().value).toBe(chosen);
    // And the handed-back focus does not reopen the list the pick just closed.
    expect(field().getAttribute("aria-expanded")).toBe("false");
  });

  it("still opens for a person arriving after a real departure", () => {
    instance = mount(MatterPicker, {
      target,
      props: { matters: MATTERS, value: "matter_1", onpick: () => {} },
    });
    flushSync();
    const chosen = field().value;
    settleAndReturnFocus();
    expect(field().value).toBe(chosen);
    // Leaving for real, then coming back, is the arrival that searches: the whole record on offer.
    leaveAndReturn();
    expect(field().value).toBe("");
    expect(field().getAttribute("aria-expanded")).toBe("true");
    field().dispatchEvent(new FocusEvent("blur"));
    flushSync();
    expect(field().value).toBe(chosen);
  });
});
