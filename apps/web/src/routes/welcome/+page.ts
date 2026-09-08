import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { readBootstrap, type Bootstrap } from "$lib/auth/joining-api.ts";

// The joining screen's guard, and the mirror image of the (app) group's. Three answers, and each
// sends somebody somewhere they can actually be:
//
//   no session      -> /login, carrying nothing to return to: this screen is not a destination
//                      somebody was heading for, it is where signing in lands them.
//   a usable firm   -> /home. They have finished joining, and a screen asking them to choose a firm
//                      would be offering to undo something the model does not undo.
//   no firm yet     -> stay, with the bootstrap in hand so the screen opens in the right state
//                      (waiting, if their firm is already building) rather than flashing a menu
//                      and then replacing it.
//
// A FIRM IS NOT THE SAME THING AS A WORKSPACE THEY CAN USE. Activation attaches the account to the
// firm before the member record mirroring it into the firm's OWN database has landed, and in that
// gap every screen in the app refuses. So a person whose membership is still being written — or has
// stopped being written, which the waiting screen can at least name — STAYS:
// the waiting screen runs one step past the firm existing and shows them that last step. This is
// also the mirror of the (app) guard, which sends exactly that person here; sending them on to /home
// would put the two guards in a loop.
//
// A transport failure is deliberately NOT treated as either — a frontend-only dev server with no
// Worker behind it still renders the screen, exactly as the (app) guard does.
export const load: PageLoad = async ({ fetch }): Promise<{ bootstrap: Bootstrap | null }> => {
  const outcome = await readBootstrap(fetch);
  if (outcome.kind === "transport") return { bootstrap: null };
  if (outcome.kind === "problem") {
    if (outcome.problem.status === 401) redirect(307, "/login");
    return { bootstrap: null };
  }
  const membership = outcome.value.membership?.state;
  const stillJoining = membership === "provisioning" || membership === "stalled";
  if (outcome.value.firm !== null && !stillJoining) redirect(307, "/home");
  return { bootstrap: outcome.value };
};
