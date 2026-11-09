import { env, runInDurableObject } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, FirmId, MatterId } from "@magna-carta/identifiers/types";
import { extracted, type TextExtractionPort } from "@magna-carta/search/extraction";
import {
  indexed,
  searchEngineNotImplemented,
  type SearchIndexPort,
} from "@magna-carta/search/port";
import { readNaturalLanguageSearchEnabled } from "@magna-carta/search/natural-language-settings";
import {
  NATURAL_LANGUAGE_FEED_PREFIX,
  naturalLanguageFeedObjectKey,
} from "@magna-carta/search/natural-language-feed";
import { readInstanceForFirm } from "@magna-carta/search/natural-language-instance-statements";
import {
  enumerateFeedObjects,
  readMatterNaturalLanguageExcluded,
  readUsageMeterTotals,
} from "@magna-carta/search/natural-language-statements";
import { createMemoryLogger } from "@magna-carta/telemetry/logger";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  searchIndexQueue,
  type SearchIndexPorts,
} from "../src/background/search/index-consumer.ts";
import { searchIndexJobName, type SearchIndexMessage } from "../src/search/index-types.ts";
import type { SearchIndexJob } from "../src/search/index-coordinator.ts";
import {
  resolveNaturalLanguageProvisioningPort,
  resolveNaturalLanguageSearchPort,
} from "../src/search/natural-language-binding.ts";
import { provisionNaturalLanguageInstance } from "../src/search/natural-language-lifecycle.ts";
import { runNaturalLanguageKeepAliveSweep } from "../src/background/search/natural-language-keep-alive.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirmRow } from "./support/test-auth.ts";

// THE MERGE GATE FOR THIS FEATURE, stated as one test: a firm that has never opted in produces no
// feed object, no instance, and an `instance-not-provisioned` outcome from the port.
//
// It runs over real Miniflare bindings and — the part that matters — reaches the not-configured
// paths through the PRODUCTION RESOLVERS rather than through an injected double. A seam that only
// works because a test hands it something the production wiring never would is the failure this file
// exists to make impossible: `resolveNaturalLanguageSearchPort(env)` and
// `resolveNaturalLanguageProvisioningPort(env)` are the exact calls the running Worker makes, and
// this environment carries neither binding, exactly as production does today.

const MATTER = "matter_test0000000000000000009" as MatterId;
const SOURCE_BYTES = new TextEncoder().encode("%PDF-1.4 fake document bytes");

let firmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm");
  await seedFirmRow(firmId, "Natural Language Gates Firm");
  await seedMatter();
});

// THE MATTER HAS TO EXIST, and this is not incidental setup.
//
// The feed writer reads two gates, and the matter-exclusion read is total in the safe direction: a
// matter it cannot find reads as EXCLUDED. Without this seed the test would pass with the firm gate
// deleted outright — the second gate would still be stopping the write, and the assertion would be
// proving nothing about the thing it names. Seeding an ordinary, included matter is what makes the
// firm gate the only thing standing between this document and the managed index.
async function seedMatter(): Promise<void> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const at = "2026-01-01T00:00:00.000Z";
  const memberUserId = newIdentifier("user");
  await database
    .prepare("INSERT INTO member (user_id, display_name, created_at) VALUES (?1, ?2, ?3)")
    .bind(memberUserId, "A Member", at)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, ?4)",
    )
    .bind(MATTER, "A Matter", memberUserId, at)
    .run();
}

const extractsTwoPages: TextExtractionPort = {
  extract: () =>
    Promise.resolve(
      extracted([
        { chunkId: "page-0", text: "the seller shall indemnify the buyer", page: 1 },
        { chunkId: "page-1", text: "environmental liability remains", page: 2 },
      ]),
    ),
};

function publishingIndexPort(): SearchIndexPort {
  return {
    index: (input) =>
      Promise.resolve(
        indexed({
          objectKey: input.objectKey,
          documentCount: input.passages.length,
          sizeBytes: 2048,
          schemaGeneration: 1,
        }),
      ),
    remove: () => Promise.resolve({ ok: true as const }),
    query: () => Promise.resolve(searchEngineNotImplemented()),
    compact: () => Promise.resolve(searchEngineNotImplemented()),
  };
}

