import type { GoogleApplication } from "@magna-carta/google-calendar/sign-in";
import type { Bindings } from "../bindings.ts";

// Where Google sends a member's browser back to after they sign in. It has to match, character for
// character, a redirect address registered on the Google application, so it is built in this one
// place and the registration steps in docs/deploy-queue.md quote this path.
export const GOOGLE_CALLBACK_PATH = "/api/v1/integrations/google/callback";

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === "/".charCodeAt(0)) end -= 1;
  return value.slice(0, end);
}

// The Google application this deployment signs members in through, or undefined when the
// deployment has none. Undefined is a first-class answer rather than a fault: a deployment nobody
// has registered an application for simply does not offer the connection.
//
// The origin is the deployment's stated public origin where it has one, and the request's own
// otherwise, for the reason given beside the Microsoft application (microsoft-application.ts).
export function resolveGoogleApplication(
  env: Pick<Bindings, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "APP_BASE_URL">,
  requestUrl: string,
): GoogleApplication | undefined {
  const clientId = env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET ?? "";
  if (clientId === "" || clientSecret === "") return undefined;
  const stated = env.APP_BASE_URL ?? "";
  const origin = stated === "" ? new URL(requestUrl).origin : trimTrailingSlashes(stated);
  return { clientId, clientSecret, redirectUri: `${origin}${GOOGLE_CALLBACK_PATH}` };
}
