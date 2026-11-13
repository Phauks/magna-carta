import { env, runInDurableObject } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { readTokenUsage } from "@magna-carta/data-access/token-usage-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmId,
  MagnusConversationId,
  MagnusTurnId,
  UserId,
} from "@magna-carta/identifiers/types";
import { aiProcessingEligibilityDefinition } from "@magna-carta/inference/settings";
import { STUB_RESPONSE_MARKER } from "@magna-carta/inference/stub";
import {
  commitVersionStatement,
  fileVersionKey,
  insertFileStatement,
  insertFileVersionStatement,
  setFileCurrentVersionStatement,
} from "@magna-carta/file-manager/file-statements";
import { attachConversationFile, startConversation } from "@magna-carta/magnus/conversation";
import { setConversationPermission } from "@magna-carta/magnus/permissions";
import { magnusEnabledDefinition } from "@magna-carta/magnus/settings";
import { listAttachments, readTurn } from "@magna-carta/magnus/statements";
import { completeTurn, submitTurn } from "@magna-carta/magnus/turn";
import { WINDOW_MAX_TURNS } from "@magna-carta/magnus/window";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../src/bindings.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { handleMagnusTurnJob, magnusQueue } from "../src/background/magnus/magnus-consumer.ts";
import type { MagnusTurnJob } from "../src/magnus/magnus-types.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";

// The queue consumer over real Miniflare bindings. The default adapter is the deterministic stub, so
// nothing here reaches a provider — which is the point: the entire path is exercisable with no
// credentials and no spend.

let firmId: FirmId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const USER = "user_magnusConsumerTester" as UserId;
const clock = { now: () => new Date().toISOString() };

function consumerEnv(): Bindings {
  return {
    FIRM_DATABASE: env.FIRM_DATABASE,
    MAGNUS_CONVERSATION: env.MAGNUS_CONVERSATION,
    TELEMETRY: env.TELEMETRY,
    AI: env.AI,
  } as unknown as Bindings;
}

async function writeSetting<T>(
  definition: Parameters<typeof writeFirmSettingStatement<T>>[1],
  value: T,
): Promise<void> {
  await commitEffectBatch(
    firmDatabase,
    {
      statements: [writeFirmSettingStatement(firmDatabase, definition, value, clock.now())],
      outboxMessages: [],
    },
    { now: clock.now },
  );
}

// Composes a conversation with one submitted turn and returns the job the relay would have produced.
async function submitOneTurn(content: string): Promise<MagnusTurnJob> {
  const context = { clock, actorUserId: USER };
  const started = startConversation(firmDatabase, context, {
    title: null,
    createdBy: USER,
    matterId: null,
  });
  await commitEffectBatch(firmDatabase, started.effect, { now: clock.now });

  const submission = submitTurn(firmDatabase, context, {
    conversationId: started.conversationId,
    content,
    nextSequence: 0,
    disclosureVersion: 1,
  });
  expect(submission.ok).toBe(true);
  if (!submission.ok) throw new Error("submission refused");
  await commitEffectBatch(firmDatabase, submission.effect, { now: clock.now });

  return {
    firmId,
    conversationId: started.conversationId,
    magnusTurnId: submission.magnusTurnId,
    outboxId: newIdentifier("outbox"),
  };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Magnus Consumer Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  await writeSetting(aiProcessingEligibilityDefinition, true);
  await writeSetting(magnusEnabledDefinition, true);
  // A member row for the acting user, so a matter can name them as its responsible member.
  await insertMemberStatement(firmDatabase, {
    userId: USER,
    displayName: "Magnus Consumer Tester",
    now: clock.now(),
  }).run();
});

