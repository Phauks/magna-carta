export * from "./types.ts";
export { normalizeName } from "./normalize-name.ts";
export { phoneticCodes } from "./phonetics.ts";
export { LEGAL_ENTITY_FORMS, normalizedMatchKey, normalizedMatchKeyBare } from "./match-key.ts";
export {
  countNamesAwaitingIndexBackfill,
  runNameIndexBackfillPass,
  DEFAULT_BACKFILL_BATCH_SIZE,
} from "./name-index-backfill.ts";
export type { NameIndexBackfillResult } from "./name-index-backfill.ts";
export { nicknameCatalogueIsPopulated, readNicknameEquivalences } from "./nickname.ts";
export type { NicknameEquivalence } from "./nickname.ts";
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
export { addName, changeName, readNames } from "./name-history.ts";
export {
  createEdge,
  readEdges,
  readEdgesForEntities,
  readEdgesPage,
  InvalidEdgeTypeError,
  UnknownEntityError,
} from "./edges.ts";
export {
  assertEntityExists,
  entityKindFromId,
  nodeTableForEntityId,
  MergedEntityError,
} from "./entity-kind.ts";
export type { CreateEdgeInput, DirectoryEdge, ReadEdgesOptions } from "./edges.ts";
export { searchNames, findDuplicateCandidates, findDuplicateCandidatesBatch } from "./search.ts";
export type {
  NameSearchHit,
  FindDuplicateCandidatesInput,
  DuplicateCandidate,
  BatchSubject,
} from "./search.ts";
export {
  addIdentifier,
  findByIdentifier,
  listIdentifierRecords,
  readIdentifier,
  IdentifierNotIndexableError,
} from "./identifiers.ts";
export type {
  AddIdentifierInput,
  DirectoryIdentifierContext,
  FindByIdentifierInput,
  IdentifierRecord,
} from "./identifiers.ts";
export type {
  AddNameInput,
  AddOrganizationNameInput,
  AddPersonNameInput,
  DirectoryNameRecord,
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
  listCategories,
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
  findNamesMissingDerivedMatchingData,
  findEdgesToDeletedEntities,
  DanglingSubordinateReferenceError,
  DirectoryFitnessError,
} from "./fitness.ts";
export type {
  DanglingReference,
  NameMissingPhonetics,
  NameMissingDerivation,
  EdgeToDeletedEntity,
} from "./fitness.ts";
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
export {
  linkMatterParty,
  unlinkMatterParty,
  readMatterParties,
  readMatterPartiesForEntity,
  createPartyRole,
  listPartyRoles,
} from "./party.ts";
export type {
  LinkMatterPartyInput,
  MatterPartyRow,
  EntityMatterPartyRow,
  CreatePartyRoleInput,
  PartyRoleRow,
} from "./party.ts";
export { readEntityDisplayNames, MAX_ENTITY_DISPLAY_NAME_LOOKUP } from "./entity-display.ts";
export type { EntityDisplayName } from "./entity-display.ts";
export { readEntityListing } from "./entity-listing.ts";
export type {
  DirectoryEntityListingKind,
  DirectoryEntityListingPage,
  DirectoryEntityListingRow,
} from "./entity-listing.ts";
export { migrateClientDisplayFields } from "./client-migration.ts";
