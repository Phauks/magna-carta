import { describe, expect, it } from "vitest";
import {
  RECORD_INDEX_MATCH_CONDITION,
  recordIdsMatchingSubquery,
  recordIndexLeadingFrom,
  recordMatchExpression,
} from "../src/record-index-query.ts";
import {
  optimizeRecordIndexStatement,
  readRecordIndexCounts,
  readRecordIndexPlaces,
  rebuildRecordIndexSourceStatements,
  selectRecordIndexPointersStatement,
} from "../src/record-index-statements.ts";
import { matterScopeToken } from "../src/record-index-schema.ts";
import { recordIndexSources } from "../src/record-index-sources.ts";
import {
  assertIndexConsistent,
  entries,
  find,
  MATTER,
  migratedDatabase,
  OTHER_MATTER,
  seedCommunication,
  seedConversation,
  seedCostEntry,
  seedEvent,
  seedNote,
  seedTask,
  seedTimeEntry,
  seedTurn,
} from "./record-index-support.ts";

// The index, exercised through a real database carrying the real migration: records are written to
// their own tables by plain statements, exactly as every domain package writes them, and the index
// is then asked what it holds. Nothing here calls the index when it writes — that is the property.

const NOTES = { sourceKeys: ["notes"] } as const;

describe("what a reader's text finds", () => {
  it("matches whole words, the last word as a prefix, in any case", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "The drainage EASEMENT was recorded." });

    expect(await find(database, "easement", NOTES)).toEqual(["note_1"]);
    expect(await find(database, "ease", NOTES)).toEqual(["note_1"]);
    expect(await find(database, "Drainage easem", NOTES)).toEqual(["note_1"]);
    // A finished word is not a prefix, and the middle of a word is not a word.
    expect(await find(database, "ease ", NOTES)).toEqual([]);
    expect(await find(database, "sement", NOTES)).toEqual([]);
    // Every word typed must be there.
    expect(await find(database, "drainage covenant", NOTES)).toEqual([]);
  });

  it("matches a quoted phrase as that run of words only", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "the drainage easement on lot four" });
    seedNote(raw, { id: "note_2", matterId: MATTER, body: "an easement for drainage on lot four" });

    expect(await find(database, '"drainage easement"', NOTES)).toEqual(["note_1"]);
    expect((await find(database, "drainage easement ", NOTES)).toSorted()).toEqual([
      "note_1",
      "note_2",
    ]);
  });

  it("folds accents, whichever way they were typed or stored", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "Sent her résumé to Mr. Peña." });
    // The same word stored as letter-then-accent pairs.
    seedNote(raw, { id: "note_2", matterId: MATTER, body: "Sent his résumé too." });

    expect((await find(database, "resume ", NOTES)).toSorted()).toEqual(["note_1", "note_2"]);
    expect((await find(database, "résumé ", NOTES)).toSorted()).toEqual(["note_1", "note_2"]);
    expect(await find(database, "pena", NOTES)).toEqual(["note_1"]);
  });

  it("matches a word with punctuation inside it as its pieces, adjacent and in order", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, {
      id: "note_1",
      matterId: MATTER,
      body: "Call with O'Brien about file 2026-0142.",
    });
    seedNote(raw, {
      id: "note_2",
      matterId: MATTER,
      body: "Brien said the O ring failed in 0142, 2026.",
    });

    expect(await find(database, "o'brien ", NOTES)).toEqual(["note_1"]);
    expect(await find(database, "2026-0142", NOTES)).toEqual(["note_1"]);
  });

  it("answers text that looks like the match language as plain words, never as an error", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, {
      id: "note_1",
      matterId: MATTER,
      body: "trust and estate planning, not litigation",
    });
    const hostile = [
      "trust AND estate",
      "trust NOT litigation",
      "NEAR(trust estate, 2)",
      "title: trust",
      'trust" OR "x',
      "trust*",
      "(trust",
      "'; DROP TABLE matter_note; --",
      '"',
      '""',
      "*",
    ];
    for (const text of hostile) {
      // Completing at all is the assertion: a stray quotation mark must not become a failed query.
      await find(database, text, NOTES);
    }
    // "NOT" is a word the reader typed, so the note that contains it still matches.
    expect(await find(database, "trust NOT litigation ", NOTES)).toEqual(["note_1"]);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM matter_note").get()).toEqual({ n: 1 });
  });
});

