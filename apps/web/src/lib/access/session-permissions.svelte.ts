/*
 * The session, read once and shared: who is asking, and what they may do.
 *
 * Twenty-seven surfaces each read the bootstrap for the same permission list, and a field that can
 * make a directory record needs the same answer from inside a dialog, inside a pane, inside a
 * picker — places that have no screen to hand it down from. So the read lives here on the roster's
 * pattern (src/lib/members/firm-roster.svelte.ts): the first caller does the work, later callers join
 * the request in flight, and a call after it has landed is a no-op. Screens that already read the
 * session for themselves keep doing so; this is for the controls that cannot.
 *
 * NOT cached across sign-ins or refreshed on a timer: a permission changes when an administrator
 * changes it, which is a page-load-scale event.
 */
import {
  readSession,
  type SessionBootstrap,
  type SessionReadOptions,
} from "$lib/matters/matters-api.ts";

export class SessionPermissions {
  /** Null until the read lands — distinct from a session that holds no permission at all. */
  session = $state<SessionBootstrap | null>(null);
  /** True once the read has answered, however it answered. */
  settled = $state(false);
  /** True when the read answered and it was not a session: a failed read is not a permission not held. */
  failed = $state(false);

  #inFlight: Promise<void> | null = null;

  /** Whether the session holds `permission`. False until the read lands, so a control errs refused. */
  holds(permission: string): boolean {
    return this.session?.permissions.includes(permission) ?? false;
  }

  async load(fetchImpl: typeof fetch): Promise<void> {
    if (this.settled) return;
    this.#inFlight ??= this.#read(fetchImpl);
    await this.#inFlight;
  }

  /**
   * Ask the server again, past the cache. For a caller that has just changed what the session says —
   * moving the firm's release channel changes the flags the session carries — so the answer it holds
   * is known to be out of date rather than merely old.
   */
  async reread(fetchImpl: typeof fetch): Promise<void> {
    if (this.#inFlight !== null) await this.#inFlight;
    this.settled = false;
    this.#inFlight = this.#read(fetchImpl, { fresh: true });
    await this.#inFlight;
  }

  async #read(fetchImpl: typeof fetch, options: SessionReadOptions = {}): Promise<void> {
    const outcome = await readSession(fetchImpl, options);
    this.session = outcome.kind === "ok" ? outcome.value : null;
    this.failed = outcome.kind !== "ok";
    this.settled = true;
    this.#inFlight = null;
  }
}

/** The shared session. One reader, one answer, one read. */
export const sessionPermissions = new SessionPermissions();
