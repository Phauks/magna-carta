/*
 * Packet loss is relayed through a TURN server, and the credentials for it are minted by an
 * authenticated route. Ask whether they can be had BEFORE telling the engine to measure: a refused
 * credential mid-run aborts the entire test, taking the bandwidth and latency results with it.
 *
 * Each refusal names itself, so the page can say which of them happened instead of showing a blank.
 */
export const TURN_CREDENTIALS_URL = "/api/v1/tools/turn-credentials";

export type TurnUnavailableReason =
  | "unauthenticated"
  | "forbidden"
  | "not-configured"
  | "unavailable";

export type TurnCapability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: TurnUnavailableReason };

/** `fetchStatus` answers the HTTP status, or throws on a transport failure. */
export async function probeTurnCapability(
  fetchStatus: (url: string) => Promise<number>,
): Promise<TurnCapability> {
  let status: number;
  try {
    status = await fetchStatus(TURN_CREDENTIALS_URL);
  } catch {
    return { available: false, reason: "unavailable" };
  }

  if (status === 200) return { available: true };
  if (status === 401) return { available: false, reason: "unauthenticated" };
  if (status === 403) return { available: false, reason: "forbidden" };
  if (status === 503) return { available: false, reason: "not-configured" };
  return { available: false, reason: "unavailable" };
}

/** What the Packet loss tile says when the measurement could not be attempted. */
export function turnUnavailableNote(reason: TurnUnavailableReason): string {
  switch (reason) {
    case "unauthenticated":
      return "Sign in to measure packet loss.";
    case "forbidden":
      return "Your account does not carry permission to measure packet loss.";
    case "not-configured":
      return "This deployment is not set up to measure packet loss.";
    case "unavailable":
      return "The relay needed to measure packet loss could not be reached.";
  }
}
