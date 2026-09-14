/* The app is a static SPA: nothing is rendered on the server, and nothing is prerendered. The
   transport configures itself when $lib/api/api-client.ts is evaluated, which is why nothing
   arranges it here — that file says why a load function could not have promised it in time. */
export const ssr = false;
export const prerender = false;
