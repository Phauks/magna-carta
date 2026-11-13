import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  createFirmKeyProvider,
  type WrappedKeyRow,
} from "@magna-carta/data-access/firm-key-provider";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { assertPermission } from "@magna-carta/access-control/registry";
import { createPerson } from "@magna-carta/directory/person";
import { createOrganization } from "@magna-carta/directory/organization";
import { addName, changeName } from "@magna-carta/directory/name-history";
import { addIdentifier, type DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { mergeEntities } from "@magna-carta/directory/merge";
import { expect, test } from "vitest";
import { matchParty, matchPartyBatch, type CandidateMatch } from "../src/matching.ts";
import { readSubjectFacts, readSubjectFactsBatch } from "../src/subject-facts.ts";
import type { Strictness } from "../src/types.ts";

// THE REFACTOR'S CORRECTNESS PROOF.
//
// The batched matcher exists to turn a query count proportional to entities-times-channels into one
// proportional to channels. A performance change to a conflicts engine that alters WHICH HITS COME
// BACK is not a refactor; it is a missed conflict, and a missed conflict here is a professional-
// conduct failure rather than a latency regression. So the batched path is held to returning exactly
// the per-entity path's hit set — same entities, same evidence, same tiers — over a corpus that
// carries every shape the channels care about:
//
//   - sound-alike surnames that only the phonetic channel returns
//   - typo variants that only the trigram channel returns
//   - an exact normalized-name twin, which has no blocking channel of its own
//   - a name-mismatched identifier twin, which only the blind-index self-join returns
//   - former and alias name rows, which balanced hides and over-inclusive searches
//   - a merged-away subordinate whose live name rows must resolve to the surviving master
//   - a mononym short enough to produce no trigrams at all
//   - organizations as well as persons, since the name channels filter on entity kind
//   - one legal name spelled two ways, which only the match-key probe joins
//   - two legal names differing only in their legal FORM, which only the bare match-key probe joins
//
// The corpus is a real migrated per-firm database written through the real Directory write paths, not
// a mock: a mock would prove the two code paths agree with each other and nothing about whether
// either agrees with the corpus.

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const ACTOR = "user_actor" as UserId;
const VIEW_SENSITIVE = assertPermission("directory:viewSensitiveIdentifiers");
const clock = { now: () => "2026-08-13T00:00:00.000Z" };

async function testContext(seed: string): Promise<DirectoryIdentifierContext> {
  const { database } = createMigratedNodeDatabase("per-firm");
  const rootKek = await importRootKek(ROOT_KEK);
  const wrappedFirmKey = await wrapFirmKey(rootKek, generateFirmKeyBytes());
  const firmKeyProvider = createFirmKeyProvider({
    rootKekBase64: ROOT_KEK,
    readWrappedKey: async (firmId: FirmId): Promise<WrappedKeyRow | null> =>
      firmId === FIRM ? { wrappedFirmKey, firmKeyVersion: 1 } : null,
  });
  return {
    firmId: FIRM,
    firmKeyVersion: 1,
    firmKeyProvider,
    database: database as unknown as BatchDatabase,
    effectivePermissions: new Set([VIEW_SENSITIVE]) as never,
    actorUserId: ACTOR,
    clock,
    randomSource: seededRandomSource(seed),
  };
}

// Every shape the blocking channels distinguish, written through the real write paths. Returns every
// entity id in the corpus — the matcher is asked about ALL of them, so a divergence anywhere shows.
async function seedCorpus(context: DirectoryIdentifierContext): Promise<string[]> {
  const ids: string[] = [];
  const person = async (given: string, family: string): Promise<string> => {
    const id = await createPerson(context.database, { given, family }, context);
    ids.push(id);
    return id;
  };
  const organization = async (legalName: string): Promise<string> => {
    const id = await createOrganization(context.database, { legalName }, context);
    ids.push(id);
    return id;
  };

  // Phonetic: Smith / Smyth / Smythe all encode alike; the exact pair are also an exact-name twin.
  await person("Catherine", "Smith");
  await person("Catherine", "Smith");
  await person("Kathryn", "Smyth");
  await person("Katharine", "Smythe");
  // Trigram: a one-character typo that keeps most windows.
  await person("Cathrine", "Smith");
  // A different surname entirely — noise the channels must not return.
  await person("Bartholomew", "Nkemdirim");
  // Former and alias rows: invisible at balanced, searched at over-inclusive.
  const renamed = await person("Mary", "Jones");
  await addName(
    context.database,
    renamed as never,
    { given: "Mary", family: "Smith", nameRole: "former" },
    context,
  );
  const aliased = await person("Robert", "Ferreira");
  await addName(
    context.database,
    aliased as never,
    { given: "Bob", family: "Ferreira", nameRole: "alias" },
    context,
  );
  // A name change through the append-and-flip path, so a current and a former row both exist.
  const changed = await person("Wilhelmina", "Okonkwo");
  await changeName(
    context.database,
    changed as never,
    { given: "Wilhelmina", family: "Adeyemi" },
    context,
  );

  // A mononym short enough to yield no trigrams and a thin phonetic token.
  await person("Li", "Yu");

  // Organizations — the name channels filter on entity kind, so a person must never match one.
  await organization("Smith and Jones, L.L.P.");
  await organization("Smith & Jones LLP");
  // Same name, different legal form: the bare key joins these two and the match key must not.
  await organization("Smith & Jones LLC");
  await organization("The Nkemdirim Holdings Corporation");
  await organization("Nkemdirim Holdings Corp");

  // A merged-away subordinate. Its name rows stay live in the corpus and must resolve to the master.
  const master = await person("Adaeze", "Balogun");
  const subordinate = await person("Adaeze", "Balogun");
  await mergeEntities(context, {
    masterId: master,
    subordinateId: subordinate,
    survivorship: {},
  });

  // Identifier twins under different names — only the blind-index self-join returns these.
  const twinA = await person("Gregory", "Vasquez");
  const twinB = await person("Greta", "Lindqvist");
  await addIdentifier(context, twinA as never, { type: "ssn", value: "123-45-6789" });
  await addIdentifier(context, twinB as never, { type: "ssn", value: "123-45-6789" });
  // A second identifier type on one of them, so the matched-type set is not trivially a singleton.
  await addIdentifier(context, twinA as never, { type: "drivers_license", value: "NV:A1234567" });

  return ids;
}

// A comparable, order-independent projection of one subject's hit set. Sorting matters: the two
// paths union their channels through different data structures, and a difference in ITERATION order
// is not a difference in the ANSWER.
function normalize(matches: readonly CandidateMatch[]): string {
  return JSON.stringify(
    matches
      .map((match) => ({
        entityId: match.entityId,
        identifierTypes: [...match.evidence.identifierTypes].toSorted(),
        exactNormalizedName: match.evidence.exactNormalizedName,
        matchKeyName: match.evidence.matchKeyName === true,
        bareMatchKeyName: match.evidence.bareMatchKeyName === true,
        phoneticMatch: match.evidence.phoneticMatch,
        trigramMatch: match.evidence.trigramMatch,
      }))
      .toSorted((left, right) => left.entityId.localeCompare(right.entityId)),
  );
}

test("with trigram matching off, the batched matcher still returns exactly the per-entity hit set", async () => {
  const context = await testContext("equivalence-without-trigram");
  const entityIds = await seedCorpus(context);
  const facts = await readSubjectFactsBatch(context, entityIds);
  const subjects = entityIds
    .map((entityId) => facts.get(entityId))
    .filter((subject) => subject !== undefined);
  const depth = { trigramMatching: false };
  const batched = await matchPartyBatch(context, subjects, "balanced", depth);
  for (const subject of subjects) {
    const perEntity = await matchParty(context, subject, "balanced", depth);
    expect({
      entityId: subject.entityId,
      matches: normalize(batched.get(subject.entityId as string) ?? []),
    }).toEqual({ entityId: subject.entityId, matches: normalize(perEntity) });
  }
  // Nothing the batch found came from trigram overlap.
  for (const matches of batched.values()) {
    for (const match of matches) expect(match.evidence.trigramMatch).toBe(false);
  }
});

for (const strictness of ["balanced", "over_inclusive"] as const satisfies readonly Strictness[]) {
  test(`the batched matcher returns exactly the per-entity matcher's hit set at ${strictness} strictness`, async () => {
    const context = await testContext(`equivalence-${strictness}`);
    const entityIds = await seedCorpus(context);
    expect(entityIds.length).toBeGreaterThan(17);

    // The subject facts each path feeds its matcher must themselves agree, or the comparison below
    // would be comparing two different questions rather than two answers to one.
    const batchedFacts = await readSubjectFactsBatch(context, entityIds);
    for (const entityId of entityIds) {
      const single = await readSubjectFacts(context, entityId);
      expect(batchedFacts.get(entityId) ?? null).toEqual(single);
    }

    const subjects = entityIds
      .map((entityId) => batchedFacts.get(entityId))
      .filter((subject) => subject !== undefined);
    const batched = await matchPartyBatch(context, subjects, strictness);

    for (const subject of subjects) {
      const perEntity = await matchParty(context, subject, strictness);
      expect({
        entityId: subject.entityId,
        matches: normalize(batched.get(subject.entityId as string) ?? []),
      }).toEqual({ entityId: subject.entityId, matches: normalize(perEntity) });
    }

    // A guard against the test passing vacuously: at least one subject must actually surface a hit,
    // or "the two agree" would mean "both returned nothing, everywhere".
    const totalHits = [...batched.values()].reduce((sum, matches) => sum + matches.length, 0);
    expect(totalHits).toBeGreaterThan(0);

    // And a guard per CHANNEL, for the same reason at finer grain: two paths can agree perfectly
    // about a channel neither of them ran. Every channel this corpus was built to exercise must have
    // fired somewhere in it, or its half of the equivalence proof is vacuous.
    const everyMatch = [...batched.values()].flat();
    expect(everyMatch.some((match) => match.evidence.exactNormalizedName)).toBe(true);
    expect(everyMatch.some((match) => match.evidence.matchKeyName === true)).toBe(true);
    expect(everyMatch.some((match) => match.evidence.bareMatchKeyName === true)).toBe(true);
    expect(everyMatch.some((match) => match.evidence.phoneticMatch)).toBe(true);
    expect(everyMatch.some((match) => match.evidence.trigramMatch)).toBe(true);
    expect(everyMatch.some((match) => match.evidence.identifierTypes.length > 0)).toBe(true);
  });
}

test("the batched matcher's query count follows the channel count, not the entity count", async () => {
  const context = await testContext("equivalence-query-count");
  const entityIds = await seedCorpus(context);
  const facts = await readSubjectFactsBatch(context, entityIds);
  const subjects = entityIds
    .map((entityId) => facts.get(entityId))
    .filter((subject) => subject !== undefined);

  // Count prepared statements against the real database rather than trusting the shape of the code:
  // an accidental per-entity read inside a loop is exactly the defect this assertion exists to catch,
  // and it is invisible to a correctness test.
  const database = context.database as unknown as { prepare: (sql: string) => unknown };
  const realPrepare = database.prepare.bind(database);
  let batchedQueries = 0;
  database.prepare = (sql: string) => {
    batchedQueries += 1;
    return realPrepare(sql);
  };
  await matchPartyBatch(context, subjects, "over_inclusive");
  const batched = batchedQueries;

  batchedQueries = 0;
  for (const subject of subjects) await matchParty(context, subject, "over_inclusive");
  const perEntity = batchedQueries;
  database.prepare = realPrepare;

  // The per-entity path issues at least one query per subject per channel; the batched path issues a
  // small fixed number regardless of how many subjects there are.
  expect(perEntity).toBeGreaterThan(subjects.length * 3);
  expect(batched).toBeLessThan(subjects.length);
  expect(batched).toBeLessThan(perEntity / 4);
});
