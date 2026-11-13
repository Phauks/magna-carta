// The person behind the board's pages, read once by the board's layout and shared with every board
// page through context: who they are, whether they may write, and where to sign in.

import { getContext, setContext } from "svelte";
import type { Failure } from "$lib/api/problem.ts";
import { readSession, signOut, type BoardSession } from "./board-client.ts";

const KEY = Symbol("community-board-session");

export class BoardSessionState {
  session = $state<BoardSession | null>(null);
  failure = $state<Failure | null>(null);
  loading = $state(true);

  /** The name the board shows for the signed-in member, or null for a reader. */
  readonly viewerDisplayName = $derived(
    this.session?.profile === null || this.session?.profile === undefined
      ? null
      : (this.session.profile.displayName ?? this.session.profile.suggestedDisplayName),
  );

  async refresh(): Promise<void> {
    const outcome = await readSession();
    this.loading = false;
    if (outcome.kind === "ok") {
      this.session = outcome.value;
      this.failure = null;
    } else {
      this.failure = outcome.failure;
    }
  }

  async signOut(): Promise<Failure | null> {
    const outcome = await signOut();
    if (outcome.kind !== "ok") return outcome.failure;
    await this.refresh();
    return null;
  }
}

export function provideBoardSession(): BoardSessionState {
  const state = new BoardSessionState();
  setContext(KEY, state);
  return state;
}

export function boardSession(): BoardSessionState {
  return getContext<BoardSessionState>(KEY);
}

/** The board's session where there is one; undefined in the developer console's gallery. */
export function optionalBoardSession(): BoardSessionState | undefined {
  return getContext<BoardSessionState | undefined>(KEY);
}
