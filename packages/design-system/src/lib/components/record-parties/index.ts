/*
 * RecordParties — the people and organizations linked to a record, exported as a single component
 * rather than the house namespace shape. Like the attachments tab beside it, it deliberately has no
 * parts to compose: a record hands over who is on it, the roles it offers and the verbs that change
 * the list, and every record type in the product then shows its people the same way.
 *
 * The pure rules travel with it, because both have callers outside the markup: which tab a record
 * opens on is decided by whatever builds the window's tab list, and what the tab says about an entity
 * already on the record is worth testing on its own.
 */
export { default } from "./record-parties.svelte";
export { default as RecordParties } from "./record-parties.svelte";
export type { PartyLink, PartyRole, RecordParty } from "./types.ts";
export { alreadyHeldSentence, isRepeatLink, rolesAlreadyHeld } from "./linkable-entities.ts";
export { PARTIES_TAB_KEY, openingTabForParties } from "./parties-tab.ts";