describe("the assistant queue consumer", () => {
  it("settles the pending turn with the stub's answer and records provenance and tokens", async () => {
    const job = await submitOneTurn("can I still amend");
    await handleMagnusTurnJob(consumerEnv(), job);

    const turn = await readTurn(firmDatabase, job.magnusTurnId as MagnusTurnId);
    expect(turn?.status).toBe("complete");
    // The stub echoes the last MEMBER message, which proves the window the consumer built reached
    // the port rather than that something reached it.
    expect(turn?.content).toBe(`${STUB_RESPONSE_MARKER} can I still amend`);
    expect(turn?.snapshotId).toBe("stub");
    expect(turn?.modelId).toBe("anthropic/claude-opus-5-5");
    expect(turn?.inputTokens ?? 0).toBeGreaterThan(0);
    expect(turn?.outputTokens ?? 0).toBeGreaterThan(0);
  });

  it("answers with the model and effort the member chose, and records both on the answer", async () => {
    const job = await submitOneTurn("which deadline governs");
    await handleMagnusTurnJob(consumerEnv(), {
      ...job,
      modelId: "anthropic/claude-sonnet-5-5",
      effort: "xhigh",
    });

    const turn = await readTurn(firmDatabase, job.magnusTurnId as MagnusTurnId);
    expect(turn?.status).toBe("complete");
    expect(turn?.modelId).toBe("anthropic/claude-sonnet-5-5");
    expect(turn?.effort).toBe("xhigh");
  });

  it("answers a choice the catalog no longer offers with the firm's model at its default effort", async () => {
    const job = await submitOneTurn("and the earlier one");
    await handleMagnusTurnJob(consumerEnv(), {
      ...job,
      modelId: "anthropic/claude-retired-model",
      effort: "max",
    });

    const turn = await readTurn(firmDatabase, job.magnusTurnId as MagnusTurnId);
    expect(turn?.status).toBe("complete");
    expect(turn?.modelId).toBe("anthropic/claude-opus-5-5");
    expect(turn?.effort).toBe("medium");
  });

  it("meters exactly the usage the response reported", async () => {
    const before = await readTokenUsage(firmDatabase);
    const beforeTotal = before.reduce((sum, row) => sum + row.inputTokens, 0);

    const job = await submitOneTurn("meter this");
    await handleMagnusTurnJob(consumerEnv(), job);

    const turn = await readTurn(firmDatabase, job.magnusTurnId as MagnusTurnId);
    const after = await readTokenUsage(firmDatabase);
    const afterTotal = after.reduce((sum, row) => sum + row.inputTokens, 0);
    expect(afterTotal - beforeTotal).toBe(turn?.inputTokens);
  });

  it("records that the window truncated, so the member is told the answer used part of the conversation", async () => {
    // A conversation long enough that the newest question is answered without its earliest turns.
    const context = { clock, actorUserId: USER };
    const started = startConversation(firmDatabase, context, {
      title: null,
      createdBy: USER,
      matterId: null,
    });
    await commitEffectBatch(firmDatabase, started.effect, { now: clock.now });

    let sequence = 0;
    let lastMagnusTurnId = "";
    for (let index = 0; index < WINDOW_MAX_TURNS; index++) {
      const submission = submitTurn(firmDatabase, context, {
        conversationId: started.conversationId,
        content: `question ${index}`,
        nextSequence: sequence,
        disclosureVersion: 1,
      });
      if (!submission.ok) throw new Error("submission refused");
      await commitEffectBatch(firmDatabase, submission.effect, { now: clock.now });
      // Settle each answer so the next window has real prior content to overflow with.
      const completion = completeTurn(firmDatabase, context, {
        conversationId: started.conversationId,
        magnusTurnId: submission.magnusTurnId,
        content: `answer ${index}`,
        modelId: "anthropic/claude-opus-5-5",
        snapshotId: "stub",
        inputTokens: 1,
        outputTokens: 1,
        contextTruncated: false,
        effort: null,
      });
      if (!completion.ok) throw new Error("completion refused");
      await commitEffectBatch(firmDatabase, completion.effect, { now: clock.now });
      sequence += 2;
      lastMagnusTurnId = submission.magnusTurnId;
    }

    // One more submission, left pending for the consumer.
    const final = submitTurn(firmDatabase, context, {
      conversationId: started.conversationId,
      content: "the newest question",
      nextSequence: sequence,
      disclosureVersion: 1,
    });
    if (!final.ok) throw new Error("submission refused");
    await commitEffectBatch(firmDatabase, final.effect, { now: clock.now });
    expect(lastMagnusTurnId).not.toBe("");

    await handleMagnusTurnJob(consumerEnv(), {
      firmId,
      conversationId: started.conversationId,
      magnusTurnId: final.magnusTurnId,
      outboxId: newIdentifier("outbox"),
    });

    const turn = await readTurn(firmDatabase, final.magnusTurnId);
    expect(turn?.status).toBe("complete");
    expect(turn?.contextTruncated).toBe(true);
  });

  it("sends an attached file's readable text ahead of the question, and records what reached the model", async () => {
    // A matter with one committed plain-text file, attached to a conversation kept on it.
    const matterId = newIdentifier("matter");
    await firmDatabase
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Attach Test', 'open', ?3, ?2, ?2)",
      )
      .bind(matterId, clock.now(), USER)
      .run();
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const objectKey = fileVersionKey(fileId, versionId);
    const fileText = "The lease runs to 30 June and renews unless notice is given by 31 March.";
    await env.R2.put(objectKey, new TextEncoder().encode(fileText));
    await commitEffectBatch(
      firmDatabase,
      {
        statements: [
          insertFileStatement(firmDatabase, {
            id: fileId,
            matterId,
            folderId: null,
            name: "lease-notes.txt",
            documentTypeId: null,
            createdAt: clock.now(),
          }),
          insertFileVersionStatement(firmDatabase, {
            id: versionId,
            fileId,
            versionNumber: 1,
            r2Key: objectKey,
            declaredContentType: "text/plain",
            uploadedBy: USER,
            createdAt: clock.now(),
          }),
          commitVersionStatement(firmDatabase, {
            versionId,
            sizeBytes: fileText.length,
            sniffedContentType: "text/plain",
            contentSha256: "0".repeat(64),
            scanVerdict: "clean",
            scanEngineVersion: null,
            scanDetail: null,
            committedAt: clock.now(),
          }),
          setFileCurrentVersionStatement(firmDatabase, fileId, versionId, clock.now()),
        ],
        outboxMessages: [],
      },
      { now: clock.now },
    );

    const context = { clock, actorUserId: USER };
    const started = startConversation(firmDatabase, context, {
      title: null,
      createdBy: USER,
      matterId,
    });
    await commitEffectBatch(firmDatabase, started.effect, { now: clock.now });
    await commitEffectBatch(
      firmDatabase,
      attachConversationFile(firmDatabase, context, {
        conversationId: started.conversationId,
        fileId,
      }),
      { now: clock.now },
    );
    const submission = submitTurn(firmDatabase, context, {
      conversationId: started.conversationId,
      content: "when does notice have to be given",
      nextSequence: 0,
      disclosureVersion: 1,
    });
    if (!submission.ok) throw new Error("submission refused");
    await commitEffectBatch(firmDatabase, submission.effect, { now: clock.now });

    await handleMagnusTurnJob(
      { ...consumerEnv(), DB_CONTROL: env.DB_CONTROL, R2: env.R2 } as unknown as Bindings,
      {
        firmId,
        conversationId: started.conversationId,
        magnusTurnId: submission.magnusTurnId,
        outboxId: newIdentifier("outbox"),
      },
    );

    // The stub echoes the last member message, so what reached the port is legible in the answer:
    // the file's text under its heading, then the question.
    const turn = await readTurn(firmDatabase, submission.magnusTurnId);
    expect(turn?.status).toBe("complete");
    expect(turn?.content).toContain("--- Attached file: lease-notes.txt ---");
    expect(turn?.content).toContain("renews unless notice is given");
    expect(turn?.content).toContain("when does notice have to be given");

    const [attachment] = await listAttachments(firmDatabase, started.conversationId);
    expect(attachment?.textStatus).toBe("sent");
    expect(attachment?.textBytes).toBe(fileText.length);
  });

  it("reads the author's earlier conversation on the matter only once they turn that on", async () => {
    const matterId = newIdentifier("matter");
    await firmDatabase
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Earlier Test', 'open', ?3, ?2, ?2)",
      )
      .bind(matterId, clock.now(), USER)
      .run();
    const context = { clock, actorUserId: USER };

    // An earlier conversation of the author's on the same matter, answered.
    const earlier = startConversation(firmDatabase, context, {
      title: "Lease review",
      createdBy: USER,
      matterId,
    });
    await commitEffectBatch(firmDatabase, earlier.effect, { now: clock.now });
    const earlierQuestion = submitTurn(firmDatabase, context, {
      conversationId: earlier.conversationId,
      content: "the landlord waived the late fee in March",
      nextSequence: 0,
      disclosureVersion: 3,
    });
    if (!earlierQuestion.ok) throw new Error("submission refused");
    await commitEffectBatch(firmDatabase, earlierQuestion.effect, { now: clock.now });

    async function ask(conversationId: MagnusConversationId, sequence: number, content: string) {
      const submission = submitTurn(firmDatabase, context, {
        conversationId,
        content,
        nextSequence: sequence,
        disclosureVersion: 3,
      });
      if (!submission.ok) throw new Error("submission refused");
      await commitEffectBatch(firmDatabase, submission.effect, { now: clock.now });
      await handleMagnusTurnJob(consumerEnv(), {
        firmId,
        conversationId,
        magnusTurnId: submission.magnusTurnId,
        outboxId: newIdentifier("outbox"),
      });
      return readTurn(firmDatabase, submission.magnusTurnId);
    }

    const current = startConversation(firmDatabase, context, {
      title: null,
      createdBy: USER,
      matterId,
    });
    await commitEffectBatch(firmDatabase, current.effect, { now: clock.now });

    // Off by default: the earlier conversation does not reach the model.
    const before = await ask(current.conversationId, 0, "was the late fee waived");
    expect(before?.content).not.toContain("landlord waived");

    await commitEffectBatch(
      firmDatabase,
      setConversationPermission(firmDatabase, context, {
        conversationId: current.conversationId,
        permission: "own-matter-conversations",
        granted: true,
        memberId: USER,
      }),
      { now: clock.now },
    );
    const after = await ask(current.conversationId, 2, "and now");
    expect(after?.content).toContain(
      "--- Your earlier conversation on this matter: Lease review ---",
    );
    expect(after?.content).toContain("Member: the landlord waived the late fee in March");
  });

  it("a redelivery neither re-calls the port nor double-meters", async () => {
    const job = await submitOneTurn("redeliver me");
    await handleMagnusTurnJob(consumerEnv(), job);
    const after = await readTokenUsage(firmDatabase);
    const afterTotal = after.reduce((sum, row) => sum + row.requestCount, 0);

    // The turn is already complete, so the redelivery returns before the model call and writes
    // nothing at all.
    await handleMagnusTurnJob(consumerEnv(), job);
    const afterReplay = await readTokenUsage(firmDatabase);
    expect(afterReplay.reduce((sum, row) => sum + row.requestCount, 0)).toBe(afterTotal);
  });

  it("a gate closed between submission and execution yields a REFUSED turn, never a silent drop", async () => {
    const job = await submitOneTurn("will this reach a model");
    await writeSetting(magnusEnabledDefinition, false);
    await handleMagnusTurnJob(consumerEnv(), job);
    await writeSetting(magnusEnabledDefinition, true);

    const turn = await readTurn(firmDatabase, job.magnusTurnId as MagnusTurnId);
    expect(turn?.status).toBe("refused");
    expect(turn?.failureLabel).toBe("not-eligible");
    expect(turn?.content).toBeNull();
  });

  it("the general firm gate closing has the same effect as the feature gate closing", async () => {
    const job = await submitOneTurn("and this one");
    await writeSetting(aiProcessingEligibilityDefinition, false);
    await handleMagnusTurnJob(consumerEnv(), job);
    await writeSetting(aiProcessingEligibilityDefinition, true);

    const turn = await readTurn(firmDatabase, job.magnusTurnId as MagnusTurnId);
    expect(turn?.status).toBe("refused");
    expect(turn?.failureLabel).toBe("not-eligible");
  });

  it("acks a message it handled and retries only one that threw — per-message isolation", async () => {
    const good = await submitOneTurn("a good one");
    const goodMessage = { id: "m1", body: good, ack: vi.fn(), retry: vi.fn() };
    // One firm id the resolver refuses, standing in for a transient failure reaching that firm's
    // database. Everything else resolves normally, so the batch mixes a working message with a
    // failing one exactly as a real batch can.
    const POISON_FIRM = "firm_poisonMessage00000000";
    const failingNamespace = {
      idFromName(name: string) {
        if (name === POISON_FIRM) throw new Error("firm database unreachable");
        return env.FIRM_DATABASE.idFromName(name);
      },
      get(id: unknown) {
        return env.FIRM_DATABASE.get(id as never);
      },
    };
    const badMessage = {
      id: "m2",
      body: {
        firmId: POISON_FIRM,
        conversationId: newIdentifier("magnusConversation"),
        magnusTurnId: newIdentifier("magnusTurn"),
        outboxId: newIdentifier("outbox"),
      } satisfies MagnusTurnJob,
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await magnusQueue(
      {
        queue: "magna-carta-production-magnus",
        messages: [goodMessage, badMessage],
      } as unknown as MessageBatch<MagnusTurnJob>,
      { ...consumerEnv(), FIRM_DATABASE: failingNamespace } as unknown as Bindings,
    );

    expect(goodMessage.ack).toHaveBeenCalledOnce();
    expect(goodMessage.retry).not.toHaveBeenCalled();
    expect(badMessage.ack).not.toHaveBeenCalled();
    expect(badMessage.retry).toHaveBeenCalledOnce();
  });

  it("no telemetry event and no audit row carries the prompt or the completion", async () => {
    const secret = "the Alvarez matter, Judge Kim, amendment before pretrial";
    const events: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      events.push(args.map((value) => String(value)).join(" "));
    };
    try {
      const job = await submitOneTurn(secret);
      await handleMagnusTurnJob(consumerEnv(), job);
    } finally {
      console.log = originalLog;
    }
    for (const line of events) expect(line).not.toContain("Alvarez");

    const { results } = await firmDatabase
      .prepare("SELECT metadata FROM audit_log")
      .all<{ metadata: string | null }>();
    for (const row of results) expect(row.metadata ?? "").not.toContain("Alvarez");
  });
});

