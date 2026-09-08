/*
 * The two other discovery registries, and the vocabulary they render from.
 *
 * The deliverable registry's assertions are about a record a firm hands to another party: an
 * artifact that claimed to be built with no form to hand over is a button that downloads nothing,
 * and an address assembled anywhere but here is how two screens end up offering different things
 * under one name.
 *
 * The vocabulary's assertion is narrower and more important than it looks. Every exception code the
 * domain can raise has to have a word here, because an unmapped code renders as nothing at all —
 * and a document whose reason for not being read is blank is exactly the failure the exception
 * report exists to prevent.
 */
import { describe, expect, it } from "vitest";
import {
  DELIVERABLES,
  deliverableIsBuilt,
  deliverablesScopedTo,
} from "../src/lib/discovery/deliverables.ts";
import {
  EXCEPTION_CODE_ORDER,
  PROCESSING_STATE_ORDER,
  RECORD_CUSTODIAN_KIND_ORDER,
  SELECTABLE_LOAD_LANES,
  exceptionCodeEntry,
  indexStateEntry,
  loadLaneEntry,
  loadStateEntry,
  processingStateEntry,
  recordCustodianKindLabel,
  reviewSetStateEntry,
} from "../src/lib/discovery/discovery-vocabulary.ts";
import {
  WORKSPACE_ENTRIES,
  workspaceEntryForPathname,
} from "../src/lib/discovery/workspace-strip.ts";

