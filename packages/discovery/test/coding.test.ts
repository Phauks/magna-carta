import type { ReviewTagId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { readCodingPanel, seedCodingPanel } from "../src/coding-panel-service.ts";
import {
  applyTag,
  buildBulkCodingChunk,
  completeBulkCoding,
  planBulkCoding,
  removeTag,
  undoTagEvent,
} from "../src/coding-service.ts";
import {
  readCompletionCount,
  readDocumentCoding,
  readDocumentCodingHistory,
  readFamilyConflictFamilyIds,
  readTagCounts,
  readTagEventPage,
  readUncodedDocumentIds,
} from "../src/coding-statements.ts";
import type { ReviewTagSemantic } from "../src/types.ts";
import { DiscoveryValidationError } from "../src/validation.ts";
import {
  ATTACHMENT_DOCUMENT,
  commit,
  migratedDatabase,
  outsiderAccess,
  PARENT_DOCUMENT,
  REVIEW_SET,
  reviewerAccess,
  serviceOptions,
  STANDALONE_DOCUMENT,
  WALLED_DOCUMENT,
} from "./support.ts";

// The coding model, exercised against a real migrated database rather than a mock — the rules that
// matter here (the two partial unique indexes, the removal CHECK, the undo predicates) live in SQL,
// and a mock would assert the service's opinion of them instead of them.

async function panelFor(database: ReturnType<typeof migratedDatabase>["database"]) {
  const panel = await readCodingPanel(database, REVIEW_SET, reviewerAccess);
  const tagBySemantic = (semantic: ReviewTagSemantic): ReviewTagId => {
    const tag = panel.tags.find((candidate) => candidate.semantic === semantic);
    if (tag === undefined) throw new Error(`no seeded tag carries the ${semantic} meaning`);
    return tag.id;
  };
  return { panel, tagBySemantic };
}

async function seededDatabase() {
  const created = migratedDatabase();
  await commit(created.database, seedCodingPanel(created.database, REVIEW_SET, serviceOptions()));
  return created;
}

describe("the seeded coding panel", () => {
  it("gives every review set three system groups whose semantics the machine reads", async () => {
    const { database } = await seededDatabase();
    const { panel } = await panelFor(database);
    expect(panel.groups.map((group) => group.name)).toEqual([
      "Responsiveness",
      "Privilege",
      "Confidentiality",
    ]);
    expect(panel.groups.every((group) => group.kind === "system")).toBe(true);
    // Exactly one group is required for completion, and it is the one production membership is drawn
    // from. If that ever changes silently, the progress figure changes meaning.
    expect(
      panel.groups.filter((group) => group.required_for_completion === 1).map((g) => g.name),
    ).toEqual(["Responsiveness"]);
    for (const semantic of ["responsive", "privileged", "privileged-redact"] as const) {
      expect(panel.tags.some((tag) => tag.semantic === semantic)).toBe(true);
    }
  });

  it("is absent to a member who is not on the review set's access list", async () => {
    const { database } = await seededDatabase();
    const walled = await readCodingPanel(database, REVIEW_SET, outsiderAccess);
    // ABSENT, not refused: no groups, no tags, nothing that names the corpus.
    expect(walled.groups).toEqual([]);
    expect(walled.tags).toEqual([]);
  });
});

describe("applying a tag", () => {
  it("writes one row and one event, and the row points back at the act", async () => {
    const { database } = await seededDatabase();
    const { tagBySemantic } = await panelFor(database);
    const result = await applyTag(
      database,
      {
        reviewSetId: REVIEW_SET,
        reviewDocumentId: STANDALONE_DOCUMENT,
        reviewTagId: tagBySemantic("responsive"),
        scope: "document",
      },
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, result.effect);

    const coding = await readDocumentCoding(database, STANDALONE_DOCUMENT, reviewerAccess, 50);
    expect(coding).toHaveLength(1);
    expect(coding[0]?.applied_by_event_id).toBe(result.reviewTagEventId);
    expect(coding[0]?.removed_at).toBeNull();

    const journal = (await readTagEventPage(database, REVIEW_SET, reviewerAccess, 50)).data;
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ kind: "apply", scope: "document", document_count: 1 });
  });

  it("changing a single-choice answer closes the old row rather than deleting it", async () => {
    const { database } = await seededDatabase();
    const { tagBySemantic } = await panelFor(database);
    for (const semantic of ["responsive", "non-responsive"] as const) {
      const result = await applyTag(
        database,
        {
          reviewSetId: REVIEW_SET,
          reviewDocumentId: STANDALONE_DOCUMENT,
          reviewTagId: tagBySemantic(semantic),
          scope: "document",
        },
        reviewerAccess,
        serviceOptions(),
      );
      await commit(database, result.effect);
    }

    // ONE live answer — the partial unique index is what makes "both responsive and non-responsive"
    // structurally unwritable rather than merely unwritten.
    const live = await readDocumentCoding(database, STANDALONE_DOCUMENT, reviewerAccess, 50);
    expect(live).toHaveLength(1);

    // And the superseded answer is still there, with an actor and an instant on its removal.
    const history = await readDocumentCodingHistory(
      database,
      STANDALONE_DOCUMENT,
      reviewerAccess,
      50,
    );
    expect(history).toHaveLength(2);
    const removed = history.filter((row) => row.removed_at !== null);
    expect(removed).toHaveLength(1);
    expect(removed[0]?.removed_by_event_id).not.toBeNull();
  });

  it("a family gesture writes a row per family member, never an inherited one", async () => {
    const { database } = await seededDatabase();
    const { tagBySemantic } = await panelFor(database);
    const result = await applyTag(
      database,
      {
        reviewSetId: REVIEW_SET,
        reviewDocumentId: ATTACHMENT_DOCUMENT,
        reviewTagId: tagBySemantic("responsive"),
        scope: "family",
      },
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, result.effect);

    expect(result.documentCount).toBe(2);
    // Rows on BOTH members. A production reads rows and only rows, so there is no inheritance rule
    // for an inheritance bug to live in.
    for (const documentId of [PARENT_DOCUMENT, ATTACHMENT_DOCUMENT]) {
      expect(await readDocumentCoding(database, documentId, reviewerAccess, 50)).toHaveLength(1);
    }
    // ...and none on the document outside the family.
    expect(await readDocumentCoding(database, STANDALONE_DOCUMENT, reviewerAccess, 50)).toEqual([]);
  });

  it("refuses a document in a review set the member is not on the list for", async () => {
    const { database } = await seededDatabase();
    const { tagBySemantic } = await panelFor(database);
    await expect(
      applyTag(
        database,
        {
          reviewSetId: REVIEW_SET,
          reviewDocumentId: WALLED_DOCUMENT,
          reviewTagId: tagBySemantic("responsive"),
          scope: "document",
        },
        reviewerAccess,
        serviceOptions(),
      ),
    ).rejects.toThrow(DiscoveryValidationError);
  });

  it("writes nothing at all for a member who is on no list", async () => {
    const { database } = await seededDatabase();
    const { tagBySemantic } = await panelFor(database);
    // The outsider cannot even resolve the tag, which is the first place the wall bites.
    await expect(
      applyTag(
        database,
        {
          reviewSetId: REVIEW_SET,
          reviewDocumentId: STANDALONE_DOCUMENT,
          reviewTagId: tagBySemantic("responsive"),
          scope: "document",
        },
        outsiderAccess,
        serviceOptions(),
      ),
    ).rejects.toThrow(DiscoveryValidationError);
    expect(await readDocumentCoding(database, STANDALONE_DOCUMENT, reviewerAccess, 50)).toEqual([]);
  });
});

