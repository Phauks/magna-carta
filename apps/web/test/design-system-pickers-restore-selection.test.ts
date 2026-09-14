// @vitest-environment happy-dom
/*
 * The design system's own pickers show what they hold at rest, even after the selection is
 * re-picked.
 *
 * The owner's report of 2026-09-14 against the app's closed-choice picker: with United States
 * selected, typing "united" and choosing United States again left "united" standing as the field's
 * text. Two halves stood behind it. Choosing the item already chosen writes nothing, so the
 * restoration rests on the close settling the text; the primitive then hands focus back to the
 * input, and a search that began on every focus blanked the field again. And quieter: the typed
 * text reached the input from the keyboard, not from the component, so the framework's record of
 * what it last wrote there still said the chosen label and it wrote nothing when the settle handed
 * it that same label. The address form's country field and the entity picker carry the same
 * controlled-text shape, so both are pinned here through the primitive's own sequence, the way
 * apps/web/test/picker-restores-selection.test.ts pins the app's two.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AddressFields from "@magna-carta/design-system/address-fields";
import EntityPicker, {
  SEARCH_SETTLE_MILLISECONDS,
  type PickableEntity,
} from "@magna-carta/design-system/entity-picker";

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
  vi.useRealTimers();
});

function field(): HTMLInputElement {
  const found = target.querySelector<HTMLInputElement>('input[role="combobox"]');
  if (found === null) throw new Error("no combobox input rendered");
  return found;
}

/** Type over whatever the field holds, the way a person does. */
function typeOver(text: string): void {
  field().focus();
  flushSync();
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

const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
];

describe("the address form's country field", () => {
  it("shows the country the address is in at rest", () => {
    instance = mount(AddressFields, {
      target,
      props: { value: { country: "US" }, countries: COUNTRIES },
    });
    flushSync();
    expect(field().value).toBe("United States");
  });

  it("restores the country after typing over it and re-picking the same country", () => {
    instance = mount(AddressFields, {
      target,
      props: { value: { country: "US" }, countries: COUNTRIES },
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

const ADA: PickableEntity = {
  identifier: "directoryPerson_1",
  name: "Pemberton, Ada",
  kind: "person",
};
const BARTHOLOMEW: PickableEntity = {
  identifier: "directoryPerson_2",
  name: "Pemberton, Bartholomew",
  kind: "person",
};

describe("the entity picker", () => {
  it("restores the chosen entity after typing over it and re-picking the same entity", async () => {
    vi.useFakeTimers();
    instance = mount(EntityPicker, {
      target,
      props: {
        search: () => Promise.resolve({ hits: [ADA, BARTHOLOMEW], capped: false }),
        value: ADA,
      },
    });
    flushSync();
    expect(field().value).toBe("Pemberton, Ada");
    typeOver("pem");
    expect(field().value).toBe("pem");
    // The typed text settles, is asked, and the list opens on the answer — the real sequence.
    await vi.advanceTimersByTimeAsync(SEARCH_SETTLE_MILLISECONDS);
    flushSync();
    expect(field().getAttribute("aria-expanded")).toBe("true");
    settleAndReturnFocus();
    expect(field().value).toBe("Pemberton, Ada");
    expect(document.activeElement).toBe(field());
  });
});
