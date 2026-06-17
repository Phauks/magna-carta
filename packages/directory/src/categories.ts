import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DirectoryCategoryId } from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.js";
import { entityKindFromId } from "./entity-kind.js";
import type { EntityKind } from "./types.js";

// Thrown when a caller references a category id that does not exist in directory_category.
export class CategoryNotFoundError extends Error {
  readonly code = "not-found";
  constructor(categoryId: string) {
    super(`directory: category not found: ${categoryId}`);
    this.name = "CategoryNotFoundError";
  }
}

// Thrown when a caller tries to assign a category to an entity whose kind does not match
// the category's applies_to constraint (e.g. a person-only category assigned to an organization).
export class CategoryAppliestoMismatchError extends Error {
  readonly code = "category-applies-to-mismatch";
  constructor(categoryId: string, appliesTo: string, entityKind: EntityKind) {
    super(
      `directory: category ${categoryId} applies to "${appliesTo}" entities only, but entity is a "${entityKind}"`,
    );
    this.name = "CategoryAppliestoMismatchError";
  }
}

// The applies_to values permitted in directory_category.
export type CategoryAppliesTo = "person" | "organization" | "both";

// The caller-supplied fields for a new category (label).
export interface CreateCategoryInput {
  readonly name: string;
  // Restricts which entity kinds this category may be assigned to.
  readonly appliesTo: CategoryAppliesTo;
  // Display order among categories. Defaults to 0 when omitted.
  readonly position?: number;
}

// The row shape returned by readCategories.
export interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly appliesTo: CategoryAppliesTo;
  readonly position: number;
  readonly archived: number;
}

// The caller-supplied fields for linking an entity to a category.
export interface AssignCategoryInput {
  readonly entityId: string;
  readonly categoryId: string;
}

// Creates a new category (label) in an atomic batch that also writes the domain audit row.
// The id is minted with the "directoryCategory" prefix. position defaults to 0.
export async function createCategory(
  database: BatchDatabase,
  input: CreateCategoryInput,
  options: DirectoryWriteOptions,
): Promise<{ id: DirectoryCategoryId }> {
  const categoryId = newIdentifier("directoryCategory", options.randomSource);
  const now = options.clock.now();
  const position = input.position ?? 0;

  const statements: SqlStatement[] = [
    database
      .prepare(
        `INSERT INTO directory_category (id, name, applies_to, position, archived, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)`,
      )
      .bind(categoryId, input.name, input.appliesTo, position, now),
    directoryAuditStatement(database, options, "directory.category.created", categoryId),
  ];

  await commitEffectBatch(database, { statements, outboxMessages: [] }, { now: () => now });

  return { id: categoryId };
}

// Links an entity to a category within an atomic batch that also writes the domain audit row.
// Validates:
// 1. The category exists — throws CategoryNotFoundError (code: "not-found") if not.
// 2. The entity exists in its type table — throws CategoryNotFoundError (code: "not-found") if not.
// 3. The category's applies_to constraint matches the entity kind — throws
//    CategoryAppliestoMismatchError (code: "category-applies-to-mismatch") if the category is
//    person-only and the entity is an organization, or vice versa. "both" accepts either kind.
export async function assignCategory(
  database: BatchDatabase,
  input: AssignCategoryInput,
  options: DirectoryWriteOptions,
): Promise<void> {
  // 1. Validate category exists and fetch its applies_to value.
  const { results: categoryResults } = await database
    .prepare(`SELECT id, applies_to FROM directory_category WHERE id = ?1`)
    .bind(input.categoryId)
    .all<{ id: string; applies_to: string }>();

  if (categoryResults.length === 0) {
    throw new CategoryNotFoundError(input.categoryId);
  }

  const appliesTo = categoryResults[0]!.applies_to as CategoryAppliesTo;

  // 2. Determine entity kind from its id prefix, then validate the entity exists.
  const entityKind = entityKindFromId(input.entityId);
  const entityTable = entityKind === "person" ? "directory_person" : "directory_organization";

  const { results: entityResults } = await database
    .prepare(`SELECT id FROM ${entityTable} WHERE id = ?1`)
    .bind(input.entityId)
    .all<{ id: string }>();

  if (entityResults.length === 0) {
    throw new CategoryNotFoundError(input.entityId);
  }

  // 3. Validate applies_to compatibility.
  if (appliesTo !== "both" && appliesTo !== entityKind) {
    throw new CategoryAppliestoMismatchError(input.categoryId, appliesTo, entityKind);
  }

  const now = options.clock.now();

  const statements: SqlStatement[] = [
    database
      .prepare(`INSERT INTO directory_entity_category (entity_id, category_id) VALUES (?1, ?2)`)
      .bind(input.entityId, input.categoryId),
    directoryAuditStatement(database, options, "directory.category.assigned", input.entityId),
  ];

  await commitEffectBatch(database, { statements, outboxMessages: [] }, { now: () => now });
}

// Returns all categories linked to the given entity by joining directory_entity_category
// with directory_category. Returns an empty array when no categories are assigned.
export async function readCategories(
  database: BatchDatabase,
  entityId: string,
): Promise<CategoryRow[]> {
  const { results } = await database
    .prepare(
      `SELECT c.id, c.name, c.applies_to, c.position, c.archived
       FROM directory_entity_category ec
       JOIN directory_category c ON c.id = ec.category_id
       WHERE ec.entity_id = ?1`,
    )
    .bind(entityId)
    .all<{
      id: string;
      name: string;
      applies_to: string;
      position: number;
      archived: number;
    }>();

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    appliesTo: row.applies_to as CategoryAppliesTo,
    position: row.position,
    archived: row.archived,
  }));
}
