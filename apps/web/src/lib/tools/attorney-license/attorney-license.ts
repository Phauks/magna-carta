/*
 * Attorney License Lookup — which official register verifies a lawyer's standing, and where it is.
 *
 * The tool is a link generator and nothing else: bar admission is per state, every state publishes
 * its own register, and this platform neither queries them nor stores what they say. So the whole
 * job is to take the reader to the right one, and the only real work is turning the jurisdiction
 * registry (@magna-carta/government-links) into a choice a person can make.
 *
 * WHY THIS IS NOT A VERIFICATION. The registers are the authority; a copy of one of their answers,
 * held here and going stale, would be worse than no answer, because a suspension is exactly the
 * fact that changes after you look. The reader is handed the live page and reads it themselves.
 *
 * DOM-free on purpose, so the narrowing and the resolution are checkable without rendering
 * anything — the same split the WHOIS tool keeps (tools/whois/whois-lookup.ts).
 */
import {
  LICENSING_STATES,
  attorneyLicenseSiteForState,
} from "@magna-carta/government-links/licensing";
import type { PortalSite } from "@magna-carta/government-links/types";
import type { ChoiceOption } from "$lib/components/choice-picker.ts";

/**
 * Every state (and the District of Columbia) as a choice, in the registry's own order, which is by
 * FIPS and therefore alphabetical by state name.
 *
 * The value is the FIPS code because that is what the registry is keyed by. A reader never sees it:
 * they see the state's name, with its postal code beside it, and can type either — somebody looking
 * for Pennsylvania is as likely to type "PA".
 */
export function licensingStateChoices(): readonly ChoiceOption[] {
  return LICENSING_STATES.map((state) => ({
    value: state.fipsPrefix,
    label: state.name,
    aside: state.code,
    keywords: [state.code],
  }));
}

/** The register for a chosen state, or null where nothing is chosen or the state is not covered. */
export function registerForState(stateFips: string): PortalSite | null {
  if (stateFips === "") return null;
  return attorneyLicenseSiteForState(stateFips) ?? null;
}

/**
 * Whether the register is served over TLS.
 *
 * Two of the fifty-one are not (Rhode Island's judiciary search and Washington's), which is not a
 * transcription error but a fact about US government portals — the county assessor registries are
 * full of the same. It is worth saying out loud rather than silently linking: the query a person
 * runs there is a named lawyer, typed by somebody at a law firm, and on a plain-HTTP page both the
 * question and the answer are readable by anything on the path. The reader still gets the link,
 * because the register is the authority whatever it is served over; they just get it knowingly.
 */
export function registerIsSecure(register: PortalSite): boolean {
  return register.searchUrl.startsWith("https://");
}
