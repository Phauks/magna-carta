import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openingTabKey } from "../src/lib/components/record-window/opening-tab.ts";
import type { RecordWindowTab } from "../src/lib/components/record-window/types.ts";

/*
 * RecordWindow's package-local contract.
 *
 * The window's rendered behavior belongs to its stories (they run in a real browser, with axe); the
 * two things asserted here are the ones a story cannot see. First, the opening-tab decision, which
 * is pure logic and deserves to be pinned by itself rather than inferred from a rendered tab strip.
 * Second, the cascade: the recipe dresses the Dialog panel and the Tabs strip by overriding them at
 * equal specificity, so it only works while it is imported AFTER both. That ordering is invisible
 * in review, silent when wrong (the window renders, just wearing the dialog's padding), and one
 * careless alphabetization away at all times.
 *
 * The header set and the shell's domain-blindness are asserted by tooling/lint-one-ui, which runs
 * over the whole repository; repeating them here would give the same fact two homes.
 */

const PACKAGE_ROOT = join(import.meta.dirname, "..");

const tab = (key: string): RecordWindowTab => ({
  key,
  label: key,
  content: (() => undefined) as unknown as RecordWindowTab["content"],
});

describe("which tab a record window opens on", () => {
  it("opens on the first tab when the caller names none", () => {
    expect(openingTabKey([tab("attachments"), tab("history")], undefined)).toBe("attachments");
  });

  it("opens on the tab the caller named, so what is waiting is in front of the reader", () => {
    expect(openingTabKey([tab("attachments"), tab("history")], "history")).toBe("history");
  });

  it("falls back to the first tab when the named one is not in the set", () => {
    // The tab set travels with the record and changes with it, so a key that no longer matches is
    // stale rather than wrong. Opening on the first tab beats refusing to open.
    expect(openingTabKey([tab("attachments"), tab("history")], "billing")).toBe("attachments");
  });

  it("answers with nothing rather than throwing when a record contributes no tabs", () => {
    expect(openingTabKey([], "history")).toBe("");
  });
});

describe("the recipe's place in the cascade", () => {
  const componentsCss = readFileSync(join(PACKAGE_ROOT, "src/lib/styles/components.css"), "utf8");
  const positionOf = (recipe: string): number => componentsCss.indexOf(`/${recipe}/`);

  it("is imported at all, or the window ships wearing no recipe of its own", () => {
    expect(positionOf("record-window")).toBeGreaterThan(-1);
  });

  it("follows the Dialog and Tabs recipes it overrides", () => {
    expect(positionOf("record-window")).toBeGreaterThan(positionOf("dialog"));
    expect(positionOf("record-window")).toBeGreaterThan(positionOf("tabs"));
  });

  it("sits on the modal frame, which follows both dialog panels and precedes the window", () => {
    // The frame overrides the Dialog and AlertDialog panels' padding, gap and overflow at equal
    // specificity, and the window's tab strip overrides Tabs the same way — so the order is
    // dialog, alert-dialog, frame, tabs... , record-window, and moving any one of them breaks a
    // recipe silently.
    // The frame is an internal recipe under styles/recipes/, not a component directory, so it is
    // found by its own import path rather than through the component locator.
    const framePosition = componentsCss.indexOf('@import "./recipes/modal-frame.css"');
    expect(framePosition).toBeGreaterThan(-1);
    expect(framePosition).toBeGreaterThan(positionOf("dialog"));
    expect(framePosition).toBeGreaterThan(positionOf("alert-dialog"));
    expect(positionOf("record-window")).toBeGreaterThan(framePosition);
  });
});

describe("the sizing rules, at the source", () => {
  /*
   * The two rules the whole behaviour rests on are pinned as text because they are what a
   * well-meaning tidy-up deletes: "the panel is fit-content" reads like an accident next to a
   * max-height utility, and "the record pane stops but the context pane does not" reads like an
   * inconsistency. Their source is the modal frame, which is where they moved the day the second
   * shell needed the same pane system; the record window keeps its class names as hooks and
   * deliberately restates neither rule, because a rule stated twice drifts.
   */
  const frame = readFileSync(join(PACKAGE_ROOT, "src/lib/styles/recipes/modal-frame.css"), "utf8");
  const recipe = readFileSync(
    join(PACKAGE_ROOT, "src/lib/components/record-window/record-window.css"),
    "utf8",
  );

  it("sizes the panel to its content, which is what lets a record that fits not scroll", () => {
    expect(frame).toContain("block-size: fit-content");
  });

  it("stops the primary pane at its measure and leaves the context pane uncapped", () => {
    expect(frame).toContain("max-inline-size: var(--mc-size-record-pane)");
    expect(frame).not.toContain("max-inline-size: var(--mc-size-record-context)");
  });

  it("lets a primary pane with no context beside it fill the frame", () => {
    // A wide single-column form has nowhere to hand its surplus width, so it takes it.
    expect(frame).toContain(".mc-modal-frame-pane:only-child");
  });

  it("restates none of the frame's rules in the window's own recipe", () => {
    expect(recipe).not.toContain("block-size: fit-content");
    expect(recipe).not.toContain("max-inline-size");
    expect(recipe).not.toContain(".mc-record-window {");
  });
});

describe("the shell's public surface", () => {
  const shell = readFileSync(
    join(PACKAGE_ROOT, "src/lib/components/record-window/record-window.svelte"),
    "utf8",
  );

  it("declares every prop a record kind hands it, and no field of its own", () => {
    // A kind of record contributes its panes and its verbs; anything else it would want to add is
    // a field on one of those panes, never a new prop here.
    for (const property of [
      "open",
      "expanded",
      "editing",
      "heading",
      "subtitle",
      "record",
      "tabs",
      "defaultTab",
      "actions",
      "onSave",
      "onCancel",
      "onPrint",
      "editDisabledReason",
      "saveDisabledReason",
      "unsavedChanges",
    ]) {
      expect(shell).toContain(property);
    }
  });

  it("keeps open, expanded and editing bindable, so a surface can drive all three", () => {
    expect(shell).toContain("open = $bindable(false)");
    expect(shell).toContain("expanded = $bindable()");
    expect(shell).toContain("editing = $bindable(false)");
  });

  it("offers no callback a record kind could open a second editing surface from", () => {
    // Editing is a MODE of this window, not an errand it sends the caller on. The moment the shell
    // hands out an "the reader pressed Edit" callback, one record kind answers it by opening its
    // own dialog and the one-window rule is over — so the callback does not exist, and the header's
    // control raises the window's own flag instead.
    expect(shell).not.toContain("onEdit");
  });

  it("hands the mode to the panes that must not fork, and to no others", () => {
    // The record pane renders the values AND the fields, so it is told which; the action bar swaps
    // the caller's verbs, so it is told too. The tabs are context and stay read-only either way,
    // which is enforced by simply never telling them.
    expect(shell).toContain("record: Snippet<[{ editing: boolean }]>");
    expect(shell).toContain("actions: Snippet<[{ editing: boolean }]>");
    expect(shell).toContain("tabs: readonly RecordWindowTab[]");
  });
});
