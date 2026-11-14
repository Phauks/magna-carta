<script lang="ts">
  /*
   * A failed action, inline, inside a screen that still works. The app's glue over the design
   * system's FailureBand: it reads the whole failure record, so the Error ID and the remedy arrive
   * without the surface assembling either.
   *
   * `fallback` is the surface's own sentence for its own channel — used only where the server sent
   * no words of its own. That ordering is the standing ruling in
   * docs/conventions/design-corrections.md: error copy is per-channel and specific, and a shared
   * default exists so nothing renders blank, not so every channel says the same thing.
   */
  import FailureBand from "@magna-carta/design-system/failure-band";
  import FailureRemedy from "./failure-remedy.svelte";
  import { guidanceFor } from "./guidance.ts";
  import { page } from "$app/state";
  import type { Snippet } from "svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import { currentTrace } from "./current-trace.ts";
  import { failureRows } from "./failure-view.ts";
  import { failureSummaryWithId } from "./failure-summary.ts";

  let {
    failure,
    subject = "That",
    title,
    fallback,
    whenSilent,
    onRetry,
    onReport,
    onStepUp,
    onRequestAccess,
    children,
  }: {
    failure: Failure;
    /** What could not be read or done, in this surface's words. Used in the default heading. */
    subject?: string;
    /**
     * This surface's own heading. Wins over the presenter's, which is a floor and never a ceiling —
     * a pane that has already had its wording reviewed keeps it.
     */
    title?: string;
    /** This surface's own sentence, used where the server sent none. */
    fallback?: string;
    /**
     * This surface's sentence for when NOTHING ANSWERED, which is often a stronger statement than
     * the refusal one: "the name was not recorded" is a fact, where "could not be recorded" only
     * describes the attempt. Falls back to `fallback` when the surface has no separate wording.
     */
    whenSilent?: string;
    onRetry?: () => void;
    onReport?: () => void;
    onStepUp?: () => void;
    onRequestAccess?: () => void;
    /** One more thing this surface has to say, rendered after the message. */
    children?: Snippet;
  } = $props();

  const guidance = $derived(guidanceFor(failure, subject));
  const ownWords = $derived(failure.problem === null ? (whenSilent ?? fallback) : fallback);
  const message = $derived(failure.problem?.detail ?? ownWords ?? guidance.message);
  // A GETTER, as on the screen-scale surface: the trace carries the moment it was copied.
  const trace = $derived(() => currentTrace(failure, page.url.pathname));

  // Whether anything would actually render in the action row. A footer holding an empty span is a
  // gap the reader has to wonder about, so the snippet is withheld rather than rendered empty.
  const hasControl = $derived(
    onReport !== undefined ||
      guidance.remedy.kind === "signIn" ||
      (onRetry !== undefined &&
        (guidance.remedy.kind === "retry" || guidance.remedy.kind === "retryAfter")) ||
      (onStepUp !== undefined && guidance.remedy.kind === "stepUp") ||
      (onRequestAccess !== undefined && guidance.remedy.kind === "requestAccess"),
  );
</script>

{#snippet controls()}
  <FailureRemedy remedy={guidance.remedy} {onRetry} {onReport} {onStepUp} {onRequestAccess} />
{/snippet}

<FailureBand
  variant={guidance.tone}
  title={title ?? guidance.title}
  {message}
  note={guidance.note}
  errorId={failure.problem?.errorId ?? null}
  summary={failureSummaryWithId(failure)}
  rows={failureRows(failure)}
  {trace}
  actions={hasControl ? controls : undefined}
  {children}
/>
