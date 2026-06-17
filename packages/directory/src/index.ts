export * from "./types.js";
export { normalizeName } from "./normalize-name.js";
export { phoneticCodes } from "./phonetics.js";
export { createPerson, readPerson, updatePerson } from "./person.js";
export { createOrganization, readOrganization } from "./organization.js";
export { addName, changeName } from "./name-history.js";
export { createEdge, readEdges, InvalidEdgeTypeError, UnknownEntityError } from "./edges.js";
export type { CreateEdgeInput, DirectoryEdge } from "./edges.js";
export { searchNames, findDuplicateCandidates } from "./search.js";
export type { NameSearchHit, FindDuplicateCandidatesInput, DuplicateCandidate } from "./search.js";
export {
  addIdentifier,
  findByIdentifier,
  readIdentifier,
  IdentifierNotIndexableError,
} from "./identifiers.js";
export type {
  AddIdentifierInput,
  DirectoryIdentifierContext,
  FindByIdentifierInput,
} from "./identifiers.js";
export type {
  AddNameInput,
  AddOrganizationNameInput,
  AddPersonNameInput,
  ChangeNameInput,
  ChangeOrganizationNameInput,
  ChangePersonNameInput,
} from "./name-history.js";
export type { DirectoryWriteOptions } from "./audit.js";
export {
  createCategory,
  assignCategory,
  readCategories,
  CategoryNotFoundError,
  EntityNotFoundError,
  CategoryAppliesToMismatchError,
} from "./categories.js";
export type {
  CreateCategoryInput,
  AssignCategoryInput,
  CategoryRow,
  CategoryAppliesTo,
} from "./categories.js";
export {
  mergeEntities,
  MergeSameEntityError,
  MergeEntityNotFoundError,
  MergeKindMismatchError,
  MergeAlreadyMergedError,
} from "./merge.js";
export type { MergeEntitiesInput, SurvivorshipInput, SurvivorshipChoice } from "./merge.js";
export {
  assertNoDanglingToSubordinate,
  findDanglingToSubordinate,
  DanglingSubordinateReferenceError,
} from "./fitness.js";
export type { DanglingReference } from "./fitness.js";
export { linkMatterParty, readMatterParties, createPartyRole, listPartyRoles } from "./party.js";
export type {
  LinkMatterPartyInput,
  MatterPartyRow,
  CreatePartyRoleInput,
  PartyRoleRow,
} from "./party.js";
export { migrateClientDisplayFields } from "./client-migration.js";
