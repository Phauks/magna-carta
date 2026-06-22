import { DurableObject } from "cloudflare:workers";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../app.ts";
import {
  bindTimer,
  pauseTimer,
  resumeTimer,
  startTimer,
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

  // The abandoned alarm fires only for a still-live timer (start sets it; stop/discard/replace cancel or
  // reschedule it). Marking abandoned does not auto-commit or auto-discard — the next interaction
  // surfaces keep / trim / discard. Completed with the stop-commit behaviour in the next task.
  override async alarm(): Promise<void> {
    // Abandoned-flag transition is implemented with the stop-commit behaviour.
  }
}
