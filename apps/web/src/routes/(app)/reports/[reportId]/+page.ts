/*
 * A report's address names a declaration in the registry, and nothing else. An id nobody declared
 * 404s inside the app chrome rather than rendering a run screen over nothing.
 */
import { error } from "@sveltejs/kit";
import { reportById } from "$lib/reports/report-registry.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  const report = reportById(params.reportId);
  if (report === null) error(404, "Not Found");
  return { report };
};
