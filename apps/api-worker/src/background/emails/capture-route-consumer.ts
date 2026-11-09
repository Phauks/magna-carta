import {
  findEmailCaptureRouteByToken,
  insertEmailCaptureRouteStatement,
} from "@magna-carta/data-access/email-capture-route-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { isWellFormedCaptureToken } from "@magna-carta/email-filing/capture-token";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { CaptureRouteRegistrationPayload } from "../../emails/capture-address-service.ts";

// The consumer that completes a capture-address mint: it writes the control-plane routing row the
// inbound Email Worker reads. The mint committed the per-firm address row and this message in one
// atomic per-firm batch, so the message existing is proof the address exists; until this runs, the
// address is real but not yet routable (see capture-address-service.ts for why that direction is the
// safe one).
//
// The whole handler is idempotent, because the relay is at-least-once and sweeps may overlap: the
// insert is ON CONFLICT DO NOTHING, and a zero-change result is then reconciled against the row that
// won rather than assumed benign.

// A malformed payload THROWS rather than being skipped: the relay increments attempts and
// dead-letters at max, which surfaces a producer bug instead of quietly leaving a firm's capture
// address permanently unroutable. Every failure carries the topic + row id prefix so the parked row
// is identifiable from telemetry alone (the payload itself is never logged).
export function parseCaptureRouteRegistrationPayload(
  rowId: string,
  payload: string,
): CaptureRouteRegistrationPayload {
  try {
    const parsed = JSON.parse(payload) as { token?: unknown; firmId?: unknown };
    if (typeof parsed.token !== "string" || !isWellFormedCaptureToken(parsed.token)) {
      throw new Error("malformed capture token");
    }
    return { token: parsed.token, firmId: assertIdentifier(parsed.firmId, "firm") };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new Error(`emailCaptureAddress.minted ${rowId}: ${message}`, { cause: caught });
  }
}

// Register the token in the global routing index. Three outcomes:
//   - the insert lands: the address is now routable;
//   - the token is already this firm's: a redelivery or an overlapping sweep, nothing to do;
//   - the token is ANOTHER firm's: refuse loudly. Adopting it would route that firm's mail into this
//     one, so this fails and dead-letters instead. The mint's freeness probe makes this practically
//     unreachable, but "practically unreachable" is not a reason to fail open on a cross-tenant leak.
//
// A row this firm has already REVOKED is left revoked: ON CONFLICT DO NOTHING never resurrects it,
// which is what keeps a redelivered mint message from undoing a revocation that came after it.
export async function registerCaptureRoute(
  controlPlaneDatabase: SqlDatabase,
  rowId: string,
  payload: CaptureRouteRegistrationPayload,
  now: string,
): Promise<void> {
  const inserted = await insertEmailCaptureRouteStatement(
    controlPlaneDatabase,
    { token: payload.token, firmId: payload.firmId },
    now,
  ).run();
  if (inserted.meta.changes > 0) return;

  const existing = await findEmailCaptureRouteByToken(controlPlaneDatabase, payload.token);
  if (existing === null) {
    // The insert changed nothing and no row is there to explain why — the index is not behaving as
    // its schema promises. Fail rather than report a token routable when it is not.
    throw new Error(
      `emailCaptureAddress.minted ${rowId}: the routing row neither inserted nor exists`,
    );
  }
  if (existing.firmId !== payload.firmId) {
    throw new Error(`emailCaptureAddress.minted ${rowId}: token already routes to another firm`);
  }
}

export interface CaptureRouteConsumerContext {
  readonly controlPlaneDatabase: SqlDatabase;
  readonly firmId: FirmId;
  readonly now: () => string;
}

// The topic handler the per-firm queue dispatch table calls. The firm on the message envelope and the
// firm in the payload must agree — they are written by the same batch, so a mismatch means the
// message was tampered with or crossed wires, and neither is something to write into a routing index.
export async function consumeCaptureRouteRegistration(
  context: CaptureRouteConsumerContext,
  rowId: string,
  payload: string,
): Promise<void> {
  const parsed = parseCaptureRouteRegistrationPayload(rowId, payload);
  if (parsed.firmId !== context.firmId) {
    throw new Error(
      `emailCaptureAddress.minted ${rowId}: payload firm does not match the originating firm`,
    );
  }
  await registerCaptureRoute(context.controlPlaneDatabase, rowId, parsed, context.now());
}
