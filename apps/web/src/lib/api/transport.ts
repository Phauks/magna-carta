/*
 * The transport seam for the typed API client.
 *
 * The generated client is a singleton, and every generated TanStack Query option factory
 * (filesListOptions, foldersListOptions, …) closes over that same instance — so pointing the app at
 * its own origin means configuring THAT client, not constructing a second one.
 *
 * The generated default baseUrl is the public production API host, which is right for a caller that
 * lives somewhere else and wrong for this app: the Worker serves the SPA and the API from one
 * origin, and the generated operation urls are already absolute paths (`/api/v1/files`). An empty
 * baseUrl therefore leaves them same-origin, which is what makes the Better Auth session cookie ride
 * along on every typed call (a cross-origin baseUrl would drop it and 401 every request).
 */
import { client } from "@magna-carta/api-client/client";

/** Point the typed client at this app's own origin. Call once, before the first query runs. */
export function configureApiTransport(): void {
  client.setConfig({ baseUrl: "" });
}
