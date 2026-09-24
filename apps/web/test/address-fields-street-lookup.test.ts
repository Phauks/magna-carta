// @vitest-environment happy-dom
/*
 * The address form's street box, when it is handed a lookup — driven through the real component and
 * the real combobox primitive, the way design-system-pickers-restore-selection.test.ts drives the
 * form's country field. The rules underneath are tested on their own in
 * packages/design-system/test/street-lookup.test.ts; this pins what a person meets.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADDRESS_LOOKUP_SENTENCES,
  type AddressLookup,
  type AddressLookupAnswer,
  type AddressLookupResolution,
  type AddressParts,
} from "@magna-carta/design-system/address-fields";
import Harness from "./address-fields-harness.svelte";
import { ADDRESS_SETTLE_MILLISECONDS } from "../../../packages/design-system/src/lib/components/address-fields/street-lookup.ts";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;
/** What the form holds, read back through the bindable `value` the way a parent binding sees it. */
let held: AddressParts;

beforeEach(() => {
  vi.useFakeTimers();
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  vi.useRealTimers();
});

function render(lookup: AddressLookup | undefined, start: AddressParts = { country: "US" }): void {
  held = start;
  instance = mount(Harness, {
    target,
    props: { start, lookup, onChange: (value: AddressParts) => (held = value) },
  });
  flushSync();
}

function streetBox(): HTMLInputElement {
  const box = target.querySelector<HTMLInputElement>('input[placeholder="Street Address"]');
  if (box === null) throw new Error("no street box rendered");
  return box;
}

function type(text: string): void {
  streetBox().focus();
  flushSync();
  streetBox().value = text;
  streetBox().dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(ADDRESS_SETTLE_MILLISECONDS + 10);
  flushSync();
}

function key(name: string): void {
  streetBox().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  flushSync();
}

/** Highlight the first choosable row and choose it, the way a keyboard does. */
async function chooseFirst(): Promise<void> {
  key("ArrowDown");
  key("Enter");
  await vi.advanceTimersByTimeAsync(10);
  flushSync();
}

function rows(): string[] {
  return [...document.querySelectorAll('[role="option"]')].map(
    (row) => row.textContent?.replace(/\s+/gu, " ").trim() ?? "",
  );
}

function isOpen(): boolean {
  return streetBox().getAttribute("aria-expanded") === "true";
}

function lookupAnswering(
  suggest: (country: string, query: string) => Promise<AddressLookupAnswer>,
  resolve: (identifier: string) => Promise<AddressLookupResolution> = () =>
    Promise.resolve({ kind: "expired" }),
) {
  const lookup = { suggest: vi.fn(suggest), resolve: vi.fn(resolve) };
  return lookup;
}

const ROSEWOOD = {
  identifier: "s1",
  label: "14 Rosewood Dr, Reno, NV 89501",
  kind: "address" as const,
};
const BUILDING = {
  identifier: "g1",
  label: "1042 W Center St, Orem, UT 84057",
  kind: "group" as const,
  count: 2,
};

describe("without a lookup", () => {
  it("is the plain street box it always was", () => {
    render(undefined);
    expect(streetBox().getAttribute("role")).not.toBe("combobox");
  });
});

describe("what is typed", () => {
  it("is the street line, written to the record on every keystroke", () => {
    render(lookupAnswering(() => Promise.resolve({ kind: "offers", offers: [] })));
    type("14 Ro");
    expect(held.street).toBe("14 Ro");
  });

  it("survives the list closing, exactly as typed", async () => {
    render(lookupAnswering(() => Promise.resolve({ kind: "offers", offers: [ROSEWOOD] })));
    type("14 Rose");
    await settle();
    key("Escape");
    expect(streetBox().value).toBe("14 Rose");
    expect(held.street).toBe("14 Rose");
  });
});

describe("asking", () => {
  it("asks nothing below the floor", async () => {
    const lookup = lookupAnswering(() => Promise.resolve({ kind: "offers", offers: [] }));
    render(lookup);
    type("14");
    await settle();
    expect(lookup.suggest).not.toHaveBeenCalled();
    expect(isOpen()).toBe(false);
  });

  it("waits for typing to settle, then asks once in the form's country", async () => {
    const lookup = lookupAnswering(() => Promise.resolve({ kind: "offers", offers: [ROSEWOOD] }));
    render(lookup);
    type("14 R");
    type("14 Ro");
    type("14 Rose");
    await settle();
    expect(lookup.suggest).toHaveBeenCalledTimes(1);
    expect(lookup.suggest).toHaveBeenCalledWith("US", "14 Rose");
    expect(isOpen()).toBe(true);
    expect(rows()).toEqual([ROSEWOOD.label]);
  });
});

