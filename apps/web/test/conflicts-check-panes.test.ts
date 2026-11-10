// @vitest-environment happy-dom
/*
 * The two panes of the New Check panel, as a reader meets them.
 *
 * The owner's rulings of 2026-11-09 reshaped the panel: the left pane asks for the parties and
 * nothing else — no matter field, no read-back of what the check will do — and the right pane lists
 * five places, each opening onto what it searches, with no sentence explaining any option. A place
 * the engine cannot search yet stands disabled and marked Soon. None of that is the kind of thing a
 * type-checker holds in place, so it is pinned here, where a later round that quietly reverts one
 * fails instead of shipping.
 */
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CheckScope from "$lib/conflicts/check-scope.svelte";
import CheckSubject from "$lib/conflicts/check-subject.svelte";
import { CheckDraft } from "$lib/conflicts/check-draft.svelte.ts";
import { SEARCH_LOCATIONS, sourceVocabulary } from "$lib/conflicts/conflicts-vocabulary.ts";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

/*
 * One helper per pane rather than one generic over both: a helper typed loosely enough to take
 * either component takes props neither of them has, which is the assertion these tests are for.
 */
function drawScope(props: ComponentProps<typeof CheckScope>): HTMLElement {
  instance = mount(CheckScope, { target, props });
  flushSync();
  return target;
}

function drawSubject(props: ComponentProps<typeof CheckSubject>): HTMLElement {
  instance = mount(CheckSubject, { target, props });
  flushSync();
  return target;
}

const text = (within: HTMLElement): string => within.textContent ?? "";

const realFetch = globalThis.fetch;

beforeEach(() => {
  /*
   * These tests are about what the panes DRAW. The pickers reach for the firm's records as they
   * mount, and an unstubbed fetch under happy-dom resolves the relative path against
   * localhost:3000 and throws a connect error into whichever test is running at the time.
   *
   * It answers 503 rather than an empty success, because an empty success is a LIE with a shape:
   * a caller that reads a field off the body gets undefined and dies somewhere unrelated. A refusal
   * is a state every one of these callers already handles.
   */
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ title: "Nothing is served in a test" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    )) as typeof fetch;
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  flushSync();
  target.remove();
});

describe("the locations tab", () => {
  it("is two tabs, Locations and Advanced Settings, and opens on Locations", () => {
    const rendered = drawScope({ draft: new CheckDraft() });
    const tabs = [...rendered.querySelectorAll('[role="tab"]')].map((tab) =>
      tab.textContent?.trim(),
    );
    expect(tabs).toEqual(["Locations", "Advanced Settings"]);
  });

  it("lists five places, in the catalogue's order: Directory, Files, Messaging, Tasks, Magnus", () => {
    expect(SEARCH_LOCATIONS.map((entry) => entry.label)).toEqual([
      "Directory",
      "Files",
      "Messaging",
      "Tasks",
      "Magnus",
    ]);
    const rendered = drawScope({ draft: new CheckDraft() });
    const shown = text(rendered);
    let last = -1;
    for (const entry of SEARCH_LOCATIONS) {
      const at = shown.indexOf(entry.label);
      expect(at, entry.label).toBeGreaterThan(last);
      last = at;
    }
  });

  it("opens every place on what it searches, in the owner's words", () => {
    const shown = text(drawScope({ draft: new CheckDraft() }));
    for (const option of [
      "Names and identifiers",
      "Relationships",
      "Firm Employees",
      "Consultations",
      "Open",
      "Closed",
      "Archived",
      "Calls",
      "Texts",
      "Email",
      "All Employee Conversations",
    ]) {
      expect(shown).toContain(option);
    }
  });

  it("draws a place it cannot search yet with its options disabled, marked Soon", () => {
    const rendered = drawScope({ draft: new CheckDraft() });
    for (const entry of SEARCH_LOCATIONS.filter((place) => !place.searchable)) {
      const place = rendered.querySelector(`[data-location="${entry.location}"]`);
      expect(place, entry.label).not.toBeNull();
      expect(text(place as HTMLElement)).toContain("Soon");
      const boxes = place?.querySelectorAll('[role="checkbox"]') ?? [];
      expect(boxes.length, entry.label).toBe(entry.options.length);
      for (const box of place?.querySelectorAll('[role="checkbox"]') ?? []) {
        expect(
          box.hasAttribute("disabled") || box.getAttribute("aria-disabled") === "true",
          entry.label,
        ).toBe(true);
      }
    }
  });

  it("lets Firm Employees be chosen without a matter", () => {
    const rendered = drawScope({ draft: new CheckDraft() });
    const box = rendered.querySelector('[id$="-source-imputation"]');
    expect(box?.hasAttribute("disabled")).toBe(false);
  });

  it("carries no line of explanation under any option", () => {
    const shown = text(drawScope({ draft: new CheckDraft() }));
    for (const source of ["party", "graph", "imputation"]) {
      expect(shown).not.toContain(sourceVocabulary(source).meaning);
    }
    expect(shown).not.toContain("floor");
    expect(shown).not.toContain("Waiting on");
  });
});

describe("the advanced settings tab", () => {
  it("offers name matching as a dropdown", () => {
    const rendered = drawScope({ draft: new CheckDraft(), tab: "advanced" });
    const field = rendered.querySelector('input[role="combobox"], input[aria-autocomplete]');
    expect(field).not.toBeNull();
    expect(text(rendered)).toContain("Name matching");
    expect((field as HTMLInputElement).value).toBe("Standard");
  });

  it("offers no number anywhere: nothing limits the search", () => {
    for (const tab of ["locations", "advanced"]) {
      const rendered = drawScope({ draft: new CheckDraft(), tab });
      expect(rendered.querySelector('input[type="number"]')).toBeNull();
      const shown = text(rendered);
      expect(shown).not.toContain("hops");
      if (instance !== undefined) void unmount(instance);
      instance = undefined;
      flushSync();
      target.replaceChildren();
    }
  });
});

describe("the subject pane", () => {
  it("asks for the parties, and no matter", () => {
    const rendered = drawSubject({ draft: new CheckDraft() });
    expect(text(rendered)).toContain("Parties");
    expect(rendered.querySelector('[id$="-matter"]')).toBeNull();
    expect(text(rendered)).not.toContain("What This Check Will Do");
  });

  it("states the surface's own matter where it was opened from one", () => {
    const rendered = drawSubject({ draft: new CheckDraft(), matterLabel: "2026-0001 · Acme" });
    expect(text(rendered)).toContain("2026-0001 · Acme");
  });
});
