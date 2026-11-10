import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createOrganization } from "@magna-carta/directory/organization";
import { createPerson } from "@magna-carta/directory/person";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, test } from "vitest";
import {
  NAME_RESULT_CEILING,
  NO_PLACES,
  readFoundIn,
  readPartyNeedles,
  readPlacesRequest,
  resolveFoundIns,
  searchContent,
  type PlacesRequest,
} from "../src/content-search.ts";

// The firm's own records as a place a check looks: calls, texts, email, tasks and Magnus
// conversations, over a real migrated per-firm database. Each test seeds the rows it needs through
// the raw handle, because the subsystems that own them are not this package's to drive.

const NOW = "2026-11-10T00:00:00.000Z";
const ACTOR = "user_actor" as UserId;
const ALL: PlacesRequest = {
  messaging: ["calls", "texts", "email"],
  tasks: ["consultations", "open", "closed", "archived"],
  magnus: true,
  files: [],
};

async function corpus() {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Actor', 'active', '${NOW}')`,
  );
  const insertMatter = (id: string, status: string, number: string | null) =>
    raw.exec(
      `INSERT INTO matter (id, title, status, responsible_member_id, matter_number, created_at, updated_at)
       VALUES ('${id}', 'Matter ${id}', '${status}', '${ACTOR}', ${number === null ? "NULL" : `'${number}'`}, '${NOW}', '${NOW}')`,
    );
  insertMatter("matter_open", "open", "2026-0001");
  insertMatter("matter_consult", "consultation", null);
  insertMatter("matter_closed", "closed", "2025-0099");
  const batch = database as unknown as BatchDatabase;
  const options = {
    clock: { now: () => NOW },
    actorUserId: ACTOR,
    randomSource: seededRandomSource("content"),
  };
  const dana = await createPerson(batch, { given: "Dana", family: "Whitfield" }, options);
  const acme = await createOrganization(batch, { legalName: "Acme Holdings LLC" }, options);
  raw.exec(
    `INSERT INTO directory_email (id, entity_id, address, normalized_address, created_at, updated_at)
     VALUES ('directoryEmail_1', '${dana}', 'Dana@Example.com', 'dana@example.com', '${NOW}', '${NOW}')`,
  );
  raw.exec(
    `INSERT INTO directory_phone (id, entity_id, number, national_number, created_at, updated_at)
     VALUES ('directoryPhone_1', '${dana}', '+1 702 555 0143', '7025550143', '${NOW}', '${NOW}')`,
  );
  return { database: batch, raw, dana, acme };
}

function communication(
  raw: { exec(sql: string): void },
  id: string,
  fields: Partial<
    Record<
      | "channel"
      | "counterparty_number"
      | "counterparty_entity_id"
      | "body"
      | "summary"
      | "matter_id",
      string
    >
  >,
): void {
  const row = {
    channel: "voice",
    counterparty_number: "(800) 555-0100",
    counterparty_entity_id: null as string | null,
    body: null as string | null,
    summary: null as string | null,
    matter_id: null as string | null,
    ...fields,
  };
  const value = (entry: string | null) =>
    entry === null ? "NULL" : `'${entry.replaceAll("'", "''")}'`;
  raw.exec(
    `INSERT INTO communication (id, channel, direction, counterparty_number, counterparty_entity_id, body, summary, matter_id, occurred_at, producer, logged_by_user_id, created_at, updated_at)
     VALUES ('${id}', ${value(row.channel)}, 'inbound', ${value(row.counterparty_number)}, ${value(row.counterparty_entity_id)}, ${value(row.body)}, ${value(row.summary)}, ${value(row.matter_id)}, '${NOW}', 'member', '${ACTOR}', '${NOW}', '${NOW}')`,
  );
}

describe("what a party is looked for by", () => {
  test("a person's names, an organization's names, and the person's address and number", async () => {
    const { database, dana, acme } = await corpus();
    const needles = await readPartyNeedles(database, [dana, acme], null);
    const byId = new Map(needles.map((needle) => [needle.entityId, needle]));
    expect(byId.get(dana)?.names).toContain("Dana Whitfield");
    expect(byId.get(dana)?.emails).toEqual(["dana@example.com"]);
    expect(byId.get(dana)?.phoneDigits).toEqual(["7025550143"]);
    expect(byId.get(acme)?.names).toContain("Acme Holdings LLC");
  });
});

