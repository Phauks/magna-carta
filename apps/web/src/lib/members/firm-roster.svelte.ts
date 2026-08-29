/*
 * The firm's roster, read once and shared.
 *
 * Three surfaces want the same list — the issue-report composer addressing colleagues, the
 * change-request composer, and the docket resolving responsible-attorney names — and the answer is
 * the same list for all of them. A per-surface read would be the same request three times on one
 * page load, and three places for "what if it fails" to drift; so the read is here, it happens once,
 * and a second caller joins the request already in flight rather than starting another.
 *
 * The roster is NOT cached across sessions or refreshed on a timer. It changes when a person joins
 * or leaves the firm, which is a page-load-scale event, and a stale name is a worse failure than a
 * re-read.
 */
import { listFirmMembers, type FirmMemberSummary } from "./members-api.ts";

export class FirmRoster {
  /** Null until the read lands — the loading state, distinct from a firm with no members. */
  members = $state<readonly FirmMemberSummary[] | null>(null);
  /** What to say when the roster could not be read; null while it is fine or still in flight. */
  failure = $state<string | null>(null);

  /** The read in flight, so a second caller joins it instead of starting a second request. */
  #inFlight: Promise<void> | null = null;

  /** The firm's members who are still here — what a picker offers. */
  get active(): readonly FirmMemberSummary[] {
    return (this.members ?? []).filter((member) => member.status === "active");
  }

  /**
   * Read the roster, at most once. Safe to call from every consumer's `$effect`: the first call does
   * the work, the rest await it, and a call after it has landed is a no-op.
   */
  async load(fetchImpl: typeof fetch): Promise<void> {
    if (this.members !== null) return;
    this.#inFlight ??= this.#read(fetchImpl);
    await this.#inFlight;
  }

  async #read(fetchImpl: typeof fetch): Promise<void> {
    const outcome = await listFirmMembers(fetchImpl);
    if (outcome.kind === "ok") {
      this.members = outcome.value.data;
      this.failure = null;
    } else {
      // The roster is not the screen's subject anywhere it is used, so a failure never fails the
      // screen: it settles as an empty roster plus a sentence the consumer can show beside the
      // control that is now empty. A member refused the read (403) is told the same thing as a
      // member whose request did not arrive, because the remedy — ask an administrator — is the
      // same, and naming the permission at somebody who cannot grant it themselves is noise.
      this.members = [];
      this.failure =
        outcome.kind === "problem" && outcome.problem.status === 403
          ? "Your account cannot read the firm's member list."
          : "The firm's member list could not be read.";
    }
    this.#inFlight = null;
  }
}

/** The shared roster. One firm, one list, one read. */
export const firmRoster = new FirmRoster();