describe("removing a tag", () => {
  it("is a state with an actor and an instant, never a deletion", async () => {
    const { database } = await seededDatabase();
    const { tagBySemantic } = await panelFor(database);
    const responsive = tagBySemantic("responsive");
    const applied = await applyTag(
      database,
      {
        reviewSetId: REVIEW_SET,
        reviewDocumentId: STANDALONE_DOCUMENT,
        reviewTagId: responsive,
        scope: "document",
      },
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, applied.effect);
    const removed = await removeTag(
      database,
      {
        reviewSetId: REVIEW_SET,
        reviewDocumentId: STANDALONE_DOCUMENT,
        reviewTagId: responsive,
        scope: "document",
      },
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, removed.effect);

    expect(await readDocumentCoding(database, STANDALONE_DOCUMENT, reviewerAccess, 50)).toEqual([]);
    const history = await readDocumentCodingHistory(
      database,
      STANDALONE_DOCUMENT,
      reviewerAccess,
      50,
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.removed_by_event_id).toBe(removed.reviewTagEventId);
  });
});

describe("bulk coding over a frozen selection", () => {
  it("freezes the selection, chunks it, and completes the event", async () => {
    const { database } = await seededDatabase();
    const { tagBySemantic } = await panelFor(database);
    const responsive = tagBySemantic("responsive");
    const plan = await planBulkCoding(
      database,
      {
        reviewSetId: REVIEW_SET,
        reviewTagId: responsive,
        reviewDocumentIds: [PARENT_DOCUMENT, ATTACHMENT_DOCUMENT, STANDALONE_DOCUMENT],
        kind: "bulk-apply",
        criteria: JSON.stringify({ field: "recordCustodianId" }),
      },
      reviewerAccess,
      serviceOptions(),
    );
    expect(plan.documentIds).toHaveLength(3);
    // The key is derived and recorded on the event, so "which documents did that act touch" survives
    // the review set closing.
    expect(plan.selectionR2Key).toBe(
      `discovery/${REVIEW_SET}/selections/${plan.reviewTagEventId}.json`,
    );

    await commit(database, plan.openEffect);
    let written = 0;
    for (const chunk of plan.chunks) {
      await commit(
        database,
        await buildBulkCodingChunk(
          database,
          plan,
          chunk,
          { reviewTagId: responsive, kind: "bulk-apply" },
          reviewerAccess,
          serviceOptions(),
        ),
      );
      written += chunk.length;
    }
    await commit(database, completeBulkCoding(database, plan, written, serviceOptions()));

    const journal = (await readTagEventPage(database, REVIEW_SET, reviewerAccess, 50)).data;
    expect(journal[0]).toMatchObject({
      kind: "bulk-apply",
      scope: "selection",
      state: "complete",
      document_count: 3,
      selection_r2_key: plan.selectionR2Key,
    });
    for (const documentId of [PARENT_DOCUMENT, ATTACHMENT_DOCUMENT, STANDALONE_DOCUMENT]) {
      expect(await readDocumentCoding(database, documentId, reviewerAccess, 50)).toHaveLength(1);
    }
  });

  it("drops a document from another corpus out of the selection rather than naming it", async () => {
    const { database } = await seededDatabase();
    const { tagBySemantic } = await panelFor(database);
    const plan = await planBulkCoding(
      database,
      {
        reviewSetId: REVIEW_SET,
        reviewTagId: tagBySemantic("responsive"),
        reviewDocumentIds: [STANDALONE_DOCUMENT, WALLED_DOCUMENT],
        kind: "bulk-apply",
        criteria: null,
      },
      reviewerAccess,
      serviceOptions(),
    );
    // The walled document VANISHES. Refusing it by name would confirm the id exists to somebody who
    // cannot see it.
    expect(plan.documentIds).toEqual([STANDALONE_DOCUMENT]);
  });
});

