import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { OutboxRow } from "@magna-carta/data-access/outbox-relay";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { RegistrationId, UserId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../bindings.ts";
import { authForEnv } from "../auth-instance.ts";
import { isFirmActivationConflict, isUserEmailConflict } from "../control-plane-conflicts.ts";
import { provisionFirm, type FirmProvisionerDependencies } from "../firm-provisioner.ts";
import { resourceProviderForEnv } from "../firm-provisioner-wiring.ts";

// The firm.provision consumer: a confirmed self-serve registration becomes a real firm.
//
// WHY THIS IS A CONSUMER AND NOT A HANDLER. Provisioning creates an R2 bucket, configures its event
// notifications and mints a wrapped firm key — three calls against an account-wide storage-API
// budget shared with every other consumer. Doing that inside the request an anonymous visitor
// triggers would put a metered external dependency on the hot path and let a burst of confirmations
// exhaust the budget for the whole fleet. Off the request, retried by the relay, it degrades into
// latency instead.
//
// AT-LEAST-ONCE IS ALREADY SAFE HERE, and that is the reuse this whole path is built on:
// provisionFirm is step-guarded by the firm row's own state, so a second delivery finds the bucket
// recorded, the key minted and the firm active, and does nothing. Nothing needed to be made
// idempotent for the queue — it already was, for crash resume.
//
// THE RESUME IDENTITY IS THE REGISTRATION ID, NOT THE FIRM'S NAME. provisionFirm finds its partial
// row by the UNIQUE firm.name, which is correct for the operator door where a human types a name
// once. It cannot be the human name here: firm names are not unique in the world, a UNIQUE column
// over them would let a stranger probe for any firm's existence by trying to register its name, and
// registering a well-known firm's name would cost one email address. So a self-serve firm's `name`
// is the registration's own handle — unique by construction, stable across retries, and meaningless
// to anyone who sees it — while the name people read lives in firm.display_name.

interface FirmProvisionPayload {
  readonly registrationId: RegistrationId;
  readonly firmDisplayName: string;
  // `userId` is present when the founder already HAS an account — the account-first door, where a
  // signed-in person asks for a firm. Provisioning then adopts that account as the owner instead of
  // creating one, and sends no activation mail: they already hold a credential, and mailing them a
  // password-reset link at the moment their workspace arrives would read as a security alert.
  readonly owner: { readonly email: string; readonly name: string; readonly userId?: UserId };
}

// A malformed payload THROWS rather than being skipped: the relay counts the attempt and
// dead-letters at the cap, which surfaces a producer/consumer drift instead of silently dropping
// somebody's workspace. Every failure carries the uniform `firm.provision ${row.id}:` prefix, the
// same shape the member.provision consumer uses.
function parseFirmProvisionPayload(row: OutboxRow): FirmProvisionPayload {
  try {
    const parsed = JSON.parse(row.payload) as {
      registrationId?: unknown;
      firmDisplayName?: unknown;
      owner?: { email?: unknown; name?: unknown; userId?: unknown };
    };
    if (
      typeof parsed.firmDisplayName !== "string" ||
      typeof parsed.owner?.email !== "string" ||
      typeof parsed.owner.name !== "string"
    ) {
      throw new Error("malformed payload");
    }
    return {
      registrationId: assertIdentifier(parsed.registrationId, "registration"),
      firmDisplayName: parsed.firmDisplayName,
      owner: {
        email: parsed.owner.email,
        name: parsed.owner.name,
        // Absent on every message the anonymous confirmation path writes, including one already in
        // flight across the deploy that introduced this field — which is why it is optional rather
        // than a second topic.
        ...(parsed.owner.userId === undefined
          ? {}
          : { userId: assertIdentifier(parsed.owner.userId, "user") }),
      },
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new Error(`firm.provision ${row.id}: ${message}`, { cause: caught });
  }
}

export async function consumeFirmProvision(env: Bindings, row: OutboxRow): Promise<void> {
  const payload = parseFirmProvisionPayload(row);
  const dependencies: FirmProvisionerDependencies = {
    controlPlaneDatabase: env.DB_CONTROL,
    resourceProvider: resourceProviderForEnv(env),
    rootKekBase64: env.ROOT_KEK,
  };

  // THE PASSWORD THE OWNER CHOSE, read back from the registration rather than carried on the
  // message. The verifier belongs to the row that expires with it; a queue payload is durable,
  // replayable and read by a consumer that has no business holding one. Null for a registration
  // started before the column existed — that owner is created account-less and still gets the
  // activation mail below, which is the only branch that sends one.
  const registration = await env.DB_CONTROL.prepare(
    "SELECT credential_hash FROM registration WHERE id = ?1",
  )
    .bind(payload.registrationId)
    .first<{ credential_hash: string | null }>();
  const credentialHash = registration?.credential_hash ?? undefined;

  const outcome = await provisionFirm(dependencies, {
    name: payload.registrationId,
    displayName: payload.firmDisplayName,
    owner: {
      ...payload.owner,
      ...(credentialHash === undefined ? {} : { credentialHash }),
    },
  });

  if (outcome.kind === "name-conflict") {
    // Structurally unreachable on this path — the "name" is a freshly minted registration handle,
    // so no other firm can hold it. Throwing rather than returning keeps it that way: if it ever
    // does happen, an identifier collision or a replayed payload is a thing to be woken up for,
    // not a row to quietly discard.
    throw new Error(
      `firm.provision ${row.id}: the registration handle is already an active firm with another owner`,
    );
  }

  if (outcome.kind === "ready-to-activate") {
    // TWO PASSES CAN REACH HERE AT ONCE, and one of them must not dead-letter. The confirming
    // request schedules a best-effort sweep to close the five-minute wait, and the cron sweep runs
    // on its own clock, so the same row is genuinely delivered twice in the ordinary case rather
    // than only after a crash. Both passes see a firm that is still 'provisioning' and both compose
    // an activation batch; the loser's batch aborts whole on one of two fences — the owner INSERT
    // against UNIQUE(user.email), or the provisioner's own activation fence — and nothing it
    // intended is written. That is the designed outcome, not a failure, so it is swallowed here
    // rather than counted as an attempt: dead-lettering a benign race would strand a real
    // customer's workspace behind an operator queue for no reason. Any other error still throws,
    // and the relay retries it.
    //
    // The batch itself — the owner user, the audit row, the member.provision row carrying the
    // Owner/Admin role, the activation fence and the status flip — commits atomically. There is no
    // idempotency record: the relay's at-least-once delivery plus the provisioner's own state
    // guards are the exactly-once story, and a later delivery finds the firm already active.
    let activated = true;
    try {
      await commitEffectBatch(env.DB_CONTROL, outcome.finalWrite, {
        now: () => new Date().toISOString(),
      });
    } catch (caught) {
      if (!isUserEmailConflict(caught) && !isFirmActivationConflict(caught)) throw caught;
      activated = false;
    }
    if (activated && payload.owner.userId === undefined && credentialHash === undefined) {
      // NO MAIL IS SENT ON THIS PATH ANY MORE, except for one shrinking case. An owner who
      // registered chose their password then, and the activation batch above committed it with
      // their user row — so the workspace and the way into it arrive together and there is nothing
      // to wait for. Nor is one sent when the founder already had an account (the account-first
      // door): an unasked-for reset link is what a takeover looks like.
      //
      // What remains is a registration started BEFORE passwords were chosen at registration, whose
      // owner has no credential and no way to make one without this link. It is sent only by the
      // pass that actually activated, so a redelivery or a lost race does not mail a second link.
      //
      // A FAILURE HERE NEITHER THROWS NOR IS VISIBLE TO THIS FUNCTION, and both halves are
      // deliberate. Better Auth awaits the send and swallows what it throws into its own logger
      // (runInBackgroundOrAwait, context/create-context.mjs), so this call resolves either way and a
      // try/catch around it would be dead code — the failure is caught one layer down, at the port
      // app.ts hands the library, where it is counted and correlated.
      //
      // That is also the right outcome for a consumer, because the queue's retry cannot fix it: a
      // redelivery finds the firm already active, takes the `already-active` branch, and never
      // reaches this line. Throwing would burn the relay's attempts, skip the registration → firm
      // write below, and still mail nobody. The firm is real and the owner's recovery is Reset
      // Password from the sign-in screen; what this path owes is that somebody KNOWS, which is the
      // counter one layer down.
      await authForEnv(env).api.requestPasswordReset({ body: { email: outcome.ownerEmail } });
    }
  }

  // Record which firm the registration became, on both outcomes: the already-active branch is a
  // redelivery of a row whose first pass may have died before this write.
  await env.DB_CONTROL.prepare(
    "UPDATE registration SET firm_id = ?2 WHERE id = ?1 AND firm_id IS NULL",
  )
    .bind(payload.registrationId, outcome.firmId)
    .run();
}
