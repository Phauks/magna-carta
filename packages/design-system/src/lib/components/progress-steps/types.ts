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
}