describe("choosing", () => {
  it("fills the form from the chosen address, keeping the unit the person typed", async () => {
    render(
      lookupAnswering(
        () => Promise.resolve({ kind: "offers", offers: [ROSEWOOD] }),
        () =>
          Promise.resolve({
            kind: "address",
            parts: {
              street: "14 Rosewood Dr",
              city: "Reno",
              region: "NV",
              postal: "89501",
              country: "US",
            },
          }),
      ),
      { country: "US", streetTwo: "Apt 4B" },
    );
    type("14 Rose");
    await settle();
    await chooseFirst();

    expect(held).toEqual({
      country: "US",
      street: "14 Rosewood Dr",
      streetTwo: "Apt 4B",
      city: "Reno",
      region: "NV",
      postal: "89501",
    });
    // The box holds the street line, never the offer's one-line label.
    expect(streetBox().value).toBe("14 Rosewood Dr");
    expect(isOpen()).toBe(false);
  });

  it("opens a group onto the addresses inside it instead of filling the form with the building", async () => {
    const lookup = lookupAnswering(
      () => Promise.resolve({ kind: "offers", offers: [BUILDING] }),
      (identifier) =>
        Promise.resolve(
          identifier === "g1"
            ? {
                kind: "group",
                offers: [
                  { identifier: "u1", label: "1042 W Center St Apt 108", kind: "address" },
                  { identifier: "u2", label: "1042 W Center St Apt 109", kind: "address" },
                ],
              }
            : {
                kind: "address",
                parts: { street: "1042 W Center St", streetTwo: "Apt 108", city: "Orem" },
              },
        ),
    );
    render(lookup);
    type("1042 W Cen");
    await settle();
    expect(rows()[0]).toContain("2 addresses");

    await chooseFirst();
    expect(held.city).toBeUndefined(); // the building filled nothing
    // The box keeps the street line as typed — never the building's one-line label.
    expect(streetBox().value).toBe("1042 W Cen");
    expect(isOpen()).toBe(true);
    expect(rows()).toEqual(["1042 W Center St Apt 108", "1042 W Center St Apt 109"]);
    expect(document.body.textContent).toContain("Addresses at 1042 W Center St, Orem, UT 84057");

    await chooseFirst();
    expect(held).toMatchObject({ street: "1042 W Center St", streetTwo: "Apt 108", city: "Orem" });
  });
});

describe("the kinds of no offers", () => {
  it("says nothing and asks nothing more when no service is provisioned", async () => {
    const lookup = lookupAnswering(() => Promise.resolve({ kind: "unavailable" }));
    render(lookup);
    type("14 Rose");
    await settle();
    expect(isOpen()).toBe(false);
    type("14 Rosewood");
    await settle();
    expect(lookup.suggest).toHaveBeenCalledTimes(1);
  });

  it("says a country cannot be looked up, then stops asking about it", async () => {
    const lookup = lookupAnswering(() => Promise.resolve({ kind: "no-coverage" }));
    render(lookup, { country: "ER" });
    type("Harnet Ave");
    await settle();
    expect(rows()).toEqual([ADDRESS_LOOKUP_SENTENCES.noCoverage]);
    type("Harnet Avenue");
    await settle();
    expect(lookup.suggest).toHaveBeenCalledTimes(1);
  });

  it("says a failed service failed, stops asking, and asks exactly once when told to try again", async () => {
    const lookup = lookupAnswering(() => Promise.reject(new Error("502")));
    render(lookup);
    type("14 Rose");
    await settle();
    expect(rows()).toEqual([ADDRESS_LOOKUP_SENTENCES.failed, ADDRESS_LOOKUP_SENTENCES.retry]);

    // Typing on does not hammer a service that just failed.
    type("14 Rosew");
    await settle();
    expect(lookup.suggest).toHaveBeenCalledTimes(1);

    // Try Again is the second row; the first is a sentence nobody can pick.
    key("ArrowDown");
    key("ArrowDown");
    key("Enter");
    await settle();
    expect(lookup.suggest).toHaveBeenCalledTimes(2);
    expect(lookup.suggest).toHaveBeenLastCalledWith("US", "14 Rosew");
    // Pressing Try Again leaves the words "Try Again" nowhere near the address.
    expect(streetBox().value).toBe("14 Rosew");
    expect(held.street).toBe("14 Rosew");
  });

  it("says nothing matched, which is not the same as a failure", async () => {
    render(lookupAnswering(() => Promise.resolve({ kind: "offers", offers: [] })));
    type("zzz nowhere");
    await settle();
    expect(rows()).toEqual([ADDRESS_LOOKUP_SENTENCES.nothingMatched]);
  });
});
