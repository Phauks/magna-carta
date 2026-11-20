import type { RandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import type { ClockPort } from "@magna-carta/ledger/types";

// The service shape every package here shares: no clock read, no ambient randomness, no ambient
// identity. All three are injected; the route commits what a service returns.
export interface GeneralLedgerServiceOptions {
  readonly clock: ClockPort;
  readonly randomSource?: RandomSource;
  readonly actorUserId: UserId;
}
