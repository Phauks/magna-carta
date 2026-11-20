/*
 * My Reports: the reports this member sent, and the one the address names. Fired and not awaited.
 */
import { incidentsGetMineOptions, incidentsListMineOptions } from "@magna-carta/api-client";
import { warm } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  warm(incidentsListMineOptions());
  if (params.incidentId !== undefined) {
    warm(incidentsGetMineOptions({ path: { incidentId: params.incidentId } }));
  }
};
