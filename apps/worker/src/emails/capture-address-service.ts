import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import {
  findEmailCaptureRouteByToken,
  revokeEmailCaptureRouteStatement,
} from "@magna-carta/data-access/email-capture-route-statements";
import {
  insertEmailCaptureAddressStatement,
  revokeEmailCaptureAddressStatement,
  type CaptureAddressRow,
} from "@magna-carta/data-access/email-filing-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { mintUniqueCaptureToken } from "@magna-carta/email-filing/capture-token";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  EmailCaptureAddressId,
  FirmId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";

// A capture address is ONE logical thing stored in TWO databases that share no transaction: the
// routing half (token -> firm) in the control plane, which the inbound Email Worker reads, and the
// filing half (token -> matter, who minted it, when) in the firm's own database, which the capture
// consumer reads. Every operation here therefore has to choose an order, and the two directions get
// OPPOSITE orders — for the same reason in both cases: whichever half is written first is the half
// whose failure is safe.
//
//   MINT writes the per-firm row and a transactional-outbox row in ONE atomic per-firm batch, and
//   lets the relay carry the control-plane insert. If the relay has not run yet, the address exists
//   but does not route: mail sent to it bounces and nothing is lost. The alternative order would
//   leave a token routing to a firm with no record of what it is for — mail arriving at an address
//   the firm cannot see. Convergence is the relay's at-least-once retry, so this is a delay, never a
//   silent half-write.
//
//   REVOKE and ROTATE write the control plane FIRST, un-batched, and only then the per-firm row.
//   Revocation is a security operation and must fail closed: the instant the control-plane row flips,
//   routing stops. If the per-firm write then fails, the address is already dead — it is a stale row,
//   not a live credential — and a retry cleans it up.

// The per-firm outbox topic the relay sweeps onto the shared per-firm queue. Its consumer performs
// the control-plane insert (capture-route-consumer.ts).
export const CAPTURE_ROUTE_TOPIC = "emailCaptureAddress.minted";

export interface CaptureRouteRegistrationPayload {
  readonly token: string;
  readonly firmId: FirmId;
}

// How many fresh candidates the mint will try before giving up. The token carries ~103 bits, so a
// real collision is astronomically improbable; more than a couple of failures means the random source
// is broken, and looping would only hide that.
const MINT_ATTEMPTS = 3;

export interface MintCaptureAddressInput {
  readonly firmId: FirmId;
  readonly kind: "matter" | "catchAll";
  readonly matterId: MatterId | null;
  readonly createdBy: UserId | null;
}

export interface ComposedMint {
  readonly emailCaptureAddressId: EmailCaptureAddressId;
  readonly token: string;
  readonly statements: EffectWrite["statements"];
  readonly outboxMessages: EffectWrite["outboxMessages"];
}

// Mint a token that is free in the GLOBAL routing index, and compose the per-firm writes that claim
// it. Nothing is committed here — the caller batches these statements with its idempotency record so
// the address row and the outbox row that makes it routable can never come apart.
//
// The freeness probe is a READ against the control plane, not a claim: the actual claim happens in
// the relay's insert, which is guarded by the token primary key. The probe exists so the vanishingly
// rare collision is resolved at mint time (by picking another token) instead of dead-lettering an
// outbox row that can no longer be satisfied — the per-firm row would already own the losing token.
export async function composeCaptureAddressMint(
  controlPlaneDatabase: SqlDatabase,
  firmDatabase: SqlDatabase,
  input: MintCaptureAddressInput,
  now: string,
): Promise<ComposedMint> {
  const token = await mintUniqueCaptureToken(
    async (candidate) =>
      (await findEmailCaptureRouteByToken(controlPlaneDatabase, candidate)) === null,
    { maxAttempts: MINT_ATTEMPTS },
  );
  const emailCaptureAddressId = newIdentifier("emailCaptureAddress");
  const payload: CaptureRouteRegistrationPayload = { token, firmId: input.firmId };
  return {
    emailCaptureAddressId,
    token,
    statements: [
      insertEmailCaptureAddressStatement(
        firmDatabase,
        {
          id: emailCaptureAddressId,
          token,
          kind: input.kind,
          matterId: input.matterId,
          createdBy: input.createdBy,
        },
        now,
      ),
    ],
    // aggregateKey is the token itself: a mint and any later registration touching the same token
    // apply in the order they were written, and the relay's seq makes that ordering explicit.
    outboxMessages: [{ topic: CAPTURE_ROUTE_TOPIC, payload, aggregateKey: token }],
  };
}

// Stop an address routing. The flip is committed on its own, BEFORE the per-firm statement is even
// composed — the whole point of the ordering is that no later failure can leave the token still
// delivering mail. Returns nothing: the statement is guarded on the row being live and scoped to the
// owning firm, so calling this twice is a no-op and the caller never has to distinguish "revoked now"
// from "was already revoked".
export async function revokeCaptureRouteFirst(
  controlPlaneDatabase: SqlDatabase,
  firmId: FirmId,
  token: string,
  now: string,
): Promise<void> {
  await revokeEmailCaptureRouteStatement(controlPlaneDatabase, { token, firmId }, now).run();
}

// The per-firm half of a revoke — composed, not committed, so it can ride the caller's batch
// (a rotate retires the old row and inserts the new one in one commit).
export function composeCaptureAddressRevoke(
  firmDatabase: SqlDatabase,
  emailCaptureAddressId: EmailCaptureAddressId,
  now: string,
): EffectWrite["statements"] {
  return [revokeEmailCaptureAddressStatement(firmDatabase, emailCaptureAddressId, now)];
}

// The response shape a list returns: metadata plus a masked token, never the value. The token IS the
// credential — anyone holding it can post mail into the firm — so it is disclosed exactly once, in
// the response to the mint or rotate that created it, and never read back.
export interface CaptureAddressSummary {
  readonly emailCaptureAddressId: EmailCaptureAddressId;
  readonly kind: "matter" | "catchAll";
  readonly matterId: MatterId | null;
  readonly active: boolean;
  readonly tokenPreview: string;
  readonly createdBy: UserId | null;
  readonly createdAt: string;
  readonly rotatedAt: string | null;
}

export function summarizeCaptureAddress(
  row: CaptureAddressRow,
  maskToken: (token: string) => string,
): CaptureAddressSummary {
  return {
    emailCaptureAddressId: row.id,
    kind: row.kind,
    matterId: row.matterId,
    active: row.active,
    tokenPreview: maskToken(row.token),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt,
  };
}
