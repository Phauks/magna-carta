// The operations the session module registers, as the conformance suite holds them (see
// test/conformance.test.ts). Regenerate with `pnpm --filter @magna-carta/api-worker run
// emit-domain-operations`; a hand edit here is a claim the suite will check against the module.
export const OPERATIONS: readonly string[] = [
  "invitations.issue",
  "invitations.redeem",
  "me.get",
  "me.name",
  "me.photo",
  "me.photoContent",
  "me.removePhoto",
  "me.setName",
  "me.setPhoto",
  "members.deactivate",
  "members.invite",
  "members.list",
  "members.professionalProfile",
  "members.reactivate",
  "members.setProfessionalProfile",
  "members.setRoles",
  "onboarding.foundFirm",
  "onboarding.redeemInvitation",
  "registrations.confirm",
  "registrations.start",
  "roles.list",
];
