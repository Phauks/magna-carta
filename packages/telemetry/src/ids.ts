// The two telemetry-minted handles, wrapping @magna-carta/identifiers so there is ONE source for
// each — the RFC 9457 problem builder delegates errorId minting here rather than calling
// newIdentifier itself, so the prefix and the mint site cannot drift apart.
//   - correlation id (correlation_): created per request, rides every event and every problem response.
//   - error id (error_): minted when an error is captured; the public key joining a user-visible
//     failure to its redacted server trace.
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CorrelationId, ErrorId } from "@magna-carta/identifiers/types";

export function newCorrelationId(): CorrelationId {
  return newIdentifier("correlation");
}

export function newErrorId(): ErrorId {
  return newIdentifier("error");
}
