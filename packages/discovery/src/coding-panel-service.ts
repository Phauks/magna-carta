import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { ReviewSetId, ReviewTagGroupId, ReviewTagId } from "@magna-carta/identifiers/types";
import {
  insertTagGroupStatement,
  insertTagStatement,
  readNextTagGroupSortOrder,
  readNextTagSortOrder,
  readTag,
  readTagGroup,
  readTagGroups,
  readTags,
  renameTagGroupStatement,
  renameTagStatement,
  setTagActiveStatement,
  tagGroupNameIsTaken,
  tagNameIsTaken,
  type ReviewTagGroupRow,
  type ReviewTagRow,
} from "./coding-statements.ts";
import { MAX_TAG_GROUPS_PER_REVIEW_SET, MAX_TAGS_PER_REVIEW_SET } from "./limits.ts";
import type { ReviewSetAccessPredicate } from "./review-set-visibility.ts";
import type { DiscoveryServiceOptions } from "./review-set-service.ts";
import {
  SEEDED_TAG_GROUPS,
  type ReviewTagGroupCardinality,
  type ReviewTagSemantic,
} from "./types.ts";
import {
  assertTagColorToken,
  assertTagGroupName,
  assertTagName,
  DiscoveryValidationError,
} from "./validation.ts";

// The coding panel: a review set's questions and their answers. Editing the panel is a
// manage-the-review-set capability rather than a reviewing one — changing what the questions ARE is a
// different act from answering them.

// The three system groups, written in the same batch as the review set's own insert so no review set
// ever exists without a panel. Names and colours are a starting point the firm edits freely; the
// SEMANTICS are what production logic will stand on, which is why a semantic-bearing tag is
// deactivated rather than deleted.
export function seedCodingPanel(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  options: DiscoveryServiceOptions,
): EffectWrite {
  const now = options.clock.now();
  const statements = [];
  let groupSortOrder = 0;
  for (const group of SEEDED_TAG_GROUPS) {
    const reviewTagGroupId = newIdentifier("reviewTagGroup", options.randomSource);
    statements.push(
      insertTagGroupStatement(database, {
        id: reviewTagGroupId,
        reviewSetId,
        name: group.name,
        kind: "system",
        cardinality: group.cardinality,
        requiredForCompletion: group.requiredForCompletion,
        sortOrder: groupSortOrder,
        now,
      }),
    );
    groupSortOrder += 1;
    let tagSortOrder = 0;
    for (const tag of group.tags) {
      statements.push(
        insertTagStatement(database, {
          id: newIdentifier("reviewTag", options.randomSource),
          reviewTagGroupId,
          reviewSetId,
          name: tag.name,
          semantic: tag.semantic,
          colorToken: tag.colorToken,
          sortOrder: tagSortOrder,
          now,
        }),
      );
      tagSortOrder += 1;
    }
  }
  return { statements, outboxMessages: [] };
}

export interface CodingPanel {
  readonly groups: readonly ReviewTagGroupRow[];
  readonly tags: readonly ReviewTagRow[];
}

// Two reads rather than a join: the panel is a handful of groups and a few dozen tags, and a joined
// read would return the group's columns once per tag for a shape the caller has to un-flatten anyway.
export async function readCodingPanel(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
): Promise<CodingPanel> {
  const [groups, tags] = await Promise.all([
    readTagGroups(database, reviewSetId, access, MAX_TAG_GROUPS_PER_REVIEW_SET),
    readTags(database, reviewSetId, access, MAX_TAGS_PER_REVIEW_SET),
  ]);
  return { groups, tags };
}

export interface CreateTagGroupInput {
  readonly reviewSetId: ReviewSetId;
  readonly name: string;
  readonly cardinality: ReviewTagGroupCardinality;
  readonly requiredForCompletion?: boolean;
}