describe("what a question is narrowed to", () => {
  it("keeps one matter's records out of another's answer", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "easement survey ordered" });
    seedNote(raw, { id: "note_2", matterId: OTHER_MATTER, body: "easement survey received" });

    expect(await find(database, "easement", { ...NOTES, matter: MATTER })).toEqual(["note_1"]);
    expect(await find(database, "easement", { ...NOTES, matter: OTHER_MATTER })).toEqual([
      "note_2",
    ]);
    expect(await find(database, "easement", { ...NOTES, matter: "none" })).toEqual([]);
    expect((await find(database, "easement", NOTES)).toSorted()).toEqual(["note_1", "note_2"]);
  });

  it("keeps one source's records out of another's answer", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "easement survey ordered" });
    seedTimeEntry(raw, { id: "time_1", matterId: MATTER, narrative: "Reviewed easement survey" });

    expect(await find(database, "easement", { sourceKeys: ["time"] })).toEqual(["time_1"]);
    expect(
      (await find(database, "easement", { sourceKeys: ["notes", "time"] })).toSorted(),
    ).toEqual(["note_1", "time_1"]);
  });

  it("does not let a matter's scope token be found as a word", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "easement" });
    // The token that narrows a query lives in its own column, which a reader's words never search:
    // typing a matter's token must not be a way to list what is on that matter.
    expect(await find(database, matterScopeToken(MATTER), NOTES)).toEqual([]);
    seedTask(raw, { id: "task_1", matterId: null, title: "easement" });
    expect(await find(database, "nomatter", { sourceKeys: ["tasks"] })).toEqual([]);
  });

  it("finds a record on no matter only where the question allows one", async () => {
    const { database, raw } = migratedDatabase();
    seedCommunication(raw, {
      id: "comm_1",
      matterId: null,
      summary: "Voicemail about the easement",
    });
    const scope = { sourceKeys: ["communications"] } as const;

    expect(await find(database, "easement", { ...scope, matter: "none" })).toEqual(["comm_1"]);
    expect(await find(database, "easement", scope)).toEqual(["comm_1"]);
    expect(await find(database, "easement", { ...scope, matter: MATTER })).toEqual([]);
  });

  it("applies a caller's matter condition before the limit, and measures that there is more", async () => {
    const { database, raw } = migratedDatabase();
    for (let index = 0; index < 5; index += 1) {
      seedNote(raw, {
        id: `note_other_${String(index)}`,
        matterId: OTHER_MATTER,
        body: "easement",
      });
    }
    seedNote(raw, { id: "note_a", matterId: MATTER, body: "easement", occurredOn: "2026-07-01" });
    seedNote(raw, { id: "note_b", matterId: MATTER, body: "easement", occurredOn: "2026-07-09" });

    const statement = selectRecordIndexPointersStatement({
      database,
      text: "easement",
      scope: NOTES,
      matterCondition: { fragment: "record_text_entry.matter_id = ?", bindings: [MATTER] },
      limit: 1,
    });
    const { results } = await statement!.all<{ record_id: string; matter_id: string }>();
    // One wanted, one more read; both from the permitted matter, most recent first among equals.
    expect(results.map((row) => row.record_id)).toEqual(["note_b", "note_a"]);
  });
});

