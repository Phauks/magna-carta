/*
 * A run's own read: the run, its files and its passes in one answer. Fired and not awaited, so the
 * workspace draws its shape at once and fills it from the cache.
 */
import { recordTransferGetRunOptions } from "@magna-carta/api-client";
import { warm } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  warm(recordTransferGetRunOptions({ path: { runId: params.runId } }));
};
