// THE READ-ONLY KILL SWITCH.
//
// One key in a key-value namespace decides whether the board accepts writes. An operator sets it
// and every write endpoint refuses, in seconds, with no deploy and no code change.
//
// It is built with the first write endpoint rather than when it is first needed, and the reason is
// arithmetic: it is a few lines now, and later it is a pass across every route in the surface,
// written under pressure, during the incident that made somebody want it. The incident it exists
// for is the one where a spam run, an abusive thread, or a disclosure is arriving faster than a
// single operator can moderate — which is exactly when nobody has an hour to spend shipping the
// switch.
//
// The switch never affects reads. The board is public to read, and a board that goes dark under
// pressure looks like an outage to every prospect looking at it; refusing writes stops the bleeding
// and leaves the surface intact.

// The minimal key-value surface, declared here for the same reason the SQL surface is: this package
// depends on no platform binding type, so it can be tested with an object literal and could be
// lifted out of this repository unchanged.
export interface ReadOnlyKeyValueStore {
  get(key: string): Promise<string | null>;
}

export const BOARD_WRITES_KEY = "community:writes";

// The stored value that means "refuse writes". Any other value, and a missing key, mean writes are
// accepted — a store that is unreachable or empty must not silently take the board read-only, and a
// typo in the value must not either. The failure this ordering chooses is the recoverable one: an
// operator who misspells the value sees writes still working and fixes it, where the opposite
// default would take the board down on a typo and look like a bug.
export const WRITES_DISABLED_VALUE = "disabled";

export interface BoardAvailability {
  readonly writesAccepted: boolean;
  // The operator's own words, shown to a member whose write was refused. Absent when writes are
  // accepted.
  readonly refusalNotice?: string;
}

export const WRITES_ACCEPTED: BoardAvailability = { writesAccepted: true };

// The default notice, used when the switch is on but the operator left no message. It says what is
// true and what to do instead, because "try again later" tells a member nothing they did not
// already know.
export const DEFAULT_REFUSAL_NOTICE =
  "The community board is temporarily read only. Everything already posted is still here; new posts, comments and votes are paused. Support is unaffected and is the place for anything urgent.";

export const REFUSAL_NOTICE_KEY = "community:writes:notice";

// Reads the switch. A store failure resolves to writes-accepted rather than rejecting, for the
// reason above: the switch is a lever an operator pulls, not a dependency the board's write path
// should be able to die on.
export async function readBoardAvailability(
  store: ReadOnlyKeyValueStore,
): Promise<BoardAvailability> {
  let value: string | null;
  try {
    value = await store.get(BOARD_WRITES_KEY);
  } catch {
    return WRITES_ACCEPTED;
  }
  if (value !== WRITES_DISABLED_VALUE) return WRITES_ACCEPTED;
  let notice: string | null = null;
  try {
    notice = await store.get(REFUSAL_NOTICE_KEY);
  } catch {
    notice = null;
  }
  return {
    writesAccepted: false,
    refusalNotice: notice === null || notice === "" ? DEFAULT_REFUSAL_NOTICE : notice,
  };
}