describe("the conversation Durable Object", () => {
  it("holds NO conversation content — its storage is empty after a full conversation", async () => {
    const job = await submitOneTurn("say something memorable");
    await handleMagnusTurnJob(consumerEnv(), job);

    const stub = env.MAGNUS_CONVERSATION.get(
      env.MAGNUS_CONVERSATION.idFromName(`${firmId}:${job.conversationId}`),
    );
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = await state.storage.list();
      expect([...stored.keys()]).toEqual([]);
    });

    // And the transcript really is there — in the firm's own database, the only copy.
    const turn = await readTurn(firmDatabase, job.magnusTurnId as MagnusTurnId);
    expect(turn?.content).toContain("say something memorable");
  });

  it("pushes state byte-identical to the poll body", async () => {
    const job = await submitOneTurn("watch this");
    await handleMagnusTurnJob(consumerEnv(), job);

    const stub = env.MAGNUS_CONVERSATION.get(
      env.MAGNUS_CONVERSATION.idFromName(`${firmId}:${job.conversationId}`),
    );
    const response = await stub.fetch(
      new Request(
        `https://magnus-conversation.invalid/subscribe?firm=${encodeURIComponent(firmId)}&conversation=${encodeURIComponent(job.conversationId)}`,
        { headers: { Upgrade: "websocket" } },
      ),
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    expect(socket).toBeDefined();
    if (socket === null || socket === undefined) return;

    const frames: string[] = [];
    socket.accept();
    socket.addEventListener("message", (event) => {
      frames.push(String(event.data));
    });
    // The connect frame is sent before accept() returns on the server side; give the runtime a turn
    // to deliver it.
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));

    const frame = JSON.parse(frames[0] ?? "{}") as {
      type: string;
      protocolVersion: number;
      state: { turnId: string; status: string; content?: string };
    };
    expect(frame.type).toBe("state");
    expect(frame.protocolVersion).toBe(1);
    expect(frame.state.status).toBe("complete");
    expect(frame.state.turnId).toBe(job.magnusTurnId);
  });

  it("refuses a request that is not a WebSocket upgrade", async () => {
    const stub = env.MAGNUS_CONVERSATION.get(
      env.MAGNUS_CONVERSATION.idFromName(`${firmId}:${newIdentifier("magnusConversation")}`),
    );
    const response = await stub.fetch(new Request("https://magnus-conversation.invalid/subscribe"));
    expect(response.status).toBe(426);
  });

  it("refuses a subscribe request that names no firm or conversation", async () => {
    const stub = env.MAGNUS_CONVERSATION.get(
      env.MAGNUS_CONVERSATION.idFromName(`${firmId}:${newIdentifier("magnusConversation")}`),
    );
    const response = await stub.fetch(
      new Request("https://magnus-conversation.invalid/subscribe", {
        headers: { Upgrade: "websocket" },
      }),
    );
    expect(response.status).toBe(400);
  });
});
