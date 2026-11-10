import { z } from "zod";
import { GUEST_TYPED_NAME_MAXIMUM_LENGTH } from "./guest-by-address.ts";

// What inviting a guest by name and address accepts, as plain zod named with `.meta({ id })`, which
// the contract emitter reads as the component's name. The route is in
// apps/api-worker/src/http/routes/communications/meeting-guest-by-address.ts and answers with the
// ordinary invitation; the rule is in docs/conventions/api.md (_Where a contract shape lives_).

export const InviteGuestByAddressRequest = z
  .object({
    // The guest's name as the host typed it. It names a new Directory person only when nobody in the
    // Directory holds the address; otherwise the Directory's own name is the one on the invitation.
    name: z.string().min(1).max(GUEST_TYPED_NAME_MAXIMUM_LENGTH),
    emailAddress: z.string().min(3).max(320),
  })
  .meta({ id: "InviteGuestByAddressRequest" });
