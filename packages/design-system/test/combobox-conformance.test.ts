/*
 * The Combobox's settled rulings, asserted where a reviewer would otherwise have to notice them.
 *
 * Three of these are about text and one is about a recipe, and all four have already been issued as
 * corrections once. A correction that survives only as a comment gets reversed the next time somebody
 * "tidies" the file, so each one is written here as a question with a wrong answer that fails:
 *
 *   - A dropdown row draws no ring, focus or selection. The rendered proof lives in the story, which
 *     measures a highlighted row in both the pointer and the keyboard path; this pins the recipe that
 *     makes it true, so the rule cannot be deleted and rediscovered in a browser months later.
 *   - Ghost text is the field's name. Not a description, not an example, not an instruction.
 *   - The hint that explained how to type in a filter field is struck. The field stands; the caption
 *     under it does not.
 *   - The add row's copy names what it will add.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADD_OPTION_VALUE,
  addOptionLabel,
  isAddOption,
  withoutAddOption,
} from "../src/lib/components/combobox/add-option.ts";
import { readsAsFieldName } from "../src/lib/formatters/placeholder.ts";

const COMBOBOX_HOME = join(import.meta.dirname, "../src/lib/components/combobox");
const SELECT_HOME = join(import.meta.dirname, "../src/lib/components/select");
const STORIES = join(import.meta.dirname, "../src/stories");

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory).map((name) => join(directory, name));
}

/** The declarations of one recipe block, by its selector, from a stylesheet. */
function declarationsOf(css: string, selector: string): string[] {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return [];
  const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
  return body
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration !== "");
}

describe("a dropdown row shows its highlight by fill alone", () => {
  const selectCss = read(join(SELECT_HOME, "select.css"));

  it("suppresses the outline at rest and under :focus-visible, so nothing restores one", () => {
    expect(declarationsOf(selectCss, ".mc-select-item")).toContain("outline-style: none");
    expect(declarationsOf(selectCss, ".mc-select-item:focus-visible")).toContain(
      "outline-style: none",
    );
  });

  it("draws no shadow ring in any of the three row states", () => {
    for (const selector of [
      ".mc-select-item",
      ".mc-select-item:focus-visible",
      ".mc-select-item[data-highlighted]",
    ]) {
      expect(declarationsOf(selectCss, selector)).toContain("box-shadow: none");
    }
  });

  it("changes only the fill when a row becomes the active one", () => {
    const highlighted = declarationsOf(selectCss, ".mc-select-item[data-highlighted]");
    const changesColour = highlighted.filter(
      (declaration) => !declaration.startsWith("outline-") && !declaration.startsWith("box-shadow"),
    );
    expect(changesColour).toEqual(["background-color: var(--mc-action-secondary)"]);
  });

  it("keys the highlight off the one attribute both interaction paths set", () => {
    // Bits marks the hovered row and the arrowed-to row with the same attribute. A separate :hover
    // rule would be the way the two paths silently drift apart, so there must not be one.
    expect(selectCss).not.toMatch(/\.mc-select-item[^{]*:hover/);
  });
});

describe("ghost text is the field's name", () => {
  it("derives the placeholder from the field name rather than taking a second string", () => {
    const input = read(join(COMBOBOX_HOME, "combobox-input.svelte"));
    expect(input).toContain("placeholderOf");
    expect(input).toContain("fieldName");
  });

  it("holds for every placeholder the two catalog entries put on screen", () => {
    for (const story of ["combobox.stories.svelte", "select.stories.svelte"]) {
      const source = read(join(STORIES, story));
      const written = [...source.matchAll(/(?:placeholder|fieldName)="([^"]*)"/g)].map(
        ([, text]) => text!,
      );
      expect(written.length).toBeGreaterThan(0);
      for (const text of written) {
        expect({ story, text, readsAsFieldName: readsAsFieldName(text) }).toEqual({
          story,
          text,
          readsAsFieldName: true,
        });
      }
    }
  });
});

describe("the hint that explained the filter field is struck", () => {
  it("appears in neither component nor either catalog entry", () => {
    // The field stands; the caption under it does not. A text field above a list of choices needs
    // no explanation of what typing in it does, and the explanation was the thing that read as
    // clutter. The exact struck wording is what is checked — prose in a comment that happens to
    // describe the behaviour is not the defect.
    const sources = [
      ...filesUnder(COMBOBOX_HOME),
      ...filesUnder(SELECT_HOME),
      join(STORIES, "combobox.stories.svelte"),
      join(STORIES, "select.stories.svelte"),
    ];
    for (const path of sources) {
      expect(read(path).toLowerCase()).not.toContain("type to narrow the choices");
      expect(read(path).toLowerCase()).not.toContain("type to filter");
      expect(read(path).toLowerCase()).not.toContain("start typing");
    }
  });
});

describe("the add row", () => {
  it("names the value it will add, once there is one", () => {
    expect(addOptionLabel("Payee", "Acme Supplies")).toEqual('Add "Acme Supplies"');
    expect(addOptionLabel("Document Type", "  Affidavit  ")).toEqual('Add "Affidavit"');
  });

  it("names the field when nothing is typed yet, reading as a sentence either way", () => {
    expect(addOptionLabel("Payee", "")).toEqual("Add payee");
    expect(addOptionLabel("Document Type", "   ")).toEqual("Add document type");
  });

  it("leaves an initialism capitalised, because lowercasing it would misspell it", () => {
    expect(addOptionLabel("ABA Number", "")).toEqual("Add ABA number");
  });

  it("says something even with no field name to work from", () => {
    expect(addOptionLabel("", "")).toEqual("Add");
  });

  it("carries a value nothing a firm types could collide with", () => {
    expect(isAddOption(ADD_OPTION_VALUE)).toBe(true);
    expect(isAddOption("Contract")).toBe(false);
    expect(isAddOption("")).toBe(false);
    expect(ADD_OPTION_VALUE).toMatch(/:/);
  });

  it("is recognised and removable inside a multiple selection", () => {
    expect(isAddOption(["Contract", ADD_OPTION_VALUE])).toBe(true);
    expect(isAddOption(["Contract", "Pleading"])).toBe(false);
    expect(withoutAddOption(["Contract", ADD_OPTION_VALUE, "Pleading"])).toEqual([
      "Contract",
      "Pleading",
    ]);
  });
});

describe("the one dropdown", () => {
  it("builds its rows out of the Select rows rather than a second set", () => {
    // A second row component is the failure this component exists to prevent: it renders correctly,
    // it typechecks, and it is discovered a round later when a ruling is fixed in one copy only.
    const index = read(join(COMBOBOX_HOME, "index.ts"));
    expect(index).toContain('from "../select/select-item.svelte"');
    expect(readdirSync(COMBOBOX_HOME)).not.toContain("combobox-item.svelte");
  });

  it("caps and scrolls its list unless the caller brings its own scroller", () => {
    const content = read(join(COMBOBOX_HOME, "combobox-content.svelte"));
    expect(content).toContain("virtualized");
    expect(content).toContain("--bits-floating-available-height");
  });
});
