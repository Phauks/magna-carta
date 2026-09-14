/*
 * Filing a problem through the firm's own pipeline and nobody else's.
 *
 * NOTHING ABOUT THE MATTER TRAVELS WITH IT. The report carries the error handles, the route, the
 * build, the breadcrumb trail (shapes, never values — see ./breadcrumbs.ts) and the reporter's own
 * words. No document, no file name, no client name, no matter content. Saying so on the dialog is
 * not reassurance copy: it is the reason a person is willing to send the report at all.
 *
 * This lives beside the diagnostics rather than among any one area's calls because it reads the
 * BUILD identity, which is baked in at build time: a module that carries it cannot be imported by a
 * plain unit test without the build's defines. It was previously duplicated per area — once for
 * costs, once for billing — which is exactly the arrangement that let the two drift.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";
import { buildIdentityLine } from "$lib/build-identity.ts";
import { breadcrumbPayload } from "./breadcrumbs.ts";

/**
 * The Error ID shape the incident route accepts. A handle in any other shape is refused by the
 * route, and refusing the whole report over it would lose the reporter's words as well — so an
 * unrecognised handle travels in the description instead of in this field.
 */
const REPORTABLE_ERROR_ID = /^error_[A-Za-z0-9]+$/;

/** Whether the route will accept this handle in `errorIds`. */
export function isReportableErrorId(errorId: string | null): boolean {
  return errorId !== null && REPORTABLE_ERROR_ID.test(errorId);
}

/** What the firm's own reporting pipeline is told when something fails and somebody reports it. */
export interface ProblemReport {
  /** The reporter's own words. Read by a person, so an empty one is refused before sending. */
  readonly description: string;
  /** The correlation handles, where the server issued any the route recognises. */
  readonly errorIds: readonly string[];
  /** Where the failure happened, as the app addresses it. */
  readonly route: string;
  /**
   * What the deployment was doing, from a surface that knew — the header's Build Information panel
   * hands over its whole diagnosis so the reporter does not have to paste it, and so a report filed
   * during an incident says which builds were live and whether the firm's database was answering.
   * Absent from every other surface, which has nothing to put here.
   */
  readonly deployment?: string;
}

export interface FiledReport {
  readonly id: string;
  readonly status: string;
}

/** File a problem. Resolves like every other call — a failed report is itself a failure to render. */
export function reportProblem(
  fetchImpl: typeof fetch,
  report: ProblemReport,
): Promise<ApiOutcome<FiledReport>> {
  return requestJson(fetchImpl, "/api/v1/incidents", {
    method: "POST",
    body: {
      errorIds: report.errorIds,
      breadcrumbs: breadcrumbPayload(),
      description: report.description,
      context: {
        route: report.route,
        appVersion: buildIdentityLine(),
        clientAt: new Date().toISOString(),
        ...(report.deployment === undefined ? {} : { deployment: report.deployment }),
      },
    },
  });
}
