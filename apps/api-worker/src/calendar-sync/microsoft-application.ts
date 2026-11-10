import type { MicrosoftApplication } from "@magna-carta/microsoft-graph/sign-in";
import type { Bindings } from "../bindings.ts";

// Where Microsoft sends a member's browser back to after they sign in. It has to match, character
// for character, a redirect address registered on the Microsoft application, so it is built in this
// one place and the registration steps in docs/deploy-queue.md quote this path.
export const MICROSOFT_CALLBACK_PATH = "/api/v1/integrations/microsoft/callback";

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === "/".charCodeAt(0)) end -= 1;
  return value.slice(0, end);
}

// The Microsoft application this deployment signs members in through, or undefined when the
// deployment has none. Undefined is a first-class answer rather than a fault: a deployment nobody
// has registered an application for simply does not offer the connection.
//
// The origin is the deployment's stated public origin where it has one, and the request's own
// otherwise. The stated one wins because the registered redirect address names exactly one origin,
// and a request that arrived by some other name for the same Worker would build an address
// Microsoft refuses.
export function resolveMicrosoftApplication(
  env: Pick<
    Bindings,
    "MICROSOFT_CLIENT_ID" | "MICROSOFT_CLIENT_SECRET" | "MICROSOFT_TENANT" | "APP_BASE_URL"
  >,
  requestUrl: string,
): MicrosoftApplication | undefined {
  const clientId = env.MICROSOFT_CLIENT_ID ?? "";
  const clientSecret = env.MICROSOFT_CLIENT_SECRET ?? "";
  if (clientId === "" || clientSecret === "") return undefined;
  const stated = env.APP_BASE_URL ?? "";
  const origin = stated === "" ? new URL(requestUrl).origin : trimTrailingSlashes(stated);
  const tenant = env.MICROSOFT_TENANT ?? "";
  return {
    clientId,
    clientSecret,
    redirectUri: `${origin}${MICROSOFT_CALLBACK_PATH}`,
    ...(tenant === "" ? {} : { tenant }),
  };
}
