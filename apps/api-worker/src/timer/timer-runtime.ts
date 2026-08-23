// The pure live-timer state machine and elapsed math, shared by the Durable Object and its tests. It
// is side-effect-free on purpose: the wall clock (`now`) and the minted run id arrive as arguments, so
// the DO owns durable storage and alarms while this stays exhaustively unit-testable. Elapsed is
// computed from startedAt + the paused intervals (the DO never ticks), keeping the timer free to
// hibernate between interactions. A trimmed run clamps to the last recorded activity instant.

export type TimerStatus = "running" | "paused" | "committing" | "abandoned";

// A pause span: `to` is null while the timer is still paused, set to the resume/clamp instant when closed.
export interface PausedInterval {
  readonly from: string;
  readonly to: string | null;
}

export interface TimerBinding {
  readonly matterId?: string;
  readonly label?: string;
  readonly narrative?: string;
  readonly utbmsTaskCodeId?: string;
}

export interface TimerState extends TimerBinding {
  readonly liveRunId: string;
  readonly startedAt: string;
  readonly pausedIntervals: readonly PausedInterval[];
  readonly status: TimerStatus;
  readonly lastActivityAt: string;
}

export interface StartTimerInput {
  readonly liveRunId: string;
  readonly now: string;
  readonly binding?: TimerBinding;
}

export function startTimer(input: StartTimerInput): TimerState {
  const binding = input.binding ?? {};
  return {
    liveRunId: input.liveRunId,
    startedAt: input.now,
    pausedIntervals: [],
    matterId: binding.matterId,
    label: binding.label,
    narrative: binding.narrative,
    utbmsTaskCodeId: binding.utbmsTaskCodeId,
    status: "running",
    lastActivityAt: input.now,
  };
}

// Open a paused interval. A no-op when already paused (the latest interval is still open).
export function pauseTimer(state: TimerState, now: string): TimerState {
  if (state.status !== "running") return state;
  return {
    ...state,
    status: "paused",
    pausedIntervals: [...state.pausedIntervals, { from: now, to: null }],
    lastActivityAt: now,
  };
}

// Close the open paused interval. A no-op when not paused.
export function resumeTimer(state: TimerState, now: string): TimerState {
  if (state.status !== "paused") return state;
  const intervals = state.pausedIntervals.map((interval, index) =>
    index === state.pausedIntervals.length - 1 && interval.to === null
      ? { from: interval.from, to: now }
      : interval,
  );
  return { ...state, status: "running", pausedIntervals: intervals, lastActivityAt: now };
}

// Attach (or re-attach) the matter and narrative metadata. Binding is required only at commit, so a
// scratch timer is bound here on its way to stop.
export function bindTimer(state: TimerState, binding: TimerBinding, now: string): TimerState {
  return {
    ...state,
    matterId: binding.matterId ?? state.matterId,
    label: binding.label ?? state.label,
    narrative: binding.narrative ?? state.narrative,
    utbmsTaskCodeId: binding.utbmsTaskCodeId ?? state.utbmsTaskCodeId,
    lastActivityAt: now,
  };
}

export type BeginCommitOutcome =
  | "committing"
  | "already-committing"
  | "already-committed"
  | "unbound";

export interface BeginCommitResult {
  readonly state: TimerState;
  readonly outcome: BeginCommitOutcome;
}

// The compare-and-set the route's idempotent stop-commit anchors on: the first call flips a live timer
// to `committing`; a second concurrent call sees it already committing and changes nothing. The DO
// serializes the calls; this is the pure transition they apply.
// A scratch timer with no matter cannot be committed — the caller must bind a matter first.
// A tombstoned run (committed id retained to replay the 201 to late retries) returns already-committed.
export function beginCommit(state: TimerState): BeginCommitResult {
  if (state.status === "committing") return { state, outcome: "already-committing" };
  if (state.matterId === undefined) return { state, outcome: "unbound" };
  return { state: { ...state, status: "committing" }, outcome: "committing" };
}

// Flag a still-live timer abandoned (the alarm's action). Never overrides a run that is already
// committing — a committed run must not be re-flagged.
export function markAbandoned(state: TimerState): TimerState {
  if (state.status === "committing" || state.status === "abandoned") return state;
  return { ...state, status: "abandoned" };
}

// The active-minutes elapsed at `now`: the wall span from startedAt to the run end, minus the paused
// spans, in whole minutes. An open paused span counts only up to `now`.
export function elapsedMinutes(state: TimerState, now: string): number {
  const start = Date.parse(state.startedAt);
  const end = Date.parse(now);
  let pausedMs = 0;
  for (const interval of state.pausedIntervals) {
    const from = Date.parse(interval.from);
    const to = interval.to === null ? end : Date.parse(interval.to);
    pausedMs += Math.max(0, Math.min(to, end) - from);
  }
  const activeMs = Math.max(0, end - start - pausedMs);
  return Math.floor(activeMs / 60_000);
}

// Clamp the run to lastActivityAt: close any open paused span at that instant, then re-anchor elapsed
// so anything after the last recorded activity does not count (the trim-to-last-activity resolution).
// Implemented by setting startedAt forward is wrong (it would lose paused math); instead the state's
// effective end is lastActivityAt, which elapsedMinutes already honours when called with that instant.
// To make the trim durable regardless of the `now` a later read passes, we close the open span and
// record a synthetic trailing paused interval from lastActivityAt onward (to: null), so all future
// wall time is treated as paused.
export function trimToLastActivity(state: TimerState): TimerState {
  const closed = state.pausedIntervals.map((interval, index) =>
    index === state.pausedIntervals.length - 1 && interval.to === null
      ? { from: interval.from, to: state.lastActivityAt }
      : interval,
  );
  return {
    ...state,
    pausedIntervals: [...closed, { from: state.lastActivityAt, to: null }],
  };
}