describe("undo", () => {
  it("removes exactly the rows the undone act wrote, and leaves another act's row alone", async () => {
    const { database } = await seededDatabase();
    const { tagBySemantic } = await panelFor(database);

    const bulk = await planBulkCoding(
      database,
      {
        reviewSetId: REVIEW_SET,
        reviewTagId: tagBySemantic("responsive"),
        reviewDocumentIds: [PARENT_DOCUMENT, STANDALONE_DOCUMENT],
        kind: "bulk-apply",
        criteria: null,
      },
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, bulk.openEffect);
    for (const chunk of bulk.chunks) {
      await commit(
        database,
        await buildBulkCodingChunk(
          database,
          bulk,
          chunk,
          { reviewTagId: tagBySemantic("responsive"), kind: "bulk-apply" },
          reviewerAccess,
          serviceOptions(),
        ),
      );
    }
    await commit(database, completeBulkCoding(database, bulk, 2, serviceOptions()));

    // A SECOND, INDEPENDENT act on one of the same documents, in a different group.
    const independent = await applyTag(
      database,
      {
        reviewSetId: REVIEW_SET,
        reviewDocumentId: STANDALONE_DOCUMENT,
        reviewTagId: tagBySemantic("privileged"),
        scope: "document",
      },
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, independent.effect);

    const undo = await undoTagEvent(
      database,
      bulk.reviewTagEventId,
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, undo.effect);

    // The bulk's rows are gone from the live read...
    expect(await readDocumentCoding(database, PARENT_DOCUMENT, reviewerAccess, 50)).toEqual([]);
    // ...and the independent act's row is untouched, because it has its own row and its own event.
    const standalone = await readDocumentCoding(database, STANDALONE_DOCUMENT, reviewerAccess, 50);
    expect(standalone).toHaveLength(1);
    expect(standalone[0]?.applied_by_event_id).toBe(independent.reviewTagEventId);

    // History never shortens: the undone act stays in the journal, pointing at its reversal.
    const journal = (await readTagEventPage(database, REVIEW_SET, reviewerAccess, 50)).data;
    const undone = journal.find((event) => event.id === bulk.reviewTagEventId);
    expect(undone?.state).toBe("undone");
    const reversal = journal.find((event) => event.kind === "undo");
    expect(reversal?.reverses_event_id).toBe(bulk.reviewTagEventId);
  });

  it("undoing a remove re-applies, restoring the original attribution", async () => {
    const { database } = await seededDatabase();
    const { tagBySemantic } = await panelFor(database);
    const responsive = tagBySemantic("responsive");
    const applied = await applyTag(
      database,
      {
        reviewSetId: REVIEW_SET,
        reviewDocumentId: STANDALONE_DOCUMENT,
        reviewTagId: responsive,
        scope: "document",
      },
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, applied.effect);
    const removed = await removeTag(
      database,
      {
        reviewSetId: REVIEW_SET,
        reviewDocumentId: STANDALONE_DOCUMENT,
        reviewTagId: responsive,
        scope: "document",
      },
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, removed.effect);
    const undo = await undoTagEvent(
      database,
      removed.reviewTagEventId,
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, undo.effect);

    const live = await readDocumentCoding(database, STANDALONE_DOCUMENT, reviewerAccess, 50);
    expect(live).toHaveLength(1);
    // The application really WAS made by the original act; the undo event is what says the removal
    // was taken back.
    expect(live[0]?.applied_by_event_id).toBe(applied.reviewTagEventId);
  });

  it("refuses to undo an undo, and refuses to undo the same act twice", async () => {
    const { database } = await seededDatabase();
    const { tagBySemantic } = await panelFor(database);
    const applied = await applyTag(
      database,
      {
        reviewSetId: REVIEW_SET,
        reviewDocumentId: STANDALONE_DOCUMENT,
        reviewTagId: tagBySemantic("responsive"),
        scope: "document",
      },
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, applied.effect);
    const undo = await undoTagEvent(
      database,
      applied.reviewTagEventId,
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, undo.effect);

    await expect(
      undoTagEvent(database, applied.reviewTagEventId, reviewerAccess, serviceOptions()),
    ).rejects.toThrow(/already been reversed/);
    await expect(
      undoTagEvent(database, undo.reviewTagEventId, reviewerAccess, serviceOptions()),
    ).rejects.toThrow(/not undone/);
  });
});