describe("how the index follows a record", () => {
  it("indexes every declared source from a plain insert into its own table", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "quitclaim one" });
    seedTimeEntry(raw, { id: "time_1", matterId: MATTER, narrative: "quitclaim two" });
    seedCostEntry(raw, { id: "cost_1", matterId: MATTER, description: "quitclaim recording fee" });
    seedEvent(raw, { id: "event_1", matterId: MATTER, title: "Hearing", description: "quitclaim" });
    seedCommunication(raw, {
      id: "comm_1",
      matterId: MATTER,
      summary: "Left a message",
      body: "about the quitclaim",
      callerIdName: "HERRERA MARIA",
    });
    seedTask(raw, { id: "task_1", matterId: MATTER, title: "Draft the quitclaim deed" });
    seedConversation(raw, { id: "conv_1", matterId: MATTER, title: "Quitclaim questions" });
    seedTurn(raw, {
      id: "turn_1",
      conversationId: "conv_1",
      sequence: 1,
      content: "Is a quitclaim enough?",
    });

    const everySource = {
      sourceKeys: recordIndexSources.map((source) => source.key),
      matter: MATTER,
    };
    expect((await find(database, "quitclaim", everySource)).toSorted()).toEqual([
      "comm_1",
      "conv_1",
      "cost_1",
      "event_1",
      "note_1",
      "task_1",
      "time_1",
      "turn_1",
    ]);
    // The caller's name is searchable beside the summary.
    expect(await find(database, "herrera", { sourceKeys: ["communications"] })).toEqual(["comm_1"]);
    expect(await readRecordIndexCounts(database)).toEqual(
      recordIndexSources.map((source) => ({
        sourceKey: source.key,
        label: source.label,
        matchedFields: source.matchedFields,
        indexed: 1,
      })),
    );
    assertIndexConsistent(raw);
  });

  it("says how many records each place should hold, counted from the records themselves", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "the covenant runs with the land" });
    seedNote(raw, { id: "note_2", matterId: MATTER, body: "a second note" });
    // A record with no words is not indexed, and is not counted as one that should be.
    seedNote(raw, { id: "note_blank", matterId: MATTER, body: "   " });
    seedConversation(raw, { id: "conv_1", matterId: MATTER, title: "Covenant questions" });
    seedTurn(raw, { id: "turn_1", conversationId: "conv_1", sequence: 1, content: "Does it run?" });

    const places = await readRecordIndexPlaces(database);

    expect(places.map((place) => place.sourceKey)).toEqual(
      recordIndexSources.map((source) => source.key),
    );
    const byKey = new Map(places.map((place) => [place.sourceKey, place]));
    expect(byKey.get("notes")).toMatchObject({
      indexed: 2,
      expected: 2,
      readBy: ["matter-search"],
    });
    expect(byKey.get("magnus-turns")).toMatchObject({ indexed: 1, expected: 1 });
    expect(byKey.get("time")).toMatchObject({ indexed: 0, expected: 0 });
  });

  it("shows an index that has fallen behind its records, which a rebuild repairs", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "the covenant runs with the land" });
    seedNote(raw, { id: "note_2", matterId: MATTER, body: "a second note" });
    // Something no write path does: an index row removed behind the record's back.
    raw.exec(
      "DELETE FROM record_text_fts WHERE rowid IN (SELECT id FROM record_text_entry WHERE record_id = 'note_2')",
    );
    raw.exec("DELETE FROM record_text_entry WHERE record_id = 'note_2'");

    const behind = (await readRecordIndexPlaces(database)).find(
      (place) => place.sourceKey === "notes",
    );
    expect(behind).toMatchObject({ indexed: 1, expected: 2 });

    for (const statement of rebuildRecordIndexSourceStatements(database, "notes")) {
      await statement.run();
    }
    const repaired = (await readRecordIndexPlaces(database)).find(
      (place) => place.sourceKey === "notes",
    );
    expect(repaired).toMatchObject({ indexed: 2, expected: 2 });
    assertIndexConsistent(raw);
  });

  it("forgets the old words when a record is edited", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "the covenant runs with the land" });
    raw.exec(`UPDATE matter_note SET body = 'the easement is appurtenant' WHERE id = 'note_1'`);

    expect(await find(database, "covenant", NOTES)).toEqual([]);
    expect(await find(database, "easement", NOTES)).toEqual(["note_1"]);
    expect(entries(raw)).toHaveLength(1);
    assertIndexConsistent(raw);
  });

  it("moves a record to its new matter when it is refiled", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "easement" });
    raw.exec(`UPDATE matter_note SET matter_id = '${OTHER_MATTER}' WHERE id = 'note_1'`);

    expect(await find(database, "easement", { ...NOTES, matter: MATTER })).toEqual([]);
    expect(await find(database, "easement", { ...NOTES, matter: OTHER_MATTER })).toEqual([
      "note_1",
    ]);
    assertIndexConsistent(raw);
  });

  it("forgets a record that is deleted", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "easement" });
    raw.exec(`DELETE FROM matter_note WHERE id = 'note_1'`);

    expect(await find(database, "easement", NOTES)).toEqual([]);
    expect(entries(raw)).toEqual([]);
    assertIndexConsistent(raw);
  });

  // A replacing insert deletes the old row WITHOUT firing its delete trigger. If the insert trigger
  // assumed the index held nothing for the row, the replaced words would stay findable.
  it("forgets a replaced row's words when a row is written over", async () => {
    const { database, raw } = migratedDatabase();
    seedTask(raw, { id: "task_1", matterId: null, title: "Serve the covenant notice" });
    raw.exec(
      `INSERT OR REPLACE INTO matter_task (id, matter_id, title, created_by, created_at, updated_at) ` +
        `VALUES ('task_1', NULL, 'Serve the easement notice', 'user_x', '2026-08-02', '2026-08-02')`,
    );
    const scope = { sourceKeys: ["tasks"] } as const;

    expect(await find(database, "covenant", scope)).toEqual([]);
    expect(await find(database, "easement", scope)).toEqual(["task_1"]);
    expect(entries(raw)).toHaveLength(1);
    assertIndexConsistent(raw);
  });

  it("follows an upsert down either of its paths", async () => {
    const { database, raw } = migratedDatabase();
    const upsert = (title: string): void => {
      raw.exec(
        `INSERT INTO matter_task (id, matter_id, title, created_by, created_at, updated_at) ` +
          `VALUES ('task_1', NULL, '${title}', 'user_x', '2026-08-02', '2026-08-02') ` +
          `ON CONFLICT (id) DO UPDATE SET title = excluded.title`,
      );
    };
    upsert("covenant");
    upsert("easement");
    const scope = { sourceKeys: ["tasks"] } as const;

    expect(await find(database, "covenant", scope)).toEqual([]);
    expect(await find(database, "easement", scope)).toEqual(["task_1"]);
    assertIndexConsistent(raw);
  });

  it("leaves the index alone when a write changes nothing it reads", async () => {
    const { raw } = migratedDatabase();
    seedTimeEntry(raw, { id: "time_1", matterId: MATTER, narrative: "Reviewed the survey" });
    const before = raw.prepare("SELECT id FROM record_text_entry").get();
    raw.exec(
      `UPDATE time_entry SET status = 'submitted', updated_at = 'later' WHERE id = 'time_1'`,
    );

    // The same entry row, not a fresh one: the status change did not re-index the narrative.
    expect(raw.prepare("SELECT id FROM record_text_entry").get()).toEqual(before);
  });

  it("does not index a record with no words, and indexes it once it has some", async () => {
    const { database, raw } = migratedDatabase();
    seedCostEntry(raw, { id: "cost_1", matterId: MATTER, description: "" });
    seedCommunication(raw, { id: "comm_1", matterId: MATTER });
    expect(entries(raw)).toEqual([]);

    raw.exec(`UPDATE cost_entry SET description = 'filing fee' WHERE id = 'cost_1'`);
    expect(await find(database, "filing", { sourceKeys: ["costs"] })).toEqual(["cost_1"]);

    raw.exec(`UPDATE cost_entry SET description = '   ' WHERE id = 'cost_1'`);
    expect(entries(raw)).toEqual([]);
    assertIndexConsistent(raw);
  });

  it("matches a title and a body as one record", async () => {
    const { database, raw } = migratedDatabase();
    seedEvent(raw, {
      id: "event_1",
      matterId: MATTER,
      title: "Hearing",
      description: "on the easement",
    });
    // One word from each column.
    expect(await find(database, "hearing easement", { sourceKeys: ["calendar"] })).toEqual([
      "event_1",
    ]);
  });
});

