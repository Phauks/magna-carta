import { createEdge } from "@magna-carta/directory/edges";
import { createOrganization } from "@magna-carta/directory/organization";
import { linkMatterParty } from "@magna-carta/directory/party";
import { createPerson } from "@magna-carta/directory/person";
import {
  DIRECTORY_EDGE_CREATED_TOPIC,
  DIRECTORY_ENTITY_CREATED_TOPIC,
  DIRECTORY_ENTITY_MERGED_TOPIC,
  DIRECTORY_ENTITY_RENAMED_TOPIC,
  DIRECTORY_IDENTIFIER_ADDED_TOPIC,
  MATTER_PARTY_LINKED_TOPIC,
} from "@magna-carta/directory/topics";
import { MATTER_OPENED_TOPIC } from "@magna-carta/matters/topics";
import { expect, test } from "vitest";
import {
  CONFLICTS_PERSONNEL_TOPIC,
  resolveAffectedMatters,
  triggerForCauseTopic,
} from "../src/recheck-cause.ts";
import { recheckFixture } from "./support/recheck-fixture.ts";

// WHICH MATTERS A CORPUS CHANGE COULD HAVE CHANGED THE ANSWER FOR.
//
// The interesting cases are the two ends: a merge reaching a matter that named only the ARCHIVED
// record (the highest-value trigger in the catalogue, and the one a naive "matters naming the master"
// query would miss entirely), and an entity creation reaching NOTHING (the import regression — a
// contact import must not re-screen a firm's whole caseload).

test("a party link resolves to the named matter, keyed on the entity", async () => {
  const fixture = await recheckFixture("party-link");
  fixture.addMatter("matter_one");
  const entityId = await createPerson(
    fixture.database,
    { given: "Ada", family: "Byron" },
    fixture.writeOptions,
  );

  const cause = await resolveAffectedMatters(fixture.database, MATTER_PARTY_LINKED_TOPIC, {
    matterId: "matter_one",
    entityId,
  });
  expect(cause.matterIds).toEqual(["matter_one"]);
  // Keyed on the entity, not the link row, so the unlink-then-link a role change is expressed as
  // stays one question about one entity rather than becoming two.
  expect(cause.causeReference).toBe(entityId);
});

test("a merge reaches matters that named the master OR the subordinate, and not closed ones", async () => {
  const fixture = await recheckFixture("merge-reach");
  fixture.addMatter("matter_master");
  fixture.addMatter("matter_subordinate");
  fixture.addMatter("matter_closed", "closed");
  const masterId = await createPerson(
    fixture.database,
    { given: "Ada", family: "Byron" },
    fixture.writeOptions,
  );
  const subordinateId = await createPerson(
    fixture.database,
    { given: "Ada", family: "Byron" },
    fixture.writeOptions,
  );
  await linkMatterParty(
    fixture.database,
    { matterId: "matter_master", entityId: masterId, role: "client" },
    fixture.writeOptions,
  );
  await linkMatterParty(
    fixture.database,
    { matterId: "matter_subordinate", entityId: subordinateId, role: "opposing_party" },
    fixture.writeOptions,
  );
  await linkMatterParty(
    fixture.database,
    { matterId: "matter_closed", entityId: subordinateId, role: "client" },
    fixture.writeOptions,
  );

  const cause = await resolveAffectedMatters(fixture.database, DIRECTORY_ENTITY_MERGED_TOPIC, {
    masterId,
    subordinateId,
    mergeId: "entityMerge_x",
  });
  // The subordinate's matter is the one a "matters naming the master" query would miss, and it is
  // precisely the matter whose answer the union of the two records could have changed.
  expect(cause.matterIds.toSorted()).toEqual(["matter_master", "matter_subordinate"]);
  // A closed matter's parties stay findable BY other matters' checks; the closed matter itself is
  // not re-screened, and its posture goes on reporting its last check verbatim.
  expect(cause.matterIds).not.toContain("matter_closed");
  // The subordinate is the stable key: an entity is merged away exactly once.
  expect(cause.causeReference).toBe(subordinateId);
});

