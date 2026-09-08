// @vitest-environment happy-dom
/*
 * The two panes of the New Check panel, as a reader meets them.
 *
 * The owner's complaint on 2026-09-08 was not that a setting was wrong — it was that a reader could
 * not tell what any of them searched: "you have so many settings and i don't know what half of them
 * mean". The answer was to put a sentence under every control and the firm's own number inside every
 * box, and neither of those is the kind of thing a type-checker can hold in place. So they are
 * pinned here, where a later round that quietly reverts one fails instead of shipping.
 */
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CheckScope from "$lib/conflicts/check-scope.svelte";
import CheckSubject from "$lib/conflicts/check-subject.svelte";
import { CheckDraft } from "$lib/conflicts/check-draft.svelte.ts";
import { OPENING_DRAFT, checkPlan } from "$lib/conflicts/check-request.ts";
import type { FirmConflictsPolicy } from "$lib/conflicts/conflicts-api.ts";

const POLICY: FirmConflictsPolicy = {
  floorSources: ["party"],
  floorStrictness: "balanced",
  defaultDepth: 1,
  edgeClassBudgets: { control: 2, family: 1, representation: 1 },
  closureCap: 500,
  candidateCap: 5000,
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

const placeholders = (within: HTMLElement): string[] =>
  [...within.querySelectorAll("input")].map((input) => input.getAttribute("placeholder") ?? "");

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

describe("the engine settings pane", () => {
  it("says what every source searches, in the page rather than on a hover", () => {
    const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY });
    const shown = text(rendered);
    // The four labels, in the words the log's own columns use.
    expect(shown).toContain("Name or identifier");
    expect(shown).toContain("Relationship");
    expect(shown).toContain("The firm's own people");
    expect(shown).toContain("Documents and messages");
    // And each one's sentence, drawn rather than left to a title attribute.
    expect(shown).toContain("matched on name and on sealed identifiers");
    expect(shown).toContain("by identity, never by name");
  });

  it("names sound-alike matching, which the old wording never did", () => {
    const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY });
    expect(text(rendered)).toContain("SOUND");
    expect(text(rendered)).toContain("Stephen and Steven");
  });

  it("calls the bands what they do rather than how strict they are", () => {
    const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY });
    expect(text(rendered)).toContain("Name matching");
    expect(text(rendered)).toContain("Standard");
    expect(text(rendered)).toContain("Widest");
    expect(text(rendered)).not.toContain("Strictness");
  });

  it("names the relationship classes for what they cover", () => {
    const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY });
    const shown = text(rendered);
    expect(shown).toContain("Ownership and control");
    expect(shown).toContain("Family and personal");
    expect(shown).toContain("Corporate family");
    expect(shown).toContain("Followed all the way");
  });

  it("shows the firm's own number inside every box a reader may leave blank", () => {
    const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY });
    // The three hop budgets, then the two bounds — each its own firm setting, in its own field.
    expect(placeholders(rendered)).toEqual(["2", "1", "1", "500", "5000"]);
  });

  it("says the firm's own where the policy could not be read, rather than inventing a figure", () => {
    const rendered = drawScope({ draft: new CheckDraft(), policy: null });
    expect(new Set(placeholders(rendered))).toEqual(new Set(["The firm's own"]));
  });

  it("states the floor as something that widens a check, never as a limit on it", () => {
    const rendered = drawScope({ draft: new CheckDraft(), policy: POLICY });
    expect(text(rendered)).toContain("raised back up before the search runs");
  });

  it("holds the hop budgets shut while the relationship walk is turned off", () => {
    const draft = new CheckDraft();
    draft.searchRelationships = false;
    const rendered = drawScope({ draft, policy: POLICY });
    const hops = [...rendered.querySelectorAll("input")].slice(0, 3);
    expect(hops.every((input) => input.disabled)).toBe(true);
  });

  it("cannot reach the firm's own people with no matter named, and says so", () => {
    const rendered = drawScope({
      draft: new CheckDraft(),
      policy: POLICY,
      matterNamed: false,
    });
    expect(text(rendered)).toContain(
      "No matter is named, so this check records it as not searched",
    );
  });
});

describe("the subject pane", () => {
  it("says a matter is where a check is filed, not what it is checked against", () => {
    const rendered = drawSubject({
      draft: new CheckDraft(),
      matterLabel: "2026-0001 · Acme",
      plan: [],
    });
    expect(text(rendered)).toContain("2026-0001 · Acme");
  });

  it("reads back what the check will do, from the values the request is composed from", () => {
    const plan = checkPlan(
      { ...OPENING_DRAFT, subjectEntityIds: ["entity-1"] },
      { matterId: null, matterEngaged: false, permissions: null },
      POLICY,
    );
    const rendered = drawSubject({ draft: new CheckDraft(), plan });
    const shown = text(rendered);
    expect(shown).toContain("What This Check Will Do");
    for (const sentence of plan) expect(shown).toContain(sentence);
  });
});