function ports(): SearchIndexPorts {
  return { extraction: extractsTwoPages, index: publishingIndexPort() };
}

async function messageFor(label: string, version: number): Promise<SearchIndexMessage> {
  const documentId = newIdentifier("file");
  const sourceKey = `matters/${MATTER}/${label}/v${version}`;
  await env.R2.put(sourceKey, SOURCE_BYTES, {
    customMetadata: { matter: MATTER, object_class: "working-document" },
  });
  return {
    firmId,
    matterId: MATTER,
    documentId,
    version,
    sourceKey,
    contentType: "application/pdf",
    engineGeneration: "",
  };
}

async function seedJob(message: SearchIndexMessage) {
  const stub = env.SEARCH_INDEX_JOB.get(
    env.SEARCH_INDEX_JOB.idFromName(
      searchIndexJobName(message.firmId, message.documentId, message.version),
    ),
  );
  await runInDurableObject(stub, async (instance: SearchIndexJob) => {
    const mutable = instance as unknown as { env: Record<string, unknown> };
    mutable.env = { ...mutable.env, SEARCH_INDEX: { send: () => Promise.resolve() } };
    await instance.start(message);
  });
  return stub;
}

function makeBatch(message: SearchIndexMessage) {
  return {
    queue: "magna-carta-production-search-index",
    messages: [
      {
        id: "msg-gates",
        timestamp: new Date(),
        attempts: 1,
        body: message,
        ack: () => {},
        retry: () => {},
      },
    ],
  } as unknown as MessageBatch<SearchIndexMessage>;
}

describe("a firm that never opted in", () => {
  it("has the gate shut, with no setting row at all", async () => {
    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    expect(await readNaturalLanguageSearchEnabled(database)).toBe(false);
  });

  it("has an ordinary, INCLUDED matter — so the firm gate is the only thing stopping the feed", async () => {
    // The control on the test below. If this ever inverts, that assertion stops measuring the firm
    // gate and starts measuring the exclusion flag, and would keep passing with the firm gate gone.
    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    expect(await readMatterNaturalLanguageExcluded(database, MATTER)).toBe(false);
  });

  it("produces NO feed object when a document is indexed", async () => {
    // The index job runs to completion and publishes a keyword split — the keyword half is a
    // different feature with a different gate. What must not happen is the second consumer writing a
    // derived copy of that text into a prefix built to be read by a managed index.
    const message = await messageFor("no-feed", 1);
    await seedJob(message);
    await searchIndexQueue(makeBatch(message), env, ports());

    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    expect(await enumerateFeedObjects(database, { kind: "firm" }, 100)).toEqual([]);

    const expectedKey = naturalLanguageFeedObjectKey(
      MATTER,
      message.documentId as FileId,
      message.version,
    );
    expect(await env.R2.head(expectedKey)).toBeNull();
    const listed = await env.R2.list({ prefix: NATURAL_LANGUAGE_FEED_PREFIX });
    expect(listed.objects.map((object) => object.key)).toEqual([]);
  });

  it("has NO instance record", async () => {
    expect(await readInstanceForFirm(env.DB_CONTROL, firmId)).toBeUndefined();
  });
});

