// WHAT A PERSON WITH NO FIRM STILL HAS TO DO — one read, one home, two readers: the bootstrap
// (routes/session/me.ts) publishes it, and the founding route (routes/session/onboarding.ts) reads it to decide
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
//
// IT ALSO REPORTS HOW FAR THE BUILD HAS GOT, because "please wait" is not an answer anybody can act
// on. Provisioning is a handful of steps of unequal length (firm-provisioner.ts), each of which
// leaves its own mark on the firm row, so the progress is READ rather than tracked — no step
// counter to drift, nothing to keep in sync with the orchestration, and a resumed build reports
// exactly what it has actually done. The facts are booleans; every word a person reads is decided
// in the browser, beside the screen that shows them (apps/web/src/lib/auth/firm-build-progress.ts).

import { OUTBOX_TABLE } from "@magna-carta/data-access/outbox-statements";

export type JoiningState = "chooseFirm" | "firmProvisioning";

/** The topic whose row carries the build — the one the firm-provision consumer drains. */
const FIRM_PROVISION_TOPIC = "firm.provision";

/**
 * How far the build has got, as facts about the firm's own record rather than as a percentage.
 *
 * The four are ORDERED and monotone — the provisioner does them in this order and each is guarded
 * by the mark the previous one left — so a reader can treat the first false as the step in flight.
 */
export interface FirmBuildProgress {
  /** The firm's row exists in the control plane, holding the name that was asked for. */
  readonly firmRecord: boolean;
  /** Its own R2 bucket has been created and recorded. */
  readonly fileStorage: boolean;
  /** Its data key has been minted and wrapped. */
  readonly encryptionKey: boolean;
  /** The firm is active and its owner is recorded — the last step, committed as one batch. */
  readonly activated: boolean;
  /**
   * The build's outbox row was dead-lettered, so nothing is retrying it any more. Reported because
   * a waiting screen that cannot say this leaves somebody watching work that has stopped.
   */
  readonly stalled: boolean;
}

/** What the joining surface should show, and — while a firm is building — how far it has got. */
export interface JoiningReading {
  readonly state: JoiningState;
  /** Present only alongside `firmProvisioning`; there is no build to report otherwise. */
  readonly build?: FirmBuildProgress;
}

interface BuildingFirmRow {
  readonly status: string;
  readonly bucket_name: string | null;
  readonly wrapped_firm_key: string | null;
}

/**
 * What the joining surface should show a person who belongs to no firm. `firmProvisioning` when a
 * confirmed registration for this address is still waiting for the firm-provisioning consumer to
 * record which firm it became; `chooseFirm` otherwise.
 *
 * A BUILD THAT HAS STOPPED IS STILL `firmProvisioning`, and says so in `build.stalled` rather than
 * being reported as no build at all. Dead-lettering does not touch the registration row, so there is
 * no state here that could distinguish the two — and sending somebody back to a menu offering to
 * found a firm, while a half-built one holds their name, would invite a second one.
 */
export async function readJoiningState(
  controlPlaneDatabase: D1Database,
  email: string,
): Promise<JoiningReading> {
  // A CONFIRMED FOUNDING REGISTRATION WHOSE FIRM IS NOT YET RECORDED — which is exactly what the
  // self-serve founding path has always meant by "under way", and is written by the provisioning
  // consumer's own last statement when it completes. The role is part of the predicate because an
  // account-first registration is also confirmed and also names no firm: it asked for a PERSON, and
  // reading it as a firm request would leave everybody who ever made an account waiting for a
  // workspace nobody is building.
  //
  // The row's ID comes back as well as its existence, because it is also the firm's resume handle:
  // a self-serve firm's `name` IS its registration id (firm-provisioner.ts), which is the only way
  // to find a half-built firm whose id nothing has recorded yet. Newest first, so an address that
  // somehow carries two unfinished founding registrations reports the one just asked for.
  const pending = await controlPlaneDatabase
    .prepare(
      "SELECT id FROM registration " +
        "WHERE email = ?1 AND role = 'foundFirm' AND status = 'confirmed' AND firm_id IS NULL " +
        "ORDER BY created_at DESC LIMIT 1",
    )
    .bind(email.trim().toLowerCase())
    .first<{ id: string }>();
  if (pending === null) return { state: "chooseFirm" };
  return {
    state: "firmProvisioning",
    build: await readFirmBuildProgress(controlPlaneDatabase, pending.id),
  };
}

/**
 * The build's own marks, read from the firm row the registration handle names and from the outbox
 * row that drives it.
 *
 * A READ FAILURE IS NOT A STALLED BUILD. Both queries degrade to "nothing has happened yet", which
 * is the reading that keeps somebody waiting — the state they are already in — rather than telling
 * them their workspace has failed because a SELECT did not answer.
 */
async function readFirmBuildProgress(
  controlPlaneDatabase: D1Database,
  registrationId: string,
): Promise<FirmBuildProgress> {
  const [firmRow, stalled] = await Promise.all([
    controlPlaneDatabase
      .prepare("SELECT status, bucket_name, wrapped_firm_key FROM firm WHERE name = ?1")
      .bind(registrationId)
      .first<BuildingFirmRow>()
      .catch(() => null),
    // The build's own row, found by the registration id its payload carries. `failed` is terminal:
    // the relay never re-dispatches a dead-lettered row on its own (outbox-relay.ts), so this is
    // the one state on this screen that will not clear by waiting.
    controlPlaneDatabase
      .prepare(
        `SELECT 1 AS present FROM ${OUTBOX_TABLE} ` +
          `WHERE topic = ?1 AND status = 'failed' AND json_extract(payload, '$.registrationId') = ?2 LIMIT 1`,
      )
      .bind(FIRM_PROVISION_TOPIC, registrationId)
      .first<{ present: number }>()
      .catch(() => null),
  ]);

  return {
    firmRecord: firmRow !== null,
    fileStorage: firmRow !== null && firmRow.bucket_name !== null,
    encryptionKey: firmRow !== null && firmRow.wrapped_firm_key !== null,
    // 'provisioning' is the only status a half-built firm wears; the activation batch flips it and
    // records the owner in the same commit, so anything else means the last step has landed.
    activated: firmRow !== null && firmRow.status !== "provisioning",
    stalled: stalled !== null,
  };
}
