// @vitest-environment happy-dom
/*
 * The matter picker's "No matter" row is offered only where a record can exist off a matter.
 *
 * Time and calls can be captured before anybody knows where they belong, so the row leads the list
 * there. A deadline cannot: it is recorded on a matter and its table will not hold one without. The
 * owner's report of 2026-11-09 was the deadline form offering "No matter" and then refusing to
 * record with "A matter is needed." — an answer the list gave and the commit took back.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const MATTERS: readonly SheetMatter[] = [
  { id: "matter_1", matterNumber: "2026-0001", title: "Ashcombe v. Hale" },
];

/** The rows the open list offers, by their visible text. */
function offeredRows(): string[] {
  const input = target.querySelector<HTMLInputElement>('input[role="combobox"]');
  if (input === null) throw new Error("no combobox input rendered");
  input.dispatchEvent(new FocusEvent("focus"));
  flushSync();
  expect(input.getAttribute("aria-expanded")).toBe("true");
  return [...document.querySelectorAll('[role="option"]')].map((row) => row.textContent.trim());
}

describe("the matter picker's No matter row", () => {
  it("leads the list by default", () => {
    instance = mount(MatterPicker, { target, props: { matters: MATTERS, onpick: () => {} } });
    flushSync();
    const rows = offeredRows();
    expect(rows[0]).toBe("No matter");
    expect(rows.some((row) => row.includes("2026-0001"))).toBe(true);
  });

  it("is left out where the record must belong to a matter", () => {
    instance = mount(MatterPicker, {
      target,
      props: { matters: MATTERS, offerNoMatter: false, onpick: () => {} },
    });
    flushSync();
    const rows = offeredRows();
    expect(rows).not.toContain("No matter");
    expect(rows.some((row) => row.includes("2026-0001"))).toBe(true);
  });
});