export async function createTagGroup(
  database: SqlDatabase,
  input: CreateTagGroupInput,
  access: ReviewSetAccessPredicate,
  options: DiscoveryServiceOptions,
): Promise<{ reviewTagGroupId: ReviewTagGroupId; effect: EffectWrite }> {
  const name = assertTagGroupName(input.name);
  if (await tagGroupNameIsTaken(database, input.reviewSetId, name)) {
    throw new DiscoveryValidationError(
      "discovery-tag-group-name-taken",
      `this review set already has a coding question called ${JSON.stringify(name)}`,
    );
  }
  const existing = await readTagGroups(
    database,
    input.reviewSetId,
    access,
    MAX_TAG_GROUPS_PER_REVIEW_SET + 1,
  );
  if (existing.length >= MAX_TAG_GROUPS_PER_REVIEW_SET) {
    throw new DiscoveryValidationError(
      "discovery-tag-group-limit-reached",
      `a review set carries at most ${MAX_TAG_GROUPS_PER_REVIEW_SET} coding questions`,
    );
  }
  const reviewTagGroupId = newIdentifier("reviewTagGroup", options.randomSource);
  const now = options.clock.now();
  return {
    reviewTagGroupId,
    effect: {
      statements: [
        insertTagGroupStatement(database, {
          id: reviewTagGroupId,
          reviewSetId: input.reviewSetId,
          name,
          // Nothing in the API mints a `system` group: the three that exist arrive by seeding, and
          // production logic stands on exactly those three existing rather than on however many a
          // firm decided to declare special.
          kind: "custom",
          cardinality: input.cardinality,
          requiredForCompletion: input.requiredForCompletion ?? false,
          sortOrder: await readNextTagGroupSortOrder(database, input.reviewSetId),
          now,
        }),
        domainAuditStatement(database, {
          clock: options.clock,
          actorUserId: options.actorUserId,
          randomSource: options.randomSource,
          event: "discovery.codingQuestionCreated",
          subjectId: input.reviewSetId,
          // Identifiers and the two scalars a reader needs. NEVER the name: a firm's issue codes name
          // the theory of its case.
          metadata: JSON.stringify({
            reviewTagGroupId,
            cardinality: input.cardinality,
            requiredForCompletion: input.requiredForCompletion ?? false,
          }),
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface CreateTagInput {
  readonly reviewTagGroupId: ReviewTagGroupId;
  readonly name: string;
  readonly colorToken: string;
}

// A tag created through the API carries NO semantic, and that is deliberate rather than an omission.
// A semantic is a promise to the production machinery that this answer means something specific;
// letting a firm attach one to a tag it invented would let a renamed label change what a production
// withholds. The semantic-bearing tags are the seeded ones.
export async function createTag(
  database: SqlDatabase,
  input: CreateTagInput,
  access: ReviewSetAccessPredicate,
  options: DiscoveryServiceOptions,
): Promise<{ reviewTagId: ReviewTagId; effect: EffectWrite }> {
  const name = assertTagName(input.name);
  const colorToken = assertTagColorToken(input.colorToken);
  const group = await requireTagGroup(database, input.reviewTagGroupId, access);
  if (await tagNameIsTaken(database, input.reviewTagGroupId, name)) {
    throw new DiscoveryValidationError(
      "discovery-tag-name-taken",
      `this coding question already has a tag called ${JSON.stringify(name)}`,
    );
  }
  const existing = await readTags(
    database,
    group.review_set_id,
    access,
    MAX_TAGS_PER_REVIEW_SET + 1,
  );
  if (existing.length >= MAX_TAGS_PER_REVIEW_SET) {
    throw new DiscoveryValidationError(
      "discovery-tag-limit-reached",
      `a review set carries at most ${MAX_TAGS_PER_REVIEW_SET} tags`,
    );
  }
  const reviewTagId = newIdentifier("reviewTag", options.randomSource);
  const now = options.clock.now();
  return {
    reviewTagId,
    effect: {
      statements: [
        insertTagStatement(database, {
          id: reviewTagId,
          reviewTagGroupId: input.reviewTagGroupId,
          reviewSetId: group.review_set_id,
          name,
          semantic: null,
          colorToken,
          sortOrder: await readNextTagSortOrder(database, input.reviewTagGroupId),
          now,
        }),
        domainAuditStatement(database, {
          clock: options.clock,
          actorUserId: options.actorUserId,
          randomSource: options.randomSource,
          event: "discovery.codingTagCreated",
          subjectId: group.review_set_id,
          metadata: JSON.stringify({ reviewTagGroupId: input.reviewTagGroupId, reviewTagId }),
        }),
      ],
      outboxMessages: [],
    },
  };
}

async function requireTagGroup(
  database: SqlDatabase,
  reviewTagGroupId: ReviewTagGroupId,
  access: ReviewSetAccessPredicate,
): Promise<ReviewTagGroupRow> {
  const row = await readTagGroup(database, reviewTagGroupId, access);
  if (row === undefined) {
    throw new DiscoveryValidationError(
      "discovery-unknown-tag-group",
      `no such coding question: ${reviewTagGroupId}`,
    );
  }
  return row;
}

async function requireTag(
  database: SqlDatabase,
  reviewTagId: ReviewTagId,
  access: ReviewSetAccessPredicate,
): Promise<ReviewTagRow> {
  const row = await readTag(database, reviewTagId, access);
  if (row === undefined) {
    throw new DiscoveryValidationError("discovery-unknown-tag", `no such tag: ${reviewTagId}`);
  }
  return row;
}

// Renaming is the only edit either shape takes, and a system group renames as freely as a custom one:
// nothing ever matched a group or a tag by its name, so a rename changes what a reviewer reads and
// nothing else. That is the whole point of the semantic column.
export async function renameTagGroup(
  database: SqlDatabase,
  reviewTagGroupId: ReviewTagGroupId,
  name: string,
  access: ReviewSetAccessPredicate,
  options: DiscoveryServiceOptions,
): Promise<EffectWrite> {
  const trimmed = assertTagGroupName(name);
  const group = await requireTagGroup(database, reviewTagGroupId, access);
  if (
    trimmed !== group.name &&
    (await tagGroupNameIsTaken(database, group.review_set_id, trimmed))
  ) {
    throw new DiscoveryValidationError(
      "discovery-tag-group-name-taken",
      `this review set already has a coding question called ${JSON.stringify(trimmed)}`,
    );
  }
  return {
    statements: [
      renameTagGroupStatement(database, reviewTagGroupId, trimmed, options.clock.now()),
      domainAuditStatement(database, {
        clock: options.clock,
        actorUserId: options.actorUserId,
        randomSource: options.randomSource,
        event: "discovery.codingQuestionRenamed",
        subjectId: group.review_set_id,
        metadata: JSON.stringify({ reviewTagGroupId }),
      }),
    ],
    outboxMessages: [],
  };
}

export async function renameTag(
  database: SqlDatabase,
  reviewTagId: ReviewTagId,
  name: string,
  access: ReviewSetAccessPredicate,
  options: DiscoveryServiceOptions,
): Promise<EffectWrite> {
  const trimmed = assertTagName(name);
  const tag = await requireTag(database, reviewTagId, access);
  if (trimmed !== tag.name && (await tagNameIsTaken(database, tag.review_tag_group_id, trimmed))) {
    throw new DiscoveryValidationError(
      "discovery-tag-name-taken",
      `this coding question already has a tag called ${JSON.stringify(trimmed)}`,
    );
  }
  return {
    statements: [
      renameTagStatement(database, reviewTagId, trimmed, options.clock.now()),
      domainAuditStatement(database, {
        clock: options.clock,
        actorUserId: options.actorUserId,
        randomSource: options.randomSource,
        event: "discovery.codingTagRenamed",
        subjectId: tag.review_set_id,
        metadata: JSON.stringify({ reviewTagId }),
      }),
    ],
    outboxMessages: [],
  };
}

// DEACTIVATED, NEVER DELETED. A tag that has ever been applied is on rows the coding journal points
// at, and deleting it would orphan the history that is the point of the journal. Deactivating hides
// it from the panel and leaves every row readable and attributable.
//
// A semantic-bearing tag cannot even be deactivated: production membership, privilege logging and
// completion arithmetic all resolve through the semantics, and a firm that hid "Privileged" would
// have removed the only way to withhold anything.
export async function setTagActive(
  database: SqlDatabase,
  reviewTagId: ReviewTagId,
  active: boolean,
  access: ReviewSetAccessPredicate,
  options: DiscoveryServiceOptions,
): Promise<EffectWrite> {
  const tag = await requireTag(database, reviewTagId, access);
  if (!active && tag.semantic !== null) {
    throw new DiscoveryValidationError(
      "discovery-semantic-tag-not-deactivatable",
      `${JSON.stringify(tag.name)} carries the ${tag.semantic} meaning that production and ` +
        `privilege logging resolve through, so it stays available. Rename it if the wording is ` +
        `wrong — nothing matches it by name.`,
    );
  }
  return {
    statements: [
      setTagActiveStatement(database, reviewTagId, active, options.clock.now()),
      domainAuditStatement(database, {
        clock: options.clock,
        actorUserId: options.actorUserId,
        randomSource: options.randomSource,
        event: active ? "discovery.codingTagReactivated" : "discovery.codingTagDeactivated",
        subjectId: tag.review_set_id,
        metadata: JSON.stringify({ reviewTagId }),
      }),
    ],
    outboxMessages: [],
  };
}

// Resolving a tag for an application: it must exist, be reachable, be active, and belong to the
// review set the document is in. The last check is what stops one matter's panel being applied to
// another matter's corpus.
export async function resolveApplicableTag(
  database: SqlDatabase,
  reviewTagId: ReviewTagId,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
): Promise<{ tag: ReviewTagRow; group: ReviewTagGroupRow }> {
  const tag = await requireTag(database, reviewTagId, access);
  if (tag.review_set_id !== reviewSetId) {
    throw new DiscoveryValidationError(
      "discovery-tag-review-set-mismatch",
      "that tag belongs to a different review set's coding panel",
    );
  }
  if (tag.active === 0) {
    throw new DiscoveryValidationError(
      "discovery-tag-inactive",
      `${JSON.stringify(tag.name)} has been deactivated and is not applied to anything new. It ` +
        `stays readable on every document already carrying it.`,
    );
  }
  const group = await requireTagGroup(database, tag.review_tag_group_id, access);
  return { tag, group };
}

export type { ReviewTagSemantic };