describe("how the index follows a Magnus conversation", () => {
  const TURNS = { sourceKeys: ["magnus-turns"] } as const;
  const CONVERSATIONS = { sourceKeys: ["magnus-conversations"] } as const;

  it("indexes a turn only once it is complete, and points at its conversation", async () => {
    const { database, raw } = migratedDatabase();
    seedConversation(raw, { id: "conv_1", matterId: MATTER });
    seedTurn(raw, {
      id: "turn_1",
      conversationId: "conv_1",
      sequence: 1,
      content: null,
      status: "pending",
    });
    expect(entries(raw)).toEqual([]);

    raw.exec(
      `UPDATE magnus_turn SET content = 'An easement by necessity', status = 'complete' WHERE id = 'turn_1'`,
    );
    expect(await find(database, "necessity", { ...TURNS, matter: MATTER })).toEqual(["turn_1"]);
    expect(entries(raw)).toEqual([
      {
        source: "magnus-turns",
        record_id: "turn_1",
        container_id: "conv_1",
        matter_id: MATTER,
        sort_key: "2026-08-01T09:00:00.000Z",
      },
    ]);
  });

  it("does not index a failed or refused turn", async () => {
    const { raw } = migratedDatabase();
    seedConversation(raw, { id: "conv_1", matterId: null });
    seedTurn(raw, {
      id: "turn_1",
      conversationId: "conv_1",
      sequence: 1,
      content: "x",
      status: "failed",
    });
    seedTurn(raw, {
      id: "turn_2",
      conversationId: "conv_1",
      sequence: 2,
      content: "y",
      status: "refused",
    });
    expect(entries(raw)).toEqual([]);
  });

  it("moves every turn when the conversation is filed on a matter", async () => {
    const { database, raw } = migratedDatabase();
    seedConversation(raw, { id: "conv_1", matterId: null, title: "Easement research" });
    seedTurn(raw, { id: "turn_1", conversationId: "conv_1", sequence: 1, content: "easement one" });
    seedTurn(raw, { id: "turn_2", conversationId: "conv_1", sequence: 2, content: "easement two" });
    seedConversation(raw, { id: "conv_2", matterId: null });
    seedTurn(raw, {
      id: "turn_3",
      conversationId: "conv_2",
      sequence: 1,
      content: "easement three",
    });

    expect((await find(database, "easement", { ...TURNS, matter: "none" })).toSorted()).toEqual([
      "turn_1",
      "turn_2",
      "turn_3",
    ]);
    raw.exec(`UPDATE magnus_conversation SET matter_id = '${MATTER}' WHERE id = 'conv_1'`);

    expect((await find(database, "easement", { ...TURNS, matter: MATTER })).toSorted()).toEqual([
      "turn_1",
      "turn_2",
    ]);
    // The other conversation's turn stays where it was.
    expect(await find(database, "easement", { ...TURNS, matter: "none" })).toEqual(["turn_3"]);
    expect(await find(database, "easement", { ...CONVERSATIONS, matter: MATTER })).toEqual([
      "conv_1",
    ]);
    assertIndexConsistent(raw);
  });

  it("takes a deleted conversation and its turns out, and puts them back if it is restored", async () => {
    const { database, raw } = migratedDatabase();
    seedConversation(raw, { id: "conv_1", matterId: MATTER, title: "Easement research" });
    seedTurn(raw, { id: "turn_1", conversationId: "conv_1", sequence: 1, content: "easement one" });

    raw.exec(
      `UPDATE magnus_conversation SET state = 'deleted', deleted_at = '2026-08-02T00:00:00.000Z' WHERE id = 'conv_1'`,
    );
    expect(entries(raw)).toEqual([]);
    // A turn settling inside a deleted conversation stays out.
    seedTurn(raw, { id: "turn_2", conversationId: "conv_1", sequence: 2, content: "easement two" });
    expect(entries(raw)).toEqual([]);

    raw.exec(
      `UPDATE magnus_conversation SET state = 'active', deleted_at = NULL WHERE id = 'conv_1'`,
    );
    expect((await find(database, "easement", TURNS)).toSorted()).toEqual(["turn_1", "turn_2"]);
    expect(await find(database, "easement", CONVERSATIONS)).toEqual(["conv_1"]);
    assertIndexConsistent(raw);
  });

  it("forgets the turns of a conversation that is removed outright", async () => {
    const { raw } = migratedDatabase();
    seedConversation(raw, { id: "conv_1", matterId: MATTER, title: "Easement research" });
    seedTurn(raw, { id: "turn_1", conversationId: "conv_1", sequence: 1, content: "easement one" });
    raw.exec(`DELETE FROM magnus_turn WHERE conversation_id = 'conv_1'`);
    raw.exec(`DELETE FROM magnus_conversation WHERE id = 'conv_1'`);

    expect(entries(raw)).toEqual([]);
    assertIndexConsistent(raw);
  });
});