test("a new edge reaches both endpoints' matters and a matter one hop across it", async () => {
  const fixture = await recheckFixture("edge-reach");
  fixture.addMatter("matter_parent");
  fixture.addMatter("matter_neighbour");
  const parent = await createOrganization(
    fixture.database,
    { legalName: "Acme Holdings" },
    fixture.writeOptions,
  );
  const subsidiary = await createOrganization(
    fixture.database,
    { legalName: "Acme Trading" },
    fixture.writeOptions,
  );
  const neighbour = await createOrganization(
    fixture.database,
    { legalName: "Beta Supply" },
    fixture.writeOptions,
  );
  await linkMatterParty(
    fixture.database,
    { matterId: "matter_parent", entityId: parent, role: "client" },
    fixture.writeOptions,
  );
  // Already-recorded relationship: the neighbour is one hop from the subsidiary, so a NEW edge onto
  // the subsidiary changes what a search seeded from the neighbour's matter would reach.
  await createEdge(
    fixture.database,
    {
      from: subsidiary,
      to: neighbour,
      edgeType: "affiliation",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    fixture.writeOptions,
  );
  await linkMatterParty(
    fixture.database,
    { matterId: "matter_neighbour", entityId: neighbour, role: "client" },
    fixture.writeOptions,
  );

  const cause = await resolveAffectedMatters(fixture.database, DIRECTORY_EDGE_CREATED_TOPIC, {
    edgeId: "directoryEdge_new",
    fromEntityId: parent,
    toEntityId: subsidiary,
    edgeType: "corporate_parent",
  });
  expect(cause.matterIds.toSorted()).toEqual(["matter_neighbour", "matter_parent"]);
  expect(cause.causeReference).toBe("directoryEdge_new");
});

test("an identifier is keyed on the identifier row, so a second one for the same entity is its own cause", async () => {
  const fixture = await recheckFixture("identifier-key");
  fixture.addMatter("matter_one");
  const entityId = await createPerson(
    fixture.database,
    { given: "Ada", family: "Byron" },
    fixture.writeOptions,
  );
  await linkMatterParty(
    fixture.database,
    { matterId: "matter_one", entityId, role: "client" },
    fixture.writeOptions,
  );

  const first = await resolveAffectedMatters(fixture.database, DIRECTORY_IDENTIFIER_ADDED_TOPIC, {
    entityId,
    identifierId: "directoryIdentifier_one",
    identifierType: "ssn",
  });
  const second = await resolveAffectedMatters(fixture.database, DIRECTORY_IDENTIFIER_ADDED_TOPIC, {
    entityId,
    identifierId: "directoryIdentifier_two",
    identifierType: "ein",
  });
  expect(first.matterIds).toEqual(["matter_one"]);
  // Two identifiers are two chances for an exact-identifier match. Collapsing them onto the entity
  // would lose the second, which is the one that could fire where the first could not.
  expect(first.causeReference).not.toBe(second.causeReference);
});

test("a rename reaches the matters the entity is a party on", async () => {
  const fixture = await recheckFixture("rename-reach");
  fixture.addMatter("matter_one");
  const entityId = await createPerson(
    fixture.database,
    { given: "Ada", family: "Byron" },
    fixture.writeOptions,
  );
  await linkMatterParty(
    fixture.database,
    { matterId: "matter_one", entityId, role: "client" },
    fixture.writeOptions,
  );

  const cause = await resolveAffectedMatters(fixture.database, DIRECTORY_ENTITY_RENAMED_TOPIC, {
    entityId,
  });
  expect(cause.matterIds).toEqual(["matter_one"]);
});

test("a firm-personnel change reaches every live matter, because imputation joins the roster", async () => {
  const fixture = await recheckFixture("personnel");
  fixture.addMatter("matter_one");
  fixture.addMatter("matter_two", "prospective");
  fixture.addMatter("matter_shut", "closed");

  const cause = await resolveAffectedMatters(fixture.database, CONFLICTS_PERSONNEL_TOPIC, {
    userId: "user_lateral",
  });
  expect(cause.matterIds.toSorted()).toEqual(["matter_one", "matter_two"]);
});

test("two hundred created entities produce no cause at all", async () => {
  // THE IMPORT REGRESSION. A new Directory entity cannot change any existing matter's answer until
  // something links it to a matter or connects it by an edge, and both of those arrive as their own
  // topics. Firing on creation would make a contact import re-screen a firm's entire open caseload
  // for no possible new hit — which is how a backstop becomes a thing people switch off.
  const fixture = await recheckFixture("import-storm");
  fixture.addMatter("matter_one");
  fixture.addMatter("matter_two");

  let totalMattersReached = 0;
  for (let index = 0; index < 200; index += 1) {
    const personId = await createPerson(
      fixture.database,
      { given: "Imported", family: `Contact${index}` },
      fixture.writeOptions,
    );
    const cause = await resolveAffectedMatters(fixture.database, DIRECTORY_ENTITY_CREATED_TOPIC, {
      personId,
    });
    totalMattersReached += cause.matterIds.length;
  }
  expect(totalMattersReached).toBe(0);
});

test("each cause topic records the trigger that names the event, not the outcome", () => {
  expect(triggerForCauseTopic(DIRECTORY_ENTITY_MERGED_TOPIC)).toBe("entity_merged");
  expect(triggerForCauseTopic(DIRECTORY_EDGE_CREATED_TOPIC)).toBe("relationship_recorded");
  expect(triggerForCauseTopic(DIRECTORY_IDENTIFIER_ADDED_TOPIC)).toBe("identifier_recorded");
  expect(triggerForCauseTopic(MATTER_PARTY_LINKED_TOPIC)).toBe("new_party");
  expect(triggerForCauseTopic(MATTER_OPENED_TOPIC)).toBe("comprehensive");
  expect(triggerForCauseTopic(CONFLICTS_PERSONNEL_TOPIC)).toBe("personnel_changed");
});

test("an unusable payload resolves to nothing rather than throwing", async () => {
  // A payload that will never parse can only march a permanent error to a dead-letter queue if it
  // throws. Resolving to nothing lets the consumer ack it and count the drop.
  const fixture = await recheckFixture("bad-payload");
  const cause = await resolveAffectedMatters(fixture.database, DIRECTORY_ENTITY_MERGED_TOPIC, {
    masterId: 42,
  });
  expect(cause.matterIds).toEqual([]);
});
