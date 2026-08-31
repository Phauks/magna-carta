/*
 * Filing a problem through the firm's own pipeline.
 *
 * It lives beside the cost ledger's calls rather than among them because it reads the BUILD
 * identity, which is baked in at build time: a module that carries it cannot be imported by a plain
 * unit test without the build's defines, and the ledger's pure helpers are tested exactly that way.
 * Keeping the two apart costs one file and buys a testable model.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";
import { buildIdentityLine } from "$lib/build-identity.ts";

/** What the firm's own reporting pipeline is told when a read fails and somebody reports it. */
export interface ProblemReport {
  readonly description: string;
  readonly errorIds: readonly string[];
  readonly route: string;
}

/**
 * File a problem through the firm's own pipeline.
 *
 * Nothing about the matter travels with it: the report carries the error handles, the route, the
 * build and the reporter's own words, and no document, file name or matter content.
 */
export function reportProblem(
  fetchImpl: typeof fetch,
  report: ProblemReport,
): Promise<ApiOutcome<{ id: string; status: string }>> {
  return requestJson(fetchImpl, "/api/v1/incidents", {
    method: "POST",
    body: {
      errorIds: report.errorIds,
      breadcrumbs: [],
      description: report.description,
      context: {
        route: report.route,
        appVersion: buildIdentityLine(),
        clientAt: new Date().toISOString(),
      },
    },
  });
}
