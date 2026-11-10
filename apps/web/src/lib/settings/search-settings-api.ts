/*
 * The firm's search settings over the wire: whether the words inside its files are indexed. One
 * read and one sparse write against GET/PATCH /api/v1/firm/search-settings, both behind
 * `firm:manageSearchSettings`.
 *
 * The `firmSearchSettings.get` and `firmSearchSettings.update` operations, reached through the
 * generated client rather than a hand-written path: the contract is generated and diff-gated, and a
 * module mirroring it by hand is a drift surface nothing keeps honest.
 *
 * THE READ CARRIES ONE FACT THE PAGE NEVER WRITES. `searchServiceConnected` says whether this
 * deployment has a search service to index with, so a firm that turned indexing on can be told that
 * nothing inside a file is searchable yet, and why.
 */
import {
  firmSearchSettingsGet,
  firmSearchSettingsUpdate,
  type FirmSearchSettingsResponse,
  type PatchFirmSearchSettingsRequest,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type SearchSettings = FirmSearchSettingsResponse;

/** A sparse change to the settings. An absent field is left exactly as it stands. */
export type SearchSettingsPatch = PatchFirmSearchSettingsRequest;

/** The permission both the read and the write name. Owners and administrators hold it by seed. */
export const MANAGE_SEARCH_SETTINGS_PERMISSION = "firm:manageSearchSettings";

export async function readSearchSettings(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<SearchSettings>> {
  try {
    const { data } = await firmSearchSettingsGet({ fetch: fetchImpl, throwOnError: true });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** Turns file indexing on or off for the whole firm; audited on the server. */
export async function updateSearchSettings(
  fetchImpl: typeof fetch,
  patch: SearchSettingsPatch,
  idempotencyKey: string,
): Promise<ApiOutcome<SearchSettings>> {
  try {
    const { data } = await firmSearchSettingsUpdate({
      fetch: fetchImpl,
      body: patch,
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}