describe("progress and the quality-control reads", () => {
  it("counts a document complete once every required group has a live answer", async () => {
    const { database } = await seededDatabase();
    const { tagBySemantic } = await panelFor(database);
    expect(await readCompletionCount(database, REVIEW_SET, reviewerAccess)).toBe(0);
    expect(await readUncodedDocumentIds(database, REVIEW_SET, reviewerAccess, 50)).toHaveLength(3);

    const applied = await applyTag(
      database,
      {
        reviewSetId: REVIEW_SET,
        reviewDocumentId: STANDALONE_DOCUMENT,
        // Privilege is NOT required for completion, so answering it alone must not count.
        reviewTagId: tagBySemantic("privileged"),
        scope: "document",
      },
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, applied.effect);
    expect(await readCompletionCount(database, REVIEW_SET, reviewerAccess)).toBe(0);

    const responsive = await applyTag(
      database,
      {
        reviewSetId: REVIEW_SET,
        reviewDocumentId: STANDALONE_DOCUMENT,
        reviewTagId: tagBySemantic("responsive"),
        scope: "document",
      },
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, responsive.effect);
    expect(await readCompletionCount(database, REVIEW_SET, reviewerAccess)).toBe(1);
    expect(await readUncodedDocumentIds(database, REVIEW_SET, reviewerAccess, 50)).toHaveLength(2);
  });

  it("counts tags by semantics rather than by name", async () => {
    const { database } = await seededDatabase();
    const { tagBySemantic } = await panelFor(database);
    const responsive = tagBySemantic("responsive");
    const applied = await applyTag(
      database,
      {
        reviewSetId: REVIEW_SET,
        reviewDocumentId: ATTACHMENT_DOCUMENT,
        reviewTagId: responsive,
        scope: "family",
      },
      reviewerAccess,
      serviceOptions(),
    );
    await commit(database, applied.effect);
    const counts = await readTagCounts(database, REVIEW_SET, reviewerAccess, 50);
    expect(counts.find((count) => count.review_tag_id === responsive)?.document_count).toBe(2);
  });

  it("surfaces a family split across the produce/withhold line", async () => {
    const { database } = await seededDatabase();
    const { tagBySemantic } = await panelFor(database);
    expect(await readFamilyConflictFamilyIds(database, REVIEW_SET, reviewerAccess, 50)).toEqual([]);

    for (const [documentId, semantic] of [
      [PARENT_DOCUMENT, "responsive"],
      [ATTACHMENT_DOCUMENT, "privileged"],
    ] as const) {
      const applied = await applyTag(
        database,
        {
          reviewSetId: REVIEW_SET,
          reviewDocumentId: documentId,
          reviewTagId: tagBySemantic(semantic),
          scope: "document",
        },
        reviewerAccess,
        serviceOptions(),
      );
      await commit(database, applied.effect);
    }

    // One family, named once — a privileged attachment under a responsive parent is exactly the shape
    // that rides into a production if nobody looks.
    expect(await readFamilyConflictFamilyIds(database, REVIEW_SET, reviewerAccess, 50)).toEqual([
      PARENT_DOCUMENT,
    ]);
    // And absent to somebody who is not on the list.
    expect(await readFamilyConflictFamilyIds(database, REVIEW_SET, outsiderAccess, 50)).toEqual([]);
  });
});
