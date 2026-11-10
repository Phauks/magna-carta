import { describe, expect, it } from "vitest";
import { EVERYTHING_SCOPE, defaultScope, scopeOptions } from "$lib/matters/matter-search.svelte.ts";
import {
  emptyGroupLine,
  presentationFor,
  skippedBadge,
} from "$lib/matters/matter-search-presentation.ts";
import { matterSections, sectionForPathname } from "$lib/matters/sections.ts";

const MATTER = "matter_scopeTest0000000000000000000";

function sectionNamed(slug: string) {
  const section = matterSections.find((candidate) => candidate.slug === slug);
  if (section === undefined) throw new Error(`no section ${slug}`);
  return section;
}

describe("the search opens scoped to the section the reader is standing on", () => {
  it("defaults to the current section when it can be searched", () => {
    expect(defaultScope(sectionNamed("files"))).toBe("files");
    expect(defaultScope(sectionNamed("notes"))).toBe("notes");
  });

  it("falls back to the whole matter rather than opening on an option that cannot answer", () => {
    // Trust has no source and will not have one until the section itself is built. Opening the
    // control there on a disabled scope would put the reader in a state where typing does nothing
    // and the control does not say why. Named from the registry rather than hardcoded, so this
    // keeps testing the fallback as sections become searchable instead of testing a stale example.
    const unsearchable = matterSections.find((section) => section.searchSource === null);
    if (unsearchable === undefined)
      throw new Error("every section is searchable — retire this test");
    expect(defaultScope(unsearchable)).toBe(EVERYTHING_SCOPE);
    expect(defaultScope(undefined)).toBe(EVERYTHING_SCOPE);
  });

  it("resolves the section from the address, root included", () => {
    expect(sectionForPathname(MATTER, `/matters/${MATTER}/files`)?.slug).toBe("files");
    expect(sectionForPathname(MATTER, `/matters/${MATTER}/files/anything`)?.slug).toBe("files");
    // The bare matter root redirects to Overview, so it reads as Overview here too.
    expect(sectionForPathname(MATTER, `/matters/${MATTER}`)?.slug).toBe("overview");
  });
});

describe("the scope vocabulary names the matter and no wider", () => {
  const options = scopeOptions(sectionNamed("files"));

  it("puts the current section first, then the whole matter", () => {
    expect(options[0]?.label).toBe("This section: Files");
    expect(options[1]?.value).toBe(EVERYTHING_SCOPE);
  });

  it("never offers a scope that could be read as wider than this matter", () => {
    // Searching everything is the command palette's job. A scope that could be in the wrong
    // position is what makes a search untrustworthy for both jobs.
    for (const option of options) {
      expect(option.label.toLowerCase()).not.toContain("everywhere");
      expect(option.label.toLowerCase()).not.toContain("all matters");
    }
  });

  it("expresses the whole matter as an EMPTY source list, not a magic key", () => {
    // Absent means "every source the reader may read". A key meaning "everything" is the word the
    // vocabulary must never grow.
    const everything = options.find((option) => option.value === EVERYTHING_SCOPE);
    expect(everything?.sources).toEqual([]);
  });

  it("lists every section exactly once", () => {
    const values = options.map((option) => option.value).toSorted();
    const expected = [
      EVERYTHING_SCOPE,
      ...matterSections.map((section) => section.slug),
    ].toSorted();
    expect(values).toEqual(expected);
  });
});

describe("a section that cannot be searched is offered and disabled, never omitted", () => {
  const options = scopeOptions(sectionNamed("files"));

  it("keeps the unsearchable sections in the list", () => {
    for (const section of matterSections.filter((entry) => entry.searchSource === null)) {
      expect(options.some((option) => option.value === section.slug)).toBe(true);
    }
  });

  it("gives each one the line saying what it waits on", () => {
    for (const option of options) {
      if (option.sources.length > 0 || option.value === EVERYTHING_SCOPE) continue;
      expect(option.waitingOn).toBeTruthy();
    }
  });

  it("gives every searchable section a source and no waiting line", () => {
    for (const option of options) {
      if (option.sources.length === 0) continue;
      expect(option.waitingOn).toBeUndefined();
    }
  });
});

describe("presentation is never the reason a source disappears", () => {
  it("renders an unknown source under its own key rather than dropping it", () => {
    // The server's registry decides what exists. A client that only rendered sources it had an
    // entry for would silently narrow an answer the surface promised was complete.
    const unknown = presentationFor("somethingTheServerAdded");
    expect(unknown.heading).toBe("somethingTheServerAdded");
    expect(unknown.icon).toBeTruthy();
  });

  it("has an entry for every section that declares a source", () => {
    for (const section of matterSections) {
      if (section.searchSource === null) continue;
      for (const source of [section.searchSource, ...(section.searchSourcesBeside ?? [])]) {
        expect(presentationFor(source).heading).not.toBe(source);
      }
    }
  });
});

describe("the Files section is searched by name and by the words inside its files", () => {
  it("asks both sources when the search is scoped to Files", () => {
    const [current] = scopeOptions(sectionNamed("files"));
    expect(current?.sources).toEqual(["files", "file-contents"]);
  });

  it("heads the two answers differently, so a match inside a file is not read as a name", () => {
    expect(presentationFor("files").heading).toBe("Files");
    expect(presentationFor("file-contents").heading).toBe("Inside Files");
  });

  it("says why the words inside files were not searched, never that nothing matched", () => {
    expect(emptyGroupLine("not-indexed", "file-contents")).toContain("turned off for this firm");
    expect(skippedBadge("not-indexed")).toBe("Off");
    // The names of the files were still searched, and the line must not say otherwise.
    expect(emptyGroupLine("engine-unavailable", "file-contents")).toContain(
      "File and folder names were",
    );
    expect(skippedBadge("engine-unavailable")).toBe("Unavailable");
    expect(emptyGroupLine(null, "file-contents")).toBe("No matches");
  });
});
