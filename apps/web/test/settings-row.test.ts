// @vitest-environment happy-dom
/*
 * The settings row's closed choice, as a reader meets it: the product's combobox, showing what it
 * holds at rest, staging what is picked into the page draft. Mounted rather than read off the
 * source, because the thing worth pinning is the binding — a control that renders the chosen
 * option's label and hands the option's VALUE back to the draft — and only a render says both.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import SettingsRow from "$lib/settings/components/settings-row.svelte";
import type { SettingDefinition, SettingValue } from "$lib/settings/settings-definitions.ts";
import { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";

const WEEK_STARTS_ON: SettingDefinition = {
  id: "test.week-starts-on",
  sectionId: "calendar",
  label: "First Day of the Week",
  description: "The day every calendar in the firm begins its week on.",
  kind: "select",
  options: [
    { value: "0", label: "Sunday" },
    { value: "1", label: "Monday" },
  ],
  defaultValue: "0",
  sensitivity: "open",
};

/**
 * A draft that answers from memory, so the row can be exercised without storage or a server. Not
 * reactive (a plain test file has no runes), which the first-render assertions below do not need.
 */
class MemoryDraft extends SettingsDraft {
  #committed: SettingValue;
  #staged: SettingValue | undefined = undefined;
  constructor(committed: SettingValue) {
    super("calendar");
    this.#committed = committed;
  }
  override value(): SettingValue {
    return this.#committed;
  }
  override stagedValue(): SettingValue {
    return this.#staged ?? this.#committed;
  }
  override stage(_definition: SettingDefinition, next: SettingValue): void {
    this.#staged = next === this.#committed ? undefined : next;
  }
  override isStaged(): boolean {
    return this.#staged !== undefined;
  }
}

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  if (instance !== undefined) unmount(instance);
  instance = undefined;
  target.remove();
});

describe("a select setting", () => {
  it("renders the product's combobox showing the chosen option's label at rest", () => {
    const draft = new MemoryDraft("1");
    instance = mount(SettingsRow, { target, props: { definition: WEEK_STARTS_ON, draft } });
    flushSync();
    const field = target.querySelector<HTMLInputElement>('input[role="combobox"]');
    expect(field).not.toBeNull();
    expect(field?.value).toBe("Monday");
    expect(field?.id).toBe(`settings-${WEEK_STARTS_ON.id}`);
    // Never a native select, and never the design system's Select trigger.
    expect(target.querySelector("select")).toBeNull();
    expect(target.querySelector(".mc-select-trigger")).toBeNull();
  });

  it("engraves the committed option's label when the row is read-only", () => {
    instance = mount(SettingsRow, {
      target,
      props: { definition: WEEK_STARTS_ON, value: "0" },
    });
    flushSync();
    expect(target.querySelector('input[role="combobox"]')).toBeNull();
    expect(target.textContent).toContain("Sunday");
  });
});
