// WHAT A PERSON WITH NO FIRM STILL HAS TO DO — one read, one home, two readers: the bootstrap
// (routes/me.ts) publishes it, and the founding route (routes/onboarding.ts) reads it to decide
// whether a second press queues a second firm or answers the one already under way.
//
// IT IS A FACT ON THE SERVER, NEVER A FLAG IN THE BROWSER. A person who asks for a firm and closes
// the tab while it builds must reopen on the waiting screen, and a person who signs in from another
// machine must see the same thing. A remembered client-side "I pressed the button" gets both wrong,
// and gets them wrong in the direction that offers to build a second firm.
//
// The registration row is the record, and it is keyed by ADDRESS because that is what the row
// already holds and what the user table holds uniquely — a joining registration and the account it
// becomes are the same mailbox by construction.

export type JoiningState = "chooseFirm" | "firmProvisioning";

/**
 * What the joining surface should show a person who belongs to no firm. `firmProvisioning` when a
 * confirmed registration for this address is still waiting for the firm-provisioning consumer to
 * record which firm it became; `chooseFirm` otherwise — including after a build that failed, so a
 * person is never stranded on a waiting screen by a dead outbox row.
 */
export async function readJoiningState(
  controlPlaneDatabase: D1Database,
  email: string,
): Promise<JoiningState> {
  // A CONFIRMED FOUNDING REGISTRATION WHOSE FIRM IS NOT YET RECORDED — which is exactly what the
  // self-serve founding path has always meant by "under way", and is written by the provisioning
  // consumer's own last statement when it completes. The role is part of the predicate because an
  // account-first registration is also confirmed and also names no firm: it asked for a PERSON, and
  // reading it as a firm request would leave everybody who ever made an account waiting for a
  // workspace nobody is building.
  const pending = await controlPlaneDatabase
    .prepare(
      "SELECT 1 AS present FROM registration " +
        "WHERE email = ?1 AND role = 'foundFirm' AND status = 'confirmed' AND firm_id IS NULL LIMIT 1",
    )
    .bind(email.trim().toLowerCase())
    .first<{ present: number }>();
  return pending === null ? "chooseFirm" : "firmProvisioning";
}
