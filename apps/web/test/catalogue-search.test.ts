/*
 * The catalogue's narrowing rules, pinned. A reader forms a habit around which words reach which
 * entry — whether two words both have to match, whether a heading counts, whether a word has to
 * start something — so the rules are asserted rather than left to the reading of one regular
 * expression. The screen that applies them holds no matching logic of its own.
 */
import { describe, expect, it } from "vitest";
import Wrench from "@lucide/svelte/icons/wrench";
import type { CatalogueSection } from "../src/lib/catalogue/catalogue.ts";
import { countCatalogueEntries } from "../src/lib/catalogue/catalogue.ts";
import {
  entryMatches,
  filterCatalogue,
  matchSummary,
} from "../src/lib/catalogue/catalogue-search.ts";

const SECTIONS: readonly CatalogueSection[] = [
  {
    id: "trust-compliance",
    label: "Trust Compliance",
    entries: [
      {
        id: "trust-compliance",
        name: "Trust Compliance Report",
        description: "Every movement of client money over one period, and what did not tie out.",
        stage: "alpha",
        icon: Wrench,
        href: "/reports/trust-compliance",
        keywords: ["reports:trustCompliance"],
      },
    ],
  },
  {
    id: "files",
    label: "Documents & Files",
    entries: [
      {
        id: "metadata-scrubber",
        name: "Metadata Scrubber",
        description: "Inspect and strip hidden metadata from a file.",
        stage: "soon",
        icon: Wrench,
        href: null,
        waitsOn: "file conversion",
      },
      {
        id: "file-repair",
        name: "File Repair",
        description: "Repair and salvage a damaged or corrupted file.",
        stage: "soon",
        icon: Wrench,
        href: null,
      },
    ],
  },
];

const idsIn = (sections: readonly CatalogueSection[]): string[] =>
  sections.flatMap((section) => section.entries.map((entry) => entry.id));

describe("filterCatalogue", () => {
  it("returns the catalogue untouched for an empty or whitespace-only query", () => {
    expect(filterCatalogue(SECTIONS, "")).toBe(SECTIONS);
    expect(filterCatalogue(SECTIONS, "   ")).toBe(SECTIONS);
  });

  it("matches on the name, whatever the case", () => {
    expect(idsIn(filterCatalogue(SECTIONS, "SCRUBBER"))).toEqual(["metadata-scrubber"]);
  });

  it("matches inside a word, not only at its start", () => {
    expect(idsIn(filterCatalogue(SECTIONS, "scrub"))).toEqual(["metadata-scrubber"]);
  });

  it("matches on the descriptive line", () => {
    expect(idsIn(filterCatalogue(SECTIONS, "salvage"))).toEqual(["file-repair"]);
  });

  it("matches on the section's heading, so a family reaches everything under it", () => {
    expect(idsIn(filterCatalogue(SECTIONS, "documents"))).toEqual([
      "metadata-scrubber",
      "file-repair",
    ]);
  });

  it("matches on a keyword that is never shown", () => {
    expect(idsIn(filterCatalogue(SECTIONS, "trustCompliance"))).toEqual(["trust-compliance"]);
  });

  it("matches on the dependency an unbuilt entry names", () => {
    expect(idsIn(filterCatalogue(SECTIONS, "file conversion"))).toEqual(["metadata-scrubber"]);
  });

  it("narrows with every added word rather than widening", () => {
    expect(idsIn(filterCatalogue(SECTIONS, "file"))).toEqual(["metadata-scrubber", "file-repair"]);
    expect(idsIn(filterCatalogue(SECTIONS, "file repair"))).toEqual(["file-repair"]);
    expect(idsIn(filterCatalogue(SECTIONS, "file trust"))).toEqual([]);
  });

  it("drops a section whole rather than showing an empty heading", () => {
    const narrowed = filterCatalogue(SECTIONS, "money");
    expect(narrowed.map((section) => section.id)).toEqual(["trust-compliance"]);
  });

  it("keeps the registry's order of sections and of entries within them", () => {
    expect(idsIn(filterCatalogue(SECTIONS, "e"))).toEqual(idsIn(SECTIONS));
  });
});

describe("entryMatches", () => {
  it("admits every entry when nothing is being searched", () => {
    const entry = SECTIONS[1]!.entries[0]!;
    expect(entryMatches(entry, "Documents & Files", "")).toBe(true);
  });
});

describe("the counts inside the field", () => {
  it("counts every entry across the sections", () => {
    expect(countCatalogueEntries(SECTIONS)).toBe(3);
  });

  it("says how much of the whole survived", () => {
    expect(matchSummary(1, 3)).toBe("1 of 3");
  });
});
