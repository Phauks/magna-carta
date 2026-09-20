/*
 * The meeting client at the path it has always been imported from.
 *
 * The client itself is now `client/meeting-client.svelte.ts`, beside the modules it composes
 * (see this directory's CLAUDE.md for the map). This file re-exports it so the two modules that
 * are NOT part of the room — `meetings-api.ts` and `meeting-entry-action.svelte`, which want
 * nothing from it but the `MeetingMedium` union — keep importing what they always did rather than
 * reaching into the room's own directory for a type about a calendar entry.
 *
 * Anything in the room imports from `client/` directly.
 */
export * from "./client/meeting-client.svelte.ts";