describe("the production resolvers, in an environment with neither binding", () => {
  it("resolve the query port to instance-not-provisioned", async () => {
    // Through the real resolver, on the real env, with no double injected anywhere. This is the
    // branch a misconfigured deployment takes, and the answer is a stated unavailability rather than
    // an empty result that would read as a corpus with nothing in it.
    expect(env.AI_SEARCH).toBeUndefined();
    const port = resolveNaturalLanguageSearchPort(env);
    const result = await port.naturalLanguageSearch({
      firmId,
      corpus: { kind: "matter", id: MATTER },
      text: "where did we agree to a contingency on appeal",
      limit: 10,
      objectClasses: ["working-document"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("instance-not-provisioned");
  });

  it("resolve the management port to binding-not-configured, and it never throws", async () => {
    expect(env.AI_SEARCH_NAMESPACES).toBeUndefined();
    const port = resolveNaturalLanguageProvisioningPort(env);
    await expect(port.destroyInstance("mc-anything")).resolves.toMatchObject({
      ok: false,
      reason: "binding-not-configured",
    });
  });

  it("record a provisioning FAILURE rather than a control-plane row claiming a ready instance", async () => {
    // The fallback that would be worst here is one that resolves cleanly: a logging adapter that
    // returned success would leave a row saying `ready` against an instance that does not exist, and
    // every later read would trust it. The row is left in `provisioning` — work that is owed — and
    // the failure goes to the error pipeline.
    const otherFirmId = newIdentifier("firm");
    await env.DB_CONTROL.prepare(
      "INSERT INTO firm (id, name, status, release_channel, bucket_name, created_at) VALUES (?1, ?2, 'active', 'stable', ?3, ?4)",
    )
      .bind(otherFirmId, `firm-${otherFirmId}`, `bucket-${otherFirmId}`, new Date().toISOString())
      .run();

    const logger = createMemoryLogger();
    await provisionNaturalLanguageInstance(
      env,
      otherFirmId,
      firmDatabaseFor(env.FIRM_DATABASE, otherFirmId),
      logger,
    );

    const row = await readInstanceForFirm(env.DB_CONTROL, otherFirmId);
    expect(row?.state).toBe("provisioning");
    expect(row?.instanceIdentifier).toBeNull();
    expect(logger.events.map((event) => event.name)).toContain(
      "search.naturalLanguage.instanceOperationFailed",
    );
    expect(logger.events.at(-1)?.fields.reason).toBe("binding-not-configured");
  });

  it("keep the weekly keep-alive a no-op while no instance is ready", async () => {
    // The sweep walks `ready` rows and there are none, so it makes no call and meters nothing. A
    // sweep that queried anyway would be spending on instances that do not exist.
    expect(await runNaturalLanguageKeepAliveSweep(env)).toEqual({ attempted: 0, kept: 0 });
  });
});

describe("a firm that HAS opted in — the feed writer as a second consumer of one extraction", () => {
  it("writes the feed object from the extraction the index job already computed, and extracts once", async () => {
    // THE PROPERTY THIS TEST EXISTS FOR: the bytes are read once and parsed once, and both the
    // keyword split and the feed read that one result. A second extraction would be a second parse of
    // the same untrusted document for a derived copy, and would let the two copies disagree about
    // what the document says with nothing comparing them. The call count is the assertion.
    const optedInFirmId = newIdentifier("firm");
    await seedFirmRow(optedInFirmId);
    const optedInMatter = "matter_test0000000000000000010" as MatterId;
    const database = firmDatabaseFor(env.FIRM_DATABASE, optedInFirmId);
    const at = "2026-01-01T00:00:00.000Z";
    const memberUserId = newIdentifier("user");
    await database
      .prepare("INSERT INTO member (user_id, display_name, created_at) VALUES (?1, ?2, ?3)")
      .bind(memberUserId, "A Member", at)
      .run();
    await database
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, ?4)",
      )
      .bind(optedInMatter, "A Matter", memberUserId, at)
      .run();
    await database
      .prepare("INSERT INTO setting (key, value, updated_at) VALUES (?1, 'true', ?2)")
      .bind("search.naturalLanguageEnabled", at)
      .run();

    let extractionCalls = 0;
    const countingExtraction: TextExtractionPort = {
      extract: () => {
        extractionCalls += 1;
        return Promise.resolve(
          extracted([
            { chunkId: "page-0", text: "the seller shall indemnify the buyer", page: 1 },
            { chunkId: "page-1", text: "environmental liability remains", page: 2 },
          ]),
        );
      },
    };

    const documentId = newIdentifier("file");
    // The catalog row carries a foreign key to the file, as it must: a feed object that named no
    // document would be a pointer to nothing, and the deletion plan is read from these rows.
    await database
      .prepare(
        "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'a.pdf', ?3, ?3)",
      )
      .bind(documentId, optedInMatter, at)
      .run();
    const sourceKey = `matters/${optedInMatter}/opted-in/v1`;
    await env.R2.put(sourceKey, SOURCE_BYTES, {
      customMetadata: { matter: optedInMatter, object_class: "working-document" },
    });
    const message: SearchIndexMessage = {
      firmId: optedInFirmId,
      matterId: optedInMatter,
      documentId,
      version: 1,
      sourceKey,
      contentType: "application/pdf",
      engineGeneration: "",
    };
    await seedJob(message);
    await searchIndexQueue(makeBatch(message), env, {
      extraction: countingExtraction,
      index: publishingIndexPort(),
    });

    expect(extractionCalls).toBe(1);

    const expectedKey = naturalLanguageFeedObjectKey(optedInMatter, documentId as FileId, 1);
    const object = await env.R2.get(expectedKey);
    expect(object).not.toBeNull();
    const body = await object?.text();
    // The same passages the keyword split was built from, with their page markers.
    expect(body).toBe(
      "## Page 1\n\nthe seller shall indemnify the buyer\n\n## Page 2\n\nenvironmental liability remains\n",
    );
    // Stamped through the platform's one dimension builder, and with no reserved dimension.
    expect(object?.customMetadata).toEqual({
      matter: optedInMatter,
      object_class: "working-document",
    });

    // The catalog names it, which is what makes deletion demonstrable and freshness computable.
    const rows = await enumerateFeedObjects(database, { kind: "firm" }, 100);
    expect(rows.map((row) => row.objectKey)).toEqual([expectedKey]);
    expect(rows[0]?.byteCount).toBe(new TextEncoder().encode(body ?? "").byteLength);
    expect(rows[0]?.removedAt).toBeNull();

    // And the meter counted the bytes it actually wrote, in the same batch as the row.
    const totals = await readUsageMeterTotals(database);
    expect(totals.authoritative.fedBytes).toBe(rows[0]?.byteCount);
    expect(totals.estimated.ingestionTokens).toBeGreaterThan(0);
    expect(totals.authoritative.semanticQueryCount).toBe(0);
  });

  it("writes nothing for a matter the firm has excluded, with the firm gate still open", async () => {
    const optedInFirmId = newIdentifier("firm");
    await seedFirmRow(optedInFirmId);
    const excludedMatter = "matter_test0000000000000000011" as MatterId;
    const database = firmDatabaseFor(env.FIRM_DATABASE, optedInFirmId);
    const at = "2026-01-01T00:00:00.000Z";
    const memberUserId = newIdentifier("user");
    await database
      .prepare("INSERT INTO member (user_id, display_name, created_at) VALUES (?1, ?2, ?3)")
      .bind(memberUserId, "A Member", at)
      .run();
    await database
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, natural_language_index_excluded, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, 1, ?4, ?4)",
      )
      .bind(excludedMatter, "A Sealed Matter", memberUserId, at)
      .run();
    await database
      .prepare("INSERT INTO setting (key, value, updated_at) VALUES (?1, 'true', ?2)")
      .bind("search.naturalLanguageEnabled", at)
      .run();

    const documentId = newIdentifier("file");
    const sourceKey = `matters/${excludedMatter}/excluded/v1`;
    await env.R2.put(sourceKey, SOURCE_BYTES, {
      customMetadata: { matter: excludedMatter, object_class: "working-document" },
    });
    const message: SearchIndexMessage = {
      firmId: optedInFirmId,
      matterId: excludedMatter,
      documentId,
      version: 1,
      sourceKey,
      contentType: "application/pdf",
      engineGeneration: "",
    };
    await seedJob(message);
    await searchIndexQueue(makeBatch(message), env, ports());

    expect(
      await env.R2.head(naturalLanguageFeedObjectKey(excludedMatter, documentId as FileId, 1)),
    ).toBeNull();
    expect(await enumerateFeedObjects(database, { kind: "firm" }, 100)).toEqual([]);
  });
});
