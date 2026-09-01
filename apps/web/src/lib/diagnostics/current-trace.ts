/*
 * Gathering the environment, and the trace as the screen would copy it right now.
 *
 * Everything that touches a global lives here, so ./failure-trace.ts — the assembly — stays a pure
 * function over fixed inputs and is tested as one. This module cannot be imported by a plain unit
 * test: it reads the build identity, which the bundler bakes in, and which does not exist outside a
 * build.
 */
import type { Failure } from "$lib/api/problem.ts";
import { buildIdentityLine } from "$lib/build-identity.ts";
import { breadcrumbs } from "./breadcrumbs.ts";
import { buildFailureTrace, type TraceEnvironment } from "./failure-trace.ts";

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

/**
 * The trace as the screen would copy it right now. `failure` is null for a report raised by hand
 * rather than provoked by a call.
 */
export function currentTrace(failure: Failure | null, route?: string): string {
  return buildFailureTrace(failure, currentEnvironment(route), breadcrumbs());
}
