import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { directoryIdentifierValue } from "@magna-carta/data-access/protected-field-registry";
import { addIdentifier, type DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { createEdge } from "@magna-carta/directory/edges";
import { changeName, addName } from "@magna-carta/directory/name-history";
import { createOrganization } from "@magna-carta/directory/organization";
import { linkMatterParty } from "@magna-carta/directory/party";
import { createPerson } from "@magna-carta/directory/person";
import type { DirectoryWriteOptions } from "@magna-carta/directory/audit";
import type { EdgeType } from "@magna-carta/directory/types";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DirectoryOrganizationId,
  DirectoryPersonId,
  FirmId,
} from "@magna-carta/identifiers/types";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { DirectoryVolume } from "./profile.ts";
import { createProfileFirmKeyProvider, PROTECTED_FIRM_KEY_VERSION } from "./protected-generate.ts";

// The directory volume: persons and organizations through createPerson/createOrganization, name
// history (changeName / addName) that keeps former and alias names in the conflicts corpus, a sparse
// relationship graph through createEdge, blind-indexed SSN identifiers through the REAL protected-field
// chokepoint (addIdentifier — the per-value HKDF index subkey + truncated HMAC, sealed under the
// seed-derived firm key), and matter-party links through linkMatterParty. Every write rides a REAL
// domain service — never a raw INSERT — so the data is valid by construction at any scale and the
// measured reads (blind-index lookup, protected-list decrypt, duplicate-candidate generation,
// inbound+outbound edge expansion) resolve against production-faithful row shapes.
//
// THE FIRM KEY IS DERIVED FROM THE SEED (createProfileFirmKeyProvider), not minted randomly: the
// snapshot artifact is cached and replayed, so the measurement run must reproduce the exact key that
// sealed the cached identifier ciphertexts. This mirrors protected-generate.ts — both sides call
// createProfileFirmKeyProvider with the same seed and get the same key.

// How many matter ids to pull for the matter-party links. The links carry no FK enforcement issue
// here (matter_party.matter_id references matter, and these are real matters the practice generator
// created), so the entity-existence check in linkMatterParty is what gates the write.
const MATTER_SAMPLE_LIMIT = 100;

// Probe identifiers the directory measurement layer binds its real operations to — deterministic for a
// given profile + seed, recorded in the snapshot manifest.
export interface DirectoryProbes {
  // The fixture firm the sealed identifier values are bound to (part of every AAD; reproduced on the
  // read side so the cached ciphertexts decrypt on replay).
  readonly firmId: FirmId;
  readonly firmKeyVersion: number;
  // The person with the most edges (inbound + outbound) — the graph-expansion hot case.
  readonly probePersonId: string;
  // The first organization — a stable second-entity probe.
  readonly probeOrganizationId: string;
  // A plaintext SSN-shaped value the blind-index probe (findByIdentifier) and candidate generation
  // match against — the exact value addIdentifier sealed for the probe person, so the lookup hits.
  readonly sampleSsnValue: string;
  // The probe person's structured name parts — fed to findDuplicateCandidates' name channels.
  readonly probeGivenName: string;
  readonly probeFamilyName: string;
  // A deterministic co-party pair: two persons sharing one exact name, so a conflicts check seeded with
  // BOTH surfaces each as the other's hit, flagged co_party. This is the load-profile expression of the
  // co-party surfacing path — matter-independent, so it exists at every scale.
  readonly coPartyEntityIdA: string;
  readonly coPartyEntityIdB: string;
  // A deterministic matching-depth trio, matter-independent so it exists at every scale. The first two
  // are one firm's name spelled two ways — ampersand versus the word, dots in the legal form versus
  // none — which the frozen normalization does NOT join and the match key does. The third differs from
  // them only in its legal FORM, which only the bare key joins. Without them the harness would measure
  // the two key channels against a synthetic corpus that never varies a spelling, and report a real
  // channel finding nothing as if that were its cost.
  readonly matchKeyOrganizationIdA: string;
  readonly matchKeyOrganizationIdB: string;
  readonly matchKeyOrganizationIdBareForm: string;
  // The head of the deep corporate group: a long corporate_successor lineage with a wide subsidiary
  // fan hanging off it. Corporate-family edges are traversed transitively at no hop cost, so a check
  // seeded here expands the whole group and is the case the closure cap exists for — the deep-graph
  // and truncating conflicts measurements both bind to it.
  readonly corporateGroupHeadId: string;
  // How many entities the group holds in total, so a measurement can assert its own shape.
  readonly corporateGroupSize: number;
}

