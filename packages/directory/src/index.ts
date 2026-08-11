export * from "./types.ts";
export { normalizeName } from "./normalize-name.ts";
export { phoneticCodes } from "./phonetics.ts";
export { createPerson, readPerson, updatePerson } from "./person.ts";
export { setPersonPronouns } from "./person.ts";
export type { Person } from "./person.ts";
export {
  IncompletePronounSetError,
  isPronounVerbNumber,
  pronounLabel,
  pronounSetFromColumns,
  validatePronounSet,
  PRONOUN_VERB_NUMBERS,
} from "./pronouns.ts";
export type { PronounColumns, PronounSet, PronounVerbNumber } from "./pronouns.ts";
export { createOrganization, readOrganization } from "./organization.ts";
export { addName, changeName } from "./name-history.ts";
export { createEdge, readEdges, InvalidEdgeTypeError, UnknownEntityError } from "./edges.ts";
export {
  assertEntityExists,
  entityKindFromId,
  nodeTableForEntityId,
  MergedEntityError,
} from "./entity-kind.ts";
export type { CreateEdgeInput, DirectoryEdge } from "./edges.ts";
export { searchNames, findDuplicateCandidates } from "./search.ts";
export type { NameSearchHit, FindDuplicateCandidatesInput, DuplicateCandidate } from "./search.ts";
export {
  addIdentifier,
  findByIdentifier,
  readIdentifier,
  IdentifierNotIndexableError,
} from "./identifiers.ts";
export type {
  AddIdentifierInput,
  DirectoryIdentifierContext,
  FindByIdentifierInput,
} from "./identifiers.ts";
export type {
  AddNameInput,
  AddOrganizationNameInput,
  AddPersonNameInput,
  ChangeNameInput,
  ChangeOrganizationNameInput,
  ChangePersonNameInput,
} from "./name-history.ts";
export type { DirectoryWriteOptions } from "./audit.ts";
export { DirectoryIdempotencyConflictError } from "./run-directory-effect.ts";
export type { DirectoryIdempotencyContext } from "./run-directory-effect.ts";
export {
  createCategory,
  assignCategory,
  readCategories,
  CategoryNotFoundError,
  EntityNotFoundError,
  CategoryAppliesToMismatchError,
} from "./categories.ts";
export type {
  CreateCategoryInput,
  AssignCategoryInput,
  CategoryRow,
  CategoryAppliesTo,
} from "./categories.ts";
export {
  mergeEntities,
  MergeSameEntityError,
  MergeEntityNotFoundError,
  MergeKindMismatchError,
  MergeAlreadyMergedError,
} from "./merge.ts";
export type { MergeEntitiesInput, SurvivorshipInput, SurvivorshipChoice } from "./merge.ts";
export {
  assertNoDanglingToSubordinate,
  findDanglingToSubordinate,
  assertDirectoryFitness,
  findNamesMissingPhonetics,
  findEdgesToDeletedEntities,
  DanglingSubordinateReferenceError,
  DirectoryFitnessError,
} from "./fitness.ts";
export type { DanglingReference, NameMissingPhonetics, EdgeToDeletedEntity } from "./fitness.ts";
export {
  addEmail,
  updateEmail,
  removeEmail,
  readEmails,
  findEntitiesByEmailAddress,
  findEntitiesByEmailAddresses,
  MAXIMUM_BATCHED_EMAIL_LOOKUPS,
  normalizeEmailAddress,
  InvalidEmailAddressError,
  DirectoryEmailNotFoundError,
} from "./contact-email.ts";
export type {
  AddEmailInput,
  UpdateEmailInput,
  DirectoryEmailRow,
  DirectoryEmailMatch,
} from "./contact-email.ts";
export { linkMatterParty, readMatterParties, createPartyRole, listPartyRoles } from "./party.ts";
export type {
  LinkMatterPartyInput,
  MatterPartyRow,
  CreatePartyRoleInput,
  PartyRoleRow,
} from "./party.ts";
export { migrateClientDisplayFields } from "./client-migration.ts";
