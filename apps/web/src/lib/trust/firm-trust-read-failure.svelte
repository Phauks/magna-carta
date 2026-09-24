<script lang="ts">
  /*
   * One section of the firm's Trust panel saying its own read failed, with the way to ask again.
   *
   * EACH READ FAILS ON ITS OWN, and the panel keeps standing around it: a firm whose statements
   * cannot be read still has an approval queue somebody owes an answer to. So the heading and the
   * sentence are the SECTION'S — what question went unanswered, and what is therefore not true —
   * never a shared line that would say the same thing about six different reads.
   *
   * IT CARRIES THE WHOLE FAILURE RECORD RATHER THAN A SENTENCE ABOUT IT. A bare alert over a
   * hard-coded line drops the two things a reader can act on: the Error ID that makes the failure
   * traceable to whoever administers their account, and the remedy the server named. Handing the
   * record to FailureNotice is what makes a refusal read as a refusal, a deploy skew read as a
   * deploy skew, and a retry appear only where retrying could work.
   *
   * THE SURFACE'S OWN SENTENCE IS A FLOOR. Where the server sent words of its own they win, which
   * is the standing ruling that error copy is per-channel and specific.
   */
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";

  let {
    failure,
    title,
    fallback,
    onRetry,
  }: {
    /** The whole record of what failed, so the Error ID and the remedy arrive with it. */
    failure: Failure;
    /** This section's own heading, naming the question that went unanswered. */
    title: string;
    /** This section's own sentence, used where the server sent none of its own. */
    fallback: string;
    /** How this section asks for its read again. */
    onRetry: () => void;
  } = $props();
</script>

<FailureNotice {failure} {title} {fallback} {onRetry} />