describe("rebuilding a source", () => {
  it("arrives at exactly what the triggers had written", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "easement", occurredOn: "2026-07-04" });
    seedNote(raw, { id: "note_2", matterId: OTHER_MATTER, body: "covenant" });
    seedConversation(raw, { id: "conv_1", matterId: MATTER });
    seedTurn(raw, { id: "turn_1", conversationId: "conv_1", sequence: 1, content: "easement" });
    seedTurn(raw, {
      id: "turn_2",
      conversationId: "conv_1",
      sequence: 2,
      content: null,
      status: "pending",
    });
    const written = entries(raw);

    for (const source of recordIndexSources) {
      for (const statement of rebuildRecordIndexSourceStatements(database, source.key)) {
        await statement.run();
      }
    }
    expect(entries(raw)).toEqual(written);
    expect(await find(database, "easement", { ...NOTES, matter: MATTER })).toEqual(["note_1"]);
    assertIndexConsistent(raw);
  });

  it("restores a source whose index rows were lost, and touches no other source", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "easement" });
    seedTask(raw, { id: "task_1", matterId: MATTER, title: "easement" });
    const taskEntry = raw.prepare("SELECT id FROM record_text_entry WHERE source = 'tasks'").get();
    raw.exec(
      `DELETE FROM record_text_fts WHERE rowid IN (SELECT id FROM record_text_entry WHERE source = 'notes')`,
    );
    raw.exec(`DELETE FROM record_text_entry WHERE source = 'notes'`);
    expect(await find(database, "easement", NOTES)).toEqual([]);

    for (const statement of rebuildRecordIndexSourceStatements(database, "notes")) {
      await statement.run();
    }
    expect(await find(database, "easement", NOTES)).toEqual(["note_1"]);
    expect(raw.prepare("SELECT id FROM record_text_entry WHERE source = 'tasks'").get()).toEqual(
      taskEntry,
    );
    assertIndexConsistent(raw);
  });
});

