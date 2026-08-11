import type {
  ResolvedTrustRequirement,
  TrustJurisdictionPort,
  TrustJurisdictionRequirement,
} from "@magna-carta/trust/jurisdiction";
import { resolveJurisdictionRequirement } from "./resolve.ts";

// The adapter that satisfies the trust domain's jurisdiction seam. The trust package declares the
// contract and the behaviour in its absence; this package is one implementation of it, and the
// dependency runs this way so the trust domain never learns which jurisdictions exist.
//
// Binding this port changes behaviour for encoded, REVIEWED jurisdictions only. Everything else
// refuses exactly as the default refusing port did — an unencoded jurisdiction with
// `jurisdiction-not-encoded`, and an encoded-but-unreviewed one with `jurisdiction-not-verified`,
// which is a strictly narrower answer than the refusal it replaces rather than a looser one.
export const encodedTrustJurisdictions: TrustJurisdictionPort = {
  resolve<T>(
    jurisdiction: string,
    requirement: TrustJurisdictionRequirement,
  ): ResolvedTrustRequirement<T> {
    return resolveJurisdictionRequirement<T>(jurisdiction, requirement);
  },
};
