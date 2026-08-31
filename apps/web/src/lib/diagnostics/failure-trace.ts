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
 * Pure, so it is tested against fixed inputs rather than eyeballed in a browser: `currentTrace`
 * reads the environment and hands it to `buildFailureTrace`, which never touches a global.
 */
import type { Failure } from "$lib/api/problem.ts";
import { buildIdentityLine } from "$lib/build-identity.ts";
import { breadcrumbs, type Breadcrumb } from "./breadcrumbs.ts";

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
 * Assemble the trace. `failure` may carry no problem at all — that is the "nothing answered" case,
 * and it is said in as many words rather than left as an absence the reader has to infer.
 */
export function buildFailureTrace(
  failure: Failure,
  environment: TraceEnvironment,
  crumbs: readonly Breadcrumb[] = [],
): string {
  const problem = failure.problem;
  const lines: string[] = ["Magna Carta — error report"];

  lines.push(line("build", environment.buildIdentity));
  lines.push(line("route", environment.route));
  lines.push(line("request", failure.request));
  lines.push(line("failed", failure.failedAt.toISOString()));
  lines.push(line("copied", environment.copiedAt.toISOString()));

  if (problem === null) {
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

/**
 * Read the environment. Every accessor is guarded: this runs on a crash screen, which is precisely
 * where an assumption about what exists is least safe, and a trace that throws while being built is
 * worse than one missing a line.
 */
export function currentEnvironment(route?: string): TraceEnvironment {
  const hasWindow = typeof window !== "undefined";
  const hasNavigator = typeof navigator !== "undefined";
  let timeZone = "(unknown)";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "(unknown)";
  } catch {
    // An environment without a resolvable zone still gets a trace.
  }
  return {
    buildIdentity: buildIdentityLine(),
    route: route ?? (hasWindow ? window.location.pathname : "(unknown)"),
    userAgent: hasNavigator ? navigator.userAgent : "(unknown)",
    language: hasNavigator ? navigator.language : "(unknown)",
    timeZone,
    viewport: hasWindow ? `${window.innerWidth}x${window.innerHeight}` : "(unknown)",
    online: hasNavigator ? navigator.onLine : true,
    copiedAt: new Date(),
  };
}

/** The trace for one failure, as the screen would copy it right now. */
export function currentTrace(failure: Failure, route?: string): string {
  return buildFailureTrace(failure, currentEnvironment(route), breadcrumbs());
}
