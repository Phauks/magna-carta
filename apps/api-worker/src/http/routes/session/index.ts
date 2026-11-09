import { createAttemptLadder } from "../../auth-attempt-budget.ts";
import { authForEnv, emailAdapterForEnv } from "../../../auth-instance.ts";
import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerInvitationRoutes } from "./invitations.ts";
import { registerMeNameRoutes } from "./me-name.ts";
import { registerMePhotoRoutes } from "./me-photo.ts";
import { registerMeRoute } from "./me.ts";
import { registerMemberAdministrationRoutes } from "./member-administration.ts";
import { registerMemberProfilesRoutes } from "./member-profiles.ts";
import { registerMembersRoute } from "./members.ts";
import { registerOnboardingRoutes } from "./onboarding.ts";
import { registerRegistrationRoutes } from "./registrations.ts";

// The joining and identity surface: the member's own bootstrap and name, the member list and its administration, the anonymous registration pair, invitations and the signed-in half of joining.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountSession(app: AppRouter, chokepoint: Chokepoint, deps: DomainDeps = {}): void {
  const domain = createDomainApp();
  // A SECOND ladder, of the same shape and for the same reason, for the anonymous invitation
  // redemption form. It is the budget that route's refusal publishes — the invitation's own count
  // is a fact about the invitation and answering with it would tell a prober whether a guessed code
  // is live (routes/session/invitations.ts). Separate state from the credential ladder above because the
  // two surfaces ask different questions of different people: a member mistyping their password
  // should not spend a new joiner's tries, or the reverse.
  const invitationRedemptionLadder = createAttemptLadder();
  registerMeRoute(domain, chokepoint);
  registerMembersRoute(domain, chokepoint, authForEnv);
  registerMemberAdministrationRoutes(domain, chokepoint);
  registerMeNameRoutes(domain, chokepoint);
  registerMePhotoRoutes(domain, chokepoint);
  // Joining the platform: the anonymous registration pair and the invitation pair (one issued
  // inside a firm, one redeemed by someone who has no account yet). Every anonymous one of them
  // rides the chokepoint's tightest rate-limit bucket.
  // The human-verification gate rides the two anonymous WRITES among them — founding a firm and
  // redeeming an invitation. Not the confirmation route: its emailed token is the only credential
  // its caller can hold, and a link opened out of a mailbox has no form to carry a challenge.
  const humanVerification = deps.humanVerification ?? {};
  registerRegistrationRoutes(domain, chokepoint, emailAdapterForEnv, authForEnv, humanVerification);
  registerInvitationRoutes(
    domain,
    chokepoint,
    authForEnv,
    invitationRedemptionLadder,
    humanVerification,
  );
  // The joining surface's signed-in half: the two routes a person with an account and no firm can
  // reach. Same ladder as the anonymous redemption route, so signing in buys no second allowance.
  registerOnboardingRoutes(domain, chokepoint, invitationRedemptionLadder);
  registerMemberProfilesRoutes(domain, chokepoint);
  app.route("/", domain);
}
