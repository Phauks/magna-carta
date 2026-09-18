/** Where one step of a ProgressSteps sequence has got to. */
export type ProgressStepStatus = "pending" | "active" | "done" | "failed";

export interface ProgressStep {
  /** What this step is, as a short phrase. Doubles as the list key, so it is unique in a sequence. */
  label: string;
  status: ProgressStepStatus;
  /**
   * What went wrong, shown INSTEAD of the label when the status is failed — so the failed step
   * reads as one sentence rather than a struck-out step plus an error somewhere else.
   */
  failure?: string;
  /**
   * A short fact beside the step, right-aligned and muted: when it happened, how long it took.
   * A number a reader scans rather than reads, so it is hidden from the live region — a note that
   * ticks would otherwise be announced on every tick, and the label already says what moved.
   */
  note?: string;
}
