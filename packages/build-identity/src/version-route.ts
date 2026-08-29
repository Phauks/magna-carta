/*
 * The tiny version read every dedicated Worker exposes so the app Worker's aggregate version
 * endpoint can ask each bound service what build it is running. Reached only over a service
 * binding (none of the sibling Workers are publicly routable), so the surface carries no
 * authentication of its own — the binding is the trust boundary, the same reasoning as each
 * Worker's operation routes. The answer is this Worker's own baked-in build identity, and a dev
 * build answers "dev" honestly rather than a fabricated version.
 */
import { BUILD_IDENTITY, type BuildIdentity } from "./build-identity.ts";

/** The path each Worker serves its identity on. Double-underscored: plumbing, never a data route. */
export const VERSION_ROUTE_PATH = "/__version";

/** True when the request is the version read (GET on the version path). */
export function isVersionRequest(request: Request): boolean {
  return request.method === "GET" && new URL(request.url).pathname === VERSION_ROUTE_PATH;
}

/** The version read's answer: this Worker's own build identity as JSON. */
export function versionResponse(identity: BuildIdentity = BUILD_IDENTITY): Response {
  return Response.json({
    commit: identity.commit,
    commitTime: identity.commitTime,
    buildTime: identity.buildTime,
  });
}