describe("finishing an erasure", () => {
  // A deleted record's terms are unreachable at once, and linger on the storage pages behind a
  // marker until the index reorganizes. The optimize statement is what removes them outright.
  it("leaves none of a deleted record's terms in the index's storage", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "the zyzzogeton memorandum" });
    seedNote(raw, { id: "note_2", matterId: MATTER, body: "an ordinary easement note" });
    raw.exec(`DELETE FROM matter_note WHERE id = 'note_1'`);
    expect(await find(database, "zyzzogeton", NOTES)).toEqual([]);

    await optimizeRecordIndexStatement(database).run();

    const stored = raw.prepare("SELECT block FROM record_text_fts_data").all() as {
      block: Uint8Array;
    }[];
    const bytes = stored.map((row) => Buffer.from(row.block).toString("latin1")).join("\n");
    expect(bytes).not.toContain("zyzzogeton");
    // Not vacuous: the surviving record's terms are stored where the erased one's would be.
    expect(bytes).toContain("easement");
    expect(await find(database, "easement", NOTES)).toEqual(["note_2"]);
    assertIndexConsistent(raw);
  });
});

describe("composing the index into a consumer's own statement", () => {
  it("leads with the index and returns only the consumer's rows within the matter it binds", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "easement survey" });
    seedNote(raw, { id: "note_2", matterId: MATTER, body: "covenant review" });
    seedNote(raw, { id: "note_3", matterId: OTHER_MATTER, body: "easement survey" });
    // Another source's record carrying the same words on the same matter.
    seedTask(raw, { id: "task_1", matterId: MATTER, title: "easement survey" });

    const sql =
      `SELECT matter_note.id AS id FROM ${recordIndexLeadingFrom("notes", "matter_note")} ` +
      `WHERE matter_note.matter_id = ? AND ${RECORD_INDEX_MATCH_CONDITION}`;
    const { results } = await database
      .prepare(sql)
      .bind(MATTER, recordMatchExpression("easement", { sourceKeys: ["notes"], matter: MATTER }))
      .all<{ id: string }>();
    expect(results).toEqual([{ id: "note_1" }]);

    // The index is visited first, and each table after it by key: the work follows the matches.
    const plan = (
      raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(MATTER, "x") as { detail: string }[]
    ).map((row) => row.detail);
    expect(plan[0]).toMatch(/^SCAN record_text_fts VIRTUAL TABLE INDEX \d+:M/u);
    expect(plan[1]).toMatch(/^SEARCH record_text_entry USING INTEGER PRIMARY KEY/u);
    expect(plan[2]).toMatch(/^SEARCH matter_note USING INDEX \S+ \(id=\?\)/u);
  });

  // The shape every matter-scoped consumer uses: the statement still reads its own table and binds
  // its own matter; the index only proposes candidates.
  it("returns the consumer's rows that match, and only within the matter it binds", async () => {
    const { database, raw } = migratedDatabase();
    seedNote(raw, { id: "note_1", matterId: MATTER, body: "easement survey" });
    seedNote(raw, { id: "note_2", matterId: MATTER, body: "covenant review" });
    seedNote(raw, { id: "note_3", matterId: OTHER_MATTER, body: "easement survey" });

    const { results } = await database
      .prepare(
        `SELECT matter_note.id AS id FROM matter_note WHERE matter_note.matter_id = ? ` +
          `AND matter_note.id IN (${recordIdsMatchingSubquery("notes")})`,
      )
      .bind(MATTER, recordMatchExpression("easement", { sourceKeys: ["notes"], matter: MATTER }))
      .all<{ id: string }>();
    expect(results).toEqual([{ id: "note_1" }]);
  });
});