describe("the deliverable registry", () => {
  it("declares every record once", () => {
    const ids = DELIVERABLES.map((deliverable) => deliverable.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has the load's two records built and scoped to the load that produced them", () => {
    const built = deliverablesScopedTo("load").filter(deliverableIsBuilt);
    expect(built.map((deliverable) => deliverable.id)).toEqual([
      "load-manifest",
      "exception-report",
    ]);
  });

  it("offers each built record in a printable form first", () => {
    for (const deliverable of DELIVERABLES) {
      if (!deliverableIsBuilt(deliverable)) continue;
      expect(deliverable.formats[0]?.format).toBe("text");
    }
  });

  it("owns the address, so no surface assembles one", () => {
    const manifest = DELIVERABLES.find((deliverable) => deliverable.id === "load-manifest");
    expect(manifest && deliverableIsBuilt(manifest)).toBe(true);
    if (manifest && deliverableIsBuilt(manifest)) {
      expect(manifest.href("discoveryLoad_1", "text")).toBe(
        "/api/v1/loads/discoveryLoad_1/artifacts/manifest?format=text",
      );
    }
  });

  it("gives every unwritten record a dependency to show", () => {
    for (const deliverable of DELIVERABLES) {
      if (deliverableIsBuilt(deliverable)) continue;
      expect(deliverable.waitsOn.trim()).not.toBe("");
    }
  });

  it("scopes the privilege log to the review set rather than to a load", () => {
    // It is generated from what was coded across the whole corpus, so it cannot belong to one
    // delivery. This is the fact that decides where it renders, which is why it is asserted.
    const log = DELIVERABLES.find((deliverable) => deliverable.id === "privilege-log");
    expect(log?.scope).toBe("review-set");
  });
});

describe("the workspace strip", () => {
  it("holds Documents and Loads, and nothing that is a narrowing in disguise", () => {
    expect(WORKSPACE_ENTRIES.map((entry) => entry.slug)).toEqual(["documents", "loads"]);
  });

  it("resolves the entry an address is on, including a deeper path", () => {
    expect(
      workspaceEntryForPathname("reviewSet_1", "/discovery/review-sets/reviewSet_1/loads")?.slug,
    ).toBe("loads");
    expect(
      workspaceEntryForPathname("reviewSet_1", "/discovery/review-sets/reviewSet_1/documents/x")
        ?.slug,
    ).toBe("documents");
    expect(workspaceEntryForPathname("reviewSet_1", "/discovery")).toBeUndefined();
  });
});

describe("the discovery vocabulary", () => {
  it("gives every exception code a word, a tone and a meaning", () => {
    for (const code of EXCEPTION_CODE_ORDER) {
      const entry = exceptionCodeEntry(code);
      expect(entry.label.trim()).not.toBe("");
      expect(entry.meaning.trim()).not.toBe("");
    }
  });

  it("never renders an exception code back at a person", () => {
    for (const code of EXCEPTION_CODE_ORDER) {
      expect(exceptionCodeEntry(code).label).not.toBe(code);
    }
  });

  it("gives every processing state, review-set state and load state a word", () => {
    for (const state of PROCESSING_STATE_ORDER) {
      expect(processingStateEntry(state).label.trim()).not.toBe("");
    }
    for (const state of ["open", "locked", "closed"] as const) {
      expect(reviewSetStateEntry(state).label.trim()).not.toBe("");
    }
    for (const state of [
      "declared",
      "loading",
      "processing",
      "complete",
      "failed",
      "reversed",
    ] as const) {
      expect(loadStateEntry(state).label.trim()).not.toBe("");
    }
  });

  it("says a document nothing has indexed is not searchable YET, and never that it failed", () => {
    // With no search engine deployed this is every read document in the product, so the word has to
    // read as the platform's work outstanding rather than as something wrong with the document. It
    // is also never an exception and never reaches a report a court sees.
    expect(indexStateEntry(null).label).toBe("Not searchable yet");
    expect(indexStateEntry("deferred").label).toBe("Not searchable yet");
    expect(indexStateEntry("deferred").tone).toBe("neutral");
  });

  it("offers the unbuilt collection lane and refuses it by name", () => {
    expect(SELECTABLE_LOAD_LANES).toContain("direct-collection");
    expect(loadLaneEntry("direct-collection").built).toBe(false);
    expect(loadLaneEntry("internal-files").built).toBe(true);
  });

  it("treats unattributed material as a real answer rather than a blank", () => {
    expect(RECORD_CUSTODIAN_KIND_ORDER).toContain("unattributed");
    expect(recordCustodianKindLabel("unattributed").trim()).not.toBe("");
  });
});

/*
 * The drift guard.
 *
 * apps/web hand-writes the shapes it reads rather than depending on the server's domain packages —
 * that is the transport seam's decision, and it is the right one. The cost is that a closed
 * vocabulary now exists in two places, and the failure mode is silent: the domain raises a new
 * exception code, this app has no word for it, and a document's reason for not being read renders
 * blank on the one screen a firm builds an exception report from.
 *
 * So the lists are compared against the domain's own source, read as TEXT rather than imported. A
 * dependency from the SPA on a server-side domain package would be a much larger thing to buy for
 * this, and reading the file is enough: the constants are closed arrays of string literals, and the
 * test fails the moment one gains a member this app does not know.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function domainVocabulary(constantName: string): string[] {
  const source = readFileSync(
    fileURLToPath(new URL("../../../packages/discovery/src/types.ts", import.meta.url)),
    "utf8",
  );
  const declaration = new RegExp(`export const ${constantName} = \\[([^\\]]*)\\]`, "u").exec(
    source,
  );
  if (declaration === null) {
    throw new Error(`packages/discovery/src/types.ts no longer declares ${constantName}.`);
  }
  return [...declaration[1]!.matchAll(/"([^"]+)"/gu)].map((match) => match[1]!);
}

describe("the web vocabulary against the domain's own", () => {
  it("has a word for every exception code the pipeline can raise", () => {
    expect([...EXCEPTION_CODE_ORDER]).toEqual(domainVocabulary("REVIEW_DOCUMENT_EXCEPTION_CODES"));
  });

  it("has a word for every processing state a document can end in", () => {
    expect([...PROCESSING_STATE_ORDER]).toEqual(
      domainVocabulary("REVIEW_DOCUMENT_PROCESSING_STATES"),
    );
  });

  it("offers every load lane the contract accepts, built or not", () => {
    expect([...SELECTABLE_LOAD_LANES]).toEqual(domainVocabulary("DISCOVERY_LOAD_LANES"));
  });

  it("has a word for every kind a Custodian of Record can be", () => {
    expect([...RECORD_CUSTODIAN_KIND_ORDER]).toEqual(domainVocabulary("RECORD_CUSTODIAN_KINDS"));
  });
});