export interface DirectoryGenerationResult {
  readonly personCount: number;
  readonly organizationCount: number;
  readonly probes: DirectoryProbes;
}

// Compose an SSN-shaped value (digits only, formatted) — never a real one.
function sampleSsn(context: FixtureContext): string {
  const digits = context.faker.string.numeric({ length: 9 });
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

// The non-identifier directory write options: the fixed clock, no acting user, the seeded source. NO
// idempotency — the load profile uses the non-idempotent direct path (the same as matters generation).
function directoryWriteOptions(context: FixtureContext): DirectoryWriteOptions {
  return { clock: context.clock, actorUserId: null, randomSource: context.randomSource };
}

// The relationship-graph edge types this volume draws from (person↔person and person↔org both ride
// the same opaque-entity-id edge table).
const EDGE_TYPE_POOL: readonly EdgeType[] = [
  "affiliation",
  "relationship",
  "representation",
  "role_assignment",
];

export async function generateDirectoryVolume(
  database: BatchDatabase,
  context: FixtureContext,
  volume: DirectoryVolume,
  options: SeedingOptions,
): Promise<DirectoryGenerationResult> {
  assertSeedingAllowed(options);
  const { faker } = context;
  const writeOptions = directoryWriteOptions(context);

  // The crypto context for the SSN identifiers — the seed-derived firm key, owner permission to write
  // the chokepoint, the per-firm database and the fixed clock/seeded source.
  const firmId = newIdentifier("firm", context.randomSource);
  const firmKeyProvider = await createProfileFirmKeyProvider(context.seed);
  const identifierContext: DirectoryIdentifierContext = {
    firmId,
    firmKeyVersion: PROTECTED_FIRM_KEY_VERSION,
    firmKeyProvider,
    database,
    effectivePermissions: new Set([directoryIdentifierValue.permission]),
    actorUserId: null,
    clock: context.clock,
    randomSource: context.randomSource,
  };

  // --- Persons. The first person is the probe; it is given the heaviest share of edges + a known SSN
  // so its graph-expansion read and its identifier lookup are the volume-shaped hot cases. ---
  const persons: { id: DirectoryPersonId; given: string; family: string }[] = [];
  for (let index = 0; index < volume.personCount; index += 1) {
    const given = faker.person.firstName();
    const family = faker.person.lastName();
    const personId = await createPerson(database, { given, family }, writeOptions);
    persons.push({ id: personId, given, family });
    context.clock.advanceMinutes(1);
  }
  if (persons.length === 0) {
    throw new Error("load-profile: directory volume generated no person");
  }

  // --- Organizations. ---
  const organizations: DirectoryOrganizationId[] = [];
  for (let index = 0; index < volume.organizationCount; index += 1) {
    const legalName = `${faker.company.name()} ${faker.company.buzzNoun()}`;
    const organizationId = await createOrganization(database, { legalName }, writeOptions);
    organizations.push(organizationId);
    context.clock.advanceMinutes(1);
  }

  // The probe person — given the heaviest share below.
  const probePerson = persons[0]!;

  // --- Name history. A fraction of persons get a name change (former name stays in the corpus); a
  // fraction get an alias (a non-current name). Drawn over the person list so the corpus carries the
  // multi-name shape the duplicate-candidate channels traverse at volume. ---
  const nameChangeCount = Math.round(volume.personCount * volume.nameChangeFraction);
  for (let index = 0; index < nameChangeCount && index < persons.length; index += 1) {
    await changeName(
      database,
      persons[index]!.id,
      { given: persons[index]!.given, family: faker.person.lastName() },
      writeOptions,
    );
    context.clock.advanceMinutes(1);
  }
  const aliasCount = Math.round(volume.personCount * volume.aliasNameFraction);
  for (let index = 0; index < aliasCount && index < persons.length; index += 1) {
    await addName(
      database,
      persons[index]!.id,
      { given: faker.person.firstName(), family: persons[index]!.family, nameRole: "alias" },
      writeOptions,
    );
    context.clock.advanceMinutes(1);
  }

  // --- The relationship graph. Each entity gets a draw of outbound edges in [min, max]; the probe
  // person is given the max both outbound (to other entities) and inbound (from other entities) so the
  // graph-expansion read — which unions from_entity_id and to_entity_id matches — has its hot case. ---
  const allEntities: string[] = [...persons.map((person) => person.id), ...organizations];
  const pickOtherEntity = (selfId: string): string => {
    let candidate = allEntities[faker.number.int({ min: 0, max: allEntities.length - 1 })]!;
    if (candidate === selfId && allEntities.length > 1) {
      candidate = allEntities[(allEntities.indexOf(selfId) + 1) % allEntities.length]!;
    }
    return candidate;
  };
  const edgeCounts = new Map<string, number>();
  const bumpEdge = (id: string) => edgeCounts.set(id, (edgeCounts.get(id) ?? 0) + 1);
  const makeEdge = async (from: string, to: string) => {
    if (from === to) return;
    await createEdge(
      database,
      {
        from: from as DirectoryPersonId,
        to: to as DirectoryPersonId,
        edgeType: EDGE_TYPE_POOL[faker.number.int({ min: 0, max: EDGE_TYPE_POOL.length - 1 })]!,
        role: null,
        note: null,
        validFrom: null,
        validTo: null,
      },
      writeOptions,
    );
    bumpEdge(from);
    bumpEdge(to);
    context.clock.advanceMinutes(1);
  };
  for (const entityId of allEntities) {
    const outbound = faker.number.int({
      min: volume.edgesPerEntity.min,
      max: volume.edgesPerEntity.max,
    });
    for (let index = 0; index < outbound; index += 1) {
      await makeEdge(entityId, pickOtherEntity(entityId));
    }
  }
  // Guarantee the probe person is the busiest node: give it max edges both ways (over and above any
  // draw above), so the inbound+outbound expansion always has its hot case.
  for (let index = 0; index < volume.edgesPerEntity.max + 1; index += 1) {
    await makeEdge(probePerson.id, pickOtherEntity(probePerson.id));
    await makeEdge(pickOtherEntity(probePerson.id), probePerson.id);
  }

  // --- Sensitive identifiers (SSN) through the REAL protected-field chokepoint. The probe person gets
  // a KNOWN value first so the blind-index lookup + candidate generation match it; the rest get random
  // SSN-shaped values. The measurement prefetches a page of these rows to decrypt. ---
  const probeSsnValue = sampleSsn(context);
  await addIdentifier(identifierContext, probePerson.id, { type: "ssn", value: probeSsnValue });

  const identifierTarget = Math.min(volume.identifiersPerEntity, persons.length);
  for (let index = 1; index < identifierTarget; index += 1) {
    await addIdentifier(identifierContext, persons[index]!.id, {
      type: "ssn",
      value: sampleSsn(context),
    });
  }

  // --- Matter-party links. A fraction of persons are joined to a real matter (created by the practice
  // generator) in a role. The matter ids come from the DB — the practice volume ran first on the same
  // database. With no matters present the links are skipped (a directory-only smaller scale still
  // generates). ---
  const { results: matterRows } = await database
    .prepare("SELECT id FROM matter ORDER BY id LIMIT ?1")
    .bind(MATTER_SAMPLE_LIMIT)
    .all<{ id: string }>();
  const matterIds = matterRows.map((row) => row.id);
  if (matterIds.length > 0) {
    const PARTY_ROLES = ["client", "opposing_party", "guardian", "witness"] as const;
    const matterPartyCount = Math.round(volume.personCount * volume.matterPartyFraction);
    for (let index = 0; index < matterPartyCount && index < persons.length; index += 1) {
      await linkMatterParty(
        database,
        {
          matterId: matterIds[faker.number.int({ min: 0, max: matterIds.length - 1 })]!,
          entityId: persons[index]!.id,
          role: PARTY_ROLES[faker.number.int({ min: 0, max: PARTY_ROLES.length - 1 })]!,
        },
        writeOptions,
      );
      context.clock.advanceMinutes(1);
    }
  }

  // --- The co-party pair. Two persons created with an IDENTICAL name so the tier-2 exact-name probe
  // (and the phonetic/trigram channels) match one from the other. A conflicts check seeded with both
  // then surfaces each as the other's hit — flagged co_party because each is itself a subject party of
  // the check — which is exactly the co-party surfacing path the measurement exercises. Created outside
  // any volume loop and independent of matters, so the pair is present at every scale. ---
  const coPartyGiven = faker.person.firstName();
  const coPartyFamily = faker.person.lastName();
  const coPartyEntityIdA = await createPerson(
    database,
    { given: coPartyGiven, family: coPartyFamily },
    writeOptions,
  );
  context.clock.advanceMinutes(1);
  const coPartyEntityIdB = await createPerson(
    database,
    { given: coPartyGiven, family: coPartyFamily },
    writeOptions,
  );
  context.clock.advanceMinutes(1);

  // --- The match-key probes. Spelling variance the generated corpus does not otherwise contain:
  // faker draws one spelling of a company name and never the same name spelled two different ways. A
  // channel measured against a corpus that cannot exercise it reports as costing something and
  // finding nothing, which is exactly the reading a new channel must never be given. ---
  const matchKeyOrganizationIdA = await createOrganization(
    database,
    { legalName: "Halvorsen & Achebe LLP" },
    writeOptions,
  );
  context.clock.advanceMinutes(1);
  const matchKeyOrganizationIdB = await createOrganization(
    database,
    { legalName: "Halvorsen and Achebe, L.L.P." },
    writeOptions,
  );
  context.clock.advanceMinutes(1);
  const matchKeyOrganizationIdBareForm = await createOrganization(
    database,
    { legalName: "Halvorsen & Achebe LLC" },
    writeOptions,
  );
  context.clock.advanceMinutes(1);

  // --- The deep corporate group. A corporate_successor lineage (the same legal person continuing
  // through a chain of renames and mergers) with a wide subsidiary fan on its head. Corporate-family
  // edges cost no hops, so the whole group is one closure however long the chain runs — which is
  // exactly the shape that makes an unbounded traversal an availability problem, and exactly the
  // shape the closure cap and its truncation record exist to handle honestly. ---
  const corporateEdge = async (from: string, to: string, edgeType: EdgeType) => {
    await createEdge(
      database,
      {
        from: from as DirectoryOrganizationId,
        to: to as DirectoryOrganizationId,
        edgeType,
        role: null,
        note: null,
        validFrom: null,
        validTo: null,
      },
      writeOptions,
    );
    context.clock.advanceMinutes(1);
  };
  const corporateGroupHeadId = await createOrganization(
    database,
    { legalName: "Meridian Holdings Group" },
    writeOptions,
  );
  context.clock.advanceMinutes(1);
  let chainTail = corporateGroupHeadId as string;
  let corporateGroupSize = 1;
  for (let index = 0; index < volume.corporateGroup.chainLength; index += 1) {
    // The lineage DOES share a name, and legitimately: a successor chain is the same legal person
    // continuing, so the engine is expected to match across every link of it.
    const successor = await createOrganization(
      database,
      { legalName: `Meridian Holdings Group ${index + 2}` },
      writeOptions,
    );
    context.clock.advanceMinutes(1);
    await corporateEdge(chainTail, successor, "corporate_successor");
    chainTail = successor;
    corporateGroupSize += 1;
  }
  // The fan's names are DRAWN, not templated. A templated name ("Operating 1 Limited", "Operating 2
  // Limited") makes every subsidiary a trigram match for every other, so the measured cost becomes an
  // all-pairs name collision rather than the graph traversal the fixture exists to shape — quadratic
  // in the fan width, and a measurement of the wrong thing. Real subsidiaries carry real names.
  for (let index = 0; index < volume.corporateGroup.fanWidth; index += 1) {
    const subsidiary = await createOrganization(
      database,
      { legalName: `${faker.company.name()} ${faker.company.buzzNoun()}` },
      writeOptions,
    );
    context.clock.advanceMinutes(1);
    await corporateEdge(corporateGroupHeadId, subsidiary, "corporate_subsidiary");
    corporateGroupSize += 1;
  }

  return {
    // The volume persons plus the two co-party persons.
    personCount: volume.personCount + 2,
    organizationCount: volume.organizationCount + corporateGroupSize + 3,
    probes: {
      firmId,
      firmKeyVersion: PROTECTED_FIRM_KEY_VERSION,
      probePersonId: probePerson.id,
      probeOrganizationId: organizations[0] ?? probePerson.id,
      sampleSsnValue: probeSsnValue,
      probeGivenName: probePerson.given,
      probeFamilyName: probePerson.family,
      coPartyEntityIdA,
      coPartyEntityIdB,
      matchKeyOrganizationIdA,
      matchKeyOrganizationIdB,
      matchKeyOrganizationIdBareForm,
      corporateGroupHeadId,
      corporateGroupSize,
    },
  };
}
