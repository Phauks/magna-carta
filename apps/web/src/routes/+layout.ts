/*
 * The typed client's transport is pointed at this origin HERE, at module scope, rather than from a
 * component: `load` functions run before any component mounts, and the matter chrome resolves a real
 * matter inside its load. A client configured on mount would be configured too late for that first
 * call — it would still carry the generated cross-origin baseUrl, and a cross-origin request drops
 * the session cookie and 401s.
 */
import { configureApiTransport } from "$lib/api/transport.ts";

configureApiTransport();

export const ssr = false;
export const prerender = false;
