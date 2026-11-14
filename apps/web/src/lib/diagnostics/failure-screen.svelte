<script lang="ts">
  /*
   * A panel or a screen that could not be read. The app's glue over the design system's
   * FailureState: it turns one failure record into the heading, the sentence, the four facts, the
   * whole copyable trace and the remedy, so a surface's failure branch is one element.
   *
   * `reassurance` is the sentence saying the area's record survived. It is the caller's because it
   * is the one genuinely per-area line and the most valuable sentence on the screen — a person whose
   * trust ledger will not load does not know whether the money is gone.
   */
  import { page } from "$app/state";
  import FailureState from "@magna-carta/design-system/failure-state";
  import FailureRemedy from "./failure-remedy.svelte";
  import { guidanceFor } from "./guidance.ts";
  import { failureRows, STANDARD_REMEDY_STEPS } from "./failure-view.ts";
  import { currentTrace } from "./current-trace.ts";
  import { failureSummaryWithId } from "./failure-summary.ts";
  import type { Failure } from "$lib/api/problem.ts";

  let {
    failure,
    subject = "That",
    fallback,
    reassurance,
    scale = "panel",
    steps,
    onRetry,
    onReport,
    onStepUp,
    onRequestAccess,
  }: {
    failure: Failure;
    subject?: string;
    /** This surface's own sentence, used where the server sent none. */
    fallback?: string;
    /** This area's statement that its record is unharmed. */
    reassurance?: string;
    /**
     * `panel` replaces one panel's body and stays compact. `screen` owns the body, so it carries the
     * whole trace and the ordered remedy — there is room to be complete, and nowhere else to look.
     */
    scale?: "panel" | "screen";
    /** Override the ordered remedy. Omitted at panel scale, where the rest of the screen works. */
    steps?: readonly string[];
    onRetry?: () => void;
    onReport?: () => void;
    onStepUp?: () => void;
    onRequestAccess?: () => void;
  } = $props();

  const guidance = $derived(guidanceFor(failure, subject));
  const message = $derived(failure.problem?.detail ?? fallback ?? guidance.message);
  // A GETTER, not a string: the trace carries the moment it was copied, and a block assembled when
  // the failure rendered would report that instead. It is re-read at the press.
  const trace = $derived(() => currentTrace(failure, page.url.pathname));
  const remedySteps = $derived(
    steps ?? (scale === "screen" ? STANDARD_REMEDY_STEPS : undefined),
  );
</script>

<FailureState
  title={guidance.title}
  {message}
  {reassurance}
  note={guidance.note}
  rows={failureRows(failure)}
  {trace}
  showTrace={scale === "screen"}
  steps={remedySteps}
  summary={failureSummaryWithId(failure)}
>
  {#snippet actions()}
    <FailureRemedy
      remedy={guidance.remedy}
      size={scale === "screen" ? "default" : "sm"}
      {onRetry}
      {onReport}
      {onStepUp}
      {onRequestAccess}
    />
  {/snippet}
</FailureState>
