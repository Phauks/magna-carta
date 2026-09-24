/*
 * The record family's review page, pinned.
 *
 * Two things are asserted, and they fail in different ways. The FIXTURES are ordinary data modules,
 * so they are imported and exercised. The PAGE and the sheet beside it are read as source, which is
 * a limitation of where this app's tests run rather than a preference: the pool here is plain node,
 * and anything that reaches a design-system component barrel pulls bits-ui, which will not load
 * outside a browser and which this app may not name. The catalog's own browser-mode stories are
 * where each component's rendered behaviour is asserted; what this file guards is that the review
 * page still SHOWS every state, and that it stays out of production.
 *
 * The state lists below are the point of the page. A gallery that quietly loses a state is worse
 * than one that never had it: the reviewer sees a clean page and concludes the state was fine.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readInstant } from "@magna-carta/design-system/formatters";
import {
  GALLERY_ATTACHMENTS,
  GALLERY_CHARGE,
  GALLERY_HISTORY,
  GALLERY_MATTER_DOCUMENTS,
  GALLERY_PLATFORM_HISTORY,
  GALLERY_SINGLE_EVENT,
  GALLERY_SPARSE_SHEET,
} from "../src/lib/developer/record-window-fixtures.ts";

function sourceOf(relativePath: string): string {
  return readFileSync(join(import.meta.dirname, "..", relativePath), "utf8");
}

const PAGE = sourceOf("src/http/routes/developer-console/record-window/+page.svelte");
const SHEET_MODULE = sourceOf("src/lib/developer/record-window-sheet.ts");
const FIXTURES_MODULE = sourceOf("src/lib/developer/record-window-fixtures.ts");

describe("the gallery route", () => {
  it("is unreachable in production, behind the same gate as the console beside it", () => {
    expect(PAGE).toContain("import.meta.env.DEV");
    expect(PAGE).toContain("only available in development builds");
  });

  it("reaches every icon through its own deep import, never the barrel", () => {
    // Written as a match over what the page imports rather than as a literal of the banned form:
    // the repository's own boundary sweep reads this file too, and the bare specifier spelled out
    // here would trip it. The escaped slash is what keeps the two apart, and is deliberate.
    //
    // There is deliberately no floor on how many icons the page imports. It once had exactly one,
    // and the day its mark became a design-system component the page had none — which is the
    // outcome this repository wants, and a floor that failed on it would be a floor punishing the
    // right move. The rule is about the SHAPE of an import, and no imports satisfy it honestly.
    const specifiers = [...PAGE.matchAll(/from "@lucide\/svelte([^"]*)"/g)].map(
      (hit) => hit[1] ?? "",
    );
    expect(specifiers.filter((suffix) => !suffix.startsWith("/icons/"))).toEqual([]);
  });

  it("composes the one record window rather than a second one", () => {
    // A hand-rolled panel that looks like the window is the defect the one-window rule exists to
    // stop, and a review page is exactly where one would be cheapest to write.
    expect(PAGE).toContain('from "@magna-carta/design-system/record-window"');
    expect(PAGE).not.toContain("mc-record-window");
  });

  it("keeps the fixture data loadable without a component behind it", () => {
    // The projection helpers share an entry point with the sheet component, so a value import of
    // them drags a Svelte component into anything that reads the fixtures. Keeping the data module
    // free of value imports is what lets this test exercise it at all.
    expect(FIXTURES_MODULE).toContain("import type { PrintSheetDocument }");
    expect(FIXTURES_MODULE).not.toMatch(/import \{[^}]*clientFacingRecord/);
    expect(SHEET_MODULE).toContain("clientFacingRecord");
  });
});

describe("the record window's states", () => {
  const cases: ReadonlyArray<{ state: string; evidence: string }> = [
    { state: "open at rest, with edit available", evidence: "At rest, edit enabled" },
    { state: "filling the screen", evidence: "expanded={true}" },
    { state: "edit refused, carrying its reason", evidence: "editDisabledReason=" },
    { state: "a tab set with counts", evidence: "count: attachments.length" },
    { state: "a tab set with nothing to count", evidence: "tabsWithoutCounts" },
    { state: "opening on a named tab", evidence: 'defaultTab="history"' },
  ];

  for (const { state, evidence } of cases) {
    it(`shows the window ${state}`, () => {
      expect(PAGE).toContain(evidence);
    });
  }

  it("states that closed is the page at rest, rather than leaving it unshown", () => {
    // Closed has no specimen to press, so it has to be said. Without the sentence a reviewer reads
    // the trigger row as the state list and concludes closed was never covered.
    expect(PAGE).toContain("Closed is what this page is showing");
  });
});

describe("the event rail's states", () => {
  const cases: ReadonlyArray<{ state: string; evidence: string }> = [
    { state: "a long history that scrolls", evidence: "events={GALLERY_HISTORY}" },
    { state: "a single event", evidence: "events={GALLERY_SINGLE_EVENT}" },
    { state: "nothing recorded yet", evidence: "events={[]} label=" },
    { state: "still loading", evidence: "events={[]} loading" },
    { state: "the platform as the source", evidence: "events={GALLERY_PLATFORM_HISTORY}" },
  ];

  for (const { state, evidence } of cases) {
    it(`shows ${state}`, () => {
      expect(PAGE).toContain(evidence);
    });
  }
});

describe("the print sheet's states", () => {
  it("layers the sheet above the record window rather than replacing it", () => {
    // The record window's own flag is set true alongside the sheet's, and nothing sets it back:
    // that is the layering, and it is the whole reason this component is a second dialog.
    expect(PAGE).toContain("showing.atRest = true;");
    expect(PAGE).toContain("showing.sheet = true;");
  });

  it("shows a sheet with little recorded on it", () => {
    expect(PAGE).toContain("sheet={GALLERY_SPARSE_SHEET}");
  });
});

describe("the attachments tab's states", () => {
  const cases: ReadonlyArray<{ state: string; evidence: string }> = [
    { state: "several attachments", evidence: "attachments={GALLERY_ATTACHMENTS}" },
    { state: "nothing attached", evidence: "attachments={[]}" },
    { state: "attaching refused", evidence: "canEdit={false}" },
  ];

  for (const { state, evidence } of cases) {
    it(`shows ${state}`, () => {
      expect(PAGE).toContain(evidence);
    });
  }

  it("says why attaching is refused rather than hiding the controls", () => {
    expect(PAGE).toContain("attachDisabledReason=");
  });
});

describe("the status register and the chain", () => {
  it("renders every vocabulary from the register itself, never a hand-copied list", () => {
    // Reading the register is what makes the page exhaustive by construction: a status word added
    // to the product appears here without anyone remembering to add it.
    expect(PAGE).toContain("Object.keys(STATUS_VOCABULARIES)");
    expect(PAGE).toContain("statusVocabulary(vocabulary)");
    expect(PAGE).toContain("<StatusMark label={entry.label} />");
  });

  it("shows the chain with the review gate off, with it on, and locked", () => {
    expect(PAGE).toContain('<RecordChain current="draft" />');
    expect(PAGE).toContain('current="submitted"');
    expect(PAGE).toContain("lock={{ object:");
  });
});

describe("the fixtures", () => {
  it("carries the firm's own note on the record, so the projection has something to strip", () => {
    expect(GALLERY_CHARGE.internalMemo).not.toBe("");
    // The sheet is built through the projection and its field selection cannot name the memo.
    expect(SHEET_MODULE).toContain("clientFacingRecord(GALLERY_CHARGE)");
    expect(SHEET_MODULE).not.toContain("internalMemo");
  });

  it("orders the history oldest first, the way the rail renders it", () => {
    // The rail renders exactly what it is handed. A fixture in the wrong order would put the filled
    // marker on the oldest event and quietly teach a reviewer the wrong thing about the component.
    const instants = GALLERY_HISTORY.map((event) => readInstant(event.at)?.getTime() ?? 0);
    expect(instants).toEqual([...instants].toSorted((first, second) => first - second));
  });

  it("carries at least one event the platform caused, and one somebody wrote words on", () => {
    expect(GALLERY_HISTORY.some((event) => event.source === "Magna Carta")).toBe(true);
    expect(GALLERY_HISTORY.some((event) => event.detail !== undefined)).toBe(true);
    expect(GALLERY_PLATFORM_HISTORY.every((event) => event.source === "Magna Carta")).toBe(true);
  });

  it("gives the single-event history the record's first event and nothing else", () => {
    expect(GALLERY_SINGLE_EVENT).toHaveLength(1);
    expect(GALLERY_SINGLE_EVENT[0]).toBe(GALLERY_HISTORY[0]);
  });

  it("leaves a sparse sheet's history empty, so the empty line is the state under review", () => {
    const history = GALLERY_SPARSE_SHEET.sections.find((section) => section.kind === "history");
    expect(history).toBeDefined();
    expect(history?.kind === "history" ? history.events : ["not a history"]).toEqual([]);
  });

  it("holds a document the record already carries, so the picker can be seen leaving it out", () => {
    const offered = GALLERY_MATTER_DOCUMENTS.flatMap((folder) =>
      folder.documents.map((document) => document.identifier),
    );
    const alreadyOn = new Set(
      GALLERY_ATTACHMENTS.map((attachment) => attachment.documentIdentifier),
    );
    expect(offered.filter((identifier) => alreadyOn.has(identifier)).length).toBeGreaterThan(0);
  });

  it("states the duration in both forms, the decimal leading", () => {
    expect(GALLERY_CHARGE.hours).toBe("2.50");
    expect(GALLERY_CHARGE.hoursClockForm).toBe("2:30");
  });
});
