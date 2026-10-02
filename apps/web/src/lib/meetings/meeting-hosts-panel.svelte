<script lang="ts">
  /*
   * Who is running this meeting, and the two things that can be done about it from one place.
   *
   * IT IS A READING PANEL. A member opens it to find out who to ask for the floor at least as often
   * as to change anything, so its action bar carries only the way out and each step is offered in
   * place, beside the fact it changes — the house shape for exactly this case.
   *
   * IT IS OPEN TO EVERYBODY IN THE ROOM, because the grants read rides on the permission to join
   * rather than on the permission to host: everybody in a meeting needs to know who is running it,
   * and hiding that from the people it governs would be a strange kind of privacy. What changes with
   * the reader is what they may DO here.
   *
   * CLAIMING IS THE EXIT FROM A ROOM NOBODY IS RUNNING. Hosting does not pass on its own when a host
   * leaves — a host whose tunnel drops for ninety seconds has not stopped hosting, and a room that
   * reassigned itself would hand a client meeting to whoever happened to be next in the roster. So a
   * member holding the key may take a room nobody is in charge of, and the record says it was
   * claimed rather than handed over, because nobody gave it.
   */
  import ShieldUser from "@lucide/svelte/icons/shield-user";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { hostRoleLabel } from "./screen/meeting-host-labels.ts";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { MeetingHostGrant } from "@magna-carta/api-client";
  import type { Snippet } from "svelte";

  let {
    open = $bindable(false),
    subject,
    grants,
    loading = false,
    failed = false,
    nameOf,
    canWithdraw = false,
    canClaim = false,
    onWithdraw,
    onClaim,
    readFailure,
    writeFailure,
  }: {
    open?: boolean;
    /** Which meeting this is about, named once. */
    subject: RecordSubject;
    /** The live grants, or null while the read is in flight. */
    grants: readonly MeetingHostGrant[] | null;
    loading?: boolean;
    failed?: boolean;
    /**
     * What a member is called, resolved from the roster this browser already holds. The grants carry
     * member handles and nothing else, and a panel that printed a handle at a reader would be
     * answering "who is running this" with a string nobody recognises.
     */
    nameOf: (userId: string) => string;
    /** Whether the reader may withdraw a co-host. The host's own act. */
    canWithdraw?: boolean;
    /** Whether this room has nobody running it and the reader may take it. */
    canClaim?: boolean;
    onWithdraw: (userId: string) => void;
    onClaim: () => void;
    /** The read's refusal, in the app's own words. */
    readFailure?: Snippet;
    /** A refused write, in the app's own words. */
    writeFailure?: Snippet;
  } = $props();
</script>

<ActionDialog bind:open kind="reading" heading="Hosts" subtitle={subject} width="narrow">
  {#snippet notice()}
    {@render writeFailure?.()}
  {/snippet}

  {#snippet fields()}
    <LoadingRegion class="flex flex-col gap-12" {loading} label="Reading who is hosting" {failed}>
      {#snippet failure()}
        {@render readFailure?.()}
      {/snippet}

      <!-- The structure renders first and states its own emptiness inside itself: a room with no
           live grant is the state the claim exists for, and a sentence standing where the list
           would be is how a reader learns nothing loaded. -->
      <ul class="flex flex-col gap-8">
        {#each grants ?? [] as grant (grant.userId)}
          <li class="flex items-center gap-8">
            <ShieldUser class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-sm">{nameOf(grant.userId)}</span>
            <span class="text-xs text-text-muted">{formatInstant(grant.grantedAt)}</span>
            <Badge variant="neutral" caps>{hostRoleLabel(grant.role)}</Badge>
            {#if canWithdraw && grant.role === "co-host"}
              <Button variant="ghost" size="sm" onclick={() => onWithdraw(grant.userId)}>
                Withdraw
              </Button>
            {/if}
          </li>
        {:else}
          <li class="text-sm text-text-muted">Nobody is running this meeting.</li>
        {/each}
      </ul>

      {#if canClaim}
        <!-- The step offered in place, beside the fact it changes. It is not in the action bar,
             because most readers open this to find out who to ask rather than to take the room. -->
        <Button variant="secondary" onclick={onClaim}>
          <ShieldUser class="size-16" aria-hidden="true" />
          Claim Hosting
        </Button>
      {/if}
    </LoadingRegion>
  {/snippet}
</ActionDialog>
