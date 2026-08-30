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
      "heading",
      "subtitle",
      "record",
      "tabs",
      "defaultTab",
      "actions",
      "onEdit",
      "onPrint",
      "editDisabledReason",
    ]) {
      expect(shell).toContain(property);
    }
  });

  it("keeps open and expanded bindable, so a surface can drive both", () => {
    expect(shell).toContain("open = $bindable(false)");
    expect(shell).toContain("expanded = $bindable()");
  });
});
