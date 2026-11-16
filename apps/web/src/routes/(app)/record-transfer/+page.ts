/*
 * The Record Transfer screen's one read, the firm's runs, started where the hover preload can
 * reach it. Fired and not awaited: the screen reads the same question back out of the cache.
 */
import { recordTransferListRunsOptions } from "@magna-carta/api-client";
import { warm } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
  warm(recordTransferListRunsOptions());
};