describe("calls and texts", () => {
  test("finds a call by its linked record and by its number, typed however a member typed it", async () => {
    const { database, raw, dana } = await corpus();
    communication(raw, "communication_linked", { counterparty_entity_id: dana });
    communication(raw, "communication_number", { counterparty_number: "(702) 555-0143" });
    communication(raw, "communication_other", { counterparty_number: "(702) 555-9999" });
    const needles = await readPartyNeedles(database, [dana], null);
    const hits = (await searchContent(database, needles, ALL)).hits;
    expect(hits.map((hit) => hit.foundIn.id).toSorted()).toEqual([
      "communication_linked",
      "communication_number",
    ]);
    expect(hits.every((hit) => hit.tier === 1 && hit.foundIn.kind === "call")).toBe(true);
  });

  test("finds a text naming the party whole, without regard to case, and not a surname alone", async () => {
    const { database, raw, dana } = await corpus();
    communication(raw, "communication_named", {
      channel: "sms",
      body: "Spoke with DANA WHITFIELD about the lease",
      matter_id: "matter_open",
    });
    communication(raw, "communication_surname", { channel: "sms", body: "Whitfield called" });
    const needles = await readPartyNeedles(database, [dana], null);
    const hits = (await searchContent(database, needles, ALL)).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      entityId: dana,
      tier: 2,
      foundIn: { kind: "text", id: "communication_named", matterId: "matter_open" },
    });
    expect(hits[0]?.matchedFields).toEqual(['"Dana Whitfield" is named in the message']);
  });

  test("searches only the channels asked for", async () => {
    const { database, raw, dana } = await corpus();
    communication(raw, "communication_call", { counterparty_entity_id: dana });
    communication(raw, "communication_text", { channel: "sms", counterparty_entity_id: dana });
    const needles = await readPartyNeedles(database, [dana], null);
    const hits = (await searchContent(database, needles, { ...NO_PLACES, messaging: ["texts"] }))
      .hits;
    expect(hits.map((hit) => hit.foundIn.id)).toEqual(["communication_text"]);
  });
});

describe("email", () => {
  test("finds a message by a sender's address or a name in its subject, filed or not", async () => {
    const { database, raw, dana } = await corpus();
    raw.exec(
      `INSERT INTO email_thread (id, first_seen_at, created_at, updated_at) VALUES ('emailThread_1', '${NOW}', '${NOW}', '${NOW}')`,
    );
    const message = (id: string, subject: string) =>
      raw.exec(
        `INSERT INTO email_message (id, message_id_provenance, subject, received_at, thread_id, content_sha256, dedup_key, original_r2_key, integrity, source_format, captured_via, created_at, updated_at)
         VALUES ('${id}', 'absent', '${subject}', '${NOW}', 'emailThread_1', 'sha-${id}', 'dedup-${id}', 'r2/${id}', '{}', 'eml', 'api', '${NOW}', '${NOW}')`,
      );
    message("emailMessage_from", "Lease renewal");
    message("emailMessage_subject", "Re: Dana Whitfield deposition");
    message("emailMessage_other", "Lunch");
    raw.exec(
      `INSERT INTO email_participant (id, email_message_id, kind, address, created_at, updated_at)
       VALUES ('emailParticipant_1', 'emailMessage_from', 'from', 'DANA@example.com', '${NOW}', '${NOW}')`,
    );
    raw.exec(
      `INSERT INTO email_matter_link (id, email_message_id, matter_id, state, captured_via, created_at, updated_at)
       VALUES ('emailMatterLink_1', 'emailMessage_subject', 'matter_open', 'filed', 'api', '${NOW}', '${NOW}')`,
    );
    const needles = await readPartyNeedles(database, [dana], null);
    const hits = (await searchContent(database, needles, { ...NO_PLACES, messaging: ["email"] }))
      .hits;
    const byId = new Map(hits.map((hit) => [hit.foundIn.id, hit]));
    expect([...byId.keys()].toSorted()).toEqual(["emailMessage_from", "emailMessage_subject"]);
    expect(byId.get("emailMessage_from")?.tier).toBe(1);
    expect(byId.get("emailMessage_from")?.foundIn.matterId).toBeNull();
    expect(byId.get("emailMessage_subject")?.tier).toBe(2);
    expect(byId.get("emailMessage_subject")?.foundIn.matterId).toBe("matter_open");
  });
});

