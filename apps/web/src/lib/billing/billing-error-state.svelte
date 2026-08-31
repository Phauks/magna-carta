<script lang="ts">
  /*
   * The billing read failed.
   *
   * THE FIRST THING IT SAYS IS THAT THE RECORD IS UNHARMED. A person whose bills will not load does
   * not know whether the bills are gone. The agreement and every finalized invoice are still on the
   * firm's record, and saying so before anything else is the difference between an inconvenience and
   * a panic.
   *
   * THEN IT HANDS OVER WHAT A REPORT NEEDS: the failing request, the answer, the moment, and the
   * correlation handle the server issued — stated rather than hidden behind a console, because the
   * person who can act on them is the one looking at the screen.
   */
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import { formatInstant } from "@magna-carta/design-system/formatters";

  let {
    title,
    detail,
    request,
    status = null,
    errorId = null,
    failedAt,
    onRetry,
    onReport,
  }: {
    /** What could not be read, in title case. */
    title: string;
    /** What the server or the transport said, in words a reader can act on. */
    detail: string;
    /** The call that failed, as the app made it. */
    request: string;
    status?: number | null;
    errorId?: string | null;
    failedAt: Date;
    onRetry: () => void;
    onReport: () => void;
  } = $props();
</script>

<EmptyState {title}>
  {detail} The record itself is unaffected: nothing was changed by this failure, and the agreement
  and every finalized bill are still on the firm&rsquo;s record.
  {#snippet actions()}
    <Button onclick={onRetry}>Retry</Button>
    <Button variant="secondary" onclick={onReport}>Report a Problem</Button>
  {/snippet}
</EmptyState>

<dl class="mx-auto flex max-w-md flex-col gap-4 pt-16 text-sm">
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">Request</dt>
    <dd class="text-right font-mono text-xs">{request}</dd>
  </div>
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">Answer</dt>
    <dd class="text-right tabular-nums">{status === null ? "Nothing answered" : status}</dd>
  </div>
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">Time</dt>
    <dd class="text-right tabular-nums">{formatInstant(failedAt)}</dd>
  </div>
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">Error ID</dt>
    <dd class="text-right font-mono text-xs">{errorId ?? "None issued"}</dd>
  </div>
</dl>

<ol class="mx-auto flex max-w-md list-decimal flex-col gap-4 pt-16 pl-16 text-sm text-text-muted">
  <li>Retry: a brief interruption usually clears on the next read.</li>
  <li>Check your connection, and whether the matter&rsquo;s other tabs load.</li>
  <li>If it keeps failing, report it with the Error ID above.</li>
</ol>
