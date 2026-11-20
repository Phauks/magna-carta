/*
 * Problem Reports: the firm's reports, the firm's sharing switch, and the report the address names,
 * all started where the hover preload can reach them. Fired and not awaited.
 */
import {
  incidentsGetOptions,
  incidentsGetSharingOptions,
  incidentsListOptions,
} from "@magna-carta/api-client";
import { warm } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  warm(incidentsListOptions(), incidentsGetSharingOptions());
  if (params.incidentId !== undefined) {
    warm(incidentsGetOptions({ path: { incidentId: params.incidentId } }));
  }
};
