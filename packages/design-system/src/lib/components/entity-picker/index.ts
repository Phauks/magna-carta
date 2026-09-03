/*
 * EntityPicker — the one field a person or an organization is chosen in, exported as a single
 * component rather than the house namespace shape. It has no parts to compose: a caller hands it a
 * search and gets an entity back, and every surface that picks from the directory is therefore the
 * same field. tooling/lint-one-ui holds the line.
 *
 * The rules travel with it because they have callers outside the field: what the floor is and what a
 * failed search is shown as are answers a test asserts and a caller may need to state elsewhere.
 */
export { default } from "./entity-picker.svelte";
export { default as EntityPicker } from "./entity-picker.svelte";
export type {
  EntityPickerAnswer,
  EntityPickerStatus,
  EntitySearch,
  PickableEntity,
} from "./types.ts";
export {
  CAPPED_SENTENCE,
  DEFAULT_MINIMUM_QUERY_LENGTH,
  SEARCH_SETTLE_MILLISECONDS,
  offerableEntities,
  runEntitySearch,
  searchRequestFor,
  tooShortSentence,
  type SearchOutcome,
  type SearchRequest,
} from "./picker-search.ts";
