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
 * PURE, AND DELIBERATELY IN ITS OWN FILE. Reading the build identity means reading constants baked
 * in by the bundler, and a module that does cannot be imported by a plain unit test at all — it
 * throws on `__MC_BUILD_COMMIT__` before a single assertion runs. So the assembly lives here with no
 * globals of any kind, and ./current-trace.ts gathers the environment and hands it over. One extra
 * file buys a testable model, which is the same trade the reporter already makes.
 */
import type { Failure } from "$lib/api/problem.ts";
import type { Breadcrumb } from "./breadcrumbs.ts";

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

const NONE_ISSUED = "(none issued)";

function line(key: string, value: string): string {
  return `${key}: ${value}`;
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
  const lines: string[] = ["Magna Carta — error report"];

  lines.push(line("build", environment.buildIdentity));
  lines.push(line("route", environment.route));
  lines.push(line("request", failure?.request ?? "(no failing call — reported by hand)"));
  lines.push(line("failed", failure?.failedAt.toISOString() ?? "(not a caught failure)"));
  lines.push(line("copied", environment.copiedAt.toISOString()));

  if (failure === null) {
    lines.push(line("answer", "nothing failed — this report was raised by a person"));
  } else if (problem === null) {
    // The distinction that changes what a person should do about it, stated rather than implied.
    lines.push(line("answer", "nothing answered — the request did not complete"));
  } else {
    lines.push(line("status", String(problem.status)));
    lines.push(line("problem type", problem.type ?? "(not stated)"));
    lines.push(line("title", problem.title ?? "(not stated)"));
    lines.push(line("detail", problem.detail ?? "(not stated)"));
    lines.push(line("error id", problem.errorId ?? NONE_ISSUED));
    lines.push(line("correlation id", problem.correlationId ?? NONE_ISSUED));

    // The rest are present only when they mean something, so their presence is itself the signal.
    if (problem.instance !== undefined) lines.push(line("instance", problem.instance));
    if (problem.stepUpRequired === true) lines.push(line("step up required", "yes"));
    if (problem.requestAccess === true) lines.push(line("access can be requested", "yes"));
    if (problem.attemptsRemaining !== undefined) {
      lines.push(line("attempts remaining", String(problem.attemptsRemaining)));
    }
    if (problem.retryAfterSeconds !== undefined) {
      lines.push(line("retry after", `${problem.retryAfterSeconds}s`));
    }
    if (problem.errors !== undefined && problem.errors.length > 0) {
      lines.push("field errors:");
      for (const fieldError of problem.errors) {
        lines.push(`  - ${fieldError.path} (${fieldError.code}): ${fieldError.detail}`);
      }
    }
  }

  lines.push(line("browser", environment.userAgent));
  lines.push(line("viewport", environment.viewport));
  lines.push(line("language", environment.language));
  lines.push(line("time zone", environment.timeZone));
  lines.push(line("network", environment.online ? "online" : "offline"));

  if (crumbs.length > 0) {
    lines.push("breadcrumbs (oldest first):");
    for (const crumb of crumbs) {
      lines.push(`  ${crumb.at} ${crumb.route} ${crumb.category}: ${crumb.label}`);
    }
  }

  return lines.join("\n");
}
