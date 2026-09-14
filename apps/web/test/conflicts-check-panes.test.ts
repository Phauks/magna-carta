// @vitest-environment happy-dom
/*
 * The two panes of the New Check panel, as a reader meets them.
 *
 * The owner's rulings of 2026-09-11 reshaped the right pane: it says less, it lists PLACES rather
 * than techniques, a place the product cannot search yet stands on the panel disabled and marked
 * Soon, name matching is a dropdown whose rows show a name each band catches, and the whole thing
 * is two tabs. None of that is the kind of thing a type-checker holds in place, so it is pinned
 * here, where a later round that quietly reverts one fails instead of shipping.
 */
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CheckScope from "$lib/conflicts/check-scope.svelte";
import CheckSubject from "$lib/conflicts/check-subject.svelte";
import { CheckDraft } from "$lib/conflicts/check-draft.svelte.ts";
import { OPENING_DRAFT, checkPlan } from "$lib/conflicts/check-request.ts";
import type { FirmConflictsPolicy } from "$lib/conflicts/conflicts-api.ts";
import { SEARCH_LOCATIONS, sourceVocabulary } from "$lib/conflicts/conflicts-vocabulary.ts";

const POLICY: FirmConflictsPolicy = {
  floorSources: ["party"],
  floorStrictness: "balanced",
  balancedNameRoles: ["current", "former", "maiden", "alias"],
};

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
    const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY });
    const tabs = [...rendered.querySelectorAll('[role="tab"]')].map((tab) =>
      tab.textContent?.trim(),
    );
    expect(tabs).toEqual(["Locations", "Advanced Settings"]);
    expect(text(rendered)).toContain("Search Locations");
  });

  it("lists the places the product can search, as places, in the catalogue's order", () => {
    const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY });
    const shown = text(rendered);
    let last = -1;
    for (const entry of SEARCH_LOCATIONS) {
      const at = shown.indexOf(entry.label);
      expect(at, entry.label).toBeGreaterThan(last);
      last = at;
    }
  });

  it("draws a place it cannot search yet, disabled, marked Soon, saying what it waits on", () => {
    const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY });
    const shown = text(rendered);
    for (const entry of SEARCH_LOCATIONS) {
      if (entry.waitsOn === null) continue;
      expect(shown).toContain(`Waiting on ${entry.waitsOn}`);
      const control = rendered.querySelector(`[id$="-${entry.location}"]`);
      expect(
        control?.hasAttribute("disabled") || control?.getAttribute("aria-disabled") === "true",
        entry.label,
      ).toBe(true);
    }
    expect(shown).toContain("Soon");
  });

  it("puts the Directory's specifics beneath it, behind a caret", () => {
    const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY });
    const caret = rendered.querySelector("[data-accordion-trigger], [aria-expanded]");
    expect(caret).not.toBeNull();
    expect(text(rendered)).toContain("What it searches there");
  });

  it("carries no line of explanation under a place", () => {
    const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY });
    const shown = text(rendered);
    // The old pane put each source's meaning under its checkbox. The meaning is still the hover's
    // and the vocabulary's; it is no longer the page's.
    for (const source of ["party", "graph", "imputation"]) {
      expect(shown).not.toContain(sourceVocabulary(source).meaning);
    }
  });
});

describe("the advanced settings tab", () => {
  it("offers name matching as a dropdown, with an example of what each band catches", () => {
    const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY, tab: "advanced" });
    const field = rendered.querySelector('input[role="combobox"], input[aria-autocomplete]');
    expect(field).not.toBeNull();
    expect(text(rendered)).toContain("Name matching");
    // The examples live on the rows, which open with the list; the field itself holds the band.
    expect((field as HTMLInputElement).value).toBe("Standard");
  });

  it("draws the two dimensions that are not places, both waiting", () => {
    const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY, tab: "advanced" });
    const shown = text(rendered);
    expect(shown).toContain(sourceVocabulary("prior_firm_history").label);
    expect(shown).toContain(sourceVocabulary("nickname_equivalence").label);
    expect(shown).toContain("Not built yet");
  });

  it("states the floor as something that widens a check, never as a limit on it", () => {
    const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY, tab: "advanced" });
    expect(text(rendered)).toContain("raised back up before the search runs");
  });

  it("offers no number anywhere: nothing limits the search", () => {
    for (const tab of ["locations", "advanced"]) {
      const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY, tab });
      expect(rendered.querySelector('input[type="number"]')).toBeNull();
      const shown = text(rendered);
      expect(shown).not.toContain("hops");
      expect(shown).not.toContain("cap");
      if (instance !== undefined) void unmount(instance);
      instance = undefined;
      flushSync();
      target.replaceChildren();
    }
  });
});

describe("the subject pane", () => {
  it("states the surface's own matter where it has one", () => {
    const rendered = drawSubject({
      draft: new CheckDraft(),
      matterLabel: "2026-0001 · Acme",
      plan: [],
    });
    expect(text(rendered)).toContain("2026-0001 · Acme");
  });

  it("offers a matter field when asked to, and no explanation under it", () => {
    const rendered = drawSubject({ draft: new CheckDraft(), chooseMatter: true, plan: [] });
    expect(rendered.querySelector('[id$="-matter"]')).not.toBeNull();
    expect(text(rendered)).not.toContain("where the check is filed, not what");
  });

  it("reads back what the check will do, from the values the request is composed from", () => {
    const plan = checkPlan(
      { ...OPENING_DRAFT, subjectEntityIds: ["entity-1"] },
      { matterId: null, matterEngaged: false, permissions: null },
    );
    const rendered = drawSubject({ draft: new CheckDraft(), plan });
    const shown = text(rendered);
    expect(shown).toContain("What This Check Will Do");
    for (const sentence of plan) expect(shown).toContain(sentence);
  });
});
