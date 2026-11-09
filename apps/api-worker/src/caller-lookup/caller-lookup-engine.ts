/*
 * Which caller-identity engine a request gets.
 *
 * ONE ENGINE TODAY, switched on by provisioning it. With `TELNYX_API_KEY` set, a member's press for a
 * caller ID goes to Telnyx Number Lookup; without it, every request gets the deferred port, which
 * answers `engine-not-implemented`, and the call record shows only the free answers — the Directory
 * match and the area code's region — exactly as though the paid lookup did not exist. The shape the
 * address-lookup engine takes (address-lookup/address-lookup-engine.ts), and for the same reason: a
 * surface written against the port needs no flag to remove the day a key is set.
 */
import { deferredCallerLookupPort, type CallerLookupPort } from "@magna-carta/caller-lookup/port";
import { telnyxCallerLookupPort } from "@magna-carta/caller-lookup/telnyx";
import type { Bindings } from "../bindings.ts";

export function resolveCallerLookupPort(env: Pick<Bindings, "TELNYX_API_KEY">): CallerLookupPort {
  const apiKey = env.TELNYX_API_KEY?.trim() ?? "";
  return apiKey === "" ? deferredCallerLookupPort() : telnyxCallerLookupPort({ apiKey });
}
