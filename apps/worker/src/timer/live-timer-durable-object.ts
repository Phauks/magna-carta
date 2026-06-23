import { DurableObject } from "cloudflare:workers";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../app.ts";
import {
  beginCommit,
  bindTimer,
  markAbandoned,
  pauseTimer,
  resumeTimer,
  startTimer,
  trimToLastActivity,
  type TimerBinding,
  type TimerState,
} from "./timer-runtime.ts";

// The per-timekeeper live timer — one Durable Object instance per `${firmId}:${userId}`, firm-namespaced
// so a timer never holds another firm's state. It is a pure coordinator over the transient timer state,
// NOT a business-data store: a committed time entry is written by the route through the data-access
// chokepoint into per-firm D1, never here. The DO holds one JSON blob in its own key-value storage and
// hibernates between interactions, so elapsed time is computed client-side from startedAt and the DO
// never ticks — keeping its cost negligible. One alarm marks an abandoned run (set on start, cancelled
// on stop/discard, rescheduled on a replacing start).

const STATE_KEY = "timer";

export interface StartInput extends TimerBinding {
  readonly abandonedThresholdMinutes: number;
}

export class LiveTimerDurableObject extends DurableObject<Bindings> {
  private async load(): Promise<TimerState | null> {
    return (await this.ctx.storage.get<TimerState>(STATE_KEY)) ?? null;
  }

  // Persist first, then schedule/cancel the alarm — storage is the source of truth the next wake reads.
  private async save(state: TimerState): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, state);
  }

  // Start (or replace) the timer: stops any current run, mints a stable live_run_id, and (re)sets the
  // abandoned alarm. The run id is a timeEntry-shaped handle so the route can derive the entry handle
  // and the chokepoint idempotency key deterministically from it at stop-commit.
  async start(input: StartInput): Promise<{ liveRunId: string; startedAt: string }> {
    const now = new Date(Date.now()).toISOString();
    const liveRunId = newIdentifier("timeEntry");
    const { abandonedThresholdMinutes, ...binding } = input;
    const state = startTimer({ liveRunId, now, binding });
    await this.save(state);
    await this.ctx.storage.setAlarm(Date.now() + abandonedThresholdMinutes * 60_000);
    return { liveRunId, startedAt: now };
  }

  async pause(): Promise<TimerState | null> {
    const state = await this.load();
    if (state === null) return null;
    const next = pauseTimer(state, new Date(Date.now()).toISOString());
    await this.save(next);
    return next;
  }

  async resume(): Promise<TimerState | null> {
    const state = await this.load();
    if (state === null) return null;
    const next = resumeTimer(state, new Date(Date.now()).toISOString());
    await this.save(next);
    return next;
  }

  async bind(binding: TimerBinding): Promise<TimerState | null> {
    const state = await this.load();
    if (state === null) return null;
    const next = bindTimer(state, binding, new Date(Date.now()).toISOString());
    await this.save(next);
    return next;
  }

  async read(): Promise<TimerState | null> {
    return this.load();
  }

  // Clear the timer and cancel the pending alarm — used for the discard resolution and the route's
  // clear-after-confirmed-commit call.
  async discard(): Promise<void> {
    await this.ctx.storage.delete(STATE_KEY);
    await this.ctx.storage.deleteAlarm();
  }

  // The single-threaded compare-and-set the route's idempotent commit anchors on. The first stop flips
  // the live run to `committing` and cancels the alarm; a concurrent second stop sees it already
  // committing and returns the SAME live_run_id, so two racing commits derive one chokepoint
  // idempotency key + one time-entry handle and collapse to a single entry. An idle DO is refused.
  // Route wiring (composing the time_entry, calling the chokepoint, clearing the DO) is handled in
  // the timer routes, wired in the timer routes task.
  async stopAndCommit(): Promise<{
    liveRunId: string | null;
    state: "committing" | "already-committing" | "already-committed" | "unbound" | "no-run";
  }> {
    const state = await this.load();
    // An idle DO has no run to stop, and a scratch timer has no matter to bill — both are returned as
    // discriminated outcomes, not thrown. A throw across the DO RPC boundary surfaces as an unhandled
    // rejection in the workers runtime even when the caller catches it; the route maps every outcome
    // to its own response (no-run -> 409, unbound -> 422, committing -> the WIP->A/R-free commit path).
    if (state === null) {
      return { liveRunId: null, state: "no-run" };
    }
    const { state: next, outcome } = beginCommit(state);
    if (outcome === "unbound") {
      return { liveRunId: next.liveRunId, state: "unbound" };
    }
    if (outcome === "committing") {
      await this.save(next);
      // The run is leaving the live state — no abandoned alarm should fire against a committing run.
      await this.ctx.storage.deleteAlarm();
    }
    return { liveRunId: next.liveRunId, state: outcome };
  }

  // The next-interaction resolution of an abandoned run: keep (leave the captured span for a normal
  // stop-commit), trim (clamp elapsed to the last recorded activity), or discard (clear entirely).
  // Returns the resolved state, or null when discarded or no run exists.
  async resolveAbandoned(resolution: "keep" | "trim" | "discard"): Promise<TimerState | null> {
    const state = await this.load();
    if (state === null) return null;
    if (resolution === "discard") {
      await this.discard();
      return null;
    }
    // keep restores the run to running as-is; trim additionally clamps elapsed to lastActivityAt.
    const restored: TimerState = { ...state, status: "running" };
    const next = resolution === "trim" ? trimToLastActivity(restored) : restored;
    await this.save(next);
    return next;
  }

  // The abandoned alarm fires only for a still-live timer (start sets it; stop/discard/replace cancel or
  // reschedule it), so reaching here means the run was never stopped. Flag it abandoned — no auto-commit,
  // no auto-discard; the next interaction surfaces keep / trim / discard.
  override async alarm(): Promise<void> {
    const state = await this.load();
    if (state === null) return;
    await this.save(markAbandoned(state));
  }
}
