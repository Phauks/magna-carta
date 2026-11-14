/*
 * The copyable trace — everything a report needs, assembled once, in one order, for every failure
 * surface in the app.
 *
 * THE POINT IS THAT ONE PASTE IS ENOUGH. A member who copies this and sends it should never be asked
 * a follow-up question that the screen already knew the answer to: which build, which route, which
 * call, what the server said, which of the hundred registered problem types it was, what handle it
 * was given, what they were doing beforehand, and whether their connection was even up. Anything the
 * app knows and omits here becomes a round trip with somebody who is already having a bad morning.
 *
 * Absent facts are STATED, not dropped, for the fields support actually looks for. "error id: (none
 * issued)" is a finding — it means the failure never reached the platform's error boundary — whereas
 * a missing line is indistinguishable from a report that got truncated.
 *
 * THE LINE GRAMMAR IS NOT THIS FILE'S. Rows are `key: value` and groups indent under a heading,
 * both defined in ./diagnostic-report.ts, because the Build Information panel assembles a paste of
 * its own and the two used to disagree about what a row looked like. What stays here is the ORDER
 * and the WORDING — which facts a failure report owes, and what each absence is called.
 *
 * PURE, AND DELIBERATELY IN ITS OWN FILE. Reading the build identity means reading constants baked
 * in by the bundler, and a module that does cannot be imported by a plain unit test at all — it
 * throws on `__MC_BUILD_COMMIT__` before a single assertion runs. So the assembly lives here with no
 * globals of any kind, and ./current-trace.ts gathers the environment and hands it over. One extra
 * file buys a testable model, which is the same trade the reporter already makes.
 */
import type { Failure } from "$lib/api/problem.ts";
import type { Breadcrumb } from "./breadcrumbs.ts";
import { actionForRequest, areaForPath, causeLabel, failurePath } from "./failure-summary.ts";
import {
  entry,
  NONE_ISSUED,
  NOT_STATED,
  renderDiagnosticReport,
  section,
  type ReportEntry,
} from "./diagnostic-report.ts";

/** What the browser can tell us about the moment, gathered at the point of copying. */
export interface TraceEnvironment {
  /** Which build produced this screen: commit, mode, build time. */
  readonly buildIdentity: string;
  /** The in-app route the member was on, path only. */
  readonly route: string;
  readonly userAgent: string;
  readonly language: string;
  /** The reader's own time zone, so a timestamp can be placed against what they remember. */
  readonly timeZone: string;
  /** Rendered viewport, which is how a layout-dependent failure gets reproduced. */
  readonly viewport: string;
  /** Whether the browser believed it had a connection. A false here explains most transport cases. */
  readonly online: boolean;
  readonly copiedAt: Date;
}

/**
 * The browser's own account of itself, as rows. Shared with the Build Information panel's paste
 * ($lib/versions/panel-report.ts): a diagnosis from either surface should describe the same machine
 * in the same words, and before this was lifted out only the failure trace carried any of it.
 */
export function environmentEntries(environment: TraceEnvironment): ReportEntry[] {
  return [
    entry("browser", environment.userAgent),
    entry("viewport", environment.viewport),
    entry("language", environment.language),
    entry("time zone", environment.timeZone),
    entry("network", environment.online ? "online" : "offline"),
  ];
}

/**
 * The breadcrumb trail as a section, or null when there is none. Shapes, never values — the
 * sanitizing is ./breadcrumbs.ts's and is pinned by its own test.
 */
export function breadcrumbSection(crumbs: readonly Breadcrumb[]) {
  if (crumbs.length === 0) return null;
  return section(
    "breadcrumbs (oldest first)",
    [],
    crumbs.map((crumb) => `${crumb.at} ${crumb.route} ${crumb.category}: ${crumb.label}`),
  );
}

/**
 * Assemble the trace.
 *
 * `failure` is null for a report nobody's call provoked — somebody reaching for "Report a problem"
 * from the help menu because something looked wrong. That report still wants the build, the route,
 * the environment and the breadcrumbs; what it has no honest answer for is which call failed, so it
 * says so rather than inventing one.
 *
 * A failure that carries no problem at all is the "nothing answered" case, and that too is stated in
 * as many words rather than left as an absence the reader has to infer.
 */
export function buildFailureTrace(
  failure: Failure | null,
  environment: TraceEnvironment,
  crumbs: readonly Breadcrumb[] = [],
): string {
  const problem = failure?.problem ?? null;

  const path = failure === null ? environment.route : failurePath(failure);
  const area = areaForPath(path);
  const action =
    failure === null || failure.request.startsWith("PAGE ") ? null : actionForRequest(path);
  const opening: ReportEntry[] = [
    ...(area === null ? [] : [entry("area", area)]),
    ...(action === null ? [] : [entry("action", action)]),
    ...(failure === null ? [] : [entry("kind", causeLabel(failure))]),
    entry("build", environment.buildIdentity),
    entry("route", environment.route),
    entry("request", failure?.request ?? "(no failing call — reported by hand)"),
    entry("failed", failure?.failedAt.toISOString() ?? "(not a caught failure)"),
    ...(failure?.cause === undefined ? [] : [entry("cause", failure.cause)]),
    entry("copied", environment.copiedAt.toISOString()),
  ];

  if (failure === null) {
    opening.push(entry("answer", "nothing failed — this report was raised by a person"));
  } else if (problem === null) {
    // The distinction that changes what a person should do about it, stated rather than implied.
    opening.push(entry("answer", "nothing answered — the request did not complete"));
  } else {
    opening.push(entry("status", String(problem.status)));
    opening.push(entry("problem type", problem.type, NOT_STATED));
    opening.push(entry("title", problem.title, NOT_STATED));
    opening.push(entry("detail", problem.detail, NOT_STATED));
    if (problem.operation !== undefined) opening.push(entry("operation", problem.operation));
    if (problem.cause !== undefined) opening.push(entry("cause", problem.cause));
    opening.push(entry("error id", problem.errorId, NONE_ISSUED));
    opening.push(entry("correlation id", problem.correlationId, NONE_ISSUED));

    // The rest are present only when they mean something, so their presence is itself the signal.
    if (problem.instance !== undefined) opening.push(entry("instance", problem.instance));
    if (problem.stepUpRequired === true) opening.push(entry("step up required", "yes"));
    if (problem.requestAccess === true) opening.push(entry("access can be requested", "yes"));
    if (problem.attemptsRemaining !== undefined) {
      opening.push(entry("attempts remaining", String(problem.attemptsRemaining)));
    }
    if (problem.retryAfterSeconds !== undefined) {
      opening.push(entry("retry after", `${problem.retryAfterSeconds}s`));
    }
  }

  const fieldErrors =
    problem?.errors !== undefined && problem.errors.length > 0
      ? section(
          "field errors",
          [],
          problem.errors.map(
            (fieldError) => `- ${fieldError.path} (${fieldError.code}): ${fieldError.detail}`,
          ),
        )
      : null;

  return renderDiagnosticReport("Magna Carta — error report", [
    section(null, opening),
    fieldErrors,
    section(null, environmentEntries(environment)),
    breadcrumbSection(crumbs),
  ]);
}
