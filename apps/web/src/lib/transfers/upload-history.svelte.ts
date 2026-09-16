/*
 * The upload history — reactive half. The shapes, the validator and the record-keeping rules are
 * beside this file (upload-history.ts), which says why any of it exists; this is the store over
 * them, on the shared persisted-preference primitive.
 */
import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
import {
  uploadHistoryCodec,
  withFinishedUpload,
  type FinishedUpload,
  type UploadHistoryEntry,
} from "./upload-history.ts";

const preference = createPersistedPreference(uploadHistoryCodec());
preference.followAcrossTabs();

/** What this browser remembers about finished uploads, newest first. */
export function uploadHistory(): readonly UploadHistoryEntry[] {
  return preference.current.entries;
}

/** Remember a batch that has finished. */
export function rememberFinishedUpload(finished: FinishedUpload): void {
  preference.set(withFinishedUpload(preference.current, finished));
}

/** Forget one remembered batch. The files themselves are untouched — they are on the matter. */
export function forgetUpload(id: string): void {
  preference.set({ entries: preference.current.entries.filter((entry) => entry.id !== id) });
}

/** Forget everything this browser remembers about finished uploads. */
export function clearUploadHistory(): void {
  preference.set({ entries: [] });
}

export { redownloadableCount } from "./upload-history.ts";
export type {
  FinishedUpload,
  UploadHistoryEntry,
  UploadHistoryFile,
  UploadHistoryOutcome,
} from "./upload-history.ts";