describe("tasks", () => {
  test("searches tasks on the matter statuses asked for, tasks on no matter, and archived tasks when asked", async () => {
    const { database, raw, acme } = await corpus();
    const task = (id: string, matter: string | null, title: string, archived = false) =>
      raw.exec(
        `INSERT INTO matter_task (id, matter_id, title, created_by, archived_at, archived_by, created_at, updated_at)
         VALUES ('${id}', ${matter === null ? "NULL" : `'${matter}'`}, '${title}', '${ACTOR}', ${archived ? `'${NOW}', '${ACTOR}'` : "NULL, NULL"}, '${NOW}', '${NOW}')`,
      );
    task("matterTask_open", "matter_open", "Call Acme Holdings LLC");
    task("matterTask_consult", "matter_consult", "Conflict memo on acme holdings llc");
    task("matterTask_closed", "matter_closed", "Acme Holdings LLC settlement");
    task("matterTask_general", null, "Lunch with Acme Holdings LLC");
    task("matterTask_archived", "matter_open", "Old Acme Holdings LLC note", true);
    const needles = await readPartyNeedles(database, [acme], null);

    const openOnly = (await searchContent(database, needles, { ...NO_PLACES, tasks: ["open"] }))
      .hits;
    expect(openOnly.map((hit) => hit.foundIn.id).toSorted()).toEqual([
      "matterTask_general",
      "matterTask_open",
    ]);

    const everything = (await searchContent(database, needles, ALL)).hits;
    expect(everything.filter((hit) => hit.foundIn.kind === "task")).toHaveLength(5);
  });

  test("finds a name written without its accents, and never a word that only contains it", async () => {
    const { database, raw } = await corpus();
    const party = {
      entityId: "directoryPerson_jose",
      names: ["José Ortega"],
      emails: [],
      phoneDigits: [],
    };
    const task = (id: string, title: string) =>
      raw.exec(
        `INSERT INTO matter_task (id, matter_id, title, created_by, created_at, updated_at)
         VALUES ('${id}', 'matter_open', '${title}', '${ACTOR}', '${NOW}', '${NOW}')`,
      );
    task("matterTask_accentless", "Call Jose Ortega back");
    task("matterTask_inside", "Review the JoséOrtegaFund letter");
    const { hits } = await searchContent(database, [party], { ...NO_PLACES, tasks: ["open"] });
    expect(hits.map((hit) => hit.foundIn.id)).toEqual(["matterTask_accentless"]);
    expect(hits[0]?.matchedFields).toEqual(['"José Ortega" is named in the task']);
  });

  test("keeps at most the ceiling of records for one name in one place, and counts the name", async () => {
    const { database, raw, acme } = await corpus();
    for (let index = 0; index <= NAME_RESULT_CEILING; index += 1) {
      raw.exec(
        `INSERT INTO matter_task (id, matter_id, title, created_by, created_at, updated_at)
         VALUES ('matterTask_${String(index)}', 'matter_open', 'Acme Holdings LLC item ${String(index)}', '${ACTOR}', '${NOW}', '${NOW}')`,
      );
    }
    const needles = await readPartyNeedles(database, [acme], null);
    const outcome = await searchContent(database, needles, { ...NO_PLACES, tasks: ["open"] });
    expect(outcome.hits).toHaveLength(NAME_RESULT_CEILING);
    expect(outcome.namesAtCeiling).toBe(1);
  });
});

describe("Magnus", () => {
  test("searches every conversation that is not deleted, General included, once per conversation", async () => {
    const { database, raw, dana } = await corpus();
    const conversation = (id: string, matter: string | null, state = "active") =>
      raw.exec(
        `INSERT INTO magnus_conversation (id, created_by, matter_id, state, created_at, updated_at)
         VALUES ('${id}', '${ACTOR}', ${matter === null ? "NULL" : `'${matter}'`}, '${state}', '${NOW}', '${NOW}')`,
      );
    const turn = (id: string, conversationId: string, sequence: number, content: string) =>
      raw.exec(
        `INSERT INTO magnus_turn (id, conversation_id, sequence, speaker, content, status, created_at)
         VALUES ('${id}', '${conversationId}', ${String(sequence)}, 'member', '${content}', 'complete', '${NOW}')`,
      );
    conversation("magnusConversation_general", null);
    conversation("magnusConversation_deleted", null, "deleted");
    turn("magnusTurn_1", "magnusConversation_general", 1, "Who is Dana Whitfield?");
    turn("magnusTurn_2", "magnusConversation_general", 2, "Tell me more about Dana Whitfield.");
    turn("magnusTurn_3", "magnusConversation_deleted", 1, "Dana Whitfield again");
    const needles = await readPartyNeedles(database, [dana], null);
    const hits = (await searchContent(database, needles, { ...NO_PLACES, magnus: true })).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]?.foundIn).toMatchObject({
      kind: "magnus_conversation",
      id: "magnusConversation_general",
      matterId: null,
    });
  });
});

describe("the request and the record", () => {
  test("a places request reads only what it recognizes, and an old row asks for nothing", () => {
    expect(readPlacesRequest(undefined)).toEqual(NO_PLACES);
    expect(
      readPlacesRequest({ messaging: ["texts", "fax"], tasks: ["open"], magnus: "yes" }),
    ).toEqual({ messaging: ["texts"], tasks: ["open"], magnus: false, files: [] });
  });

  test("a stored place reads back with its matter's number, and a Directory result reads as none", async () => {
    const { database } = await corpus();
    const stored = JSON.stringify({
      kind: "task",
      id: "matterTask_1",
      matterId: "matter_open",
      at: NOW,
    });
    expect(readFoundIn(stored)).toEqual({
      kind: "task",
      id: "matterTask_1",
      matterId: "matter_open",
      at: NOW,
    });
    expect(readFoundIn("not json")).toBeNull();
    const resolved = await resolveFoundIns(database, [
      { id: "hit_task", found_in_json: stored },
      { id: "hit_directory", found_in_json: null },
    ]);
    expect(resolved.get("hit_task")?.matterNumber).toBe("2026-0001");
    expect(resolved.get("hit_directory")).toBeNull();
  });
});
