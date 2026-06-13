// The two telemetry-minted handles (spec §1), wrapping @magna-carta/identifiers so there is ONE
// source for each (the slice 0·5 problem module delegates errorId minting here — Task 6).
//   - correlation id (cor_): created per request, rides every event and every problem response.
//   - error id (err_): minted when an error is captured; the public key joining a user-visible
//     failure to its redacted server trace.
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CorrelationId, ErrorId } from "@magna-carta/identifiers/types";

export function newCorrelationId(): CorrelationId {
  return newIdentifier("correlation");
}

export function newErrorId(): ErrorId {
  return newIdentifier("error");
}
